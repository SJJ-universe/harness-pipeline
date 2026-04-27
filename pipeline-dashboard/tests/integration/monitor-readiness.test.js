// Slice MB5 (Phase D Round 2, 2026-04-27) — monitor readiness flow.
//
// Single integration test that exercises the full operator flow that
// docs/readiness-rubric.md commits to:
//
//   monitor opt-in → hydrate → run select → filter → pin → inspector
//
// All in-memory: a real Express test instance hosting createMonitorRoutes
// + a real HarnessMonitorStore + real normalizer + real hydrate +
// stub fetch wrapped around the test server. No browser needed.
//
// Why an integration test instead of unit-only? Because the readiness
// rubric is about cross-cutting operator behaviour. The unit suite
// already proves each module works in isolation. This test proves the
// pieces work TOGETHER under one user story.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createMonitorRoutes } = require("../../src/routes/monitorRoutes");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { createEventReplayBuffer } = require("../../src/runtime/eventReplayBuffer");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");
const { hydrateMonitorStore, hydrateRunDetail } = require("../../public/js/monitor/hydrate");

// ── shared test rig ─────────────────────────────────────────────────

function makeStubExecutor(runId, opts = {}) {
  return {
    runId,
    getReplaySnapshot() { return opts.snap || { status: "idle" }; },
    getSubagentSnapshot() { return opts.subagents || []; },
  };
}

function startServer(opts) {
  const app = express();
  app.use("/api", createMonitorRoutes(opts));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      // Wrap the test server's address in a fetch-like impl.
      function _fetch(url, init = {}) {
        return new Promise((res, rej) => {
          const req = http.request({
            host: "127.0.0.1", port, path: url,
            method: (init.method || "GET").toUpperCase(),
            headers: init.headers || {},
          }, (r) => {
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf-8");
              res({
                ok: r.statusCode >= 200 && r.statusCode < 300,
                status: r.statusCode,
                async json() { return JSON.parse(text); },
                async text() { return text; },
              });
            });
            r.on("error", rej);
          });
          req.on("error", rej);
          req.end();
        });
      }
      resolve({ server, port, fetchImpl: _fetch });
    });
  });
}

// ── the readiness flow ──────────────────────────────────────────────

