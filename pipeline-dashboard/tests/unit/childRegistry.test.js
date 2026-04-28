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

// ── R1-g remote children projection ────────────────────────────────────

test("R1-g: registerRemote stores synthetic ref + snapshot has remote shape", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  const ref = r.registerRemote({
    id: "agent-aaa", label: "claude", runId: "rr-1",
    hostIdentity: "runner-x", agentType: "claude",
  });
  assert.ok(ref, "should return a ref");
  assert.equal(ref.remote, true);
  assert.equal(r.size(), 1);
  const snap = r.snapshot();
  assert.equal(snap[0].remote, true);
  assert.equal(snap[0].id, "agent-aaa");
  assert.equal(snap[0].label, "claude");
  assert.equal(snap[0].hostIdentity, "runner-x");
  assert.equal(snap[0].agentType, "claude");
  assert.equal(snap[0].pid, null);
  // Broadcast carries the remote keys.
  const reg = events.find((e) => e.type === "child_registered");
  assert.equal(reg.data.remote, true);
  assert.equal(reg.data.id, "agent-aaa");
});

test("R1-g/R1-k1: registerRemote is idempotent on the {runId, hostIdentity, id} triple", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  const a = r.registerRemote({ id: "a1", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  const b = r.registerRemote({ id: "a1", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  assert.strictEqual(a, b, "same triple should yield the same ref");
  assert.equal(r.size(), 1);
  const regs = events.filter((e) => e.type === "child_registered");
  assert.equal(regs.length, 1, "duplicate registerRemote must not double-broadcast");
});

test("R1-g: registerRemote requires id (returns null on empty/missing)", () => {
  const r = createChildRegistry();
  assert.equal(r.registerRemote({ label: "no-id" }), null);
  assert.equal(r.registerRemote({ id: "", label: "empty" }), null);
  assert.equal(r.size(), 0);
});

test("R1-g/R1-k1: unregisterRemote removes the entry when the triple matches", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  r.registerRemote({ id: "a2", label: "claude", runId: "rr-1", hostIdentity: "runner-x" });
  events.length = 0;
  assert.equal(r.unregisterRemote({ id: "a2", runId: "rr-1", hostIdentity: "runner-x" }), true);
  assert.equal(r.size(), 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "child_unregistered");
  assert.equal(events[0].data.id, "a2");
  assert.equal(events[0].data.remote, true);
});

test("R1-g/R1-k1: unregisterRemote returns false on unknown triple (idempotent)", () => {
  const r = createChildRegistry();
  assert.equal(r.unregisterRemote({ id: "nope", runId: "rr-1", hostIdentity: "runner-x" }), false);
  r.registerRemote({ id: "a3", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  r.unregisterRemote({ id: "a3", runId: "rr-1", hostIdentity: "runner-x" });
  assert.equal(r.unregisterRemote({ id: "a3", runId: "rr-1", hostIdentity: "runner-x" }), false);
});

test("R1-g/R1-k1: unregister(ref) on a remote child also clears the composite-key index", () => {
  const r = createChildRegistry();
  const ref = r.registerRemote({ id: "a4", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  r.unregister(ref);
  assert.equal(r.size(), 0);
  // After cleanup, registerRemote with the same triple should succeed
  // (treated as a fresh entry, not the existing-ref idempotency path).
  const ref2 = r.registerRemote({ id: "a4", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  assert.notStrictEqual(ref2, ref);
  assert.equal(r.size(), 1);
});

// ── R1-k1 namespace + ownership-verify regressions ─────────────────────

test("R1-k1: same id under different runIds creates two distinct entries (no collision)", () => {
  const events = [];
  const r = createChildRegistry({ broadcast: (e) => events.push(e) });
  const a = r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  const b = r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-2", hostIdentity: "runner-x" });
  assert.notStrictEqual(a, b, "different runIds must not collapse into one ref");
  assert.equal(r.size(), 2, "both entries should coexist");
  // Both runs surface in the snapshot; the id label collides but the
  // runId disambiguates downstream consumers.
  const runs = r.snapshot().map((s) => s.runId).sort();
  assert.deepEqual(runs, ["rr-1", "rr-2"]);
});

test("R1-k1: same id under different hostIdentities creates two distinct entries", () => {
  const r = createChildRegistry();
  const a = r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  const b = r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-y" });
  assert.notStrictEqual(a, b);
  assert.equal(r.size(), 2);
});

test("R1-k1: unregisterRemote with WRONG runId is a no-op (ownership verify)", () => {
  const r = createChildRegistry();
  r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  // Wrong runId — even if hostIdentity + id match, the registry must refuse.
  const removed = r.unregisterRemote({ id: "claude-aaa", runId: "rr-EVIL", hostIdentity: "runner-x" });
  assert.equal(removed, false, "mismatched runId must not be allowed to remove");
  assert.equal(r.size(), 1, "the original entry must survive");
});

test("R1-k1: unregisterRemote with WRONG hostIdentity is a no-op (ownership verify)", () => {
  const r = createChildRegistry();
  r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  const removed = r.unregisterRemote({ id: "claude-aaa", runId: "rr-1", hostIdentity: "runner-EVIL" });
  assert.equal(removed, false);
  assert.equal(r.size(), 1);
});

test("R1-k1: stop in run A cannot remove an entry registered in run B", () => {
  // The original collision scenario: two runs registered the same agent id;
  // a stop frame from run A must not clobber run B's projection.
  const r = createChildRegistry();
  r.registerRemote({ id: "shared", label: "x", runId: "rr-A", hostIdentity: "runner-x" });
  r.registerRemote({ id: "shared", label: "x", runId: "rr-B", hostIdentity: "runner-x" });
  r.unregisterRemote({ id: "shared", runId: "rr-A", hostIdentity: "runner-x" });
  // Only run A's entry should be gone.
  assert.equal(r.size(), 1);
  const survivor = r.snapshot()[0];
  assert.equal(survivor.runId, "rr-B");
  assert.equal(survivor.id, "shared");
});

test("R1-k1: missing id on unregisterRemote returns false (defensive)", () => {
  const r = createChildRegistry();
  r.registerRemote({ id: "claude-aaa", label: "x", runId: "rr-1", hostIdentity: "runner-x" });
  assert.equal(r.unregisterRemote({ runId: "rr-1", hostIdentity: "runner-x" }), false);
  assert.equal(r.unregisterRemote({ id: "", runId: "rr-1", hostIdentity: "runner-x" }), false);
  assert.equal(r.size(), 1);
});

test("R1-g: killAll skips remote children", () => {
  const r = createChildRegistry();
  r.register(mkChild(1));
  r.register(mkChild(2));
  r.registerRemote({ id: "a5", label: "remote", runId: "rr-1" });
  // killAll signals only the 2 local children.
  assert.equal(r.killAll("SIGTERM"), 2);
  // The remote child stays in the registry — it's not auto-removed.
  assert.equal(r.size(), 3);
});

test("R1-g: snapshot mixes local + remote with the right discriminators", () => {
  const r = createChildRegistry();
  r.register(mkChild(7), { label: "local-codex", runId: "rr-1" });
  r.registerRemote({ id: "a6", label: "remote-claude", runId: "rr-1", hostIdentity: "runner-y", agentType: "claude" });
  const snap = r.snapshot();
  assert.equal(snap.length, 2);
  const local = snap.find((s) => s.pid === 7);
  const remote = snap.find((s) => s.id === "a6");
  assert.equal(local.remote, undefined, "local entries must not carry remote=true");
  assert.equal(remote.remote, true);
  assert.equal(remote.hostIdentity, "runner-y");
});
