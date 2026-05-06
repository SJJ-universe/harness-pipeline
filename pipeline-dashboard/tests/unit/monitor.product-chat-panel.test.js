// Slice AGENT-DESKTOP-0-d (2026-05-06) — product-chat-panel unit tests.
//
// Drives the panel via injected stubs (fetch, doc, onActionClick,
// toastFn). Asserts the contract shipped in -0-b/c:
//   - composer + history + recommended chips render
//   - submit POSTs to intentUrl + appends user bubble + renders proposal
//   - Approve fires onActionClick with the right id + parameters
//   - Cancel disables buttons + appends [system] bubble
//   - blocked_pii proposal hides Approve, shows blocked-note
//   - PII warn surfaces when piiContext.hasPii
//   - Edit (general_task only) opens inline editor
//   - Recommended chip click pre-fills + submits

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productChatPanel = require("../../public/js/monitor/panels/product-chat-panel");

// ── DOM stub ─────────────────────────────────────────────────────────
//
// Mirrors the stub used in monitor.product-slot-contract.test.js, with
// addEventListener capture so synthetic clicks/keydowns drive handlers.

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    style: {},
    classList: {
      _classes: new Set(),
      add(...a) { for (const c of a) this._classes.add(c); return this; },
      remove(...a) { for (const c of a) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _value: "",
    get value() { return this._value; },
    set value(v) { this._value = String(v == null ? "" : v); },
    disabled: false,
    type: "",
    id: "",
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) { this.children.splice(idx, 1); c.parentNode = null; }
      return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || [])) fn({ type: "click", target: el }); },
    _keydown(key, opts) {
      const event = Object.assign({ type: "keydown", key: key, preventDefault() {} },
        opts || {});
      for (const fn of (listeners.keydown || [])) fn(event);
    },
    focus() { this._focused = true; },
    _findOneByAttr(k, v) {
      if (this.attributes && this.attributes[k] === v) return this;
      for (const c of this.children) {
        if (typeof c._findOneByAttr === "function") {
          const f = c._findOneByAttr(k, v);
          if (f) return f;
        }
      }
      return null;
    },
    _findAllByAttr(k, v) {
      const out = [];
      if (this.attributes && this.attributes[k] === v) out.push(this);
      for (const c of this.children) {
        if (typeof c._findAllByAttr === "function") out.push(...c._findAllByAttr(k, v));
      }
      return out;
    },
  };
  return el;
}
const makeStubDoc = () => ({ createElement: makeStubElement });
const makeRoot = () => makeStubElement("div");

