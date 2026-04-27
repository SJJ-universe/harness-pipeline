// Slice S3 (Phase 3-S, 2026-04-27) — childRegistry unit tests.
//
// childRegistry tracks every active spawn so server.js gracefulShutdown
// can SIGTERM/SIGKILL the whole set. Coverage:
//   - register / unregister are idempotent (no-op on null/duplicate)
//   - killAll fires the correct signal on every active child
//   - killAll swallows per-child errors (ESRCH on already-dead children)
//   - snapshot returns pid/label/runId/age + shape stable
//   - broadcast emits register/unregister/killAll events with right shape
//   - size() reflects active count

const test = require("node:test");
const assert = require("node:assert/strict");
const { createChildRegistry } = require("../../src/runtime/childRegistry");

function mkChild(pid = 1234, opts = {}) {
  const child = {
    pid,
    killCalls: [],
    kill(sig) {
      if (opts.throwOnKill) throw new Error(opts.throwOnKill); // ESRCH simulation
      this.killCalls.push(sig);
    },
  };
  return child;
}

// ── register / unregister ──────────────────────────────────────────────

test("register adds the child + size() reflects count", () => {
  const r = createChildRegistry();
  assert.equal(r.size(), 0);
  r.register(mkChild(1), { label: "a" });
  assert.equal(r.size(), 1);
  r.register(mkChild(2), { label: "b" });
  assert.equal(r.size(), 2);
});

test("register is idempotent (same child object → no-op)", () => {
  const r = createChildRegistry();
  const c = mkChild(7);
  r.register(c, { label: "x" });
  r.register(c, { label: "x" });
  r.register(c, { label: "x" });
  assert.equal(r.size(), 1);
});

test("register on null/undefined child is a no-op", () => {
  const r = createChildRegistry();
  r.register(null, { label: "noop" });
  r.register(undefined, { label: "noop" });
  assert.equal(r.size(), 0);
});

test("unregister removes the child + size() decreases", () => {
  const r = createChildRegistry();
  const a = mkChild(1);
  const b = mkChild(2);
  r.register(a, { label: "a" });
  r.register(b, { label: "b" });
  r.unregister(a);
  assert.equal(r.size(), 1);
  r.unregister(b);
  assert.equal(r.size(), 0);
});

test("unregister of an unknown child is a no-op (idempotent)", () => {
  const r = createChildRegistry();
  r.unregister(mkChild(99));
  r.unregister(null);
  assert.equal(r.size(), 0);
});

// ── killAll ────────────────────────────────────────────────────────────

test("killAll sends the requested signal to every registered child", () => {
  const r = createChildRegistry();
  const a = mkChild(1);
  const b = mkChild(2);
  const c = mkChild(3);
  r.register(a); r.register(b); r.register(c);
  const n = r.killAll("SIGTERM");
  assert.equal(n, 3);
  assert.deepEqual(a.killCalls, ["SIGTERM"]);
  assert.deepEqual(b.killCalls, ["SIGTERM"]);
  assert.deepEqual(c.killCalls, ["SIGTERM"]);
});

test("killAll defaults to SIGTERM when no signal given", () => {
  const r = createChildRegistry();
  const a = mkChild(1);
  r.register(a);
  r.killAll();
  assert.deepEqual(a.killCalls, ["SIGTERM"]);
});

test("killAll swallows ESRCH (kill on already-dead child) and continues", () => {
  const r = createChildRegistry();
  const dead = mkChild(1, { throwOnKill: "ESRCH" });
  const alive = mkChild(2);
  r.register(dead);
  r.register(alive);
  // Should NOT throw; should still kill the alive one.
  const n = r.killAll("SIGTERM");
  assert.deepEqual(alive.killCalls, ["SIGTERM"]);
  // dead.killCalls remains [] (the throw shortcircuited that one)
  assert.deepEqual(dead.killCalls, []);
  // n counts only successful kills
  assert.equal(n, 1);
});

test("killAll on empty registry returns 0 + does not throw", () => {
  const r = createChildRegistry();
  assert.equal(r.killAll("SIGKILL"), 0);
});

// ── snapshot ───────────────────────────────────────────────────────────

test("snapshot returns pid/label/runId/ageMs for every active child", async () => {
  const r = createChildRegistry();
  r.register(mkChild(101), { label: "claude", runId: "run-A" });
  r.register(mkChild(102), { label: "codex", runId: "run-B" });
  await new Promise((res) => setTimeout(res, 5));
  const snap = r.snapshot();
  assert.equal(snap.length, 2);
  for (const entry of snap) {
    assert.ok(typeof entry.pid === "number");
    assert.ok(["claude", "codex"].includes(entry.label));
    assert.ok(["run-A", "run-B"].includes(entry.runId));
    assert.ok(typeof entry.ageMs === "number");
    assert.ok(entry.ageMs >= 0);
  }
});

test("snapshot stays empty after every child unregisters", () => {
  const r = createChildRegistry();
  const a = mkChild(1); r.register(a); r.unregister(a);
  assert.deepEqual(r.snapshot(), []);
});

// ── broadcast ──────────────────────────────────────────────────────────

test("broadcast: child_registered fires with pid/label/runId/count", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  r.register(mkChild(42), { label: "claude", runId: "run-1" });
  const reg = events.find((e) => e.type === "child_registered");
  assert.ok(reg);
  assert.deepEqual(reg.data, { pid: 42, label: "claude", runId: "run-1", count: 1 });
});

test("broadcast: child_unregistered fires with same shape on remove", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  const c = mkChild(43);
  r.register(c, { label: "codex", runId: "run-2" });
  events.length = 0;
  r.unregister(c);
  const unr = events.find((e) => e.type === "child_unregistered");
  assert.ok(unr);
  assert.equal(unr.data.pid, 43);
  assert.equal(unr.data.label, "codex");
  assert.equal(unr.data.runId, "run-2");
  assert.equal(unr.data.count, 0);
});

test("broadcast: child_kill_all summarises signal + count + remaining active", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  r.register(mkChild(1));
  r.register(mkChild(2));
  events.length = 0;
  r.killAll("SIGKILL");
  const ev = events.find((e) => e.type === "child_kill_all");
  assert.ok(ev);
  assert.equal(ev.data.signal, "SIGKILL");
  assert.equal(ev.data.count, 2);
  // After kill we still have entries (registry tracks; only unregister removes).
  assert.equal(ev.data.active, 2);
  assert.ok(typeof ev.data.at === "number");
});

// ── child without pid (test mock or unborn) ────────────────────────────

test("register accepts a child without a pid (mock / failed spawn)", () => {
  const r = createChildRegistry();
  r.register({ kill: () => {} }, { label: "preborn" });
  assert.equal(r.size(), 1);
  const snap = r.snapshot();
  assert.equal(snap[0].pid, null);
});

// ── _resetForTests ─────────────────────────────────────────────────────

test("_resetForTests drops every entry without firing broadcasts", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  r.register(mkChild(1));
  r.register(mkChild(2));
  events.length = 0;
  r._resetForTests();
  assert.equal(r.size(), 0);
  assert.equal(events.length, 0);
});
