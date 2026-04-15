// P1-3 — SessionWatcher dedup: HARNESS_WATCHER_MODE + isHookDriven suppression.
//
// Run: node executor/__p1-3-test.js
//
// Exercises the broadcast gate directly via _startAutoPipeline + _advanceTo
// so we don't need to spin up file polling or fake JSONL tails.

const path = require("path");
const { SessionWatcher } = require("../session-watcher");
const { HookRouter } = require("./hook-router");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL  " + name + "\n        " + (e.stack || e.message));
  }
}

function makeWatcher(mode) {
  const events = [];
  const broadcast = (ev) => events.push(ev);
  const w = new SessionWatcher(broadcast, path.resolve(__dirname, ".."), { mode });
  return { w, events };
}

function drive(w) {
  // Exercise the same internal path _handleUserMessage takes when a real
  // JSONL line arrives. Bypasses file polling.
  w._startAutoPipeline("implementation", "이 기능을 구현해주세요");
}

console.log("[SessionWatcher mode matrix]");

test("default mode is 'auto' when env+opts omitted", () => {
  const w = new SessionWatcher(() => {}, path.resolve(__dirname, ".."));
  if (w.mode !== "auto") throw new Error("expected auto, got " + w.mode);
});

test("mode='auto' no hook: _startAutoPipeline broadcasts pipeline events", () => {
  const { w, events } = makeWatcher("auto");
  drive(w);
  const kinds = events.map((e) => e.type);
  if (!kinds.includes("auto_pipeline_detect")) {
    throw new Error("expected auto_pipeline_detect, got " + JSON.stringify(kinds));
  }
  if (!kinds.includes("phase_update")) {
    throw new Error("expected phase_update, got " + JSON.stringify(kinds));
  }
});

test("mode='auto' + markHookDriven() suppresses broadcasts", () => {
  const { w, events } = makeWatcher("auto");
  w.markHookDriven();
  drive(w);
  if (events.length !== 0) {
    throw new Error("expected 0 broadcasts, got " + events.length + " → " +
      JSON.stringify(events.map((e) => e.type)));
  }
});

test("mode='auto' + markHookDriven() still updates internal state", () => {
  const { w } = makeWatcher("auto");
  w.markHookDriven();
  drive(w);
  if (!w.pipelineActive) throw new Error("internal pipelineActive not set");
  if (w.currentTemplate !== "default") {
    throw new Error("internal currentTemplate not set, got " + w.currentTemplate);
  }
  if (w.currentPhase !== "A") {
    throw new Error("internal currentPhase not set, got " + w.currentPhase);
  }
});

test("mode='watcher' ignores markHookDriven() — broadcasts still flow", () => {
  const { w, events } = makeWatcher("watcher");
  w.markHookDriven();
  drive(w);
  if (events.length === 0) {
    throw new Error("expected broadcasts in watcher mode, got 0");
  }
  if (w.isHookDriven) {
    throw new Error("watcher mode must not flip isHookDriven");
  }
});

test("mode='hook' starts already hook-driven — broadcasts suppressed", () => {
  const { w, events } = makeWatcher("hook");
  if (!w.isHookDriven) throw new Error("hook mode should start hook-driven");
  drive(w);
  if (events.length !== 0) {
    throw new Error("expected 0 broadcasts, got " + events.length);
  }
});

test("mode='off' .start() is a no-op (no polling scheduled)", () => {
  const { w } = makeWatcher("off");
  w.start();
  try {
    if (w.checkInterval) throw new Error("checkInterval should be null in off mode");
    if (w.dirWatcher) throw new Error("dirWatcher should be null in off mode");
  } finally {
    w.stop();
  }
});

test("HookRouter.attachExecutor calls markHookDriven (auto mode flips)", () => {
  const { w, events } = makeWatcher("auto");
  const router = new HookRouter({ broadcast: () => {}, sessionWatcher: w });
  router.attachExecutor({ enabled: true });
  if (!w.isHookDriven) throw new Error("attachExecutor should flip to hook-driven");
  drive(w);
  if (events.length !== 0) {
    throw new Error("expected 0 broadcasts after attachExecutor, got " + events.length);
  }
});

test("HookRouter.attachExecutor in watcher mode does NOT flip", () => {
  const { w, events } = makeWatcher("watcher");
  const router = new HookRouter({ broadcast: () => {}, sessionWatcher: w });
  router.attachExecutor({ enabled: true });
  if (w.isHookDriven) throw new Error("watcher mode must not flip");
  drive(w);
  if (events.length === 0) {
    throw new Error("expected broadcasts in watcher mode post-attach, got 0");
  }
});

test("invalid mode falls back to 'auto' with warning tolerated", () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const { w } = makeWatcher("bogus");
    if (w.mode !== "auto") {
      throw new Error("expected fallback to auto, got " + w.mode);
    }
  } finally {
    console.warn = origWarn;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