function makeFakeFetch(responses /* response or array */) {
  const calls = [];
  const queue = Array.isArray(responses) ? responses.slice() : [responses];
  return {
    calls,
    fetchImpl(url, init) {
      calls.push({ url, init });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
}

function makeFakeResponse({ ok = true, status = 200, body = null } = {}) {
  return {
    ok,
    status,
    json() { return Promise.resolve(body); },
  };
}

// ── Construction ───────────────────────────────────────────────────

test("create throws without root", () => {
  assert.throws(() => productChatPanel.create({ doc: makeStubDoc() }),
    /root must be an element/);
});

test("create throws without document", () => {
  // node:test runs without globalThis.document, so omitting opts.doc
  // also omits the fallback. Simulate by wiping window.document.
  const origDoc = globalThis.document;
  delete globalThis.document;
  try {
    assert.throws(
      () => productChatPanel.create({ root: makeRoot() }),
      /no document available/,
    );
  } finally {
    if (origDoc !== undefined) globalThis.document = origDoc;
  }
});

// ── DOM contract ───────────────────────────────────────────────────

test("create renders chat region with history + recommended + composer slots", () => {
  const root = makeRoot();
  productChatPanel.create({ root, doc: makeStubDoc() });
  assert.ok(root._findOneByAttr("data-region", "chat"), "chat region must exist");
  assert.ok(root._findOneByAttr("data-chat-slot", "history"), "history slot must exist");
  assert.ok(root._findOneByAttr("data-chat-slot", "recommended"), "recommended slot must exist");
  assert.ok(root._findOneByAttr("data-chat-slot", "composer"), "composer slot must exist");
});

test("recommended chips render exactly one button per RECOMMENDED_CHIPS entry", () => {
  const root = makeRoot();
  productChatPanel.create({ root, doc: makeStubDoc() });
  const chips = root._findAllByAttr("data-chat-action", "recommended");
  assert.equal(chips.length, productChatPanel.RECOMMENDED_CHIPS.length);
});

// ── Submit flow ────────────────────────────────────────────────────

test("submit POSTs to /api/chat/intent with the textarea value", async () => {
  const root = makeRoot();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse({
    ok: true,
    body: {
      ok: true,
      proposal: {
        intent: "codex_verify",
        summary: "Codex 검증",
        riskLevel: "low",
        requiresApproval: true,
        parameters: {},
        classifierTrace: "matched:codex_verify",
        piiContext: null,
      },
      audit: { entryId: "evt-1" },
    },
  }));
  const handle = productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  // Set textarea value directly via the handle's exposed _appendMessage doesn't help —
  // fetch the textarea by id from the root tree:
  const textarea = root._findOneByAttr("data-chat-slot", "composer").children[0];
  textarea.value = "코덱스 검증해줘";
  handle._submit();
  // Wait for the promise chain to flush.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/chat/intent");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, "코덱스 검증해줘");
});

test("submit appends user bubble immediately + clears textarea", async () => {
  const root = makeRoot();
  const { fetchImpl } = makeFakeFetch(makeFakeResponse({
    ok: true,
    body: { ok: true, proposal: { intent: "codex_verify", summary: "x",
      riskLevel: "low", requiresApproval: true, parameters: {}, classifierTrace: "x" },
      audit: {} },
  }));
  const handle = productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  const textarea = root._findOneByAttr("data-chat-slot", "composer").children[0];
  textarea.value = "test input";
  handle._submit();
  // user bubble appears synchronously
  const userBubbles = root._findAllByAttr("data-role", "user");
  assert.equal(userBubbles.length, 1);
  assert.equal(userBubbles[0].textContent, "test input");
  assert.equal(textarea.value, "", "textarea must clear after submit");
});

test("submit on empty textarea is a silent no-op (no fetch, no bubble)", () => {
  const root = makeRoot();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse());
  const handle = productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  handle._submit();
  assert.equal(calls.length, 0, "fetch must not fire on empty input");
  const bubbles = root._findAllByAttr("data-role", "user");
  assert.equal(bubbles.length, 0);
});

// ── Proposal card rendering ────────────────────────────────────────

test("proposal card carries data-intent + data-risk attributes", async () => {
  const root = makeRoot();
  const handle = productChatPanel.create({ root, doc: makeStubDoc() });
  handle._renderProposalCard({
    intent: "general_task",
    summary: "테스트 작업",
    riskLevel: "medium",
    requiresApproval: true,
    parameters: { task: "x", maxIterations: 3 },
    classifierTrace: "fallback:general_task",
    piiContext: null,
  }, "evt-7");
  const proposalBubble = root._findOneByAttr("data-role", "proposal");
  assert.ok(proposalBubble);
  const card = proposalBubble.children[0];
  assert.equal(card.getAttribute("data-intent"), "general_task");
  assert.equal(card.getAttribute("data-risk"), "medium");
});

test("proposal card with PII renders warn block", () => {
  const root = makeRoot();
  const handle = productChatPanel.create({ root, doc: makeStubDoc() });
  handle._renderProposalCard({
    intent: "general_task",
    summary: "test",
    riskLevel: "high",
    requiresApproval: true,
    parameters: { task: "x" },
    classifierTrace: "fallback",
    piiContext: { hasPii: true, findings: [{ type: "krn" }] },
  }, "evt-1");
  assert.ok(root._findOneByAttr("data-chat-slot", "pii-warn"),
    "PII warn block must render when proposal carries pii hits");
});