test("MB5 readiness flow: opt-in → hydrate → select → filter → pin → inspector", async () => {
  // 1. SETUP: real orchestrator with two runs, one active.
  const childRegistry = createChildRegistry();
  childRegistry.register({ pid: 101, kill() {} }, { label: "codex", runId: "default" });
  childRegistry.register({ pid: 202, kill() {} }, { label: "claude", runId: "session-2" });

  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 100 });
  // Pre-load some events so hydrate has something to surface.
  eventReplayBuffer.append({ type: "phase_update", data: { runId: "default", phase: "B", status: "active" } });
  eventReplayBuffer.append({ type: "tool_recorded", data: { runId: "default", tool: "Edit" } });
  eventReplayBuffer.append({ type: "tool_recorded", data: { runId: "session-2", tool: "Read" } });
  eventReplayBuffer.append({ type: "toast", data: { message: "global note" } });

  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 5,
    createExecutor: (runId) => makeStubExecutor(runId, {
      snap: {
        status: runId === "default" ? "active" : "idle",
        templateId: runId === "default" ? "general" : null,
        phase: runId === "default" ? "B" : null,
        phaseIdx: runId === "default" ? 1 : null,
        startedAt: runId === "default" ? Date.now() - 5000 : null,
      },
      subagents: runId === "default" ? [
        { session_id: "s-1", agent_type: "codex", parent_session_id: null, startedAt: Date.now() - 4000, completedAt: null, active: true },
      ] : [],
    }),
  });
  pipelineOrchestrator.getOrCreateRun("session-2");

  const { server, port, fetchImpl } = await startServer({
    pipelineOrchestrator, childRegistry, eventReplayBuffer,
  });

  try {
    // 2. OPT-IN: build a fresh monitor store as if the user just toggled
    //    ?monitor=1 on.
    const store = createMonitorStore();

    // 3. HYDRATE: bootstrap fetch should populate the store fully.
    await hydrateMonitorStore({ store, normalize, fetchImpl });
    const hydrated = store.snapshot();
    assert.ok(hydrated.server, "server summary present");
    assert.ok(hydrated.runIds.length >= 2, "both runs hydrated");
    assert.equal(hydrated.selectedRunId, "default", "default run is selected");
    assert.ok(hydrated.activeChildren.length >= 2, "active children hydrated");
    assert.ok(hydrated.events.length >= 1, "recentEvents normalised into store");

    // 4. RUN SELECT: switch to session-2. agent-tree's eventual filter
    //    should reflect the change in selectedRunId.
    store.selectRun("session-2");
    assert.equal(store.snapshot().selectedRunId, "session-2");

    // 5. PER-RUN HYDRATE: pull detail for the selected run + verify the
    //    runDetails cache fills.
    await hydrateRunDetail({ store, runId: "default", fetchImpl });
    const detail = store.snapshot().runDetails.default;
    assert.ok(detail, "runDetails.default populated");
    assert.equal(detail.run.id, "default");
    assert.ok(Array.isArray(detail.children));
    assert.equal(detail.children.length, 1, "scoped to default");
    assert.equal(detail.children[0].pid, 101);
    assert.equal(detail.subagents.length, 1, "MB2 subagent snapshot flowed through");

    // 6. FILTER: hide the "tool" scope. The store's snapshot reflects
    //    the exclusion; the timeline panel renders against this list.
    store.toggleTimelineScope("tool");
    assert.deepEqual(store.snapshot().timelineExcluded, ["tool"]);

    // 7. PIN: pick an event from the hydrated buffer, pin it, push more
    //    events to evict the original from the ring, verify the pinned
    //    one survives in pinnedEvents.
    const target = store.snapshot().events.find((e) => e.type === "phase_update");
    assert.ok(target, "phase_update envelope visible after hydrate");
    store.pinEvent(target);
    // Push enough events (with a small store) to evict the original.
    const tinyStore = createMonitorStore({ maxEvents: 3 });
    tinyStore.pushEvent(target);
    tinyStore.pinEvent(target);
    for (let i = 0; i < 5; i++) {
      tinyStore.pushEvent({ type: "tool_recorded", scope: "tool", ts: 1000 + i, payload: { i } });
    }
    assert.equal(tinyStore.snapshot().events.length, 3, "ring capped");
    assert.equal(tinyStore.snapshot().events.includes(target), false, "ring evicted target");
    assert.equal(tinyStore.snapshot().pinnedEvents.includes(target), true, "pin survived ring eviction");

    // 8. INSPECTOR: clicking the pinned event would call selectItem.
    //    Verify the store's selectedItem is set with the right payload.
    store.selectItem("event", target);
    const sel = store.snapshot().selectedItem;
    assert.equal(sel.kind, "event");
    assert.equal(sel.payload, target, "selectedItem holds the same envelope reference");

    // 9. CONTRACT STABILITY: bootstrap shape MUST still have the
    //    documented top-level keys after all this activity.
    const bootRes = await fetchImpl("/api/monitor/bootstrap");
    const boot = await bootRes.json();
    for (const k of ["server", "runs", "selectedRunId", "activeChildren", "recentEvents", "exportedAt"]) {
      assert.ok(k in boot, `bootstrap retained key: ${k}`);
    }

    // 10. RUN DETAIL CONTRACT STABILITY: same for /api/monitor/runs/:runId.
    const detailRes = await fetchImpl("/api/monitor/runs/default");
    const detailBody = await detailRes.json();
    for (const k of ["run", "recentEvents", "children", "subagents", "findings", "replayMeta", "exportedAt"]) {
      assert.ok(k in detailBody, `run detail retained key: ${k}`);
    }
  } finally {
    server.close();
  }
});

// ── readiness rubric anchor ──────────────────────────────────────────

test("MB5 readiness rubric exists in repo + claims the right total", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const rubricPath = path.join(__dirname, "../../docs/readiness-rubric.md");
  assert.ok(fs.existsSync(rubricPath), "readiness-rubric.md present");
  const text = fs.readFileSync(rubricPath, "utf-8");
  // Five categories at 0..3 stars = 15 max.
  assert.match(text, /Total 15 stars/);
  // Exit code map documented.
  assert.match(text, /total ≥ 14.*release-ready/);
  // Five top-level categories.
  for (const cat of [
    "Run visibility", "Child visibility", "Replay visibility",
    "Event integrity", "Contract stability",
  ]) {
    assert.match(text, new RegExp(cat));
  }
});

test("MB5 readiness-report.js script exists + exits with 0..3", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const scriptPath = path.join(__dirname, "../../scripts/readiness-report.js");
  assert.ok(fs.existsSync(scriptPath), "readiness-report.js present");
  const src = fs.readFileSync(scriptPath, "utf-8");
  // Exit codes documented in source.
  assert.match(src, /exit = 0/);
  assert.match(src, /exit = 1/);
  assert.match(src, /exit = 2/);
  // JSON flag supported.
  assert.match(src, /--json/);
});
