// Slice UI-H9-b/c (Phase D / Phase E1.5, 2026-04-30) — run-viewer
// drill-down panel tests. Pins: open/close lifecycle, four data
// planes (run / audit / review / approvals), audit fetch error
// branches, recent-results-card → run-viewer wiring.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runViewer = require("../../public/js/monitor/panels/run-viewer");
const recentResults = require("../../public/js/monitor/panels/recent-results-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub ──────────────────────────────────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      _classes: new Set(),
      add(...args) { for (const c of args) this._classes.add(c); return this; },
      remove(...args) { for (const c of args) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === true) { this._classes.add(c); return true; }
        if (force === false) { this._classes.delete(c); return false; }
        if (this._classes.has(c)) { this._classes.delete(c); return false; }
        this._classes.add(c); return true;
      },
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
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) { this.children.splice(idx, 1); c.parentNode = null; }
      return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click(target) { for (const fn of (listeners.click || []).slice()) fn({ target: target || el, preventDefault() {} }); },
    _keydown(key) { for (const fn of (listeners.keydown || []).slice()) fn({ key, preventDefault() {} }); },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
    _findOneByClass(cls) {
      const arr = this._findAllByClass(cls);
      return arr.length > 0 ? arr[0] : null;
    },
    _allText() {
      let out = this._textContent || "";
      for (const c of this.children) {
        if (typeof c._allText === "function") out += c._allText();
      }
      return out;
    },
  };
  return el;
}

function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

// Synchronous fetch stub for unit tests. Yields the same response
// to every call.
function makeFetch(response) {
  return async (_url, _opts) => response;
}

// ── _formatTime + _truncate ──────────────────────────────────────

test("UI-H9-b: _formatTime returns '' for null / NaN / unknown shapes", () => {
  assert.equal(runViewer._formatTime(null), "");
  assert.equal(runViewer._formatTime(undefined), "");
  assert.equal(runViewer._formatTime("not-a-date"), "");
  assert.equal(runViewer._formatTime({}), "");
});

test("UI-H9-b: _formatTime renders YYYY-MM-DD HH:mm:ss for numeric ts", () => {
  // 2026-04-30 12:34:56 UTC — local TZ may shift; we test the shape only.
  const out = runViewer._formatTime(new Date(2026, 3, 30, 12, 34, 56).getTime());
  assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("UI-H9-b: _truncate adds ellipsis past max", () => {
  assert.equal(runViewer._truncate("hello", 10), "hello");
  assert.equal(runViewer._truncate("hello world!", 8), "hello w…");
  assert.equal(runViewer._truncate(null, 5), "");
});

// ── open / close lifecycle ────────────────────────────────────────

test("UI-H9-b: starts closed (no DOM until open)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  runViewer.create({ root, store, doc: makeStubDoc(), fetchImpl: makeFetch({ ok: false }) });
  // overlay is created lazily — root has no children before open
  assert.equal(root.children.length, 0);
});

test("UI-H9-b: open() with empty / non-string runId is ignored", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return {}; } }),
  });
  handle.open(null);
  handle.open("");
  handle.open({});
  assert.equal(root.children.length, 0);
});

test("UI-H9-b: open(runId) creates overlay + visible body", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { label: "First", status: "completed", phase: "done" });
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; } }),
  });
  handle.open("r1");
  assert.equal(root.children.length, 1);
  const overlay = root.children[0];
  assert.ok(!overlay.classList.contains("rv-hidden"));
  // Run section renders the runId
  const allText = root._allText();
  assert.match(allText, /r1/);
  assert.match(allText, /First/);
});

test("UI-H9-b: close() hides overlay + clears state", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { label: "L" });
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(handle._state().openRunId, "r1");
  handle.close();
  assert.equal(handle._state().openRunId, null);
  const overlay = root.children[0];
  assert.ok(overlay.classList.contains("rv-hidden"));
});

test("UI-H9-b: clicking the close button fires onClose + hides", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let closed = 0;
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
    onClose: () => { closed += 1; },
  });
  handle.open("r1");
  const closeBtn = root._findOneByClass("rv-close");
  closeBtn._click();
  assert.equal(closed, 1);
  const overlay = root.children[0];
  assert.ok(overlay.classList.contains("rv-hidden"));
});

test("UI-H9-b: backdrop click closes (target === overlay)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
  });
  handle.open("r1");
  const overlay = root.children[0];
  overlay._click(overlay); // target === overlay ⇒ close
  assert.ok(overlay.classList.contains("rv-hidden"));
});

