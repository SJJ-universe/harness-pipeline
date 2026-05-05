// Slice S3-d (Phase 2 / SMART-3, 2026-05-04) — dual-agent-console
// preset dropdown UI tests.
//
// Uses the same DOM-stub pattern as monitor.dual-agent-console.test.js
// to stay consistent + avoid pulling in jsdom (not a project dep).
//
// Covers:
//   - Mount triggers client.listPresets when client supports it
//   - Loading state renders disabled placeholder
//   - Ready state renders 1 (none) + 6 preset options
//   - Soft-fail state renders disabled "(unavailable)" stub
//   - Dropdown change updates selectedPresetId
//   - Send-to-Codex / follow-up / hand-back-claude pass selectedPresetId
//   - selectedPresetId="" reverts to free-form
//   - Client without listPresets hides picker
//   - Test hooks _setPresets / _selectPreset
//   - Tooltip shows description for selected preset
//   - i18n labels override defaultLabel when bound
//   - Action row keeps both buttons + picker (regression check)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const dualConsole = require("../../public/js/monitor/panels/dual-agent-console");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (extended copy of monitor.dual-agent-console.test.js) ──

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
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
    // For <select>: 'options' is a children filter on <option> tags.
    get options() { return this.children.filter((c) => c.tagName === "OPTION"); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    // S3-d: trigger registered "change" listeners with a synthetic event
    // so we can drive the dropdown selection without jsdom.
    _change(value) {
      this.value = value;
      const ev = { target: { value: this.value } };
      for (const fn of (listeners.change || []).slice()) fn(ev);
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
    _findAllByDataAttr(attr, val) {
      const out = [];
      for (const c of this.children) {
        if (c.attributes && (val === undefined ? attr in c.attributes : c.attributes[attr] === val)) out.push(c);
        if (typeof c._findAllByDataAttr === "function") {
          out.push(...c._findAllByDataAttr(attr, val));
        }
      }
      return out;
    },
    _findOneByDataAttr(attr, val) {
      const arr = this._findAllByDataAttr(attr, val);
      return arr.length > 0 ? arr[0] : null;
    },
  };
  el.disabled = false;
  return el;
}

function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

// ── Test helpers ────────────────────────────────────────────────────

function fakeClient({
  listPresetsImpl = null,
  sendToCodexImpl = null,
  followUpImpl = null,
  handBackToClaudeImpl = null,
  hasListPresets = true,
} = {}) {
  const calls = {
    listPresets: [],
    sendToCodex: [],
    followUp: [],
    handBackToClaude: [],
  };
  const c = {
    calls,
    async createSession() { return { ok: true, session: {} }; },
    async sendToCodex(id, opts) {
      calls.sendToCodex.push({ id, opts });
      if (typeof sendToCodexImpl === "function") return sendToCodexImpl(id, opts);
      return { ok: true };
    },
    async followUp(id, opts) {
      calls.followUp.push({ id, opts });
      if (typeof followUpImpl === "function") return followUpImpl(id, opts);
      return { ok: true };
    },
    async handBackToClaude(id, opts) {
      calls.handBackToClaude.push({ id, opts });
      if (typeof handBackToClaudeImpl === "function") return handBackToClaudeImpl(id, opts);
      return { ok: true };
    },
    async archiveSession() { return { ok: true }; },
  };
  if (hasListPresets) {
    c.listPresets = async function(opts) {
      calls.listPresets.push(opts || {});
      if (typeof listPresetsImpl === "function") return listPresetsImpl(opts);
      return null;
    };
  }
  return c;
}

function fakeI18n(map = {}) {
  return {
    t(key, params) {
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        const v = map[key];
        if (!params) return v;
        return String(v).replace(/\{(\w+)\}/g, (_m, k) =>
          (k in params ? String(params[k]) : `{${k}}`));
      }
      return key;
    },
  };
}

const SAMPLE_PRESETS = [
  { presetId: "accuracy", defaultLabel: "Accuracy", defaultDescription: "Logic / edge cases." },
  { presetId: "security", defaultLabel: "Security", defaultDescription: "Auth / injection." },
  { presetId: "privacy", defaultLabel: "Privacy", defaultDescription: "PII / retention." },
  { presetId: "performance", defaultLabel: "Performance", defaultDescription: "N+1 / leaks." },
  { presetId: "release", defaultLabel: "Release Readiness", defaultDescription: "Rollout / signing." },
  { presetId: "public-sector-audit", defaultLabel: "Public-Sector Audit", defaultDescription: "Fail-closed audit." },
];

async function flushPromises() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function findActionButton(root, actionId) {
  return root._findOneByDataAttr("data-action-id", actionId);
}

function findPicker(root) {
  return root._findOneByClass("dac-preset-picker");
}

function findSelect(root) {
  const picker = findPicker(root);
  return picker ? picker._findOneByClass("dac-preset-select") : null;
}

// ── Tests ───────────────────────────────────────────────────────────

