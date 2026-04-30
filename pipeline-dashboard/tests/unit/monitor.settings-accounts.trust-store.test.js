// Slice TRUST-STORE-0-e/f (Phase E Round 2, 2026-04-30) — settings-accounts
// trust-store extension tests. Reuses the DOM-stub pattern from
// monitor.settings-accounts.test.js (jsdom isn't a project dep).
//
// Pinned behaviors:
//   - Section renders with header + add form + empty list
//   - Public-sector + 0 keys → red warning banner
//   - Add key flow → POST + refresh + form clears
//   - Edit label flow → PATCH + refresh
//   - Delete in standard mode → DELETE + refresh
//   - Delete in public-sector → 409 confirm flow + 2-step
//   - Error rendering uses _formatTrustStoreError mapping
//   - _state() exposes trust sub-state for inspection

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  create,
  _formatTrustStoreError,
} = require("../../public/js/monitor/panels/settings-accounts");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (mirror of monitor.settings-accounts.test.js) ─────────

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
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    _input(value) {
      for (const fn of (listeners.input || []).slice()) {
        fn({ target: { value } });
      }
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
    _findOneByClass(cls) {
      const arr = this._findAllByClass(cls);
      return arr.length > 0 ? arr[0] : null;
    },
  };
  el.value = "";
  return el;
}

function makeStubDoc() { return { createElement: makeStubElement }; }

function makeFetch(routes) {
  const calls = [];
  function impl(url, init) {
    init = init || {};
    const method = (init.method || "GET").toUpperCase();
    const key = method + " " + url;
    calls.push({ url, method, init });
    const handler = routes[key] || routes[method + " *"];
    if (!handler) {
      return Promise.resolve({
        ok: false, status: 404,
        async json() { return { ok: false, error: "no stub for " + key }; },
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

async function flush(n = 6) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

// Default fetch stub: empty profiles + empty trust store.
function makeDefaultFetch(opts = {}) {
  const trustResp = opts.trustResp || {
    ok: true, body: {
      ok: true, keys: [], posture: opts.posture || "standard",
      requireSignedManifest: opts.posture === "public-sector",
      keyCount: 0,
    },
  };
  return makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": typeof trustResp === "function" ? trustResp : trustResp,
  });
}

// ── _formatTrustStoreError mapping ──────────────────────────────────

test("TRUST-STORE-0: _formatTrustStoreError maps every documented code", () => {
  // Frozen vocabulary the routes emit. Mismatched mapping leaves
  // operators staring at raw codes.
  assert.match(_formatTrustStoreError("invalid_input"), /잘못된 입력/);
  assert.match(_formatTrustStoreError("invalid_public_key"), /공개키 형식/);
  assert.match(_formatTrustStoreError("private_key_rejected"), /개인키/);
  assert.match(_formatTrustStoreError("duplicate_key_id"), /이미 등록/);
  assert.match(_formatTrustStoreError("key_not_found"), /찾을 수 없습니다/);
  assert.match(_formatTrustStoreError("trust_file_invalid"), /손상/);
  assert.match(_formatTrustStoreError("store_unwritable"), /쓸 수 없습니다/);
  assert.match(_formatTrustStoreError("confirm_required"), /2단계 확인/);
  assert.match(_formatTrustStoreError("confirm_token_invalid"), /확인 토큰/);
  assert.match(_formatTrustStoreError("confirm_token_mismatch"), /일치하지 않/);
  assert.match(_formatTrustStoreError("confirm_token_expired"), /만료/);
  assert.match(_formatTrustStoreError("confirm_token_missing"), /누락/);
  assert.match(_formatTrustStoreError("confirm_not_required"), /필요하지 않/);
  assert.match(_formatTrustStoreError("trust_store_not_wired"), /구성되지 않/);
  assert.match(_formatTrustStoreError("network_error"), /네트워크/);
  // Unknown code falls through — Korean default, never raw English.
  assert.match(_formatTrustStoreError("totally_made_up_code"), /신뢰 저장소/);
});

// ── render: section presence ───────────────────────────────────────

test("TRUST-STORE-0: trust-store section renders inside settings panel", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeDefaultFetch();
  create({ root, store, doc, fetchImpl });
  await flush();
  const sec = root._findOneByClass("sa-trust-store");
  assert.ok(sec, "trust-store section must render");
  // Title
  assert.ok(root._findOneByClass("sa-trust-title"));
  // Empty state in the list
  assert.ok(root._findOneByClass("sa-trust-empty"));
  // Add form is always present
  assert.ok(root._findOneByClass("sa-trust-add"));
});

test("TRUST-STORE-0: public-sector + 0 keys shows red warning banner", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeDefaultFetch({ posture: "public-sector" });
  create({ root, store, doc, fetchImpl });
  await flush();
  const sec = root._findOneByClass("sa-trust-store");
  assert.ok(sec.classList.contains("sa-trust-store-public-sector"),
    "public-sector posture must mark the section",
  );
  const warn = root._findOneByClass("sa-trust-warn");
  assert.ok(warn, "warning banner appears when posture=public-sector + 0 keys");
  assert.match(warn._textContent, /공공기관 모드/);
  // Title swaps to the public-sector variant
  const title = root._findOneByClass("sa-trust-title");
  assert.match(title._textContent, /공공기관/);
});

test("TRUST-STORE-0: public-sector + ≥1 key suppresses the red banner", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": {
      ok: true, body: {
        ok: true, posture: "public-sector", requireSignedManifest: true, keyCount: 1,
        keys: [{ keyId: "abc", publicKeyDerBase64: "...", label: "Release", addedAt: "2026-04-30T00:00:00Z" }],
      },
    },
  });
  create({ root, store, doc, fetchImpl });
  await flush();
  assert.equal(root._findOneByClass("sa-trust-warn"), null);
  assert.ok(root._findOneByClass("sa-trust-row"));
});

