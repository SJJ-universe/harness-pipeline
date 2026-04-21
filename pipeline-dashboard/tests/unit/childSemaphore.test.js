// Slice N (v6) — ChildSemaphore unit tests.
//
// Drives the pure semaphore without real timers (tests run fast). The 30s
// default timeout is overridden per-call for waiter expiry scenarios.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createChildSemaphore } = require("../../src/runtime/childSemaphore");

function collectBroadcasts() {
  const events = [];
  return { events, broadcast: (e) => events.push(e) };
}

// ── Fast path (slots available) ─────────────────────────────────

test("acquire resolves immediately when a slot is free", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 2 });
  const release = await sem.acquire();
  assert.equal(typeof release, "function");
  assert.equal(sem.inFlightCount(), 1);
  release();
  assert.equal(sem.inFlightCount(), 0);
});

test("multiple acquires up to maxConcurrent all resolve immediately", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 3 });
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  const r3 = await sem.acquire();
  assert.equal(sem.inFlightCount(), 3);
  r1(); r2(); r3();
  assert.equal(sem.inFlightCount(), 0);
});

// ── Queue path (slots full) ─────────────────────────────────────

test("acquire beyond max waits until a previous release", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const r1 = await sem.acquire();
  let r2Resolved = false;
  const r2Promise = sem.acquire().then((rel) => { r2Resolved = true; return rel; });
  // r2 not resolved yet
  await new Promise((r) => setImmediate(r));
  assert.equal(r2Resolved, false);
  assert.equal(sem.waitingCount(), 1);
  // Release r1 — pump queue — r2 resolves
  r1();
  const r2 = await r2Promise;
  assert.equal(r2Resolved, true);
  assert.equal(sem.inFlightCount(), 1);
  assert.equal(sem.waitingCount(), 0);
  r2();
});

test("FIFO ordering: first queued gets first release slot", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const r1 = await sem.acquire({ label: "A" });
  const promises = [
    sem.acquire({ label: "B" }),
    sem.acquire({ label: "C" }),
    sem.acquire({ label: "D" }),
  ];
  const resolvedOrder = [];
  promises.forEach((p, i) => p.then((rel) => { resolvedOrder.push(i); rel(); }));
  // Release 3 times — each pump should resolve B, C, D in order
  r1();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(resolvedOrder, [0, 1, 2]);
});

// ── Timeout ──────────────────────────────────────────────────────

test("queued acquire rejects after custom timeoutMs", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1, timeoutMs: 50 });
  const r1 = await sem.acquire();
  let caught = null;
  try {
    await sem.acquire({ label: "late", timeoutMs: 20 });
    assert.fail("expected timeout rejection");
  } catch (err) {
    caught = err;
  }
  assert.ok(caught);
  assert.match(caught.message, /timeout/);
  assert.match(caught.message, /late/);
  // Semaphore state: nothing leaked
  assert.equal(sem.waitingCount(), 0);
  assert.equal(sem.inFlightCount(), 1);
  r1();
});

test("timeout on one waiter does not affect other waiters", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1, timeoutMs: 50 });
  const r1 = await sem.acquire();
  const failing = sem.acquire({ label: "fail-fast", timeoutMs: 15 }).catch((err) => err);
  const succeeding = sem.acquire({ label: "patient", timeoutMs: 500 });
  // fail-fast times out; patient waits
  const err = await failing;
  assert.match(err.message, /fail-fast/);
  r1();
  const r2 = await succeeding;
  assert.equal(typeof r2, "function");
  r2();
});

// ── Release idempotency ─────────────────────────────────────────

test("release() is idempotent — second call is a no-op", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 2 });
  const release = await sem.acquire();
  release();
  release(); // should not underflow inFlight
  assert.equal(sem.inFlightCount(), 0);
});

// ── Broadcast ───────────────────────────────────────────────────

test("broadcast fires child_queue_depth on every state change", async () => {
  const { events, broadcast } = collectBroadcasts();
  const sem = createChildSemaphore({ maxConcurrent: 1, broadcast });
  await sem.acquire({ label: "a" });
  // 1 acquire → 1 broadcast
  assert.ok(events.length >= 1);
  const last = events[events.length - 1];
  assert.equal(last.type, "child_queue_depth");
  assert.equal(last.data.inFlight, 1);
  assert.equal(last.data.waiting, 0);
  assert.equal(last.data.max, 1);
});

test("broadcast carries waiting count on enqueue + release", async () => {
  const { events, broadcast } = collectBroadcasts();
  const sem = createChildSemaphore({ maxConcurrent: 1, broadcast });
  const r1 = await sem.acquire({ label: "first" });
  const waiterPromise = sem.acquire({ label: "second" });
  // enqueue → broadcast waiting=1
  const enqueueEvent = events.find((e) => e.data.waiting === 1);
  assert.ok(enqueueEvent, "enqueue broadcast missing");
  assert.equal(enqueueEvent.data.inFlight, 1);
  r1();
  const r2 = await waiterPromise;
  r2();
  // After pump + release, last event should show 0/0
  const last = events[events.length - 1];
  assert.equal(last.data.inFlight, 0);
  assert.equal(last.data.waiting, 0);
});

// ── Config & error handling ─────────────────────────────────────

test("maxConcurrent < 1 throws on creation", () => {
  assert.throws(() => createChildSemaphore({ maxConcurrent: 0 }), /maxConcurrent/);
});

test("snapshot() reflects current in-flight + waiting labels", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const r1 = await sem.acquire({ label: "codex" });
  sem.acquire({ label: "claude" }); // intentionally not awaited
  await new Promise((r) => setImmediate(r));
  const snap = sem.snapshot();
  assert.equal(snap.inFlight, 1);
  assert.equal(snap.waiting, 1);
  assert.deepEqual(snap.waitingLabels, ["claude"]);
  r1();
});

test("_resetForTests clears queue without resolving waiters", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const r1 = await sem.acquire();
  sem.acquire({ label: "x" }); // dangling, will be dropped
  sem._resetForTests();
  assert.equal(sem.inFlightCount(), 0);
  assert.equal(sem.waitingCount(), 0);
});
