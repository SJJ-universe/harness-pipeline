// Slice UX-2-b (Phase D R3 + Phase E1.5, 2026-04-29) — approval-card
// panel unit tests.
//
// Mounts the approval-card panel against the same hand-rolled DOM
// stub the project uses elsewhere (jsdom isn't a project dependency).
// Verifies:
//   - Initial render shows "No pending approvals" placeholder
//   - On store.upsertApproval, a card renders with tool / summary
//   - PII badge renders when piiContext.hasPii
//   - Allow / Deny buttons POST to /api/approvals/:id/{grant,deny}
//   - 404 / 401 / network error handled with operator-readable toasts
//   - busy guard disables every button while a fetch is in flight
//   - resolveApproval (via store) removes the card from the DOM
//   - destroy() unsubscribes + clears the panel

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const approvalCard = require("../../public/js/monitor/panels/approval-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (lifted from monitor.settings-accounts.test.js) ──────

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
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
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
    _allText() {
      // Concatenate all descendant text content for substring matches.
      let out = this._textContent || "";
      for (const c of this.children) {
        if (typeof c._allText === "function") out += c._allText();
      }
      return out;
    },
  };
  el.disabled = false;
  return el;
}

function makeStubDoc() {
  return { createElement: makeStubElement };
}

function makeRoot() {
  const root = makeStubElement("div");
  return root;
}

// ── Fixtures ──────────────────────────────────────────────────────

function makeRequest(overrides = {}) {
  return {
    approvalId: "appr-1",
    hook: "PreToolUse",
    tool: "Bash",
    args: { command: "echo hi" },
    argsHash: "deadbeef".repeat(8),
    argsSummary: "echo hi",
    runId: "run-1",
    hostIdentity: "host-A",
    source: "remote_hook",
    piiContext: null,
    timeoutMs: 30000,
    requestedAt: 1000,
    expiresAt: 31000,
    ...overrides,
  };
}

function fakeFetch(handler) {
  let calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  fn.calls = () => calls;
  return fn;
}

function fakeOk(body = {}) {
  return { ok: true, status: 200, async json() { return body; } };
}

function fakeError(status, body = {}) {
  return { ok: false, status, async json() { return body; } };
}

// ── Construction guards ──────────────────────────────────────────

test("UX-2-b: create throws without root", () => {
  assert.throws(() => approvalCard.create({ store: createMonitorStore() }),
    /root must be an element/);
});

test("UX-2-b: create throws without store", () => {
  const root = makeRoot();
  assert.throws(() => approvalCard.create({ root, doc: makeStubDoc() }),
    /store must be a OrchestratorMonitorStore/);
});

// ── Empty state ───────────────────────────────────────────────────

test("UX-2-b: empty store renders 'No pending approvals' placeholder", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  const head = root._findOneByClass("ac-list-header");
  assert.ok(head);
  assert.match(head._allText(), /No pending approvals/);
  // No card list rendered for empty state.
  assert.equal(root._findOneByClass("ac-list"), null);
});

// ── Card render ───────────────────────────────────────────────────

test("UX-2-b: upsertApproval triggers a card render", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });

  store.upsertApproval(makeRequest({
    approvalId: "appr-1", tool: "Bash", argsSummary: "echo hi",
  }));

  const card = root._findOneByClass("ac-card");
  assert.ok(card, "card should be rendered");
  assert.equal(card.getAttribute("data-approval-id"), "appr-1");
  assert.equal(card._findOneByClass("ac-tool")._textContent, "Bash");
  assert.equal(card._findOneByClass("ac-summary")._textContent, "echo hi");
  assert.equal(card._findOneByClass("ac-tool-glyph")._textContent, "$");
});

test("UX-2-b: header count reflects pending count", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });

  store.upsertApproval(makeRequest({ approvalId: "a", requestedAt: 1 }));
  assert.match(root._findOneByClass("ac-count")._textContent, /1 pending approval$/);

  store.upsertApproval(makeRequest({ approvalId: "b", requestedAt: 2 }));
  assert.match(root._findOneByClass("ac-count")._textContent, /2 pending approvals/);
});

test("UX-2-b: tool glyph defaults to '·' for unknown tool", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({ tool: "FutureTool" }));
  assert.equal(root._findOneByClass("ac-tool-glyph")._textContent, "·");
});

test("UX-2-b: long argsSummary truncates with ellipsis", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  const long = "a".repeat(200);
  store.upsertApproval(makeRequest({ argsSummary: long }));
  const summary = root._findOneByClass("ac-summary")._textContent;
  assert.equal(summary.length, 80);
  assert.ok(summary.endsWith("…"));
});

test("UX-2-b: meta line shows host / run / timeout", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({
    hostIdentity: "host-Z", runId: "run-X", timeoutMs: 30000,
  }));
  const meta = root._findOneByClass("ac-meta")._textContent;
  assert.match(meta, /host: host-Z/);
  assert.match(meta, /run: run-X/);
  assert.match(meta, /timeout: 30s/);
});

test("UX-2-b: meta line omits missing fields gracefully", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({
    hostIdentity: null, runId: null, timeoutMs: 30000,
  }));
  const meta = root._findOneByClass("ac-meta")._textContent;
  assert.equal(meta, "timeout: 30s");
});

// ── PII badge ────────────────────────────────────────────────────

