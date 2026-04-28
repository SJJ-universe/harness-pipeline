// Slice S3 (Phase 3-S, 2026-04-27) — child-process lifecycle registry.
// Slice R1-g (Phase D R1, 2026-04-28) — remote-children projection added.
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
// R1-g extends the registry with REMOTE children — agents that live on a
// remote runner-host. The orchestrator can't kill them with a signal
// (they're across a process boundary), so registerRemote sets a no-op
// `kill()` handler and `killAll()` skips them. The orchestrator's only
// remote-side teardown is closing the WS, which the runner-host watches
// for and reacts to. Remote entries appear in `snapshot()` alongside
// local processes so the dashboard's "active children" view is uniform.
//
// Contract
//   register(child, { label, runId? })          → local; idempotent
//   registerRemote({ id, label, runId,          → remote; returns synthetic
//                    hostIdentity, agentType })   ref for later unregister
//   unregister(childOrRef)                       → idempotent (works on
//                                                  both local + remote refs)
//   unregisterRemoteById(id)                     → R1-g convenience for the
//                                                  WS-side projection path
//   killAll(signal = 'SIGTERM')                  → only signals LOCAL refs
//                                                  ESRCH/ENOENT swallowed
//   snapshot()                                   → [{ pid, label, runId,
//                                                     ageMs, remote?, id?,
//                                                     hostIdentity?,
//                                                     agentType? }]
//   size()                                       → active count (local + remote)
//
// Broadcasts (when a `broadcast` callback is provided):
//   child_registered      { pid, label, runId, count, remote?, id?,
//                           hostIdentity?, agentType? }
//   child_unregistered    { pid, label, runId, count, remote?, id?,
//                           hostIdentity?, agentType? }
//   child_kill_all        { signal, count, at }
//
// Failure modes
//   - register without matching unregister → leak. The runners always wrap
//     exec in try/finally so unregister fires even on throw / timeout.
//   - kill on an already-exited child → its `kill(signal)` throws ESRCH;
//     we swallow per-child errors so one zombie doesn't block the rest.
//   - duplicate registerRemote with the same id → idempotent (the existing
//     entry is returned, no double-broadcast).

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

  // Index from id → ref so unregisterRemoteById is O(1).
  const remoteById = new Map();

  /**
   * Slice R1-g: register a child that lives on a remote runner-host.
   * Returns a synthetic ref the caller can pass to unregister(), or
   * the existing ref if id is already registered (idempotent). When id
   * is missing/empty, returns null + emits no broadcast.
   */
  function registerRemote({ id, label, runId = null, hostIdentity = null, agentType = null } = {}) {
    if (typeof id !== "string" || id.length === 0) return null;
    if (remoteById.has(id)) return remoteById.get(id);
    // Synthetic ref: kill() is a no-op so killAll() can't accidentally
    // try to signal a remote process. The `remote: true` flag also lets
    // killAll() skip these entries explicitly.
    const ref = { remote: true, id, kill() { /* remote — no-op */ } };
    const meta = {
      pid: null,
      label: label || agentType || "remote-child",
      runId,
      hostIdentity,
      agentType,
      remote: true,
      id,
      registeredAt: Date.now(),
    };
    active.set(ref, meta);
    remoteById.set(id, ref);
    broadcast({
      type: "child_registered",
      data: {
        pid: meta.pid, label: meta.label, runId: meta.runId,
        count: active.size,
        remote: true, id, hostIdentity, agentType,
      },
    });
    return ref;
  }

  /**
   * Slice R1-g: unregister a remote child by id. Returns true when an
   * entry was removed, false when the id was unknown (idempotent).
   */
  function unregisterRemoteById(id) {
    if (typeof id !== "string" || id.length === 0) return false;
    const ref = remoteById.get(id);
    if (!ref) return false;
    const meta = active.get(ref);
    active.delete(ref);
    remoteById.delete(id);
    broadcast({
      type: "child_unregistered",
      data: {
        pid: meta.pid, label: meta.label, runId: meta.runId,
        count: active.size,
        remote: true, id, hostIdentity: meta.hostIdentity, agentType: meta.agentType,
      },
    });
    return true;
  }

  function unregister(child) {
    if (!child) return;
    if (!active.has(child)) return; // idempotent
    const meta = active.get(child);
    active.delete(child);
    // Slice R1-g: unregistering by ref also clears the id index.
    if (meta.remote && meta.id) {
      remoteById.delete(meta.id);
    }
    broadcast({
      type: "child_unregistered",
      data: meta.remote
        ? {
            pid: meta.pid, label: meta.label, runId: meta.runId,
            count: active.size,
            remote: true, id: meta.id,
            hostIdentity: meta.hostIdentity, agentType: meta.agentType,
          }
        : { pid: meta.pid, label: meta.label, runId: meta.runId, count: active.size },
    });
  }

  function killAll(signal = "SIGTERM") {
    let killed = 0;
    for (const child of Array.from(active.keys())) {
      // Slice R1-g: skip remote children — they're killed by closing
      // their WS, not by signaling. Including them in the killAll
      // count would be misleading.
      if (child.remote === true) continue;
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
    return Array.from(active.entries()).map(([_child, meta]) => {
      // Local entries: { pid, label, runId, ageMs }.
      // Remote entries also expose remote/id/hostIdentity/agentType so the
      // dashboard can group + label them differently.
      const out = {
        pid: meta.pid,
        label: meta.label,
        runId: meta.runId,
        ageMs: now - meta.registeredAt,
      };
      if (meta.remote) {
        out.remote = true;
        out.id = meta.id;
        out.hostIdentity = meta.hostIdentity;
        out.agentType = meta.agentType;
      }
      return out;
    });
  }

  function size() {
    return active.size;
  }

  // Test-only: drop every entry without firing broadcasts.
  function _resetForTests() {
    active.clear();
    remoteById.clear();
  }

  return {
    register,
    unregister,
    registerRemote,
    unregisterRemoteById,
    killAll,
    snapshot,
    size,
    _resetForTests,
  };
}

module.exports = { createChildRegistry };
