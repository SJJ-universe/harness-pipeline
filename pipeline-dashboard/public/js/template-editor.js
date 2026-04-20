// Template editor modal — Slice E (v4).
//
// Opens over #template-editor-overlay. Left pane lists templates (built-ins
// marked read-only, customs deletable); right pane is a textarea with JSON
// lint + save/delete controls. All writes go through POST/DELETE
// /api/pipeline/templates which are already protected by the x-harness-token
// middleware (api-client.js attaches it automatically).
//
// The editor is intentionally primitive — no Monaco, no tree view. The JSON
// Schema docs live at src/templates/pipelineTemplate.schema.json; users can
// crib a built-in template as a starting skeleton.

(function () {
  const el = window.HarnessDom && window.HarnessDom.el;
  if (!el) return; // dom.js is required — fail quietly in unusual test harnesses

  const state = {
    templates: {},    // merged map from GET /api/pipeline/templates
    selectedId: null, // currently highlighted id in the list
    dirty: false,     // has the textarea been edited since last save/select?
  };

  function _overlay() { return document.getElementById("template-editor-overlay"); }
  function _list() { return document.getElementById("tpl-ed-list"); }
  function _textarea() { return document.getElementById("tpl-ed-json"); }
  function _msg() { return document.getElementById("tpl-ed-msg"); }
  function _saveBtn() { return document.getElementById("btn-tpl-ed-save"); }
  function _deleteBtn() { return document.getElementById("btn-tpl-ed-delete"); }
  function _newBtn() { return document.getElementById("btn-tpl-ed-new"); }

  const BUILT_IN_IDS = new Set(["default", "code-review", "testing"]);

  function _toast(opts) {
    try {
      if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
        return window.HarnessToast.show(opts);
      }
    } catch (_) {}
    return null;
  }

  async function _fetchTemplates() {
    try {
      const res = await fetch("/api/pipeline/templates");
      if (!res.ok) throw new Error(`status ${res.status}`);
      state.templates = await res.json();
    } catch (err) {
      state.templates = {};
      _toast({ type: "error", message: `템플릿 목록을 가져오지 못했습니다: ${err.message}` });
    }
  }

  function _setMessage(text, kind) {
    const m = _msg();
    if (!m) return;
    m.textContent = text || "";
    m.className = "tpl-ed-msg" + (kind ? " tpl-ed-msg-" + kind : "");
  }

  function _renderList() {
    const list = _list();
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    const ids = Object.keys(state.templates).sort((a, b) => {
      // Built-ins first, then customs alphabetically
      const aBuiltin = BUILT_IN_IDS.has(a);
      const bBuiltin = BUILT_IN_IDS.has(b);
      if (aBuiltin !== bBuiltin) return aBuiltin ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const id of ids) {
      const isBuiltin = BUILT_IN_IDS.has(id);
      const template = state.templates[id];
      const row = el("button", {
        type: "button",
        class: "tpl-ed-row" + (state.selectedId === id ? " selected" : ""),
        onClick: () => _select(id),
      }, [
        el("span", { class: "tpl-ed-row-id" }, id),
        el("span", { class: "tpl-ed-row-name" }, (template && template.name) || ""),
        isBuiltin
          ? el("span", { class: "tpl-ed-row-badge builtin" }, "built-in")
          : el("span", { class: "tpl-ed-row-badge custom" }, "custom"),
      ]);
      list.appendChild(row);
    }

    if (ids.length === 0) {
      list.appendChild(el("div", { class: "tpl-ed-row empty" }, "(템플릿 없음)"));
    }
  }

  function _select(id) {
    if (state.dirty) {
      if (!confirm("편집 중인 내용이 있습니다. 버릴까요?")) return;
    }
    state.selectedId = id;
    state.dirty = false;
    const template = state.templates[id] || {};
    const ta = _textarea();
    if (ta) {
      ta.value = JSON.stringify(template, null, 2);
    }
    _setMessage("", "");
    _renderList();
    _refreshActionButtons();
  }

  function _refreshActionButtons() {
    const id = state.selectedId;
    const isBuiltin = id && BUILT_IN_IDS.has(id);
    const save = _saveBtn();
    const del = _deleteBtn();
    if (save) save.disabled = !id || isBuiltin; // built-ins are never savable
    if (del) del.disabled = !id || isBuiltin;
  }

  async function _save() {
    const ta = _textarea();
    if (!ta) return;
    let parsed;
    try {
      parsed = JSON.parse(ta.value);
    } catch (err) {
      _setMessage(`JSON 파싱 오류: ${err.message}`, "error");
      return;
    }
    // Client-side pre-check to give quick feedback on the id. The server
    // runs the full schema again — this is convenience, not security.
    if (!parsed.id || !/^custom-[a-z0-9_-]{1,40}$/.test(parsed.id)) {
      _setMessage("id는 /^custom-[a-z0-9_-]{1,40}$/ 패턴을 만족해야 합니다", "error");
      return;
    }
    try {
      const res = await fetch("/api/pipeline/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        _setMessage(`저장 실패 (${res.status}): ${body.error || "unknown"}`, "error");
        return;
      }
      const result = await res.json();
      _toast({ type: "success", message: `템플릿 "${result.id}" 저장됨` });
      state.dirty = false;
      state.selectedId = result.id;
      await _fetchTemplates();
      _renderList();
      _refreshActionButtons();
      _setMessage(`저장됨: ${result.id}`, "ok");
    } catch (err) {
      _setMessage(`네트워크 오류: ${err.message}`, "error");
    }
  }

  async function _deleteCurrent() {
    const id = state.selectedId;
    if (!id || BUILT_IN_IDS.has(id)) return;
    if (!confirm(`템플릿 "${id}"를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch(`/api/pipeline/templates/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        _setMessage(`삭제 실패 (${res.status}): ${body.error || "unknown"}`, "error");
        return;
      }
      _toast({ type: "success", message: `템플릿 "${id}" 삭제됨` });
      state.selectedId = null;
      state.dirty = false;
      _textarea().value = "";
      await _fetchTemplates();
      _renderList();
      _refreshActionButtons();
      _setMessage("", "");
    } catch (err) {
      _setMessage(`네트워크 오류: ${err.message}`, "error");
    }
  }

  function _startNew() {
    if (state.dirty) {
      if (!confirm("편집 중인 내용이 있습니다. 버릴까요?")) return;
    }
    const stub = {
      id: "custom-new-template",
      name: "새 커스텀 템플릿",
      phases: [
        {
          id: "A",
          name: "분석",
          agent: "claude",
          allowedTools: ["Read", "Glob", "Grep"],
          exitCriteria: [
            { type: "min-tools-in-phase", count: 2 },
          ],
        },
      ],
    };
    state.selectedId = stub.id;
    state.dirty = true;
    _textarea().value = JSON.stringify(stub, null, 2);
    _setMessage("새 템플릿 초안 — id를 바꾼 뒤 '저장'을 누르세요.", "info");
    _renderList();
    _refreshActionButtons();
  }

  async function open() {
    const overlay = _overlay();
    if (!overlay) return;
    overlay.classList.add("visible");
    await _fetchTemplates();
    _renderList();
    _refreshActionButtons();
  }

  function close() {
    if (state.dirty) {
      if (!confirm("편집 중인 내용이 있습니다. 버릴까요?")) return;
    }
    const overlay = _overlay();
    if (overlay) overlay.classList.remove("visible");
    state.dirty = false;
  }

  // WebSocket-driven refresh: when another client or CLI updates the
  // registry we re-fetch in the background so the list is live.
  function onRegistryReloaded() {
    if (!_overlay() || !_overlay().classList.contains("visible")) return;
    _fetchTemplates().then(_renderList);
  }

  function _bindEvents() {
    const save = _saveBtn();
    const del = _deleteBtn();
    const newBtn = _newBtn();
    const ta = _textarea();
    if (save) save.addEventListener("click", _save);
    if (del) del.addEventListener("click", _deleteCurrent);
    if (newBtn) newBtn.addEventListener("click", _startNew);
    if (ta) ta.addEventListener("input", () => { state.dirty = true; });
    const closeBtn = document.querySelector("#template-editor-overlay .modal-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    // Backdrop click closes (click on overlay, not content)
    const overlay = _overlay();
    if (overlay) overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  window.HarnessTemplateEditor = { open, close, onRegistryReloaded };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bindEvents);
  } else {
    _bindEvents();
  }
})();