test("S3-d UI: mount triggers client.listPresets when supported", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({
      schema: "harness-review-preset/v1",
      presets: SAMPLE_PRESETS,
    }),
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  // _fetchPresetsOnce uses Promise.resolve().then(...) so the call
  // arrives on the next microtask rather than during create().
  await flushPromises();
  assert.equal(client.calls.listPresets.length, 1, "listPresets called once after mount microtask");
  const state = panel._state();
  assert.deepEqual(state.availablePresets, SAMPLE_PRESETS);
  panel.destroy();
});

test("S3-d UI: loading state shows disabled placeholder dropdown", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => new Promise(() => {}),  // never resolves
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  const picker = findPicker(root);
  assert.ok(picker);
  assert.equal(picker.attributes["data-state"], "loading");
  const select = findSelect(root);
  assert.ok(select.disabled);
  assert.equal(select.options.length, 1);
  panel.destroy();
});

test("S3-d UI: ready state renders 1+6 options with default-label fallback", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  panel._setPresets(SAMPLE_PRESETS);
  const picker = findPicker(root);
  assert.equal(picker.attributes["data-state"], "ready");
  const select = findSelect(root);
  assert.equal(select.options.length, 7, "1 (none) + 6 presets");
  // value is set as a JS property in the implementation (matches
  // <option value=""> property contract); stub does not mirror it
  // to attributes, so test against the property.
  assert.equal(select.options[0].value, "");
  const presetValues = select.options.slice(1).map((o) => o.value);
  assert.deepEqual(presetValues, [
    "accuracy", "security", "privacy",
    "performance", "release", "public-sector-audit",
  ]);
  // Labels fall back to defaultLabel when no i18n bound.
  assert.equal(select.options[1].textContent, "Accuracy");
  assert.equal(select.options[6].textContent, "Public-Sector Audit");
  panel.destroy();
});

test("S3-d UI: soft-fail state renders disabled '(unavailable)' stub", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const errors = [];
  const client = fakeClient({
    listPresetsImpl: () => Promise.reject(new Error("network down")),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    onError: (e) => errors.push(e),
  });
  await flushPromises();
  const picker = findPicker(root);
  assert.equal(picker.attributes["data-state"], "missing");
  const select = findSelect(root);
  assert.ok(select.disabled, "select must be disabled in soft-fail state");
  assert.equal(select.options.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /network down/);
  panel.destroy();
});

test("S3-d UI: changing dropdown updates selectedPresetId state", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  panel._setPresets(SAMPLE_PRESETS);

  const select = findSelect(root);
  select._change("security");
  assert.equal(panel._state().selectedPresetId, "security");

  // After change, render() rebuilt root.children — re-query.
  const select2 = findSelect(root);
  select2._change("");
  assert.equal(panel._state().selectedPresetId, null);

  panel.destroy();
});

test("S3-d UI: tooltip shows description for selected preset", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  panel._setPresets(SAMPLE_PRESETS);

  // Initially no preset → no tooltip
  assert.equal(root._findOneByClass("dac-preset-tooltip"), null);

  panel._selectPreset("security");
  const tip = root._findOneByClass("dac-preset-tooltip");
  assert.ok(tip);
  assert.match(tip._textContent, /Auth.*injection/i);

  panel._selectPreset(null);
  assert.equal(root._findOneByClass("dac-preset-tooltip"), null);

  panel.destroy();
});

test("S3-d UI: client without listPresets hides picker entirely", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({ hasListPresets: false });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  const picker = findPicker(root);
  assert.ok(picker, "picker element exists but is hidden");
  assert.equal(picker.attributes["data-state"], "no-client");
  // Standard HTML `hidden` attribute (display:none equivalent + a11y-aware)
  assert.ok(picker.hasAttribute("hidden"));
  panel.destroy();
});

test("S3-d UI: action row not present when client is null (legacy mode)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // No client at all → action row hides; legacy footer is shown
  const panel = dualConsole.create({ root, store, doc: makeStubDoc() });
  assert.equal(root._findOneByClass("dac-action-row"), null);
  assert.equal(root._findOneByClass("dac-preset-picker"), null);
  assert.ok(root._findOneByClass("dac-footer"));
  panel.destroy();
});

test("S3-d UI: sendToCodex receives selectedPresetId in opts", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "review the security",
  });
  store.upsertReviewSession("s1", { sessionId: "s1", state: "created", label: "T" });
  store.selectReviewSession("s1");
  panel._setPresets(SAMPLE_PRESETS);
  panel._selectPreset("security");

  const btn = findActionButton(root, "send-codex");
  assert.ok(btn);
  assert.equal(btn.disabled, false);
  btn._click();
  await flushPromises();

  assert.equal(client.calls.sendToCodex.length, 1);
  const call = client.calls.sendToCodex[0];
  assert.equal(call.id, "s1");
  assert.equal(call.opts.preset, "security");
  assert.equal(call.opts.instruction, "review the security");

  panel.destroy();
});