test("blocked_pii proposal omits Approve button + shows blocked-note", () => {
  const root = makeRoot();
  const handle = productChatPanel.create({ root, doc: makeStubDoc() });
  handle._renderProposalCard({
    intent: "blocked_pii",
    summary: "공공기관 모드: 차단됨",
    riskLevel: "high",
    requiresApproval: false,
    parameters: {},
    classifierTrace: "blocked",
    piiContext: { hasPii: true, findings: [{ type: "krn" }] },
  }, "evt-1");
  const approveBtn = root._findOneByAttr("data-chat-action", "approve");
  assert.equal(approveBtn, null, "Approve button must NOT render for blocked_pii");
  // The blocked-note appears in a span — find it via class instead
  const proposal = root._findOneByAttr("data-role", "proposal");
  let foundNote = false;
  function walk(el) {
    if (!el) return;
    if (el.classList && el.classList.contains("prod-chat-proposal-blocked-note")) {
      foundNote = true;
    }
    for (const c of (el.children || [])) walk(c);
  }
  walk(proposal);
  assert.ok(foundNote, "blocked-note span must render");
});

test("general_task proposal renders Edit button (other intents do NOT)", () => {
  const root = makeRoot();
  const handle = productChatPanel.create({ root, doc: makeStubDoc() });
  // codex_verify: no Edit
  handle._renderProposalCard({
    intent: "codex_verify",
    summary: "x",
    riskLevel: "low",
    requiresApproval: true,
    parameters: {},
    classifierTrace: "x",
  }, null);
  let edits = root._findAllByAttr("data-chat-action", "edit");
  assert.equal(edits.length, 0, "codex_verify must not have an Edit button");

  // general_task: has Edit
  handle._renderProposalCard({
    intent: "general_task",
    summary: "y",
    riskLevel: "medium",
    requiresApproval: true,
    parameters: { task: "y", maxIterations: 3 },
    classifierTrace: "y",
  }, null);
  edits = root._findAllByAttr("data-chat-action", "edit");
  assert.equal(edits.length, 1, "general_task must surface an Edit button");
});

// ── Approve / Cancel wiring ────────────────────────────────────────

test("Approve fires onActionClick with the dispatch id mapped from the intent", () => {
  const root = makeRoot();
  const seen = [];
  const handle = productChatPanel.create({
    root, doc: makeStubDoc(),
    onActionClick: (id, payload) => seen.push({ id, payload }),
  });
  handle._renderProposalCard({
    intent: "codex_verify",
    summary: "Codex 검증",
    riskLevel: "low",
    requiresApproval: true,
    parameters: {},
    classifierTrace: "matched",
  }, "evt-1");
  const approveBtn = root._findOneByAttr("data-chat-action", "approve");
  approveBtn._click();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, "codex-verify");
});

test("Approve on general_task forwards parameters as the payload", () => {
  const root = makeRoot();
  const seen = [];
  const handle = productChatPanel.create({
    root, doc: makeStubDoc(),
    onActionClick: (id, payload) => seen.push({ id, payload }),
  });
  handle._renderProposalCard({
    intent: "general_task",
    summary: "task",
    riskLevel: "medium",
    requiresApproval: true,
    parameters: { task: "예쁜 페이지", maxIterations: 5 },
    classifierTrace: "fallback",
  }, "evt-1");
  const approveBtn = root._findOneByAttr("data-chat-action", "approve");
  approveBtn._click();
  assert.equal(seen[0].id, "general-task");
  assert.deepEqual(seen[0].payload, { task: "예쁜 페이지", maxIterations: 5 });
});