// ── add flow ───────────────────────────────────────────────────────

test("TRUST-STORE-0: add key → POST → refresh → form clears", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  let listCallCount = 0;
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": () => {
      listCallCount += 1;
      // First call (mount): empty. After successful add: shows the key.
      if (listCallCount === 1) {
        return { ok: true, body: { ok: true, keys: [], posture: "standard", keyCount: 0 } };
      }
      return {
        ok: true, body: {
          ok: true, posture: "standard", keyCount: 1,
          keys: [{ keyId: "added", publicKeyDerBase64: "x", label: "L1", addedAt: "2026-04-30T00:00:00Z" }],
        },
      };
    },
    "POST /api/trust-store/keys": (body) => {
      assert.equal(body.publicKeyDerBase64, "MCowBQ...");
      assert.equal(body.label, "L1");
      return {
        ok: true, status: 201,
        body: { ok: true, key: { keyId: "added", publicKeyDerBase64: "MCowBQ...", label: "L1", addedAt: "2026-04-30T00:00:00Z" } },
      };
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  // Drive the add via the public action surface (avoids depending on
  // exact button positions or input-event semantics).
  await handle.addTrustKey({ publicKey: "MCowBQ...", label: "L1" });
  await flush();
  // Form was reset
  const s = handle._state();
  assert.equal(s.trustForm.publicKey, "");
  assert.equal(s.trustForm.label, "");
  // List refreshed
  assert.equal(s.trustKeys.length, 1);
  assert.equal(s.trustKeys[0].keyId, "added");
});

test("TRUST-STORE-0: add key with empty publicKey surfaces invalid_public_key", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeDefaultFetch();
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.addTrustKey({ publicKey: "  ", label: "x" });
  await flush();
  const s = handle._state();
  assert.equal(s.trustError, "invalid_public_key");
});

test("TRUST-STORE-0: add key 409 duplicate surfaces error code", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": { ok: true, body: { ok: true, keys: [], posture: "standard", keyCount: 0 } },
    "POST /api/trust-store/keys": {
      ok: false, status: 409,
      body: { ok: false, error: "duplicate_key_id", keyId: "abc" },
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.addTrustKey({ publicKey: "MCowBQ...", label: "x" });
  await flush();
  assert.equal(handle._state().trustError, "duplicate_key_id");
  // The error banner is rendered with the Korean message.
  const errBanner = root._findOneByClass("sa-trust-error");
  assert.ok(errBanner);
  assert.match(errBanner._textContent, /이미 등록/);
});

