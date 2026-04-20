// Slice C (v4) — api-client.js must surface server/network failures as
// toasts with a retry action. We run the browser IIFE inside a Node vm
// context with a fake window + originalFetch so we can drive real behavior
// without loading a browser.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const API_CLIENT_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "public", "js", "api-client.js"),
  "utf-8"
);

class HeadersStub {
  constructor(init) {
    this._map = new Map();
    if (init && typeof init === "object") {
      if (init instanceof HeadersStub) {
        for (const [k, v] of init._map) this._map.set(k, v);
      } else {
        for (const [k, v] of Object.entries(init)) this._map.set(k, v);
      }
    }
  }
  set(k, v) { this._map.set(String(k).toLowerCase(), String(v)); }
  get(k) { return this._map.get(String(k).toLowerCase()); }
  has(k) { return this._map.has(String(k).toLowerCase()); }
}

function setupClient({ originalFetch }) {
  const toasts = [];
  const warnings = [];
  const win = {
    HARNESS_TOKEN: null,
    HarnessToast: { show: (opts) => { toasts.push(opts); return "t1"; } },
    // api-client captures `window.fetch.bind(window)` at IIFE time, so this
    // must be a real function that works with .bind and then gets replaced
    // when the IIFE returns.
    fetch: originalFetch,
    _toasts: toasts,
  };
  const ctx = vm.createContext({
    window: win,
    Headers: HeadersStub,
    console: { warn: (...args) => warnings.push(args), error: () => {} },
    setTimeout, clearTimeout,
  });
  vm.runInContext(API_CLIENT_SRC, ctx, { filename: "api-client.js" });
  return { win, toasts, warnings };
}

// Helper: resolve the token-fetch microtask queue before assertions.
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

test("successful /api/* calls attach x-harness-token and do NOT toast", async () => {
  const seenCalls = [];
  const originalFetch = async (url, init) => {
    seenCalls.push({ url, init });
    if (url === "/api/auth/token") {
      return { ok: true, status: 200, json: async () => ({ token: "abc123" }) };
    }
    return { ok: true, status: 200 };
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();

  const res = await win.fetch("/api/hook", { method: "POST", body: "{}" });
  assert.equal(res.ok, true);
  const hookCall = seenCalls.find((c) => c.url === "/api/hook");
  assert.ok(hookCall);
  assert.equal(hookCall.init.headers.get("x-harness-token"), "abc123");
  assert.equal(toasts.length, 0, "happy-path calls must not surface toasts");
});

test("500 response on /api/* triggers an error toast with 재시도 action", async () => {
  const originalFetch = async (url) => {
    if (url === "/api/auth/token") return { ok: true, status: 200, json: async () => ({ token: "x" }) };
    return { ok: false, status: 503 };
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();

  await win.fetch("/api/hook", { method: "POST" });
  const errToast = toasts.find((t) => /서버 오류 503/.test(t.message));
  assert.ok(errToast, "expected an error toast for 503 on /api/hook");
  assert.equal(errToast.type, "error");
  assert.equal(errToast.actionLabel, "재시도");
  assert.equal(typeof errToast.onAction, "function");
});

test("4xx responses are NOT toasted (caller owns client-side validation UX)", async () => {
  const originalFetch = async (url) => {
    if (url === "/api/auth/token") return { ok: true, status: 200, json: async () => ({ token: "x" }) };
    return { ok: false, status: 400 };
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();

  await win.fetch("/api/hook", { method: "POST" });
  const errToast = toasts.find((t) => /서버 오류/.test(t.message));
  assert.ok(!errToast, "4xx must not surface the generic server-error toast");
});

test("network exception on /api/* triggers error toast and rethrows", async () => {
  let tokenServed = false;
  const originalFetch = async (url) => {
    if (url === "/api/auth/token") {
      tokenServed = true;
      return { ok: true, status: 200, json: async () => ({ token: "x" }) };
    }
    throw new Error("ECONNREFUSED");
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();
  assert.ok(tokenServed);

  await assert.rejects(
    () => win.fetch("/api/hook", { method: "POST" }),
    /ECONNREFUSED/
  );
  const netToast = toasts.find((t) => /네트워크 오류/.test(t.message));
  assert.ok(netToast);
  assert.equal(netToast.type, "error");
  assert.equal(netToast.actionLabel, "재시도");
});

test("non-/api/* URLs do not emit api-client toasts even on failure", async () => {
  const originalFetch = async (url) => {
    if (url === "/api/auth/token") return { ok: true, status: 200, json: async () => ({ token: "x" }) };
    if (url === "https://example.com/cdn/xterm.js") return { ok: false, status: 502 };
    throw new Error("should not hit");
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();

  await win.fetch("https://example.com/cdn/xterm.js");
  assert.equal(
    toasts.filter((t) => /서버 오류/.test(t.message)).length,
    0,
    "third-party CDN failures must NOT produce dashboard-level toasts"
  );
});

test("token fetch failure surfaces a retryable toast (no silent catch)", async () => {
  const originalFetch = async (url) => {
    if (url === "/api/auth/token") throw new Error("down");
    return { ok: true, status: 200 };
  };
  const { toasts } = setupClient({ originalFetch });
  await flush();
  const tokenToast = toasts.find((t) => /인증 토큰/.test(t.message));
  assert.ok(tokenToast, "token fetch failure was swallowed — Slice C should surface it");
  assert.equal(tokenToast.actionLabel, "재시도");
});

test("retry action on 503 toast fires another fetch attempt", async () => {
  let hookAttempts = 0;
  const originalFetch = async (url, init) => {
    if (url === "/api/auth/token") return { ok: true, status: 200, json: async () => ({ token: "x" }) };
    if (url === "/api/hook") {
      hookAttempts++;
      return { ok: false, status: 503 };
    }
    return { ok: true, status: 200 };
  };
  const { win, toasts } = setupClient({ originalFetch });
  await flush();

  await win.fetch("/api/hook", { method: "POST", body: "{}" });
  assert.equal(hookAttempts, 1);
  const errToast = toasts.find((t) => /서버 오류 503/.test(t.message));
  assert.ok(errToast);
  // Simulate the user clicking "재시도"
  errToast.onAction();
  await flush();
  assert.equal(hookAttempts, 2, "action handler must re-issue the failed request");
});