test("UX-2-b: piiContext.hasPii=true renders PII warning badge", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({
    piiContext: {
      hasPii: true,
      findingTypes: ["phone_kr_mobile", "krn"],
      samples: { phone_kr_mobile: ["01*"] },
    },
  }));
  const badge = root._findOneByClass("ac-pii-badge");
  assert.ok(badge);
  assert.match(badge._textContent, /PII/);
  assert.match(badge._textContent, /phone_kr_mobile/);
  assert.match(badge._textContent, /krn/);
});

test("UX-2-b: piiContext absent does NOT render badge", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({ piiContext: null }));
  assert.equal(root._findOneByClass("ac-pii-badge"), null);
});

test("UX-2-b: piiContext with hasPii but no findingTypes still renders badge with generic label", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({
    piiContext: { hasPii: true, findingTypes: [], samples: {} },
  }));
  const badge = root._findOneByClass("ac-pii-badge");
  assert.ok(badge);
  assert.match(badge._textContent, /PII detected/);
});

// ── Allow / Deny buttons ─────────────────────────────────────────

test("UX-2-b: Allow button POSTs to /api/approvals/:id/grant", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = fakeFetch(() => fakeOk({ ok: true, resolution: "granted" }));

  approvalCard.create({ root, store, doc: makeStubDoc(), fetchImpl, deciderId: "operator-1" });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));

  const allow = root._findOneByClass("ac-btn-allow");
  allow._click();
  await new Promise((r) => setImmediate(r));

  const calls = fetchImpl.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/approvals/appr-1/grant");
  assert.equal(calls[0].opts.method, "POST");
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.deciderId, "operator-1");
});

test("UX-2-b: Deny button POSTs to /api/approvals/:id/deny", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = fakeFetch(() => fakeOk({ ok: true, resolution: "denied" }));

  approvalCard.create({ root, store, doc: makeStubDoc(), fetchImpl, deciderId: "operator-1" });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));

  root._findOneByClass("ac-btn-deny")._click();
  await new Promise((r) => setImmediate(r));

  assert.equal(fetchImpl.calls()[0].url, "/api/approvals/appr-1/deny");
});

test("UX-2-b: deciderId defaults to 'operator' when not provided", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = fakeFetch(() => fakeOk());

  approvalCard.create({ root, store, doc: makeStubDoc(), fetchImpl });  // no deciderId
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  root._findOneByClass("ac-btn-allow")._click();
  await new Promise((r) => setImmediate(r));

  const body = JSON.parse(fetchImpl.calls()[0].opts.body);
  assert.equal(body.deciderId, "operator");
});

test("UX-2-b: 404 response -> 'Already resolved' toast", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = fakeFetch(() => fakeError(404, { error: "unknown_or_resolved" }));

  approvalCard.create({
    root, store, doc: makeStubDoc(), fetchImpl,
    setTimeoutFn: () => 0, clearTimeoutFn: () => {},
  });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  root._findOneByClass("ac-btn-allow")._click();
  await new Promise((r) => setImmediate(r));

  assert.match(root._findOneByClass("ac-toast")._textContent, /Already resolved/);
});

test("UX-2-b: 401 response -> 'Auth required' toast", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = fakeFetch(() => fakeError(401));

  approvalCard.create({
    root, store, doc: makeStubDoc(), fetchImpl,
    setTimeoutFn: () => 0, clearTimeoutFn: () => {},
  });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  root._findOneByClass("ac-btn-allow")._click();
  await new Promise((r) => setImmediate(r));

  assert.match(root._findOneByClass("ac-toast")._textContent, /Auth required/);
});

test("UX-2-b: network error caught, surfaces toast (no throw)", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const fetchImpl = async () => { throw new Error("network down"); };

  approvalCard.create({
    root, store, doc: makeStubDoc(), fetchImpl,
    setTimeoutFn: () => 0, clearTimeoutFn: () => {},
  });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  root._findOneByClass("ac-btn-allow")._click();
  await new Promise((r) => setImmediate(r));

  assert.match(root._findOneByClass("ac-toast")._textContent, /Failed/);
});

test("UX-2-b: button disabled while a fetch is in flight (busy guard)", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let resolveFetch;
  const fetchImpl = () => new Promise((r) => { resolveFetch = r; });

  approvalCard.create({
    root, store, doc: makeStubDoc(), fetchImpl,
    setTimeoutFn: () => 0, clearTimeoutFn: () => {},
  });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));

  root._findOneByClass("ac-btn-allow")._click();
  await new Promise((r) => setImmediate(r));
  // After click + microtask: the buttons are disabled.
  assert.equal(root._findOneByClass("ac-btn-allow").disabled, true);
  assert.equal(root._findOneByClass("ac-btn-deny").disabled, true);

  resolveFetch(fakeOk());
  await new Promise((r) => setImmediate(r));
});

// ── Resolution clears the card via store ─────────────────────────

test("UX-2-b: resolveApproval (via store) removes the card from DOM", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));

  assert.ok(root._findOneByClass("ac-card"));
  store.resolveApproval("appr-1");
  assert.equal(root._findOneByClass("ac-card"), null);
  assert.match(root._findOneByClass("ac-count")._textContent, /No pending approvals/);
});

// ── Lifecycle ─────────────────────────────────────────────────────

test("UX-2-b: destroy() unsubscribes + clears the DOM", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = approvalCard.create({ root, store, doc: makeStubDoc() });
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  assert.ok(root._findOneByClass("ac-card"));

  handle.destroy();

  assert.equal(root.children.length, 0,
    "destroy() should empty the panel root");

  // After destroy, store updates do not re-render.
  store.upsertApproval(makeRequest({ approvalId: "appr-2" }));
  assert.equal(root.children.length, 0,
    "subsequent store updates should not affect a destroyed panel");
});
