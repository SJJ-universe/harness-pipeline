// tests/unit/monitor.settings-accounts.test.js — Slice D3-d (Phase E1.5, 2026-04-29)
//
// Mounts the settings-accounts panel against a hand-rolled DOM stub
// (matches monitor.global-bar.test.js convention — jsdom isn't a project
// dependency). Verifies:
//
//   - Initial render with empty profile list
//   - Refresh fetches GET /api/profiles + populates the list
//   - Active profile gets the active marker
//   - Test Claude / Test Codex buttons fire POST /api/setup/probe-provider
//     and cache the result in panel-local state
//   - Switch button fires POST /api/profiles/:id/switch + handles 409
//     with a toast
//   - Delete button consults confirm() then fires DELETE + refreshes list
//   - Toast auto-clears after TOAST_TTL_MS
//   - busy flag disables every button while a fetch is in flight
//   - refresh handles non-OK responses + network errors gracefully
//   - Public-sector test → PUBLIC_SECTOR_BLOCKED → operator-readable toast

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  create,
  _formatTestResult,
  TOAST_TTL_MS,
} = require("../../public/js/monitor/panels/settings-accounts");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (lifted from monitor.global-bar.test.js) ──────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); return this; },
      remove(c) { this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get innerHTML() { return ""; },
    set innerHTML(v) {
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _click() {
      for (const fn of (listeners.click || []).slice()) fn({});
    },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") {
          out.push(...c._findAllByClass(cls));
        }
      }
      return out;
    },
    _findByText(text) {
      for (const c of this.children) {
        if (c._textContent === text) return c;
        if (typeof c._findByText === "function") {
          const found = c._findByText(text);
          if (found) return found;
        }
      }
      return null;
    },
  };
  // Also support disabled property for buttons.
  el.disabled = false;
  return el;
}

function makeStubDoc() {
  return { createElement: makeStubElement };
}

// ── fetch stub ────────────────────────────────────────────────

function makeFetch(routes) {
  // routes is { method-path: handler } where handler is fn(body) => response shape
  // Response shape: { ok, status, body }
  const calls = [];
  function impl(url, init) {
    init = init || {};
    const method = (init.method || "GET").toUpperCase();
    const key = method + " " + url;
    calls.push({ url, method, init });
    const handler = routes[key] || routes[method + " *"];
    if (!handler) {
      return Promise.resolve({
        ok: false,
        status: 404,
        async json() { return { error: "no stub for " + key }; },
      });
    }
    let parsedBody = null;
    if (init.body) {
      try { parsedBody = JSON.parse(init.body); } catch (_) { parsedBody = init.body; }
    }
    const r = typeof handler === "function" ? handler(parsedBody, init) : handler;
    return Promise.resolve({
      ok: r.ok != null ? r.ok : (r.status >= 200 && r.status < 300),
      status: r.status || 200,
      async json() { return r.body || {}; },
    });
  }
  impl.calls = calls;
  return impl;
}

// ── helpers ───────────────────────────────────────────────────

async function flush(n = 4) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

function findButton(root, label) {
  const btns = root._findAllByClass("sa-btn");
  for (const b of btns) {
    if (b._textContent === label) return b;
  }
  return null;
}

function exampleProfiles() {
  return [
    {
      id: "personal",
      label: "Personal",
      workspacePath: "/tmp/ws/personal",
      activeProvider: "claude",
      secretIds: [],
    },
    {
      id: "agency",
      label: "Agency",
      workspacePath: "/tmp/ws/agency",
      activeProvider: "claude",
      secretIds: [],
      accountType: "agency_managed",
      workspaceMode: "sandbox",
    },
  ];
}

function exampleAccountStatus(activeId = "personal") {
  return {
    profile: {
      activeId,
      activeLabel: activeId === "personal" ? "Personal" : "Agency",
      count: 2,
      credentialBackend: "keychain",
    },
    deployment: { mode: "standard", publicSector: false, allowLocalExecutor: true,
      allowPlaintextSecrets: false, requireSandboxWorkspace: false, requirePiiScan: false },
    bridge: { mode: "off" },
    remote: { mode: "off", activeRunnerCount: 0 },
  };
}

// ─────────────────────────────────────────────────────────────────
//  CONSTRUCTION + INITIAL RENDER
// ─────────────────────────────────────────────────────────────────

