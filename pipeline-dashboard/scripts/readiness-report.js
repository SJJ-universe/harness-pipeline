#!/usr/bin/env node
//
// Slice MB5 (Phase D Round 2, 2026-04-27) — readiness-report.
//
// One-shot operator check that scores the harness against
// docs/readiness-rubric.md. Exit code maps to release-readiness:
//
//   0 — total ≥ 14 (release-ready)
//   1 — total ≥ 10 (preview-ready)
//   2 — total ≥ 6  (internal-only)
//   3 — total < 6  (blocking — do not ship)
//
// Usage:
//   node scripts/readiness-report.js                # human-readable
//   node scripts/readiness-report.js --json         # machine-readable
//   node scripts/readiness-report.js --no-spawn     # skip the server boot
//
// The server-spawning checks call out to the real harness on a
// throw-away port (5099 by default). Set HARNESS_PORT override before
// running if 5099 is taken.

const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.HARNESS_READINESS_PORT) || 5099;
const HOST = "127.0.0.1";
const SPAWN_TIMEOUT_MS = 4000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

// ── tiny http GET wrapper ────────────────────────────────────────────

function get(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: p, timeout: 1500 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let body = null; try { body = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, body, text });
      });
    });
    req.on("error", () => resolve({ status: 0, body: null, text: "" }));
    req.on("timeout", () => { try { req.destroy(); } catch (_) {} resolve({ status: 0, body: null, text: "" }); });
  });
}

// ── score categories ────────────────────────────────────────────────

async function scoreRunVisibility() {
  const stars = [];
  const info = await get("/api/server/info");
  const boot = await get("/api/monitor/bootstrap");
  if (info.status === 200 && boot.status === 200) {
    stars.push("server/info + monitor/bootstrap respond 200");
    if (boot.body && Array.isArray(boot.body.runs) && typeof boot.body.selectedRunId !== "undefined") {
      stars.push("bootstrap carries runs + selectedRunId");
    }
    // Star 3: per-run detail endpoint resolves at least one run.
    if (boot.body && boot.body.runs && boot.body.runs.length > 0) {
      const detail = await get("/api/monitor/runs/" + encodeURIComponent(boot.body.runs[0].id));
      if (detail.status === 200) stars.push("monitor/runs/:runId returns detail");
    }
  }
  return { name: "run-visibility", stars };
}

async function scoreChildVisibility() {
  const stars = [];
  const info = await get("/api/server/info");
  if (info.status === 200 && Array.isArray(info.body && info.body.activeChildren)) {
    stars.push("server/info exposes activeChildren");
    // Star 2: monitor/bootstrap also has activeChildren.
    const boot = await get("/api/monitor/bootstrap");
    if (boot.status === 200 && Array.isArray(boot.body && boot.body.activeChildren)) {
      stars.push("monitor/bootstrap exposes activeChildren");
    }
    // Star 3: monitor/runs/:runId exposes subagents field for the default run.
    const detail = await get("/api/monitor/runs/default");
    if (detail.status === 200 && Array.isArray(detail.body && detail.body.subagents)) {
      stars.push("monitor/runs/default exposes subagents");
    }
  }
  return { name: "child-visibility", stars };
}

async function scoreReplayVisibility() {
  const stars = [];
  // Star 1: the buffer module exists + exports the contract.
  try {
    const erb = require("../src/runtime/eventReplayBuffer");
    if (typeof erb.createEventReplayBuffer === "function") stars.push("createEventReplayBuffer module exports the contract");
  } catch (_) {}
  // Star 2: monitor bootstrap recentEvents present.
  const boot = await get("/api/monitor/bootstrap");
  if (boot.status === 200 && Array.isArray(boot.body && boot.body.recentEvents)) {
    stars.push("monitor/bootstrap.recentEvents present");
  }
  // Star 3 — MC4 BEHAVIOR: pin an event, push more to evict it from the
  // ring, verify the pinned ref still surfaces. Fail when ring eviction
  // wipes the pin (regression in MA6 pin-survival semantics).
  try {
    const { createMonitorStore } = require("../public/js/monitor/store");
    const s = createMonitorStore({ maxEvents: 3 });
    const target = { type: "phase_update", scope: "phase", payload: {} };
    s.pushEvent(target);
    s.pinEvent(target);
    for (let i = 0; i < 10; i++) {
      s.pushEvent({ type: "tool_recorded", scope: "tool", payload: { i } });
    }
    const snap = s.snapshot();
    const ringEvicted = !snap.events.includes(target);
    const pinSurvived = snap.pinnedEvents.includes(target);
    if (ringEvicted && pinSurvived) {
      stars.push("pin survives ring eviction (behavior verified)");
    }
  } catch (_) {}
  return { name: "replay-visibility", stars };
}

