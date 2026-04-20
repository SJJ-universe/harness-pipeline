// Run history drawer — Slice E (v4).
//
// Tracks the last N completed pipeline runs in localStorage so the user can
// scroll back through past runs without the server keeping a durable log.
// Each entry stores a snapshot fetched from `GET /api/runs/current`, which
// contains the replay events the live dashboard would have applied. Clicking
// a historical entry re-plays those events into the current DOM in readonly
// mode via `applyReplayEvent()` — the same reducer used on reconnect.
//
// Same two-layer design as toast.js / subagent-tray.js so the pure
// `RunHistoryStore` is directly testable in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    // The installed singleton is exposed to app.js for wiring the open/close
    // buttons and the post-complete auto-save hook.
    root.HarnessRunHistory = api.install({
      win: window,
      doc: document,
      storage: window.localStorage,
    });
    root.HarnessRunHistory.RunHistoryStore = api.RunHistoryStore;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STORAGE_KEY = "harness:runHistory:v1";
  const DEFAULT_MAX_ENTRIES = 10;
  const MAX_ENTRY_BYTES = 250 * 1024; // 250KB cap per saved run
  const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2MB total cap

  // ── Pure storage layer ─────────────────────────────────────────────
  class RunHistoryStore {
    constructor({ storage, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
      this.storage = storage || null;
      this.maxEntries = maxEntries;
    }

    _readList() {
      if (!this.storage) return [];
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    _writeList(list) {
      if (!this.storage) return;
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch (err) {
        // Quota exceeded or disabled storage — drop oldest half and retry.
        try {
          const half = list.slice(Math.ceil(list.length / 2));
          this.storage.setItem(STORAGE_KEY, JSON.stringify(half));
        } catch (_) { /* give up silently */ }
      }
    }

    /**
     * Add a run snapshot. `entry.body` is the full export payload, `entry.meta`
     * is the small projection rendered in the drawer list. We store both under
     * a single id so the list can render fast without JSON-parsing every body.
     */
    add(entry) {
      if (!entry || typeof entry !== "object") return { rejected: "invalid-entry" };
      const id = entry.id || ("run-" + Date.now().toString(36));
      const meta = entry.meta || {};
      const body = entry.body || {};
      const serialized = JSON.stringify({ id, meta, body });
      if (serialized.length > MAX_ENTRY_BYTES) {
        return { rejected: "entry-too-large" };
      }
      const next = this._readList();
      // Dedup by id — a re-save overwrites the existing row.
      const existingIdx = next.findIndex((e) => e.id === id);
      const record = { id, meta, body, savedAt: Date.now() };
      if (existingIdx >= 0) {
        next[existingIdx] = record;
      } else {
        next.unshift(record);
      }
      // Cap: newest-first, trim overflow from the tail.
      while (next.length > this.maxEntries) next.pop();
      // Total-size guard: drop oldest entries until under MAX_TOTAL_BYTES.
      let totalBytes = JSON.stringify(next).length;
      while (totalBytes > MAX_TOTAL_BYTES && next.length > 1) {
        next.pop();
        totalBytes = JSON.stringify(next).length;
      }
      this._writeList(next);
      return { added: record };
    }

    list() {
      // Newest first, no bodies — cheap for drawer rendering.
      return this._readList().map((e) => ({ id: e.id, meta: e.meta, savedAt: e.savedAt }));
    }

    get(id) {
      return this._readList().find((e) => e.id === id) || null;
    }

    remove(id) {
      const next = this._readList().filter((e) => e.id !== id);
      this._writeList(next);
    }

    clear() {
      if (this.storage) this.storage.removeItem(STORAGE_KEY);
    }
  }

  // ── Browser install ────────────────────────────────────────────────
  function install({ win, doc, storage, applyReplayEvent } = {}) {
    const store = new RunHistoryStore({ storage });
    if (!doc) {
      // Headless (test harness) — state only, no DOM.
      return {
        store, save: () => {}, open: () => {}, close: () => {},
        loadEntry: () => {}, clear: () => store.clear(),
      };
    }

    function _drawer() { return doc.getElementById("run-history-drawer"); }
    function _list() { return doc.getElementById("run-history-list"); }
    function _emptyBanner() { return doc.getElementById("run-history-empty"); }

    function _toast(opts) {
      try {
        if (win && win.HarnessToast && typeof win.HarnessToast.show === "function") {
          return win.HarnessToast.show(opts);
        }
      } catch (_) {}
    }

    function _renderList() {
      const list = _list();
      if (!list) return;
      while (list.firstChild) list.removeChild(list.firstChild);
      const items = store.list();
      const banner = _emptyBanner();
      if (banner) banner.style.display = items.length === 0 ? "" : "none";
      for (const item of items) {
        const savedDate = new Date(item.savedAt);
        const meta = item.meta || {};
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "run-history-row";
        row.dataset.runId = item.id;
        const idLabel = doc.createElement("span");
        idLabel.className = "run-history-id";
        idLabel.textContent = meta.label || item.id;
        row.appendChild(idLabel);
        const ts = doc.createElement("span");
        ts.className = "run-history-ts";
        ts.textContent = savedDate.toLocaleString();
        row.appendChild(ts);
        if (meta.templateId) {
          const tpl = doc.createElement("span");
          tpl.className = "run-history-tpl";
          tpl.textContent = meta.templateId;
          row.appendChild(tpl);
        }
        const del = doc.createElement("button");
        del.type = "button";
        del.className = "run-history-del";
        del.textContent = "×";
        del.title = "삭제";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!win.confirm(`이 기록을 삭제할까요?`)) return;
          store.remove(item.id);
          _renderList();
        });
        row.appendChild(del);
        row.addEventListener("click", () => _loadEntry(item.id));
        list.appendChild(row);
      }
    }

    async function _save() {
      try {
        const res = await win.fetch("/api/runs/current");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = await res.json();
        const snap = body.snapshot || {};
        const meta = {
          label: snap.templateId
            ? `${snap.templateId} · ${snap.phase || "?"} · ${snap.status || "?"}`
            : "(idle)",
          templateId: snap.templateId || null,
          status: snap.status || null,
          phase: snap.phase || null,
          exportedAt: body.exportedAt,
        };
        const result = store.add({ meta, body });
        if (result.rejected === "entry-too-large") {
          _toast({ type: "warn", message: "실행 기록이 너무 커서 저장하지 못했습니다" });
        } else {
          _toast({ type: "success", message: "현재 실행 기록 저장됨", duration: 2500 });
          _renderList();
        }
      } catch (err) {
        _toast({ type: "error", message: `저장 실패: ${err.message}` });
      }
    }

    function _loadEntry(id) {
      const entry = store.get(id);
      if (!entry) {
        _toast({ type: "error", message: "기록을 찾지 못했습니다" });
        return;
      }
      const body = entry.body || {};
      const events = Array.isArray(body.events) ? body.events : [];
      const reducer = applyReplayEvent
        || (win && typeof win.applyReplayEvent === "function" ? win.applyReplayEvent : null);
      if (!reducer) {
        _toast({ type: "warn", message: "리플레이 리듀서를 찾지 못했습니다 (앱 초기화 전일 수 있음)" });
        return;
      }
      // Readonly replay — the user's current live pipeline state in memory
      // is not affected beyond the DOM, so we warn them before applying.
      if (!win.confirm(`'${entry.meta && entry.meta.label || id}' 기록을 현재 화면에 replay 할까요? (readonly)`)) return;
      let count = 0;
      for (const ev of events) {
        try { reducer(ev ? ev.event || ev : null); count++; } catch (_) {}
      }
      _toast({ type: "info", message: `${count}개 이벤트 replay 완료`, duration: 2500 });
      close();
    }

    function open() {
      _renderList();
      const d = _drawer();
      if (d) d.classList.add("visible");
    }

    function close() {
      const d = _drawer();
      if (d) d.classList.remove("visible");
    }

    function _bindEvents() {
      const d = _drawer();
      if (!d) return;
      const saveBtn = doc.getElementById("btn-run-history-save");
      const clearBtn = doc.getElementById("btn-run-history-clear");
      const closeBtn = d.querySelector(".modal-close");
      if (saveBtn) saveBtn.addEventListener("click", _save);
      if (closeBtn) closeBtn.addEventListener("click", close);
      if (clearBtn) clearBtn.addEventListener("click", () => {
        if (!win.confirm("모든 기록을 지울까요?")) return;
        store.clear();
        _renderList();
      });
      // Backdrop click closes
      d.addEventListener("click", (e) => { if (e.target === d) close(); });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", _bindEvents);
    } else {
      _bindEvents();
    }

    return { store, save: _save, open, close, loadEntry: _loadEntry, clear: () => { store.clear(); _renderList(); } };
  }

  return { RunHistoryStore, install, STORAGE_KEY, DEFAULT_MAX_ENTRIES };
});
