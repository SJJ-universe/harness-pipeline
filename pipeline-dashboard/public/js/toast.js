// Harness toast system — Slice C (v4).
//
// Two layers:
//   1. `ToastState` — a pure in-memory stack manager. No DOM dependencies,
//      which keeps it directly testable from Node without jsdom. It handles
//      dedup (same type + message bumps a counter on the existing entry) and
//      eviction (FIFO once the visible stack hits `maxStack`).
//   2. `installToast()` — browser-side wiring. Renders entries into
//      `<div id="toast-container">`, attaches dismiss timers, and exposes
//      `window.HarnessToast = { show, dismiss, clear, state }`.
//
// The module doubles as a CommonJS export so `tests/unit/toast.test.js` can
// require it directly and drive ToastState without loading any HTML.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    // Installed immediately so the rest of the app can call showToast() right
    // after this script tag loads. We rely on #toast-container existing in
    // index.html — if it doesn't, the system silently degrades to a no-op.
    root.HarnessToast = api.install({ doc: document, win: window });
    // Expose the pure state class for diagnostics / tests run in-browser.
    root.HarnessToast.ToastState = api.ToastState;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_DURATION = 5000;
  const DEFAULT_MAX_STACK = 3;

  // ── Pure state manager ─────────────────────────────────────────────
  // add() returns { existing? , added? , evicted? } so the DOM layer knows
  // whether to update an existing node, insert a new one, or remove old nodes.
  class ToastState {
    constructor({ maxStack = DEFAULT_MAX_STACK } = {}) {
      this.maxStack = maxStack;
      this.stack = [];
      this._idSeq = 0;
    }

    add(entry) {
      const type = entry.type || "info";
      const message = String(entry.message == null ? "" : entry.message);
      if (!message) return { rejected: "empty-message" };

      // Dedup: same type+message bumps the existing entry's counter rather
      // than queueing a second toast. This prevents retry loops from burying
      // the original context.
      const existing = this.stack.find((t) => t.type === type && t.message === message);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        return { existing };
      }

      // FIFO eviction once we hit the visible cap.
      const evicted = [];
      while (this.stack.length >= this.maxStack) {
        evicted.push(this.stack.shift());
      }

      const added = {
        id: "t" + ++this._idSeq,
        type,
        message,
        count: 1,
        duration: Number.isFinite(entry.duration) ? entry.duration : DEFAULT_DURATION,
        actionLabel: entry.actionLabel || null,
        onAction: typeof entry.onAction === "function" ? entry.onAction : null,
      };
      this.stack.push(added);
      return { added, evicted };
    }

    remove(id) {
      const idx = this.stack.findIndex((t) => t.id === id);
      if (idx < 0) return null;
      const [removed] = this.stack.splice(idx, 1);
      return removed;
    }

    clear() {
      const all = [...this.stack];
      this.stack.length = 0;
      return all;
    }

    size() { return this.stack.length; }
    find(id) { return this.stack.find((t) => t.id === id) || null; }
    snapshot() { return this.stack.map((t) => ({ ...t, onAction: !!t.onAction })); }
  }

  // ── DOM wiring ─────────────────────────────────────────────────────
  function install({ doc, win, maxStack = DEFAULT_MAX_STACK } = {}) {
    if (!doc) return { show() {}, dismiss() {}, clear() {}, state: new ToastState({ maxStack }) };

    const state = new ToastState({ maxStack });
    const nodes = new Map();   // id → HTMLElement
    const timers = new Map();  // id → timer handle

    function _container() { return doc.getElementById("toast-container"); }

    function _ariaProps(type) {
      // Error toasts demand assertive + alert so screen readers interrupt.
      if (type === "error") return { role: "alert", "aria-live": "assertive" };
      return { role: "status", "aria-live": "polite" };
    }

    function _renderNode(entry) {
      const a = _ariaProps(entry.type);
      const node = doc.createElement("div");
      node.className = `toast toast-${entry.type}`;
      node.setAttribute("role", a.role);
      node.setAttribute("aria-live", a["aria-live"]);
      node.dataset.toastId = entry.id;

      const msgWrap = doc.createElement("div");
      msgWrap.className = "toast-message";
      const msgText = doc.createElement("span");
      msgText.className = "toast-text";
      msgText.textContent = entry.message;
      msgWrap.appendChild(msgText);

      const badge = doc.createElement("span");
      badge.className = "toast-count";
      badge.textContent = ""; // populated via _refreshBadge
      msgWrap.appendChild(badge);
      node.appendChild(msgWrap);

      if (entry.actionLabel && entry.onAction) {
        const btn = doc.createElement("button");
        btn.className = "toast-action";
        btn.type = "button";
        btn.textContent = entry.actionLabel;
        btn.addEventListener("click", () => {
          try { entry.onAction(); } catch (_) {}
          // Default behavior: dismiss after the action fires.
          api.dismiss(entry.id);
        });
        node.appendChild(btn);
      }

      const closeBtn = doc.createElement("button");
      closeBtn.className = "toast-close";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "닫기");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", () => api.dismiss(entry.id));
      node.appendChild(closeBtn);

      return node;
    }

    function _refreshBadge(entry) {
      const node = nodes.get(entry.id);
      if (!node) return;
      const badge = node.querySelector(".toast-count");
      if (!badge) return;
      badge.textContent = entry.count > 1 ? `×${entry.count}` : "";
    }

    function _scheduleDismiss(entry) {
      const prev = timers.get(entry.id);
      if (prev) win.clearTimeout(prev);
      const t = win.setTimeout(() => api.dismiss(entry.id), entry.duration);
      timers.set(entry.id, t);
    }

    const api = {
      state,

      show(opts = {}) {
        const result = state.add(opts);
        if (result.rejected) return null;

        if (result.existing) {
          _refreshBadge(result.existing);
          _scheduleDismiss(result.existing);
          return result.existing.id;
        }

        // Evicted entries lose their DOM node + timer before we insert the new one.
        for (const ev of (result.evicted || [])) {
          const prev = timers.get(ev.id);
          if (prev) win.clearTimeout(prev);
          timers.delete(ev.id);
          const n = nodes.get(ev.id);
          if (n && n.parentNode) n.parentNode.removeChild(n);
          nodes.delete(ev.id);
        }

        const entry = result.added;
        const node = _renderNode(entry);
        nodes.set(entry.id, node);
        const c = _container();
        if (c) c.appendChild(node);
        _scheduleDismiss(entry);
        return entry.id;
      },

      dismiss(id) {
        const removed = state.remove(id);
        if (!removed) return;
        const t = timers.get(id);
        if (t) win.clearTimeout(t);
        timers.delete(id);
        const node = nodes.get(id);
        if (node && node.parentNode) node.parentNode.removeChild(node);
        nodes.delete(id);
      },

      clear() {
        for (const entry of state.clear()) {
          const t = timers.get(entry.id);
          if (t) win.clearTimeout(t);
          timers.delete(entry.id);
          const node = nodes.get(entry.id);
          if (node && node.parentNode) node.parentNode.removeChild(node);
          nodes.delete(entry.id);
        }
      },
    };

    return api;
  }

  return { ToastState, install, DEFAULT_DURATION, DEFAULT_MAX_STACK };
});