// ── data planes ──────────────────────────────────────────────────

test("UI-H9-b: renders 'no info' empty state when run + detail both missing", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: false, status: 404 }),
  });
  handle.open("ghost");
  const empty = root._findAllByClass("rv-empty");
  // run section + review + approvals all show empty (3) — audit
  // fetch hasn't resolved yet
  assert.ok(empty.length >= 3);
});

test("UI-H9-b: review-session section filters by runId", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { label: "L" });
  store.upsertReviewSession("s1", { runId: "r1", label: "Session A", state: "created" });
  store.upsertReviewSession("s2", { runId: "other", label: "Session B", state: "archived" });
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
  });
  handle.open("r1");
  const reviewSection = root._findAllByClass("rv-section-review")[0];
  const reviewText = reviewSection._allText();
  assert.match(reviewText, /Session A/);
  assert.equal(reviewText.includes("Session B"), false);
});

test("UI-H9-b: approvals section filters by runId", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  store.upsertApproval({ approvalId: "a1", tool: "Bash", argsSummary: "rm -rf /tmp", runId: "r1", requestedAt: 1 });
  store.upsertApproval({ approvalId: "a2", tool: "Edit", argsSummary: "/etc/hosts", runId: "other", requestedAt: 2 });
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
  });
  handle.open("r1");
  const apprSec = root._findAllByClass("rv-section-approvals")[0];
  const apprText = apprSec._allText();
  assert.match(apprText, /Bash/);
  assert.equal(apprText.includes("Edit"), false);
});

// ── audit fetch branches ─────────────────────────────────────────

test("UI-H9-b: audit fetch resolves → renders chain badge + entries", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const fetchResp = {
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        entries: [
          { eventId: "e1", type: "review_session_created", at: "2026-04-30T00:00:00Z" },
          { eventId: "e2", type: "review_session_archived", at: "2026-04-30T00:00:01Z" },
        ],
        total: 2, returned: 2, truncated: false,
        chain: { valid: true, entries: 2 },
      };
    },
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch(fetchResp),
  });
  handle.open("r1");
  // Wait one microtask so the async fetch resolves + _render fires.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const badge = root._findOneByClass("rv-chain-ok");
  assert.ok(badge, "expected ok chain badge after successful fetch");
  const auditList = root._findOneByClass("rv-audit-list");
  assert.ok(auditList);
  // Two audit rows
  assert.equal(auditList.children.length, 2);
});

test("UI-H9-b: audit fetch 404 → empty state + no error chip", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: false, status: 404 }),
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // 404 maps to empty entries — chain still ok (valid=true)
  assert.ok(root._findOneByClass("rv-chain-ok"));
  // No error widget
  assert.equal(root._findOneByClass("rv-error"), null);
});

test("UI-H9-b: audit fetch HTTP 500 → renders rv-error", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: false, status: 500 }),
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const err = root._findOneByClass("rv-error");
  assert.ok(err);
  assert.match(err._textContent, /http_500/);
});

test("UI-H9-b: audit fetch network error → renders rv-error", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: async () => { throw new Error("offline"); },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const err = root._findOneByClass("rv-error");
  assert.ok(err);
  assert.match(err._textContent, /offline/);
});

// ── recent-results-card → onSelectRun wiring ─────────────────────

test("UI-H9-c: recent-results row click fires onSelectRun(runId)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { status: "completed", completedAt: 1, label: "RR" });
  let selected = null;
  recentResults.create({
    root, store, doc: makeStubDoc(),
    onSelectRun: (id) => { selected = id; },
  });
  const row = root._findOneByClass("rrc-row");
  assert.ok(row);
  assert.ok(row.classList.contains("rrc-row-clickable"));
  row._click();
  assert.equal(selected, "r1");
});

test("UI-H9-c: recent-results row Enter key fires onSelectRun", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { status: "completed", completedAt: 1 });
  let selected = null;
  recentResults.create({
    root, store, doc: makeStubDoc(),
    onSelectRun: (id) => { selected = id; },
  });
  const row = root._findOneByClass("rrc-row");
  row._keydown("Enter");
  assert.equal(selected, "r1");
});

test("UI-H9-c: recent-results row WITHOUT onSelectRun is not clickable", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", { status: "completed", completedAt: 1 });
  recentResults.create({ root, store, doc: makeStubDoc() });
  const row = root._findOneByClass("rrc-row");
  assert.ok(!row.classList.contains("rrc-row-clickable"));
  // No role/tabindex when not interactive
  assert.equal(row.attributes.role, undefined);
});