test("Cancel disables card buttons + appends [system] bubble", () => {
  const root = makeRoot();
  const handle = productChatPanel.create({ root, doc: makeStubDoc() });
  handle._renderProposalCard({
    intent: "codex_verify",
    summary: "x",
    riskLevel: "low",
    requiresApproval: true,
    parameters: {},
    classifierTrace: "x",
  }, null);
  const cancelBtn = root._findOneByAttr("data-chat-action", "cancel");
  const approveBtn = root._findOneByAttr("data-chat-action", "approve");
  cancelBtn._click();
  assert.equal(approveBtn.disabled, true, "Approve must disable after Cancel");
  const sysBubbles = root._findAllByAttr("data-role", "system");
  assert.equal(sysBubbles.length, 1);
  assert.match(sysBubbles[0].textContent, /취소/);
});

// ── Recommended chip click → pre-fill + submit ─────────────────────

test("recommended chip click pre-fills composer + auto-submits", async () => {
  const root = makeRoot();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse({
    ok: true,
    body: { ok: true, proposal: { intent: "codex_verify", summary: "x",
      riskLevel: "low", requiresApproval: true, parameters: {}, classifierTrace: "x" },
      audit: {} },
  }));
  productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  const chip = root._findAllByAttr("data-chat-action", "recommended")[0];
  chip._click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, productChatPanel.RECOMMENDED_CHIPS[0]);
});

// ── Enter key submits ──────────────────────────────────────────────

test("Enter (without Shift) on textarea triggers submit", async () => {
  const root = makeRoot();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse({
    ok: true,
    body: { ok: true, proposal: { intent: "general_task", summary: "x",
      riskLevel: "medium", requiresApproval: true,
      parameters: { task: "x", maxIterations: 3 }, classifierTrace: "x" },
      audit: {} },
  }));
  productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  const composer = root._findOneByAttr("data-chat-slot", "composer");
  const textarea = composer.children[0];
  textarea.value = "hello";
  textarea._keydown("Enter", { shiftKey: false });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
});

test("Shift+Enter on textarea does NOT submit (allows newline)", () => {
  const root = makeRoot();
  const { fetchImpl, calls } = makeFakeFetch(makeFakeResponse());
  productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  const composer = root._findOneByAttr("data-chat-slot", "composer");
  const textarea = composer.children[0];
  textarea.value = "hello";
  textarea._keydown("Enter", { shiftKey: true });
  assert.equal(calls.length, 0, "Shift+Enter must not submit");
});

// ── Defensive ──────────────────────────────────────────────────────

test("unknown intent in proposal disables Approve dispatch (safety)", () => {
  const root = makeRoot();
  const seen = [];
  const handle = productChatPanel.create({
    root, doc: makeStubDoc(),
    onActionClick: (id) => seen.push(id),
  });
  handle._renderProposalCard({
    intent: "future_intent_we_dont_know",
    summary: "x",
    riskLevel: "low",
    requiresApproval: true,
    parameters: {},
    classifierTrace: "x",
  }, null);
  const approveBtn = root._findOneByAttr("data-chat-action", "approve");
  approveBtn._click();
  // Approve fired but no onActionClick because intent is not in INTENT_TO_DISPATCH.
  assert.equal(seen.length, 0);
  // System bubble should explain.
  const sysBubbles = root._findAllByAttr("data-role", "system");
  assert.equal(sysBubbles.length, 1);
  assert.match(sysBubbles[0].textContent, /알 수 없는 intent/);
});

test("fetch rejection surfaces as [system] bubble (no crash)", async () => {
  const root = makeRoot();
  const { fetchImpl } = makeFakeFetch(new Error("network down"));
  const handle = productChatPanel.create({ root, doc: makeStubDoc(), fetchImpl });
  const composer = root._findOneByAttr("data-chat-slot", "composer");
  composer.children[0].value = "test";
  handle._submit();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const sysBubbles = root._findAllByAttr("data-role", "system");
  assert.equal(sysBubbles.length, 1);
  assert.match(sysBubbles[0].textContent, /네트워크|요청 실패|network/);
});