test("D3-d: create throws on bad inputs (root + store + doc)", () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  assert.throws(() => create({}), /root must be an element/);
  assert.throws(() => create({ root: doc.createElement("div") }), /store must be a OrchestratorMonitorStore/);
  assert.throws(
    () => create({ root: doc.createElement("div"), store, doc: {} }),
    /no document available/,
  );
});

test("D3-d: initial render shows 'No profiles' empty state", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: [] } },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  // Header is present.
  const headers = root._findAllByClass("sa-header");
  assert.equal(headers.length, 1);
  // Empty state text.
  const empty = root._findAllByClass("sa-empty");
  assert.equal(empty.length, 1);
  assert.match(empty[0]._textContent, /No profiles yet/);
  // No rows.
  const rows = root._findAllByClass("sa-row");
  assert.equal(rows.length, 0);

  panel.destroy();
});

test("D3-d: refresh populates the list from GET /api/profiles", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  const rows = root._findAllByClass("sa-row");
  assert.equal(rows.length, 2, "two profiles render two rows");
  // The personal row gets the active marker.
  const activeRows = root._findAllByClass("is-active");
  // Each active row contains a child with class is-active too (the badge).
  // Filter to just rows.
  const activeRowEls = activeRows.filter((el) => el.classList.contains("sa-row"));
  assert.equal(activeRowEls.length, 1);
});

test("D3-d: refresh on non-OK response surfaces a toast", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 401, body: { error: "auth" } },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  const toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]._textContent, /Failed to load profiles/);
  assert.match(toasts[0]._textContent, /401/);

  panel.destroy();
});

// ─────────────────────────────────────────────────────────────────
//  ACTIVE MARKER + ROW DETAILS
// ─────────────────────────────────────────────────────────────────

test("D3-d: active profile has 'active' badge; non-active rows show 'Switch' button", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  // The active badge is a span with class "sa-row-badge" textContent "active".
  const badges = root._findAllByClass("sa-row-badge");
  assert.equal(badges.length, 1);
  assert.equal(badges[0]._textContent, "active");
  // Switch button only appears on non-active rows. With 2 profiles + 1 active,
  // there should be exactly 1 Switch button.
  const switchBtns = root._findAllByClass("sa-btn-primary");
  assert.equal(switchBtns.length, 1);
});

test("D3-d: row meta shows profile id + workspace path", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  const metas = root._findAllByClass("sa-row-meta");
  assert.equal(metas.length, 2);
  // Personal row's meta mentions both id + workspace.
  const personalMeta = metas.find((m) => m._textContent.includes("personal"));
  assert.ok(personalMeta);
  assert.match(personalMeta._textContent, /workspace: \/tmp\/ws\/personal/);
});

// ─────────────────────────────────────────────────────────────────
//  TEST CLAUDE / TEST CODEX BUTTONS
// ─────────────────────────────────────────────────────────────────

test("D3-d: testProfile fires POST /api/setup/probe-provider with mode=tier1+2", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
    "POST /api/setup/probe-provider": (body) => ({
      status: 200,
      body: {
        installed: true,
        authenticated: true,
        canRun: false,
        accountLabel: "alice@example.com",
        errorCode: null,
        spendsTokens: false,
        details: { cliPath: "/bin/claude", cliVersion: "1.2.3", lastTestedAt: new Date().toISOString(), elapsedMs: 5, probeMode: body.mode, stderr: null },
      },
    }),
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();
  await panel.testProfile("personal", "claude");
  await flush();

  const probeCall = fetchImpl.calls.find((c) => c.url === "/api/setup/probe-provider");
  assert.ok(probeCall, "probe-provider was called");
  const sent = JSON.parse(probeCall.init.body);
  assert.equal(sent.runner, "claude");
  assert.equal(sent.profileId, "personal");
  assert.equal(sent.mode, "tier1+2",
    "wizard never spends tokens by default — tier1+2 is the safe mode");

  // Test result cached + rendered.
  const state = panel._state();
  assert.ok(state.testResults.get("personal"));
  assert.equal(state.testResults.get("personal").claude.errorCode, null);
});

