// Slice D (v4) — subagent tray unit coverage.
//
// Two layers:
//   1. SubagentTrayState  — pure state, tested directly in Node.
//   2. install()          — DOM wiring, tested against a hand-rolled fake doc
//                            (mirrors the toast.test.js approach).

const test = require("node:test");
const assert = require("node:assert/strict");
const { SubagentTrayState, install } = require("../../public/js/subagent-tray");

// ── Pure state ────────────────────────────────────────────────────

test("start() adds a fresh entry with correct shape", () => {
  const s = new SubagentTrayState();
  const e = s.start({ session_id: "a", agent_type: "Explore" });
  assert.equal(e.id, "a");
  assert.equal(e.agent_type, "Explore");
  assert.equal(e.completedAt, null);
  assert.equal(typeof e.startedAt, "number");
  assert.equal(s.size(), 1);
  assert.equal(s.activeCount(), 1);
});

test("start() with no session_id still produces a stable id", () => {
  const s = new SubagentTrayState();
  const e = s.start({ agent_type: "Plan" });
  assert.ok(e.id && typeof e.id === "string");
  assert.equal(s.size(), 1);
});

test("start() is idempotent for the same session_id (preserves startedAt)", () => {
  const s = new SubagentTrayState();
  const first = s.start({ session_id: "a", agent_type: "Explore", at: 1000 });
  const again = s.start({ session_id: "a", agent_type: "Explore", at: 9999 });
  assert.equal(again.startedAt, 1000, "re-start must not reset startedAt");
  assert.equal(s.size(), 1);
});

test("complete() marks completedAt and keeps entry until removed", () => {
  const s = new SubagentTrayState();
  s.start({ session_id: "a", agent_type: "Explore", at: 1000 });
  const e = s.complete({ session_id: "a", at: 4500 });
  assert.equal(e.completedAt, 4500);
  assert.equal(s.size(), 1, "complete must not remove the entry immediately");
  assert.equal(s.activeCount(), 0);
  assert.equal(s.completedCount(), 1);
});

test("complete() without a prior start synthesizes an entry from elapsedMs", () => {
  // Covers the replay-only scenario where the dashboard came online after the
  // SubagentStart event was flushed out of the replay buffer.
  const s = new SubagentTrayState();
  const e = s.complete({ session_id: "b", agent_type: "Explore", elapsedMs: 2000, at: 5000 });
  assert.ok(e);
  assert.equal(e.startedAt, 3000);
  assert.equal(e.completedAt, 5000);
});

test("snapshot() sorts active oldest→newest, completed newest-first", () => {
  const s = new SubagentTrayState();
  s.start({ session_id: "a", agent_type: "A", at: 100 });
  s.start({ session_id: "b", agent_type: "B", at: 200 });
  s.start({ session_id: "c", agent_type: "C", at: 300 });
  s.complete({ session_id: "a", at: 400 });
  s.complete({ session_id: "b", at: 500 });
  const snap = s.snapshot();
  // Active first (only c is still active), then completed by most-recent-complete.
  assert.deepEqual(snap.items.map((e) => e.id), ["c", "b", "a"]);
  assert.equal(snap.overflow, 0);
});

test("snapshot() clamps to maxVisible - 1 and reports overflow count", () => {
  const s = new SubagentTrayState({ maxVisible: 3 });
  for (let i = 0; i < 5; i++) s.start({ session_id: "s" + i, agent_type: "t", at: 1000 + i });
  const snap = s.snapshot();
  assert.equal(snap.items.length, 2, "one slot is reserved for the overflow row");
  assert.equal(snap.overflow, 3);
});

test("remove() deletes; clear() empties the map", () => {
  const s = new SubagentTrayState();
  s.start({ session_id: "a", agent_type: "A" });
  s.start({ session_id: "b", agent_type: "B" });
  assert.equal(s.remove("a"), true);
  assert.equal(s.size(), 1);
  s.clear();
  assert.equal(s.size(), 0);
});

// ── DOM install ───────────────────────────────────────────────────

