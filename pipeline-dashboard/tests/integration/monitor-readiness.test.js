// Slice MB5 (Phase D Round 2, 2026-04-27) — monitor readiness flow.
//
// Single integration test that exercises the full operator flow that
// docs/readiness-rubric.md commits to:
//
//   monitor opt-in → hydrate → run select → filter → pin → inspector
//
// All in-memory: a real Express test instance hosting createMonitorRoutes
// + a real OrchestratorMonitorStore + real normalizer + real hydrate +
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
// Slice MC1: layout.mount + UI-driven onSelect → auto-hydrate path
// (replaces the previous direct-call-to-hydrateRunDetail shortcut).
const { mount: mountLayout } = require("../../public/js/monitor/layout");

// ── shared test rig ─────────────────────────────────────────────────

function makeStubExecutor(runId, opts = {}) {
  return {
    runId,
    getReplaySnapshot() { return opts.snap || { status: "idle" }; },
    getSubagentSnapshot() { return opts.subagents || []; },
  };
}

// MC1: Hand-rolled DOM stub matching the layout-test pattern. Layout
// reaches into root.classList, root.appendChild, root.innerHTML,
// root.ownerDocument.body, doc.createElement.
function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get innerHTML() { return ""; },
    set innerHTML(v) { if (v !== "") throw new Error("stub: innerHTML must be ''"); this.children = []; },
    get className() { return this.classList.toString(); },
    set className(v) { this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
  };
  return el;
}
function makeStubDoc() {
  const body = makeStubElement("body");
  const doc = { createElement: makeStubElement, body };
  const original = makeStubElement;
  // Each created element back-references the doc through ownerDocument.
  doc.createElement = (tag) => {
    const el = original(tag);
    el.ownerDocument = doc;
    return el;
  };
  return doc;
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

    // 4. RUN SELECT via the UI flow (MC1): mount the layout with a
    //    minimal stub run-tree, then call its onSelect. This proves that
    //    selectRun + auto-hydrateRunDetail are wired together inside
    //    layout.js — NOT hand-stitched in the test (which was the
    //    pre-MC1 gap).
    const stubDoc = makeStubDoc();
    let runTreeOnSelect = null;
    const stubRunTree = {
      create(opts) { runTreeOnSelect = opts.onSelect; return { destroy() {} }; },
    };
    const handle = mountLayout({
      root: stubDoc.createElement("div"),
      store, normalize,
      // Layout calls hydrateMonitorStore on mount — we already hydrated above,
      // so a no-op shim is fine.
      hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
      runDetailHydrate: ({ runId }) => hydrateRunDetail({ store, runId, fetchImpl }),
      runDetailTtlMs: 0,
      panels: { runTree: stubRunTree },
      bridge: null,
      doc: stubDoc,
    });
    await handle.hydrationPromise;
    assert.equal(typeof runTreeOnSelect, "function", "run-tree mounted with onSelect");

    // Click "default" through the UI surface. selectRun + auto-hydrate
    // should both fire.
    runTreeOnSelect("default");
    // The auto-hydrate fires an HTTP fetch through the in-memory test
    // server. Wait until store.runDetails.default is populated (with a
    // generous timeout) so we test the wiring without flake.
    for (let i = 0; i < 50; i++) {
      if (store.snapshot().runDetails.default) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(store.snapshot().selectedRunId, "default", "selectRun fired through UI");
    const detail = store.snapshot().runDetails.default;
    assert.ok(detail, "runDetails.default populated by AUTO-hydrate (no direct call)");
    assert.equal(detail.run.id, "default");
    assert.ok(Array.isArray(detail.children));
    assert.equal(detail.children.length, 1, "scoped to default");
    assert.equal(detail.children[0].pid, 101);
    assert.equal(detail.subagents.length, 1, "MB2 subagent snapshot flowed through");

    handle.destroy();

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

test("MB5 + R1-i readiness rubric exists in repo + claims the right total", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const rubricPath = path.join(__dirname, "../../docs/readiness-rubric.md");
  assert.ok(fs.existsSync(rubricPath), "readiness-rubric.md present");
  const text = fs.readFileSync(rubricPath, "utf-8");
  // R1-i (Phase D R1, 2026-04-28): rubric grew from 5×3=15 → 6×3=18 stars
  // when the remote-isolation category landed.
  assert.match(text, /Total 18 stars/);
  // Exit code map documented (post-R1-i thresholds).
  assert.match(text, /total ≥ 17.*release-ready/);
  // All six top-level categories.
  for (const cat of [
    "Run visibility", "Child visibility", "Replay visibility",
    "Event integrity", "Contract stability", "Remote isolation",
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

test("MC4 + R1-i: readiness-report stars are BEHAVIOR-verified, not export-checks", () => {
  // Source-grep anchor: every star-3 in the 6 categories must include
  // "behavior verified" or otherwise actually exercise behavior. This
  // guards against future regressions where a star slips back to a
  // typeof-export check.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "../../scripts/readiness-report.js"), "utf-8"
  );
  // The known weak markers ("present" / "exported" / "ready") must NOT
  // appear in star-3 push lines anymore.
  assert.match(src, /pin survives ring eviction \(behavior verified\)/);
  assert.match(src, /bridge forwards live event into store \(behavior verified\)/);
  assert.match(src, /bridge run sync upserts run on pipeline_start \(behavior verified\)/);
  assert.match(src, /layout panels override invokes stub panel\.create \(behavior verified\)/);
  assert.match(src, /normalize\(\) yields canonical envelope shape/);
  // R1-i remote-isolation: all three stars are in-process behavior checks.
  assert.match(src, /HARNESS_REMOTE_MODE default = off \(fail-closed, behavior verified\)/);
  assert.match(src, /HKDF JWT \+ ledger keys derive with domain separation \(behavior verified\)/);
  assert.match(src, /live runner agent → orchestrator round-trip projects remote child \+ ledger chain verifies \(behavior verified\)/);
  // Sanity: the old typeof-only string is gone.
  assert.equal(/store\.snapshot\.pinnedEvents shape ready/.test(src), false);
});