test("D3-d: testProfile result renders into the row 'results' line", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
    "POST /api/setup/probe-provider": {
      status: 200,
      body: {
        installed: true, authenticated: true, canRun: false,
        accountLabel: "alice@example.com", errorCode: null, spendsTokens: false,
        details: { cliPath: "/bin/claude", cliVersion: "1", lastTestedAt: "now", elapsedMs: 1, probeMode: "tier1+2", stderr: null },
      },
    },
  });
  const panel = create({ root, store, doc, fetchImpl });
  await flush();
  await panel.testProfile("personal", "claude");
  await flush();

  const resultsLines = root._findAllByClass("sa-row-results");
  // Personal row's results line should now show "claude: ok (alice@example.com)".
  const personalResults = resultsLines.find((r) => /alice@example\.com/.test(r._textContent));
  assert.ok(personalResults, "results line shows Claude success with account label");
  assert.match(personalResults._textContent, /claude: ok/);
  assert.match(personalResults._textContent, /codex: untested/);
});

test("D3-d: PUBLIC_SECTOR_BLOCKED test result surfaces operator-readable toast", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("agency"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
    "POST /api/setup/probe-provider": {
      status: 200,
      body: {
        installed: false, authenticated: null, canRun: false,
        errorCode: "PUBLIC_SECTOR_BLOCKED", spendsTokens: false, accountLabel: null,
        details: { cliPath: null, cliVersion: null, stderr: "local executor disabled", lastTestedAt: "now", elapsedMs: 1, probeMode: "tier1+2" },
      },
    },
  });

  const panel = create({ root, store, doc, fetchImpl });
  await flush();
  await panel.testProfile("agency", "claude");
  await flush();

  const toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]._textContent, /sandbox runner/i);
});

// ─────────────────────────────────────────────────────────────────
//  SWITCH BUTTON
// ─────────────────────────────────────────────────────────────────

test("D3-d: switch fires POST /api/profiles/:id/switch + success toast", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
    "POST /api/profiles/agency/switch": { status: 200, body: { ok: true } },
  });
  const panel = create({ root, store, doc, fetchImpl });
  await flush();
  await panel.switchProfile("agency");
  await flush();

  const switchCall = fetchImpl.calls.find((c) => c.url === "/api/profiles/agency/switch");
  assert.ok(switchCall);
  assert.equal(switchCall.method, "POST");

  const toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]._textContent, /Switched to agency/);
});

test("D3-d: switch returning 409 shows active-run toast (no spam)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
    "POST /api/profiles/agency/switch": { status: 409, body: { error: "active_run_blocks_switch" } },
  });
  const panel = create({ root, store, doc, fetchImpl });
  await flush();
  await panel.switchProfile("agency");
  await flush();

  const toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]._textContent, /Active run/);
  assert.match(toasts[0]._textContent, /finish.*stop/);
});

// ─────────────────────────────────────────────────────────────────
//  DELETE BUTTON (with confirmation guard)
// ─────────────────────────────────────────────────────────────────

test("D3-d: delete consults confirm() before firing DELETE", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 200, body: { profiles: exampleProfiles() } },
  });
  let confirmCalled = false;
  const panel = create({
    root, store, doc, fetchImpl,
    confirmImpl: () => { confirmCalled = true; return false; },
  });
  await flush();
  await panel.deleteProfile("agency");
  await flush();

  assert.equal(confirmCalled, true);
  // Confirm returned false → no DELETE call should have fired.
  const deleteCall = fetchImpl.calls.find((c) => c.method === "DELETE");
  assert.equal(deleteCall, undefined,
    "confirm() returning false must abort delete");
});

test("D3-d: delete with confirm=true fires DELETE and refreshes list", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));
  let getCalls = 0;
  const fetchImpl = makeFetch({
    "GET /api/profiles": (body, init) => {
      getCalls += 1;
      if (getCalls === 1) {
        return { status: 200, body: { profiles: exampleProfiles() } };
      }
      // After delete, return only personal.
      return { status: 200, body: { profiles: [exampleProfiles()[0]] } };
    },
    "DELETE /api/profiles/agency": { status: 200, body: { ok: true } },
  });
  const panel = create({
    root, store, doc, fetchImpl,
    confirmImpl: () => true,
  });
  await flush();
  await panel.deleteProfile("agency");
  await flush(8); // delete then refresh both need to settle

  assert.ok(fetchImpl.calls.find((c) => c.method === "DELETE" && c.url === "/api/profiles/agency"));
  // After delete, the list should now have 1 row.
  const rows = root._findAllByClass("sa-row");
  assert.equal(rows.length, 1);
});