test("TRUST-STORE-0: add key 400 private_key_rejected surfaces banner", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": { ok: true, body: { ok: true, keys: [], posture: "standard", keyCount: 0 } },
    "POST /api/trust-store/keys": {
      ok: false, status: 400,
      body: { ok: false, error: "private_key_rejected", marker: "PRIVATE KEY" },
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.addTrustKey({ publicKey: "-----BEGIN PRIVATE KEY-----...", label: "" });
  await flush();
  assert.equal(handle._state().trustError, "private_key_rejected");
  const errBanner = root._findOneByClass("sa-trust-error");
  assert.match(errBanner._textContent, /개인키/);
});

// ── edit flow ──────────────────────────────────────────────────────

test("TRUST-STORE-0: updateTrustKeyLabel → PATCH → refresh", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  let listCalls = 0;
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": () => {
      listCalls += 1;
      const label = listCalls === 1 ? "before" : "after";
      return {
        ok: true, body: {
          ok: true, posture: "standard", keyCount: 1,
          keys: [{ keyId: "abc", publicKeyDerBase64: "x", label, addedAt: "2026-04-30T00:00:00Z" }],
        },
      };
    },
    "PATCH /api/trust-store/keys/abc": (body) => {
      assert.equal(body.label, "after");
      return {
        ok: true, body: { ok: true, key: { keyId: "abc", label: "after" } },
      };
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.updateTrustKeyLabel("abc", "after");
  await flush();
  assert.equal(handle._state().trustKeys[0].label, "after");
});

// ── delete flow — standard ─────────────────────────────────────────

test("TRUST-STORE-0: standard mode delete → DELETE → refresh", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  let listCalls = 0;
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": () => {
      listCalls += 1;
      return {
        ok: true, body: {
          ok: true, posture: "standard",
          keyCount: listCalls === 1 ? 1 : 0,
          keys: listCalls === 1
            ? [{ keyId: "abc", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" }]
            : [],
        },
      };
    },
    "DELETE /api/trust-store/keys/abc": { ok: true, body: { ok: true, removed: "abc" } },
  });
  const handle = create({ root, store, doc, fetchImpl,
    confirmImpl: () => true, // operator confirmed
  });
  await flush();
  await handle.deleteTrustKey("abc");
  await flush();
  assert.equal(handle._state().trustKeys.length, 0);
  // Confirm flow NOT triggered in standard
  assert.equal(handle._state().trustConfirm, null);
});

test("TRUST-STORE-0: standard mode delete cancelled by confirm() returning false", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": {
      ok: true, body: {
        ok: true, posture: "standard", keyCount: 1,
        keys: [{ keyId: "abc", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" }],
      },
    },
  });
  const handle = create({ root, store, doc, fetchImpl, confirmImpl: () => false });
  await flush();
  await handle.deleteTrustKey("abc");
  await flush();
  // No DELETE call fired — fetch.calls reflects only the GETs.
  const deleteCalls = fetchImpl.calls.filter((c) => c.method === "DELETE");
  assert.equal(deleteCalls.length, 0);
});

// ── delete flow — public-sector 2-step ─────────────────────────────