test("S3-d UI: sendToCodex with selectedPresetId=null omits preset", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "free-form",
  });
  store.upsertReviewSession("s2", { sessionId: "s2", state: "created", label: "T" });
  store.selectReviewSession("s2");
  panel._setPresets(SAMPLE_PRESETS);
  // Don't select — leave default null.

  findActionButton(root, "send-codex")._click();
  await flushPromises();

  assert.equal(client.calls.sendToCodex.length, 1);
  assert.equal(client.calls.sendToCodex[0].opts.preset, undefined,
    "preset omitted when none selected");

  panel.destroy();
});

test("S3-d UI: handBackToClaude receives selectedPresetId in opts", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "fix the SQL injection",
  });
  store.upsertReviewSession("s3", {
    sessionId: "s3", state: "critique_received", label: "T",
  });
  store.selectReviewSession("s3");
  panel._setPresets(SAMPLE_PRESETS);
  panel._selectPreset("security");

  const btn = findActionButton(root, "hand-back");
  assert.ok(btn);
  assert.equal(btn.disabled, false);
  btn._click();
  await flushPromises();

  assert.equal(client.calls.handBackToClaude.length, 1);
  assert.equal(client.calls.handBackToClaude[0].opts.preset, "security");

  panel.destroy();
});

test("S3-d UI: followUp receives selectedPresetId in opts", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "any data races?",
  });
  store.upsertReviewSession("s4", {
    sessionId: "s4", state: "critique_received", label: "T",
  });
  store.selectReviewSession("s4");
  panel._setPresets(SAMPLE_PRESETS);
  panel._selectPreset("performance");

  const btn = findActionButton(root, "followup-codex");
  assert.ok(btn);
  btn._click();
  await flushPromises();

  assert.equal(client.calls.followUp.length, 1);
  assert.equal(client.calls.followUp[0].opts.preset, "performance");

  panel.destroy();
});

test("S3-d UI: i18n labels override defaultLabel when bound", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const i18n = fakeI18n({
    "smart.preset.label": "검토 관점",
    "smart.preset.none": "자유 입력",
    "smart.preset.security.label": "보안",
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client, i18n });
  panel._setPresets(SAMPLE_PRESETS);

  const label = root._findOneByClass("dac-preset-label");
  assert.equal(label._textContent, "검토 관점");

  const select = findSelect(root);
  assert.equal(select.options[0]._textContent, "자유 입력");
  // security option uses i18n label (.value is a JS property in stub)
  const security = select.options.find((o) => o.value === "security");
  assert.equal(security._textContent, "보안");
  // accuracy still falls back to defaultLabel since no i18n key
  const accuracy = select.options.find((o) => o.value === "accuracy");
  assert.equal(accuracy._textContent, "Accuracy");

  panel.destroy();
});

test("S3-d UI: action row contains BOTH buttons AND preset picker (no regression)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({ root, store, doc: makeStubDoc(), client });
  panel._setPresets(SAMPLE_PRESETS);

  const row = root._findOneByClass("dac-action-row");
  assert.ok(row);
  assert.ok(row._findOneByClass("dac-action-buttons"));
  assert.ok(row._findOneByClass("dac-preset-picker"));
  assert.ok(row._findOneByClass("dac-session-indicator"));
  panel.destroy();
});

test("S3-d UI: dropdown in soft-fail state still allows action buttons (free-form fallback)", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.reject(new Error("net err")),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "free-form review",
    onError: () => {},
  });
  store.upsertReviewSession("s5", { sessionId: "s5", state: "created", label: "T" });
  store.selectReviewSession("s5");
  await flushPromises();
  const btn = findActionButton(root, "send-codex");
  assert.equal(btn.disabled, false);
  btn._click();
  await flushPromises();
  assert.equal(client.calls.sendToCodex.length, 1);
  assert.equal(client.calls.sendToCodex[0].opts.preset, undefined);
  panel.destroy();
});

test("S3-d UI: presetId reaches all 3 dispatch paths regardless of order", async () => {
  // Defense: make sure setting preset before AND after a session
  // selection both work (the dropdown change re-renders the button).
  const root = makeRoot();
  const store = createMonitorStore();
  const client = fakeClient({
    listPresetsImpl: () => Promise.resolve({ presets: SAMPLE_PRESETS }),
  });
  const panel = dualConsole.create({
    root, store, doc: makeStubDoc(), client,
    promptFn: () => "x",
  });
  panel._setPresets(SAMPLE_PRESETS);
  panel._selectPreset("privacy");
  // Now seed a session in critique_received state so all 3 buttons enable.
  store.upsertReviewSession("s6", {
    sessionId: "s6", state: "critique_received", label: "T",
  });
  store.selectReviewSession("s6");

  // 1. send-codex
  findActionButton(root, "send-codex")._click();
  await flushPromises();
  assert.equal(client.calls.sendToCodex[0].opts.preset, "privacy");

  // 2. hand-back-claude (button reappears after re-render)
  findActionButton(root, "hand-back")._click();
  await flushPromises();
  assert.equal(client.calls.handBackToClaude[0].opts.preset, "privacy");

  // 3. follow-up codex
  findActionButton(root, "followup-codex")._click();
  await flushPromises();
  assert.equal(client.calls.followUp[0].opts.preset, "privacy");

  panel.destroy();
});