// ── destroy ──────────────────────────────────────────────────────

test("UI-H9-b: destroy removes overlay from root + subsequent open is no-op", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({ ok: true, status: 200, async json() { return { entries: [] }; } }),
  });
  handle.open("r1");
  assert.equal(root.children.length, 1);
  handle.destroy();
  assert.equal(root.children.length, 0);
  // After destroy, open is a no-op (no overlay re-attaches).
  handle.open("r2");
  assert.equal(root.children.length, 0);
});

// ── UI-H10: sealed-bundle export ─────────────────────────────────

test("UI-H10: _formatExportError maps server codes to Korean copy", () => {
  // Frozen vocabulary the server emits — mismatched mapping leaves
  // operators staring at raw codes ("not_found" instead of the
  // Korean line). Pin every documented code.
  assert.match(runViewer._formatExportError("not_found"), /감사 봉투가 없습니다/);
  assert.match(runViewer._formatExportError("invalid_run_id"), /잘못된 실행 ID/);
  assert.match(runViewer._formatExportError("bundle_failed"), /감사 봉투 생성/);
  assert.match(runViewer._formatExportError("ledger_unavailable"), /ledger/);
  assert.match(runViewer._formatExportError("network_error"), /네트워크/);
  assert.match(runViewer._formatExportError("download_unavailable"), /브라우저/);
  assert.match(runViewer._formatExportError("empty_response"), /비어/);
  assert.match(runViewer._formatExportError("http_error"), /서버에서/);
  // Unknown code falls through to a generic but Korean line — never
  // a raw English code.
  assert.match(runViewer._formatExportError("totally_made_up"), /감사 봉투/);
});

test("UI-H10: _filenameTimestamp produces YYYYMMDDHHMM (no separators)", () => {
  const ts = runViewer._filenameTimestamp(new Date(2026, 3, 30, 9, 5, 0));
  // YYYYMMDDHHMM = 12 chars, all digits.
  assert.match(ts, /^\d{12}$/);
  // Local-TZ: month is 0-indexed → April = 04. Rest pads.
  assert.equal(ts.slice(4, 6), "04");
  assert.equal(ts.slice(6, 8), "30");
});

test("UI-H10: export button renders inside audit section after fetch resolves", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({
      ok: true, status: 200,
      async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; },
    }),
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  assert.ok(btn, "export button renders after audit fetch resolves");
  // Standard mode label (no public-sector prefix)
  assert.equal(btn.textContent, "감사 봉투 내보내기");
  // Public-sector specific class is NOT applied in standard mode
  assert.equal(btn.classList.contains("rv-export-btn-public-sector"), false);
  // aria-label always set (a11y)
  assert.equal(btn.getAttribute("aria-label"), "감사 봉투 다운로드");
});

test("UI-H10: public-sector posture switches button label + adds bronze class + tooltip", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  store.setAccountStatus({ deployment: { mode: "public-sector", publicSector: true } });
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: makeFetch({
      ok: true, status: 200,
      async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; },
    }),
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  assert.ok(btn);
  assert.match(btn.textContent, /공공기관/);
  assert.ok(btn.classList.contains("rv-export-btn-public-sector"));
  // Offline-verify tooltip is set so the auditor sees "what to run on
  // disk" without leaving the UI.
  assert.match(btn.getAttribute("title") || "", /verify-auditor-bundle/);
  // The hint line under the button advertises the seal.
  const hint = root._findOneByClass("rv-export-hint");
  assert.ok(hint);
  assert.match(hint.textContent, /HMAC/);
});

test("UI-H10: clicking export → calls download impl + records success state", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let downloadCalls = 0;
  let downloadArgs = null;
  let exportSuccessCalls = 0;
  // Two fetch responses: 1) audit fetch (entries empty), 2) export POST.
  // The runViewer fetches audit on open; we intercept and switch the
  // response on the SECOND call.
  let callIdx = 0;
  const fetchStub = async (url) => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; } };
    }
    // Second call must be the export POST.
    assert.match(url, /\/api\/audit\/runs\/r1\/export/);
    return {
      ok: true, status: 200,
      async json() {
        return { ok: true, bundle: { schema: "x", totalEntries: 7, runId: "r1" } };
      },
    };
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    downloadImpl(arg) { downloadCalls += 1; downloadArgs = arg; },
    onExportSuccess() { exportSuccessCalls += 1; },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  btn._click();
  // Export is async; wait for the chain to settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(downloadCalls, 1);
  assert.match(downloadArgs.filename, /^audit-r1-\d{12}\.json$/);
  assert.equal(downloadArgs.bundle.totalEntries, 7);
  assert.equal(exportSuccessCalls, 1);
  // Success banner now visible
  const successLine = root._findOneByClass("rv-export-success");
  assert.ok(successLine);
  assert.match(successLine.textContent, /다운로드됨/);
});