function makeFakeDom() {
  const timers = new Map();
  const intervals = new Map();
  let seq = 1;

  function makeEl(tag) {
    const el = {
      tag, children: [], _text: "",
      _className: "",
      attrs: {}, dataset: {},
      parentNode: null,
      _listeners: {},
      _classes: new Set(),
      // className <-> _classes live binding so assignments like
      // `node.className = "subagent-item done"` (which the real tray code uses
      // for full rebuilds) stay in sync with `.classList.has("done")`.
      get className() { return el._className; },
      set className(v) {
        el._className = String(v);
        el._classes = new Set(String(v).split(/\s+/).filter(Boolean));
      },
      classList: {
        add(c) { el._classes.add(c); _syncClass(el); },
        remove(c) { el._classes.delete(c); _syncClass(el); },
        toggle(c) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); _syncClass(el); },
        contains(c) { return el._classes.has(c); },
      },
      appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
        return child;
      },
      get firstChild() { return el.children[0] || null; },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return el.attrs[k]; },
      addEventListener(name, fn) { (el._listeners[name] ||= []).push(fn); },
      querySelector(sel) {
        if (sel.startsWith("[data-subagent-id=")) {
          const want = sel.match(/\"([^\"]+)\"/);
          if (!want) return null;
          const walk = (n) => {
            if (n.dataset && n.dataset.subagentId === want[1]) return n;
            for (const c of n.children) { const hit = walk(c); if (hit) return hit; }
            return null;
          };
          return walk(el);
        }
        if (sel.startsWith(".")) {
          const cls = sel.slice(1);
          const walk = (n) => {
            if (n._classes && n._classes.has(cls)) return n;
            for (const c of n.children) { const hit = walk(c); if (hit) return hit; }
            return null;
          };
          return walk(el);
        }
        return null;
      },
      get textContent() { return el._text; },
      set textContent(v) { el._text = String(v); el.children.length = 0; },
    };
    return el;
  }
  function _syncClass(el) {
    // Write _className directly to avoid the className setter re-parsing and
    // overwriting the _classes Set we just edited.
    el._className = el._classes.size ? [...el._classes].join(" ") : "";
  }

  const tray = makeEl("div"); tray.id = "subagent-tray"; tray._classes.add("empty"); _syncClass(tray);
  const items = makeEl("div"); items.id = "subagent-items";
  const count = makeEl("span"); count.id = "subagent-count";
  const byId = { "subagent-tray": tray, "subagent-items": items, "subagent-count": count };
  const doc = {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId[id] || null,
  };
  const win = {
    setInterval(fn, ms) { const id = seq++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { const id = seq++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    _tick() { for (const fn of intervals.values()) fn(); },
    _fireTimers() { for (const fn of [...timers.values()]) fn(); timers.clear(); },
    _timerCount() { return timers.size; },
    _intervalCount() { return intervals.size; },
  };
  return { doc, win, tray, items, count };
}

test("install().start() renders an item and updates the counter", () => {
  const { doc, win, items, count, tray } = makeFakeDom();
  const api = install({ doc, win });
  api.start({ session_id: "a", agent_type: "Explore" });
  assert.equal(items.children.length, 1);
  assert.equal(items.children[0].dataset.subagentId, "a");
  assert.equal(count.textContent, "1");
  assert.equal(tray._classes.has("empty"), false, "empty class should drop when items exist");
});

test("install() starts a live tick interval only while active agents exist", () => {
  const { doc, win } = makeFakeDom();
  const api = install({ doc, win, fadeMs: 100 });
  assert.equal(win._intervalCount(), 0, "no interval before any agent");
  api.start({ session_id: "a", agent_type: "A" });
  assert.equal(win._intervalCount(), 1, "start() must arm the tick");
  api.complete({ session_id: "a" });
  // Fade timer is scheduled; tick still running until next firing.
  win._tick(); // first tick after complete — all active count is 0 → clears itself
  assert.equal(win._intervalCount(), 0, "tick must self-clear when nothing is active");
});

test("install().complete() marks done, schedules fade, removes after fadeMs", () => {
  const { doc, win, items } = makeFakeDom();
  const api = install({ doc, win, fadeMs: 1000 });
  api.start({ session_id: "a", agent_type: "A" });
  api.complete({ session_id: "a" });
  assert.equal(items.children[0]._classes.has("done"), true);
  assert.equal(win._timerCount(), 1, "fade timer should be scheduled");
  win._fireTimers();
  assert.equal(items.children.length, 0, "fade should clear the row");
});

test("install() caps rendered items at maxVisible - 1 and appends +N more", () => {
  const { doc, win, items } = makeFakeDom();
  const api = install({ doc, win, maxVisible: 3 });
  for (let i = 0; i < 5; i++) api.start({ session_id: "s" + i, agent_type: "t" });
  // 5 active, maxVisible 3 → render 2 items + "+3 more"
  assert.equal(items.children.length, 3);
  const last = items.children[items.children.length - 1];
  assert.equal(last._classes.has("subagent-more"), true);
  assert.equal(last.textContent, "+3 more");
});

test("install().restore() skips the fade timer (replay mode)", () => {
  const { doc, win } = makeFakeDom();
  const api = install({ doc, win, fadeMs: 1000 });
  api.restore("subagent_started", { session_id: "a", agent_type: "Explore", at: 1000 });
  api.restore("subagent_completed", { session_id: "a", at: 3000 });
  assert.equal(win._timerCount(), 0,
    "replay must not schedule a live fade — the entry should persist in its final state");
});

test("install().reset() clears state, timers, and DOM", () => {
  const { doc, win, items, count, tray } = makeFakeDom();
  const api = install({ doc, win });
  api.start({ session_id: "a", agent_type: "A" });
  api.start({ session_id: "b", agent_type: "B" });
  api.reset();
  assert.equal(items.children.length, 0);
  assert.equal(count.textContent, "0");
  assert.equal(tray._classes.has("empty"), true);
  assert.equal(win._intervalCount(), 0);
  assert.equal(win._timerCount(), 0);
});

test("install() without DOM is a no-op (smoke for test-environments)", () => {
  const api = install({}); // no doc
  assert.doesNotThrow(() => api.start({ session_id: "a", agent_type: "x" }));
  assert.doesNotThrow(() => api.complete({ session_id: "a" }));
  assert.doesNotThrow(() => api.reset());
});