async function scoreEventIntegrity() {
  const stars = [];
  // Star 1 — MC4 BEHAVIOR: normalize() actually produces the canonical
  // envelope shape on a representative event. (was: typeof check)
  try {
    const { normalize } = require("../public/js/monitor/normalizer");
    const env = normalize({ type: "phase_update", data: { runId: "default", phase: "B" } });
    if (env && env.type === "phase_update" && env.scope === "phase" && env.runId === "default") {
      stars.push("normalize() yields canonical envelope shape");
    }
  } catch (_) {}
  // Star 2 — MC4 BEHAVIOR: bridge actually forwards a tapped event into
  // the store via real legacy-bridge + real dispatcher. (was: typeof
  // check)
  try {
    const dispatcher = require("../public/js/event-dispatcher");
    const { install } = require("../public/js/monitor/legacy-bridge");
    const { createMonitorStore } = require("../public/js/monitor/store");
    const { normalize } = require("../public/js/monitor/normalizer");
    dispatcher._resetForTests();
    const store = createMonitorStore();
    const handle = install({
      store, normalize, dispatcher,
      fetchImpl: null, setIntervalFn: () => null,
    });
    dispatcher.notifyTaps({ type: "phase_update", data: { runId: "default", phase: "B" } });
    const forwarded = store.snapshot().events.length === 1
      && store.snapshot().events[0].type === "phase_update";
    handle.destroy();
    if (forwarded) stars.push("bridge forwards live event into store (behavior verified)");
  } catch (_) {}
  // Star 3 — MC4 BEHAVIOR: bridge run sync upserts run-summary on a
  // pipeline_start event. (was: addTap/notifyTaps export check)
  try {
    const dispatcher = require("../public/js/event-dispatcher");
    const { install } = require("../public/js/monitor/legacy-bridge");
    const { createMonitorStore } = require("../public/js/monitor/store");
    const { normalize } = require("../public/js/monitor/normalizer");
    dispatcher._resetForTests();
    const store = createMonitorStore();
    const handle = install({
      store, normalize, dispatcher,
      fetchImpl: null, setIntervalFn: () => null,
    });
    dispatcher.notifyTaps({
      type: "pipeline_start",
      data: { runId: "verify", template: "general", phase: "A" },
    });
    const r = store.snapshot().runs.verify;
    handle.destroy();
    if (r && r.status === "active" && r.templateId === "general" && r.phase === "A") {
      stars.push("bridge run sync upserts run on pipeline_start (behavior verified)");
    }
  } catch (_) {}
  return { name: "event-integrity", stars };
}