test("UI-H10: server 404 → maps to '감사 봉투가 없습니다' Korean error", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; } };
    }
    return { ok: false, status: 404, async json() { return { ok: false, error: "not_found" }; } };
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    downloadImpl() { /* should NOT be called on error */ throw new Error("download triggered on error"); },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  btn._click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const errLine = root._findOneByClass("rv-export-error");
  assert.ok(errLine);
  assert.match(errLine.textContent, /감사 봉투가 없습니다/);
  // No success banner on failure
  assert.equal(root._findOneByClass("rv-export-success"), null);
});

test("UI-H10: network failure → 'network_error' code surfaces", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [], total: 0, returned: 0, chain: { valid: true } }; } };
    }
    throw new Error("connection refused");
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  btn._click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const errLine = root._findOneByClass("rv-export-error");
  assert.ok(errLine);
  assert.match(errLine.textContent, /네트워크/);
});

test("UI-H10: download_unavailable when window/Blob/URL absent", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [] }; } };
    }
    return { ok: true, status: 200, async json() { return { ok: true, bundle: { totalEntries: 1 } }; } };
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    // Explicitly null windowImpl + no downloadImpl override → triggers
    // the "no Blob / no URL" defensive path.
    windowImpl: null,
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  btn._click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const errLine = root._findOneByClass("rv-export-error");
  assert.ok(errLine);
  assert.match(errLine.textContent, /브라우저/);
});

test("UI-H10: button disabled while export in flight; second click ignored", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let downloadCalls = 0;
  // Fetch resolves on next microtask — gives us a window to assert
  // the button is disabled mid-flight.
  let resolveExport;
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [] }; } };
    }
    return new Promise((resolve) => {
      resolveExport = () => resolve({
        ok: true, status: 200,
        async json() { return { ok: true, bundle: { totalEntries: 1 } }; },
      });
    });
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    downloadImpl() { downloadCalls += 1; },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const btn = root._findOneByClass("rv-export-btn");
  btn._click();
  // Yield once so the in-flight render fires, leaving exportState.exporting=true.
  await new Promise((r) => setTimeout(r, 0));
  const inflightBtn = root._findOneByClass("rv-export-btn");
  assert.equal(inflightBtn.attributes.disabled, "disabled");
  assert.match(inflightBtn.textContent, /내보내는 중/);
  // Second click while in-flight is ignored — fetchStub stays at 2 calls.
  inflightBtn._click();
  resolveExport();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(downloadCalls, 1, "second click during in-flight must not double-download");
});

test("UI-H10: close clears export banner so reopening starts fresh", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1 || callIdx === 3) {
      return { ok: true, status: 200, async json() { return { entries: [] }; } };
    }
    // Export call → success
    return { ok: true, status: 200, async json() { return { ok: true, bundle: { totalEntries: 1 } }; } };
  };
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    downloadImpl() { /* no-op */ },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  root._findOneByClass("rv-export-btn")._click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // Banner present
  assert.ok(root._findOneByClass("rv-export-success"));
  handle.close();
  // Re-open same run — banner must be gone, exportState reset.
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root._findOneByClass("rv-export-success"), null);
  // _state() reflects the reset.
  assert.equal(handle._state().exportState.success, null);
  assert.equal(handle._state().exportState.error, null);
});

test("UI-H10: _exportNow test hook drives flow without DOM click", async () => {
  // Confirms the synthetic test API is wired so future toast/preview
  // tests don't have to synthesize click events.
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("r1", {});
  let callIdx = 0;
  const fetchStub = async () => {
    callIdx += 1;
    if (callIdx === 1) {
      return { ok: true, status: 200, async json() { return { entries: [] }; } };
    }
    return { ok: true, status: 200, async json() { return { ok: true, bundle: { totalEntries: 1 } }; } };
  };
  let downloadCalls = 0;
  const handle = runViewer.create({
    root, store, doc: makeStubDoc(),
    fetchImpl: fetchStub,
    downloadImpl() { downloadCalls += 1; },
  });
  handle.open("r1");
  await new Promise((r) => setTimeout(r, 0));
  await handle._exportNow("r1");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(downloadCalls, 1);
});
