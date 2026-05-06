// Slice PRODUCT-SHELL-WIRING (Phase 2 v2 follow-up, 2026-05-06) — shell action
// handlers for the product shell.
//
// The product shell at `/` has 7 action buttons (header: metrics, history,
// codex-verify, shutdown; rail: pipeline-start, pipeline-compact,
// pipeline-template). This module owns the routing implementations so the
// shell + panels stay DOM-only. Each handler is a pure-ish function that
// takes an env bag (`{doc, win, fetchImpl, confirmFn, toastFn}`) — tests
// inject stubs for every dependency.
//
// Wave 1 (real work):
//   - pipeline-start: open the lazy-DOM general-pipeline-modal
//   - shutdown:       confirm + POST /api/server/shutdown
//   - codex-verify:   POST /api/codex/verify + toast result
//
// Wave 2 (legacy view redirect for advanced features that the product
// shell intentionally doesn't reimplement):
//   - metrics, history, pipeline-compact, pipeline-template:
//       toast announcement → window.location.assign("/?mode=legacy#anchor")
//
// `createDefaultHandlers(env)` returns the {actionId → handler} map that
// `product-shell._dispatch` consumes. Tests can pass a custom map to mock
// individual actions while the real ones run for the rest.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessShellActions = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolveWin(opts) {
    if (opts && opts.win) return opts.win;
    if (typeof window !== "undefined") return window;
    return null;
  }
  function _resolveDoc(opts) {
    if (opts && opts.doc) return opts.doc;
    if (typeof document !== "undefined") return document;
    return null;
  }
  function _resolveFetch(opts) {
    if (opts && typeof opts.fetchImpl === "function") return opts.fetchImpl;
    if (typeof fetch === "function") return fetch;
    return null;
  }
  function _resolveConfirm(opts) {
    if (opts && typeof opts.confirmFn === "function") return opts.confirmFn;
    if (typeof confirm !== "undefined") return confirm;
    return () => true;
  }

  function _toast(toastFn, payload) {
    if (typeof toastFn !== "function") return;
    try { toastFn(payload); } catch (_) { /* swallow toast errors */ }
  }

  // Wave 2 helper — same-tab navigate with a toast pre-announcement.
  function _legacyRedirect(win, toastFn, anchor, korLabel) {
    _toast(toastFn, {
      message: "고급 보기로 이동합니다 — " + korLabel,
      kind: "info",
      duration: 1500,
    });
    if (!win || !win.location || typeof win.location.assign !== "function") return;
    const url = "/?mode=legacy" + anchor;
    // Tiny delay so the toast renders before the page swap. Tests use
    // a fake `setTimeout` (or skip the timer) so this stays deterministic.
    if (typeof win.setTimeout === "function") {
      win.setTimeout(function () { win.location.assign(url); }, 250);
    } else {
      win.location.assign(url);
    }
  }

  // ── Wave 1 handlers ────────────────────────────────────────────────

  function pipelineStart(opts) {
    const win = _resolveWin(opts);
    const doc = _resolveDoc(opts);
    const toastFn = opts && opts.toastFn;
    const modalApi = (win && win.HarnessGeneralPipelineModal) || null;
    if (!modalApi || typeof modalApi.install !== "function") {
      _toast(toastFn, {
        message: "모달 모듈을 로드할 수 없습니다 (general-pipeline-modal)",
        kind: "error",
      });
      return;
    }
    const trapApi = win && win.HarnessFocusTrap;
    const installFocusTrap = (trapApi && typeof trapApi.trap === "function")
      ? trapApi.trap
      : null;
    const modal = modalApi.install({
      doc: doc,
      mountTarget: doc && doc.body,
      installFocusTrap: installFocusTrap,
      addLog: opts && opts.addLog,
    });
    if (modal && typeof modal.open === "function") modal.open();
  }

  async function shutdown(opts) {
    const fetchImpl = _resolveFetch(opts);
    const confirmFn = _resolveConfirm(opts);
    const toastFn = opts && opts.toastFn;
    if (!confirmFn("서버를 종료합니까?")) return;
    if (typeof fetchImpl !== "function") {
      _toast(toastFn, { message: "네트워크 사용 불가 (fetch)", kind: "error" });
      return;
    }
    try {
      const r = await fetchImpl("/api/server/shutdown", { method: "POST" });
      _toast(toastFn, {
        message: r && r.ok
          ? "서버 종료 요청을 보냈습니다."
          : "서버 종료 실패: " + (r && r.status ? r.status : "unknown"),
        kind: r && r.ok ? "info" : "error",
      });
    } catch (err) {
      _toast(toastFn, {
        message: "서버 종료 요청 실패: "
          + (err && err.message ? err.message : String(err)),
        kind: "error",
      });
    }
  }

  async function codexVerify(opts) {
    const fetchImpl = _resolveFetch(opts);
    const toastFn = opts && opts.toastFn;
    if (typeof fetchImpl !== "function") {
      _toast(toastFn, { message: "네트워크 사용 불가 (fetch)", kind: "error" });
      return;
    }
    try {
      const r = await fetchImpl("/api/codex/verify", { method: "POST" });
      let body = null;
      try { body = await r.json(); } catch (_) { /* non-JSON body is fine */ }
      const ok = r && r.ok && body && body.ok !== false;
      const detail = (body && (body.detail || body.message)) || "";
      _toast(toastFn, {
        message: "Codex 검증: " + (ok ? "PASS" : "FAIL")
          + (detail ? " — " + detail : ""),
        kind: ok ? "info" : "error",
        duration: 4000,
      });
    } catch (err) {
      _toast(toastFn, {
        message: "Codex 검증 요청 실패: "
          + (err && err.message ? err.message : String(err)),
        kind: "error",
      });
    }
  }

  // ── Wave 2 handlers (legacy view redirect) ─────────────────────────

  function metrics(opts) {
    _legacyRedirect(_resolveWin(opts), opts && opts.toastFn, "#analytics", "메트릭");
  }
  function history(opts) {
    _legacyRedirect(_resolveWin(opts), opts && opts.toastFn, "#run-history", "히스토리");
  }
  function pipelineCompact(opts) {
    _legacyRedirect(_resolveWin(opts), opts && opts.toastFn, "#compact", "compact 보기");
  }
  function pipelineTemplate(opts) {
    _legacyRedirect(_resolveWin(opts), opts && opts.toastFn, "#template-editor", "템플릿 편집기");
  }

  // ── AGENT-DESKTOP-0-c (2026-05-06) — chat-driven dispatchers ──────
  //
  // The chat panel approves a general_task proposal by passing the
  // proposal's parameters ({task, maxIterations}) as the payload to
  // _dispatch. This handler POSTs directly to /api/pipeline/general-run
  // (the same endpoint the legacy modal uses) — bypassing the modal
  // DOM since the operator already approved via the chat card.
  //
  // The endpoint itself enforces validateGeneralRun + the existing
  // generalRunRef.active concurrency lock + audit chain, so the
  // safety semantics match the modal flow exactly.

  async function generalTask(opts) {
    const fetchImpl = _resolveFetch(opts);
    const toastFn = opts && opts.toastFn;
    const params = (opts && opts.parameters) || {};
    const task = (typeof params.task === "string") ? params.task.trim() : "";
    const maxIterations = (typeof params.maxIterations === "number" && params.maxIterations >= 1)
      ? Math.min(Math.trunc(params.maxIterations), 5)
      : 3;
    // Diagnostic logging — visible via DevTools (F12) in the
    // Chrome/Edge --app window. Tracks the full lifecycle so when
    // the chat says "시작했습니다" but the server is silent, the
    // operator can see exactly where the call dropped.
    try { console.log("[shell-actions] generalTask invoked", {
      taskLength: task.length, maxIterations, hasFetch: typeof fetchImpl === "function",
    }); } catch (_) {}
    if (!task || task.length < 3) {
      _toast(toastFn, { message: "작업 설명이 너무 짧습니다 (최소 3자).", kind: "error" });
      throw new Error("task too short (length=" + task.length + ")");
    }
    if (typeof fetchImpl !== "function") {
      _toast(toastFn, { message: "네트워크 사용 불가 (fetch)", kind: "error" });
      throw new Error("fetch not available");
    }
    try { console.log("[shell-actions] POST /api/pipeline/general-run", { task: task.slice(0, 60), maxIterations }); } catch (_) {}
    let r = null;
    try {
      r = await fetchImpl("/api/pipeline/general-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task, maxIterations: maxIterations }),
      });
    } catch (netErr) {
      try { console.error("[shell-actions] fetch threw:", netErr); } catch (_) {}
      _toast(toastFn, {
        message: "파이프라인 시작 실패 (network): " + (netErr && netErr.message ? netErr.message : String(netErr)),
        kind: "error",
      });
      throw netErr;
    }
    try { console.log("[shell-actions] response", { status: r && r.status, ok: r && r.ok }); } catch (_) {}
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON body */ }
    try { console.log("[shell-actions] response body", body); } catch (_) {}
    if (!r || !r.ok) {
      const errMsg = (body && body.error) || ("status " + (r && r.status));
      _toast(toastFn, { message: "파이프라인 시작 실패: " + errMsg, kind: "error" });
      throw new Error("server rejected: " + errMsg);
    }
    const runId = (body && body.runId) || "?";
    _toast(toastFn, {
      message: "파이프라인 시작 — runId " + runId,
      kind: "info",
      duration: 3500,
    });
    return body;
  }

  // show_status is purely informational (chat panel handles inline);
  // we still register a no-op handler so _dispatch finds it without
  // logging "no handler for action: show_status".
  function showStatus(_opts) {
    // Intentionally empty — chat panel renders the snapshot bubble
    // itself before invoking _dispatch (see product-chat-panel.js
    // _onApprove → _renderStatusSummary).
  }

  // ── Default handler map for product-shell._dispatch ────────────────

  function createDefaultHandlers(env) {
    const baseEnv = env || {};
    // The chat panel's _onApprove passes parameters as the second arg
    // to _dispatch; product-shell._dispatch forwards that as `payload`
    // to the handler (which we surface here as `extra.parameters`).
    function _wrap(fn) {
      return function (payload) {
        const extra = (payload && typeof payload === "object")
          ? { parameters: payload }
          : {};
        return fn(Object.assign({}, baseEnv, extra));
      };
    }
    return {
      "pipeline-start":    _wrap(pipelineStart),
      "pipeline-compact":  _wrap(pipelineCompact),
      "pipeline-template": _wrap(pipelineTemplate),
      "metrics":           _wrap(metrics),
      "history":           _wrap(history),
      "codex-verify":      _wrap(codexVerify),
      "shutdown":          _wrap(shutdown),
      // AGENT-DESKTOP-0-c (2026-05-06): chat-flow dispatchers
      "general-task":      _wrap(generalTask),
      "show_status":       _wrap(showStatus),
    };
  }

  return {
    pipelineStart,
    shutdown,
    codexVerify,
    metrics,
    history,
    pipelineCompact,
    pipelineTemplate,
    generalTask,
    showStatus,
    createDefaultHandlers,
  };
});
