// Slice N (v6) — Child-process concurrency gate for Codex + Claude runners.
//
// The runners used to spawn child processes with no global limit. On burst
// (button mashing, cycle fan-out, Phase 1 multi-run) this could park dozens
// of 120~180s processes, blowing RAM/CPU. The semaphore serializes acquires
// through a shared FIFO queue.
//
// Contract:
//   - `acquire({ label, timeoutMs })` → Promise<release>
//       • Immediately-resolved when a slot is free.
//       • Queued otherwise; rejects after `timeoutMs` (default 30s) to
//         prevent deadlock.
//   - `release()` — returned function. Idempotent: repeated calls no-op.
//   - Every acquire/release/timeout fires a `child_queue_depth` broadcast so
//     the dashboard can visualize contention.
//
// Failure mode:
//   If a caller forgets to release (e.g. a synchronous throw mid-exec), the
//   slot leaks — we intentionally do NOT auto-release on GC. The runners
//   wrap exec() in `try/finally` so the contract is enforced at the call
//   site, not hidden here.

function createChildSemaphore({
  maxConcurrent = 2,
  timeoutMs = 30000,
  broadcast = () => {},
} = {}) {
  if (maxConcurrent < 1) {
    throw new Error(`maxConcurrent must be >= 1, got ${maxConcurrent}`);
  }

  let inFlight = 0;
  const queue = []; // [{ resolve, reject, label, enqueuedAt, timer }]

  function _publish(extra = {}) {
    broadcast({
      type: "child_queue_depth",
      data: {
        inFlight,
        waiting: queue.length,
        max: maxConcurrent,
        at: Date.now(),
        ...extra,
      },
    });
  }

  function _makeRelease(label) {
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      inFlight--;
      _pump();
      _publish({ event: "release", label });
    };
  }

  function _pump() {
    while (inFlight < maxConcurrent && queue.length > 0) {
      const next = queue.shift();
      if (next.timer) clearTimeout(next.timer);
      inFlight++;
      next.resolve(_makeRelease(next.label));
    }
  }

  function acquire({ label = "child", timeoutMs: customTimeout } = {}) {
    return new Promise((resolve, reject) => {
      // Fast path: slot available immediately.
      if (inFlight < maxConcurrent) {
        inFlight++;
        _publish({ event: "acquire-fast", label });
        resolve(_makeRelease(label));
        return;
      }
      // Queue with timeout.
      const effectiveTimeout = customTimeout || timeoutMs;
      const entry = { resolve, reject, label, enqueuedAt: Date.now(), timer: null };
      entry.timer = setTimeout(() => {
        const idx = queue.indexOf(entry);
        if (idx >= 0) queue.splice(idx, 1);
        _publish({ event: "timeout", label });
        reject(new Error(
          `child semaphore timeout after ${effectiveTimeout}ms (label=${label}, inFlight=${inFlight}, waiting=${queue.length})`
        ));
      }, effectiveTimeout);
      queue.push(entry);
      _publish({ event: "enqueue", label });
    });
  }

  function snapshot() {
    return {
      inFlight,
      waiting: queue.length,
      max: maxConcurrent,
      waitingLabels: queue.map((q) => q.label),
    };
  }

  // Test-only: drain queue + reset counters without rejecting waiters.
  // Used by unit tests to prevent inter-test leakage.
  function _resetForTests() {
    for (const e of queue) if (e.timer) clearTimeout(e.timer);
    queue.length = 0;
    inFlight = 0;
  }

  return {
    acquire,
    snapshot,
    depth: () => inFlight + queue.length,
    inFlightCount: () => inFlight,
    waitingCount: () => queue.length,
    maxConcurrent: () => maxConcurrent,
    _resetForTests,
  };
}

module.exports = { createChildSemaphore };
