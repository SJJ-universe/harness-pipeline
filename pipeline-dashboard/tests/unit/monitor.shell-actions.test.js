// Slice PRODUCT-SHELL-WIRING (rc.5 prep, 2026-05-06) — shell-actions
// handler tests.
// Slice LEGACY-VIEW-REMOVE-0 (2026-05-11): Wave 2 handler tests
// (metrics / history / pipelineCompact / pipelineTemplate) removed
// when the legacy view was retired.
//
// Pure-function tests of the 3 remaining action handlers (pipelineStart,
// shutdown, codexVerify) + the chat-flow dispatchers (generalTask,
// showStatus) + the `createDefaultHandlers()` factory that the product
// shell consumes. Every dependency (fetch, confirm, location, modal
// module, toast) is injected via opts so we can assert exact behavior
// with no globals.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const shellActions = require("../../public/js/monitor/shell-actions");

// ── Helpers ────────────────────────────────────────────────────────

function makeFakeResponse({ ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    async json() { return body; },
  };
}

function makeFakeFetch(responses /* array or single response */) {
  const calls = [];
  const queue = Array.isArray(responses) ? responses.slice() : [responses];
  function fetchImpl(url, init) {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
  return { fetchImpl, calls };
}

function makeFakeWin() {
  const calls = { assigned: [], timeouts: [] };
  return {
    location: {
      assign(url) { calls.assigned.push(url); },
    },
    setTimeout(fn, _ms) {
      calls.timeouts.push(fn);
      // Fire immediately — keeps tests synchronous.
      try { fn(); } catch (_) {}
      return 0;
    },
    _calls: calls,
  };
}

function makeToastSink() {
  const messages = [];
  return {
    toastFn(payload) { messages.push(payload); },
    messages,
  };
}

// ── Wave 1: pipelineStart ──────────────────────────────────────────

test("pipelineStart invokes window.OrchestratorGeneralPipelineModal.install().open()", () => {
  const opens = [];
  const fakeModal = {
    install(opts) {
      return {
        open() { opens.push({ via: "open", opts }); },
      };
    },
  };
  const fakeWin = { OrchestratorGeneralPipelineModal: fakeModal };
  shellActions.pipelineStart({ win: fakeWin, doc: { body: {} } });
  assert.equal(opens.length, 1, "modal.open() must fire exactly once");
});

test("pipelineStart toasts an error when OrchestratorGeneralPipelineModal is not loaded", () => {
  const sink = makeToastSink();
  shellActions.pipelineStart({ win: {}, doc: {}, toastFn: sink.toastFn });
  assert.equal(sink.messages.length, 1);
  assert.match(sink.messages[0].message, /모달|modal/);
  assert.equal(sink.messages[0].kind, "error");
});

// ── Wave 1: shutdown ───────────────────────────────────────────────

test("shutdown handler aborts when confirmFn returns false", async () => {
  const sink = makeToastSink();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse());
  await shellActions.shutdown({
    fetchImpl,
    confirmFn: () => false,
    toastFn: sink.toastFn,
  });
  assert.equal(calls.length, 0, "fetch must NOT fire when confirm declined");
  assert.equal(sink.messages.length, 0, "no toast on user cancel");
});

test("shutdown handler POSTs /api/server/shutdown when confirmed", async () => {
  const sink = makeToastSink();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse({ ok: true }));
  await shellActions.shutdown({
    fetchImpl,
    confirmFn: () => true,
    toastFn: sink.toastFn,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/server/shutdown");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0].kind, "info");
});

test("shutdown handler toasts error when fetch rejects", async () => {
  const sink = makeToastSink();
  const { fetchImpl } = makeFakeFetch(new Error("network down"));
  await shellActions.shutdown({
    fetchImpl,
    confirmFn: () => true,
    toastFn: sink.toastFn,
  });
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0].kind, "error");
  assert.match(sink.messages[0].message, /network down/);
});

// ── Wave 1: codexVerify ────────────────────────────────────────────

test("codexVerify POSTs /api/codex/verify and toasts PASS on ok response", async () => {
  const sink = makeToastSink();
  const { fetchImpl, calls } = makeFakeFetch(
    makeFakeResponse({ ok: true, body: { ok: true, detail: "claude.cmd 0.13s" } }),
  );
  await shellActions.codexVerify({ fetchImpl, toastFn: sink.toastFn });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/codex/verify");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0].kind, "info");
  assert.match(sink.messages[0].message, /PASS/);
  assert.match(sink.messages[0].message, /claude\.cmd/);
});

test("codexVerify toasts FAIL when body.ok is false", async () => {
  const sink = makeToastSink();
  const { fetchImpl } = makeFakeFetch(
    makeFakeResponse({ ok: true, body: { ok: false, detail: "auth missing" } }),
  );
  await shellActions.codexVerify({ fetchImpl, toastFn: sink.toastFn });
  assert.equal(sink.messages[0].kind, "error");
  assert.match(sink.messages[0].message, /FAIL/);
});

// ── Wave 2: removed (LEGACY-VIEW-REMOVE-0, 2026-05-11) ─────────────
//
// The metrics / history / pipelineCompact / pipelineTemplate handlers
// targeted /?mode=legacy#anchor URLs that lived only in the legacy
// view. With the legacy view retired, those handlers — and the
// corresponding header/rail buttons — were removed.

// ── Default handler map ────────────────────────────────────────────

test("createDefaultHandlers exposes all documented action ids", () => {
  const handlers = shellActions.createDefaultHandlers({});
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [
      "codex-verify",
      "general-task",     // AGENT-DESKTOP-0-c: chat-flow general task dispatcher
      "pipeline-start",
      "show_status",      // AGENT-DESKTOP-0-c: inline status summary
      "shutdown",
    ],
  );
  for (const id of Object.keys(handlers)) {
    assert.equal(typeof handlers[id], "function", id + " must be callable");
  }
});

test("createDefaultHandlers binds the env into each handler invocation", async () => {
  const sink = makeToastSink();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse({ ok: true }));
  const handlers = shellActions.createDefaultHandlers({
    fetchImpl,
    confirmFn: () => true,
    toastFn: sink.toastFn,
  });
  await handlers["shutdown"]();
  assert.equal(calls.length, 1, "env-bound fetch must reach the shutdown endpoint");
});
