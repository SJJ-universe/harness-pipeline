// Slice S3 (Phase 3-S, 2026-04-27) — child-process lifecycle registry.
//
// childSemaphore (Slice N) limits *concurrency* (how many children can run
// at once) but does not track *which* children are still alive at any
// moment. When the dashboard receives SIGINT / SIGTERM, or auto-shuts-down
// after the last WS client disconnects, every spawned Codex / Claude
// child gets orphaned — they outlive the parent (long-lived 120~180s
// Codex critique calls) or zombify on Linux (no parent to reap).
//
// This registry is the missing lifecycle layer: every runner registers a
// child immediately after spawn and unregisters on close/exit, so server.js
// can `killAll('SIGTERM') → 1s grace → killAll('SIGKILL')` from the
// graceful-shutdown path and reap everything cleanly before process.exit.
//
// Contract
//   register(child, { label, runId? })  → idempotent (no-op on null/dup)
//   unregister(child)                    → idempotent
//   killAll(signal = 'SIGTERM')          → walks current set + sends signal
//                                          ESRCH/ENOENT swallowed (already dead)
//   snapshot()                           → [{ pid, label, runId, ageMs }]
//   size()                               → active count
//
// Broadcasts (when a `broadcast` callback is provided):
//   child_registered      { pid, label, runId, count }
//   child_unregistered    { pid, label, runId, count }
//   child_kill_all        { signal, count, at }
//
// Failure modes
//   - register without matching unregister → leak. The runners always wrap
//     exec in try/finally so unregister fires even on throw / timeout.
//   - kill on an already-exited child → its `kill(signal)` throws ESRCH;
//     we swallow per-child errors so one zombie doesn't block the rest.

function createChildRegistry({ broadcast = () => {} } = {}) {
  // Map<childRef, { pid, label, runId, registeredAt }>
  // Using the child object itself as the key (not pid) so that even
  // pid-less mocks in tests work, and so that the same pid being
  // reused by the OS after exit doesn't collide.
  const active = new Map();

  function register(child, { label = "child", runId = null } = {}) {
    if (!child) return;
    if (active.has(child)) return; // idempotent
    const meta = {
      pid: typeof child.pid === "number" ? child.pid : null,
      label,
      runId,
      registeredAt: Date.now(),
    };
    active.set(child, meta);
    broadcast({
      type: "child_registered",
      data: { pid: meta.pid, label: meta.label, runId: meta.runId, count: active.size },
    });
  }

  function unregister(child) {
    if (!child) return;
    if (!active.has(child)) return; // idempotent
    const meta = active.get(child);
    active.delete(child);
    broadcast({
      type: "child_unregistered",
      data: { pid: meta.pid, label: meta.label, runId: meta.runId, count: active.size },
    });
  }

  function killAll(signal = "SIGTERM") {
    let killed = 0;
    for (const child of Array.from(active.keys())) {
      try {
        if (typeof child.kill === "function") {
          child.kill(signal);
          killed++;
        }
      } catch (_) {
        // ESRCH (no such process) / ENOENT (Windows already-exited) /
        // EPERM (signal not allowed for this process) — none should stop
        // us from continuing to the next child.
      }
    }
    broadcast({
      type: "child_kill_all",
      data: { signal, count: killed, active: active.size, at: Date.now() },
    });
    return killed;
  }

  function snapshot() {
    const now = Date.now();
    return Array.from(active.entries()).map(([_child, meta]) => ({
      pid: meta.pid,
      label: meta.label,
      runId: meta.runId,
      ageMs: now - meta.registeredAt,
    }));
  }

  function size() {
    return active.size;
  }

  // Test-only: drop every entry without firing broadcasts.
  function _resetForTests() {
    active.clear();
  }

  return {
    register,
    unregister,
    killAll,
    snapshot,
    size,
    _resetForTests,
  };
}

module.exports = { createChildRegistry };