async function scoreContractStability() {
  const stars = [];
  // Star 1: monitor/bootstrap response shape stable (top-level keys present).
  const boot = await get("/api/monitor/bootstrap");
  if (boot.status === 200 && boot.body) {
    const required = ["server", "runs", "selectedRunId", "activeChildren", "recentEvents", "exportedAt"];
    const missing = required.filter((k) => !(k in boot.body));
    if (missing.length === 0) stars.push("monitor/bootstrap response shape stable");
  }
  // Star 2: legacy /api/runs/current shape unchanged (snapshot + events).
  const legacy = await get("/api/runs/current");
  if (legacy.status === 200 && legacy.body && legacy.body.snapshot && Array.isArray(legacy.body.events)) {
    stars.push("legacy /api/runs/current shape unchanged");
  }
  // Star 3 — MC4 BEHAVIOR: layout actually invokes a stub panel via the
  // panels override surface. (was: typeof check on layout.mount)
  try {
    const { mount } = require("../public/js/monitor/layout");
    const { createMonitorStore } = require("../public/js/monitor/store");
    const { normalize } = require("../public/js/monitor/normalizer");
    const store = createMonitorStore();
    let stubFired = false;
    const stub = {
      create() { stubFired = true; return { destroy() {} }; },
    };
    // Minimal DOM stub matching the layout-test pattern.
    const makeEl = (tag) => {
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
        get className() { return this.classList.toString(); },
        set className(v) { this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
        appendChild(c) { this.children.push(c); return c; },
        setAttribute() {}, removeAttribute() {}, hasAttribute() { return false; },
        addEventListener() {}, removeEventListener() {},
        get innerHTML() { return ""; },
        set innerHTML(v) { if (v !== "") throw new Error("innerHTML must be ''"); this.children = []; },
        get textContent() { return ""; }, set textContent(_) {},
      };
      return el;
    };
    const doc = { createElement: makeEl, body: makeEl("body") };
    const root = makeEl("div");
    root.ownerDocument = doc;
    const handle = mount({
      root, store, normalize,
      hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
      panels: { globalBar: stub },
      bridge: null,
      doc,
    });
    if (handle) handle.destroy();
    if (stubFired) {
      stars.push("layout panels override invokes stub panel.create (behavior verified)");
    }
  } catch (_) {}
  return { name: "contract-stability", stars };
}

// ── server boot helper ──────────────────────────────────────────────

function bootHarness() {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      HARNESS_PORT: String(PORT),
      HARNESS_CSP_MODE: "enforce",
    });
    const cwd = path.resolve(__dirname, "..");
    const proc = spawn(process.execPath, ["server.js"], {
      cwd, env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error("server boot timed out")); }
    }, SPAWN_TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      if (!resolved && /Pipeline Dashboard:/.test(s)) {
        resolved = true;
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.on("error", (err) => { if (!resolved) { resolved = true; reject(err); } });
    proc.on("exit", () => { if (!resolved) { resolved = true; reject(new Error("server exited before boot")); } });
  });
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const json = flag("--json");
  const noSpawn = flag("--no-spawn");

  let proc = null;
  try {
    if (!noSpawn) {
      try {
        proc = await bootHarness();
      } catch (err) {
        if (!json) {
          process.stdout.write("WARN: failed to boot harness for live checks: " + err.message + "\n");
          process.stdout.write("      run with --no-spawn if you've started the harness yourself.\n");
        }
      }
    }

    const categories = [
      await scoreRunVisibility(),
      await scoreChildVisibility(),
      await scoreReplayVisibility(),
      await scoreEventIntegrity(),
      await scoreContractStability(),
    ];

    const total = categories.reduce((acc, c) => acc + c.stars.length, 0);
    const max = categories.length * 3;

    let exit = 3;
    if (total >= 14) exit = 0;
    else if (total >= 10) exit = 1;
    else if (total >= 6) exit = 2;

    if (json) {
      process.stdout.write(JSON.stringify({
        total, max, exit, categories,
      }, null, 2) + "\n");
    } else {
      process.stdout.write("=== Harness Readiness Report ===\n");
      for (const c of categories) {
        const s = c.stars.length;
        const stars = "★".repeat(s) + "·".repeat(3 - s);
        process.stdout.write("  " + (c.name + " ".repeat(20)).slice(0, 20) + " " + stars + "  (" + s + "/3)\n");
        for (const note of c.stars) process.stdout.write("    + " + note + "\n");
      }
      process.stdout.write("  ───────────────────────────────\n");
      process.stdout.write("  total                " + total + "/" + max + "\n");
      const verdict = exit === 0 ? "release-ready"
        : exit === 1 ? "preview-ready"
        : exit === 2 ? "internal-only"
        : "blocking";
      process.stdout.write("  → " + verdict + "\n");
    }

    return exit;
  } finally {
    if (proc) {
      try { proc.kill(); } catch (_) {}
    }
  }
}

main()
  .then((exit) => process.exit(exit))
  .catch((err) => {
    process.stderr.write("readiness-report error: " + (err && err.message) + "\n");
    process.exit(3);
  });