test("TRUST-STORE-0: public-sector delete returns 409 + caches confirm token", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": {
      ok: true, body: {
        ok: true, posture: "public-sector", requireSignedManifest: true, keyCount: 1,
        keys: [{ keyId: "abc", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" }],
      },
    },
    "DELETE /api/trust-store/keys/abc": {
      ok: false, status: 409,
      body: {
        ok: false, error: "confirm_required",
        confirmToken: "deadbeef00000000deadbeef00000000",
        confirmTtlMs: 300000,
        keyId: "abc",
      },
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.deleteTrustKey("abc");
  await flush();
  const s = handle._state();
  assert.ok(s.trustConfirm);
  assert.equal(s.trustConfirm.keyId, "abc");
  assert.equal(s.trustConfirm.token, "deadbeef00000000deadbeef00000000");
  // Inline confirm UI is rendered
  assert.ok(root._findOneByClass("sa-trust-confirm"));
});

test("TRUST-STORE-0: public-sector confirm flow → POST /confirm → refresh", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  let listCalls = 0;
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": () => {
      listCalls += 1;
      return {
        ok: true, body: {
          ok: true, posture: "public-sector", requireSignedManifest: true,
          keyCount: listCalls === 1 ? 1 : 0,
          keys: listCalls === 1
            ? [{ keyId: "abc", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" }]
            : [],
        },
      };
    },
    "DELETE /api/trust-store/keys/abc": {
      ok: false, status: 409,
      body: { ok: false, error: "confirm_required", confirmToken: "tok123", confirmTtlMs: 300000, keyId: "abc" },
    },
    "POST /api/trust-store/keys/abc/confirm": (body) => {
      assert.equal(body.confirmToken, "tok123");
      return { ok: true, body: { ok: true, removed: "abc" } };
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  // Step 1: trigger DELETE — server returns 409 + token.
  await handle.deleteTrustKey("abc");
  await flush();
  assert.equal(handle._state().trustConfirm.token, "tok123");
  // Step 2: confirm — server actually deletes.
  await handle.confirmDeleteTrustKey("abc");
  await flush();
  assert.equal(handle._state().trustConfirm, null);
  assert.equal(handle._state().trustKeys.length, 0);
});

test("TRUST-STORE-0: confirmDeleteTrustKey without active token surfaces error", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeDefaultFetch({ posture: "public-sector" });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.confirmDeleteTrustKey("abc");
  await flush();
  // No token cached → confirm_token_missing error code surfaces.
  assert.equal(handle._state().trustError, "confirm_token_missing");
});

test("TRUST-STORE-0: confirmDeleteTrustKey on POST failure clears the token", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": {
      ok: true, body: {
        ok: true, posture: "public-sector", requireSignedManifest: true, keyCount: 1,
        keys: [{ keyId: "abc", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" }],
      },
    },
    "DELETE /api/trust-store/keys/abc": {
      ok: false, status: 409,
      body: { ok: false, error: "confirm_required", confirmToken: "tok123", confirmTtlMs: 300000, keyId: "abc" },
    },
    "POST /api/trust-store/keys/abc/confirm": {
      ok: false, status: 400,
      body: { ok: false, error: "confirm_token_expired" },
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  await handle.deleteTrustKey("abc");
  await flush();
  await handle.confirmDeleteTrustKey("abc");
  await flush();
  // Failure dropped the token (operator must restart) + surfaces error.
  assert.equal(handle._state().trustConfirm, null);
  assert.equal(handle._state().trustError, "confirm_token_expired");
});

// ── single-flight gate ─────────────────────────────────────────────

test("TRUST-STORE-0: trustBusy flag prevents overlapping trust actions", async () => {
  // Synchronous-double-call pattern: in JS, addTrustKey runs
  // synchronously up to its `await fetch(...)`. Setting trustBusy=true
  // happens BEFORE the await yields, so a second call (made before
  // the first's microtask resumes) sees trustBusy=true and returns
  // early. We verify by counting POST calls — only one fires.
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeFetch({
    "GET /api/profiles": { ok: true, body: { profiles: [], activeProfileId: null } },
    "GET /api/trust-store": { ok: true, body: { ok: true, keys: [], posture: "standard", keyCount: 0 } },
    "POST /api/trust-store/keys": {
      ok: true, status: 201,
      body: { ok: true, key: { keyId: "x", publicKeyDerBase64: "x", label: null, addedAt: "2026-04-30T00:00:00Z" } },
    },
  });
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  // Two synchronous calls — second sees trustBusy=true from the first.
  const p1 = handle.addTrustKey({ publicKey: "MCowBQ...1" });
  const p2 = handle.addTrustKey({ publicKey: "MCowBQ...2" });
  await Promise.all([p1, p2]);
  await flush();
  const postCalls = fetchImpl.calls.filter((c) => c.method === "POST");
  assert.equal(postCalls.length, 1, "second add must be ignored while first is in-flight");
  // After settling, trustBusy is back to false (no leaked busy flag).
  assert.equal(handle._state().trustBusy, false);
});

// ── public API surface ─────────────────────────────────────────────

test("TRUST-STORE-0: handle exposes trust action methods + refreshTrust", async () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  const root = doc.createElement("div");
  const fetchImpl = makeDefaultFetch();
  const handle = create({ root, store, doc, fetchImpl });
  await flush();
  assert.equal(typeof handle.refreshTrust, "function");
  assert.equal(typeof handle.addTrustKey, "function");
  assert.equal(typeof handle.updateTrustKeyLabel, "function");
  assert.equal(typeof handle.deleteTrustKey, "function");
  assert.equal(typeof handle.confirmDeleteTrustKey, "function");
});