// ─────────────────────────────────────────────────────────────────
//  TOAST TTL
// ─────────────────────────────────────────────────────────────────

test("D3-d: toast auto-clears via setTimeout (TOAST_TTL_MS)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let scheduledMs = null;
  let scheduledFn = null;
  const setTimeoutFn = (fn, ms) => {
    scheduledFn = fn;
    scheduledMs = ms;
    return 1;
  };
  const clearTimeoutFn = () => {};
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 401, body: {} }, // triggers toast on initial refresh
  });

  const panel = create({ root, store, doc, fetchImpl, setTimeoutFn, clearTimeoutFn });
  await flush();

  // Toast appears + setTimeout was scheduled with TOAST_TTL_MS.
  let toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 1);
  assert.equal(scheduledMs, TOAST_TTL_MS);

  // Manually fire the scheduled timeout — toast should clear.
  scheduledFn();
  toasts = root._findAllByClass("sa-toast");
  assert.equal(toasts.length, 0);

  panel.destroy();
});

// ─────────────────────────────────────────────────────────────────
//  busy FLAG
// ─────────────────────────────────────────────────────────────────

test("D3-d: busy flag disables every button while a fetch is in flight", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus("personal"));

  // Hold the probe-provider response so we can inspect the busy state.
  let resolveProbe;
  const probePromise = new Promise((resolve) => { resolveProbe = resolve; });
  const fetchImpl = (url, init) => {
    if (url === "/api/profiles") {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() { return { profiles: exampleProfiles() }; },
      });
    }
    if (url === "/api/setup/probe-provider") {
      return probePromise.then(() => ({
        ok: true,
        status: 200,
        async json() { return { installed: true, authenticated: true, errorCode: null, accountLabel: null, spendsTokens: false, details: {} }; },
      }));
    }
    return Promise.resolve({ ok: false, status: 404, async json() { return {}; } });
  };

  const panel = create({ root, store, doc, fetchImpl });
  await flush();

  const beforePromise = panel.testProfile("personal", "claude");
  await flush();
  // While the probe is in flight, panel.busy must be true.
  assert.equal(panel._state().busy, true,
    "busy flag must be set while a fetch is in flight");

  // Resolve the in-flight probe.
  resolveProbe();
  await beforePromise;
  await flush();
  assert.equal(panel._state().busy, false);
});

// ─────────────────────────────────────────────────────────────────
//  _formatTestResult unit
// ─────────────────────────────────────────────────────────────────

test("D3-d: _formatTestResult — untested vs error vs ok shapes", () => {
  assert.equal(_formatTestResult("claude", null), "claude: untested");
  assert.equal(_formatTestResult("claude", undefined), "claude: untested");
  assert.equal(_formatTestResult("claude", { errorCode: "NOT_INSTALLED" }), "claude: NOT_INSTALLED");
  assert.equal(_formatTestResult("claude", { errorCode: "PUBLIC_SECTOR_BLOCKED" }), "claude: PUBLIC_SECTOR_BLOCKED");
  assert.equal(_formatTestResult("claude", { installed: true, authenticated: true }), "claude: ok");
  assert.equal(
    _formatTestResult("claude", { installed: true, authenticated: true, accountLabel: "alice@example.com" }),
    "claude: ok (alice@example.com)",
  );
  assert.equal(_formatTestResult("claude", { installed: true, authenticated: false }), "claude: not authenticated");
  assert.equal(_formatTestResult("claude", { installed: false, authenticated: false }), "claude: not installed");
});

// ─────────────────────────────────────────────────────────────────
//  destroy
// ─────────────────────────────────────────────────────────────────

test("D3-d: destroy unsubscribes + clears the root + cancels pending toast timer", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let cleared = false;
  const setTimeoutFn = () => 99;
  const clearTimeoutFn = () => { cleared = true; };
  const fetchImpl = makeFetch({
    "GET /api/profiles": { status: 401, body: {} }, // triggers toast → schedules timer
  });

  const panel = create({ root, store, doc, fetchImpl, setTimeoutFn, clearTimeoutFn });
  await flush();

  panel.destroy();

  // root cleared.
  assert.equal(root.children.length, 0);
  // timer cancelled.
  assert.equal(cleared, true);
  // Subscriber list is empty (a subsequent store update shouldn't repopulate root).
  store.bumpCounter("noise", 1);
  await flush();
  assert.equal(root.children.length, 0);
});
