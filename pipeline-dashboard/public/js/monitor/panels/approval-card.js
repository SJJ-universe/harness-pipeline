// Slice UX-2-b (Phase D R3 + Phase E1.5, 2026-04-29) — pending-
// approval card panel.
//
// Compact card list of pending operator approvals. Reads
// snapshot.pendingApprovals (UX-2-a slice). For each entry renders:
//
//   - Tool icon + tool name + argsSummary (truncated)
//   - PII badge ("⚠ PII detected: krn, phone") when piiContext.hasPii
//   - Allow / Deny buttons -> POST /api/approvals/:id/{grant,deny}
//   - Hint of when the request will expire (static "30s timeout"
//     label — the WS approval_resolved on timeout removes the card,
//     so the UI doesn't need a live ticking countdown)
//
// The Advanced Mode view (UX-2-c approval-panel.js) shows full
// detail — host, runId, args hash, full args record, redacted PII
// samples. This card is the at-a-glance view.
//
// Side effects via constructor injection (testable):
//   fetchImpl       -> POSTs to /api/approvals/:id/{grant,deny}
//   confirmImpl     -> window.confirm for "Deny without reading?"
//                       guard (only when card is brand-new + no PII)
//   setTimeoutFn    -> toast TTL (4s)
//   doc             -> document for createElement / event listeners

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorApprovalCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const TOAST_TTL_MS = 4000;
  // The bigger the card list grows, the more we want to truncate
  // descriptions to keep the panel scannable. Match the manager's
  // ARGS_SUMMARY_MAX_LENGTH so card text doesn't display longer
  // strings than the audit chain captured.
  const SUMMARY_DISPLAY_MAX = 80;

  // Tool emojis are operator-friendly — at-a-glance "what kind of
  // tool" without reading the label. Keep the alphabet narrow so
  // it never feels noisy. None == fallback.
  const TOOL_GLYPH = {
    Bash: "$",
    Edit: "✎",
    Write: "✏",
  };

  function create({
    root,
    store,
    fetchImpl,
    headers,
    doc,
    deciderId,
    setTimeoutFn,
    clearTimeoutFn,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("approval-card.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("approval-card.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("approval-card.create: no document available");
    }
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _setTimeout = setTimeoutFn
      || (typeof setTimeout !== "undefined" ? setTimeout : null);
    const _clearTimeout = clearTimeoutFn
      || (typeof clearTimeout !== "undefined" ? clearTimeout : null);
    const _deciderId = deciderId || "operator";

    let busy = false;          // disable buttons while a fetch is in flight
    let toast = null;          // last operator-readable message
    let toastTimer = null;
    let unsubscribe = null;
    let destroyed = false;

    function _setToast(message) {
      toast = message;
      if (_clearTimeout && toastTimer) {
        _clearTimeout(toastTimer);
        toastTimer = null;
      }
      if (_setTimeout && message) {
        toastTimer = _setTimeout(() => {
          toast = null;
          toastTimer = null;
          render();
        }, TOAST_TTL_MS);
      }
    }

    async function _decide(approvalId, action) {
      if (busy || typeof _fetch !== "function" || destroyed) return;
      busy = true;
      render();
      try {
        const res = await _fetch(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Accept: "application/json",
            ...(headers || {}),
          },
          body: JSON.stringify({ deciderId: _deciderId }),
        });
        if (!res || typeof res.ok !== "boolean") {
          _setToast("Failed: network");
          return;
        }
        if (!res.ok) {
          if (res.status === 404) {
            // Already resolved by another tab / timed out / cancelled.
            // The store will get the broadcast and remove the card on
            // its own; just acknowledge to the operator.
            _setToast("Already resolved");
          } else if (res.status === 401) {
            _setToast("Auth required (refresh page)");
          } else {
            _setToast(`Failed: status ${res.status}`);
          }
          return;
        }
        // Success — the store update arrives via WS approval_resolved,
        // so we don't need to manually mutate. Just toast the action.
        _setToast(action === "grant" ? "Granted" : "Denied");
      } catch (err) {
        _setToast("Failed: " + (err && err.message ? err.message : "network"));
      } finally {
        busy = false;
        render();
      }
    }

    // ── Rendering ─────────────────────────────────────────────────

    function _truncate(s, n) {
      if (typeof s !== "string") return "";
      if (s.length <= n) return s;
      return s.slice(0, n - 1) + "…";
    }

    function _piiBadge(piiContext) {
      if (!piiContext || !piiContext.hasPii) return null;
      const types = Array.isArray(piiContext.findingTypes)
        ? piiContext.findingTypes : [];
      const badge = _doc.createElement("span");
      badge.className = "ac-pii-badge";
      badge.textContent = types.length > 0
        ? `⚠ PII: ${types.join(", ")}`
        : "⚠ PII detected";
      return badge;
    }

    function _renderApproval(req) {
      const card = _doc.createElement("article");
      card.className = "ac-card";
      card.setAttribute("data-approval-id", req.approvalId);

      // Header
      const header = _doc.createElement("header");
      header.className = "ac-header";
      const glyph = _doc.createElement("span");
      glyph.className = "ac-tool-glyph";
      glyph.textContent = TOOL_GLYPH[req.tool] || "·";
      const title = _doc.createElement("span");
      title.className = "ac-tool";
      title.textContent = req.tool;
      const summary = _doc.createElement("span");
      summary.className = "ac-summary";
      summary.textContent = _truncate(req.argsSummary || "", SUMMARY_DISPLAY_MAX);
      summary.title = req.argsSummary || "";  // full text on hover
      header.appendChild(glyph);
      header.appendChild(title);
      header.appendChild(summary);
      card.appendChild(header);

      // PII badge (if any)
      const badge = _piiBadge(req.piiContext);
      if (badge) card.appendChild(badge);

      // Meta line: hostIdentity + run + timeout
      const meta = _doc.createElement("div");
      meta.className = "ac-meta";
      const parts = [];
      if (req.hostIdentity) parts.push(`host: ${req.hostIdentity}`);
      if (req.runId) parts.push(`run: ${req.runId}`);
      if (typeof req.timeoutMs === "number") {
        parts.push(`timeout: ${Math.round(req.timeoutMs / 1000)}s`);
      }
      meta.textContent = parts.join(" · ");
      card.appendChild(meta);

      // Action row
      const actions = _doc.createElement("div");
      actions.className = "ac-actions";
      const allow = _doc.createElement("button");
      allow.className = "ac-btn ac-btn-allow";
      allow.type = "button";
      allow.textContent = "Allow";
      allow.disabled = busy;
      allow.addEventListener("click", () => _decide(req.approvalId, "grant"));

      const deny = _doc.createElement("button");
      deny.className = "ac-btn ac-btn-deny";
      deny.type = "button";
      deny.textContent = "Deny";
      deny.disabled = busy;
      deny.addEventListener("click", () => _decide(req.approvalId, "deny"));

      actions.appendChild(allow);
      actions.appendChild(deny);
      card.appendChild(actions);

      return card;
    }

    function render() {
      if (destroyed) return;
      // Wipe + re-render. The card list is small enough that diffing
      // would be over-engineering; flat rebuild is simpler + tested
      // pattern (matches settings-accounts.js shape).
      root.innerHTML = "";

      const snap = store.snapshot();
      const list = Array.isArray(snap.pendingApprovals) ? snap.pendingApprovals : [];

      // Header showing count + toast
      const head = _doc.createElement("header");
      head.className = "ac-list-header";
      const count = _doc.createElement("span");
      count.className = "ac-count";
      count.textContent = list.length === 0
        ? "No pending approvals"
        : `${list.length} pending approval${list.length === 1 ? "" : "s"}`;
      head.appendChild(count);
      if (toast) {
        const t = _doc.createElement("span");
        t.className = "ac-toast";
        t.textContent = toast;
        head.appendChild(t);
      }
      root.appendChild(head);

      if (list.length === 0) return;

      const container = _doc.createElement("div");
      container.className = "ac-list";
      for (const req of list) {
        container.appendChild(_renderApproval(req));
      }
      root.appendChild(container);
    }

    // ── Lifecycle ─────────────────────────────────────────────────

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) { /* defensive */ }
          unsubscribe = null;
        }
        if (_clearTimeout && toastTimer) {
          try { _clearTimeout(toastTimer); } catch (_) { /* defensive */ }
          toastTimer = null;
        }
        root.innerHTML = "";
      },
      // Test hooks
      _decide,
      _render: render,
      _setToast,
    };
  }

  return { create };
});
