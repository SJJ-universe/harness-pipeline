// Slice UI-H7-e (Phase D / Phase E1.5, 2026-04-30) — end-to-end
// public-sector posture chain for the review-relay surface.
//
// Verifies:
//   - publicSector + !allowLocalExecutor → server returns 409 +
//     friendly client error code at hand-back-claude
//   - same posture → follow-up target=claude → 409
//   - same posture → follow-up target=codex → 200 (Codex critique
//     is read-only and always allowed)
//   - same posture → archive succeeds (no executor, just state change)
//   - dual-agent-console (mounted with publicSector store data) hides
//     hand-back button + shows posture badge

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { ReviewSessionManager } = require("../../src/runtime/reviewSessionManager");
const { createReviewSessionRoutes } = require("../../src/routes/reviewSessionRoutes");
const reviewSessionClient = require("../../public/js/monitor/review-session-client");
const dualConsole = require("../../public/js/monitor/panels/dual-agent-console");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── Direct-router helper (no full server boot) ──────────────────

async function spinRouter(deploymentProfile) {
  const manager = new ReviewSessionManager();
  const app = express();
  app.use("/api", createReviewSessionRoutes({
    reviewSessionManager: manager,
    deploymentProfile,
  }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  const port = listener.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    manager,
    async close() { await new Promise((r) => listener.close(r)); },
  };
}

// ── DOM stub for dual-agent-console (lifted) ────────────────────

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
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
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
  };
  el.disabled = false;
  return el;
}
function makeStubDoc() { return { createElement: makeStubElement }; }

// ── Server-side posture: hand-back returns 409 ───────────────────

test("UI-H7-e end-to-end: publicSector + !allowLocalExecutor blocks hand-back-claude", async () => {
  const ctx = await spinRouter({ publicSector: true, allowLocalExecutor: false });
  try {
    // Create a session and run it through to critique-received
    // (state needed for hand-back).
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "posture-test" }),
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "review" }),
    });
    ctx.manager.recordCritiqueReceived(session.sessionId, { summary: "ok" });

    // Try hand-back via client
    let caught = null;
    try {
      await reviewSessionClient.handBackToClaude(session.sessionId, {
        instruction: "apply",
        fetchImpl: (url, init) => fetch(`${ctx.base}${url}`, init),
      });
    } catch (err) { caught = err; }

    assert.ok(caught, "expected hand-back to throw");
    assert.equal(caught.code, "public_sector_local_executor_disabled");
    assert.equal(caught.status, 409);
    assert.match(caught.message, /Public-sector posture/);
  } finally { await ctx.close(); }
});

test("UI-H7-e end-to-end: publicSector + !allowLocalExecutor blocks follow-up target=claude", async () => {
  const ctx = await spinRouter({ publicSector: true, allowLocalExecutor: false });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "follow-up-test" }),
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "review" }),
    });

    let caught = null;
    try {
      await reviewSessionClient.followUp(session.sessionId, {
        question: "explain",
        target: "claude",
        fetchImpl: (url, init) => fetch(`${ctx.base}${url}`, init),
      });
    } catch (err) { caught = err; }

    assert.ok(caught);
    assert.equal(caught.code, "public_sector_local_executor_disabled");
    assert.equal(caught.status, 409);
  } finally { await ctx.close(); }
});

test("UI-H7-e end-to-end: publicSector ALLOWS follow-up target=codex (read-only)", async () => {
  const ctx = await spinRouter({ publicSector: true, allowLocalExecutor: false });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "codex-readonly" }),
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "review" }),
    });

    const result = await reviewSessionClient.followUp(session.sessionId, {
      question: "details please",
      target: "codex",
      fetchImpl: (url, init) => fetch(`${ctx.base}${url}`, init),
    });
    assert.equal(result.ok, true);
    assert.equal(result.session.sessionId, session.sessionId);
  } finally { await ctx.close(); }
});

test("UI-H7-e end-to-end: publicSector ALLOWS archive (no spawn, just state)", async () => {
  const ctx = await spinRouter({ publicSector: true, allowLocalExecutor: false });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "archive-test" }),
    });
    const { session } = await create.json();

    const result = await reviewSessionClient.archiveSession(session.sessionId, {
      reason: "operator-archive",
      fetchImpl: (url, init) => fetch(`${ctx.base}${url}`, init),
    });
    assert.equal(result.ok, true);
    assert.equal(result.session.state, "archived");
  } finally { await ctx.close(); }
});

// ── UI side: dual-agent-console hides hand-back + shows badge ────

test("UI-H7-e UI: publicSector store → hand-back hidden + posture badge visible", () => {
  const root = makeStubElement("div");
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  store.setAccountStatus({
    deployment: { mode: "public-sector", publicSector: true,
                  allowLocalExecutor: false },
  });
  const calls = { handBack: 0 };
  const client = {
    handBackToClaude: () => { calls.handBack++; return Promise.resolve(); },
  };
  dualConsole.create({ root, store, doc: makeStubDoc(), client });

  const buttons = root._findAllByClass("dac-action-btn");
  const ids = buttons.map((b) => b.attributes["data-action-id"]);
  assert.equal(ids.includes("hand-back"), false,
    "hand-back button should be hidden under public-sector posture");

  const badge = root._findOneByClass("dac-posture-badge");
  assert.ok(badge, "posture badge should be visible");
  assert.match(badge._textContent, /공공기관/);
});

test("UI-H7-e UI: standard posture → hand-back visible + no posture badge", () => {
  const root = makeStubElement("div");
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  store.setAccountStatus({
    deployment: { mode: "standard", publicSector: false, allowLocalExecutor: true },
  });
  const client = { handBackToClaude: () => Promise.resolve() };
  dualConsole.create({ root, store, doc: makeStubDoc(), client });

  const buttons = root._findAllByClass("dac-action-btn");
  const ids = buttons.map((b) => b.attributes["data-action-id"]);
  assert.ok(ids.includes("hand-back"));
  assert.equal(root._findOneByClass("dac-posture-badge"), null);
});

// ── Combined: server returns 409, client surfaces friendly Korean ─

test("UI-H7-e combined: server 409 + UI error mapping (full chain)", async () => {
  const ctx = await spinRouter({ publicSector: true, allowLocalExecutor: false });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "combined-test" }),
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "review" }),
    });
    ctx.manager.recordCritiqueReceived(session.sessionId, { summary: "ok" });

    let caught = null;
    try {
      await reviewSessionClient.handBackToClaude(session.sessionId, {
        instruction: "apply",
        fetchImpl: (url, init) => fetch(`${ctx.base}${url}`, init),
      });
    } catch (err) { caught = err; }

    // Verify error code propagation
    assert.equal(caught.code, "public_sector_local_executor_disabled");

    // Verify the Korean friendly mapper on layout side
    const { _formatReviewError } = require("../../public/js/monitor/layout.js");
    const friendly = _formatReviewError(caught);
    assert.match(friendly, /공공기관 모드/);
    assert.match(friendly, /로컬 Claude 실행/);
  } finally { await ctx.close(); }
});
