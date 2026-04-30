// Slice D3-d (Phase E1.5, 2026-04-29) — HarnessMonitorSettingsAccounts.
//
// Operator-facing modal panel for profile management. Closes the loop
// between D2 (setup-wizard collects + finalize creates profiles) and
// runtime usage:
//
//   - List every profile via GET /api/profiles
//   - Mark the active profile (from snapshot.accountStatus.profile.activeId)
//   - Switch active via POST /api/profiles/:id/switch
//       409 (active_run_blocks_switch) → operator-readable toast
//   - Test Claude / Test Codex per profile via
//     POST /api/setup/probe-provider with mode=tier1+2 (no token spend)
//       Result cached in panel-local state (NOT the store — keeps the
//       store small, and probe results are panel-specific UX state)
//   - Delete profile via DELETE /api/profiles/:id
//       window.confirm() guard so accidental click can't wipe a
//       profile silently
//
// Why claude/codex test buttons live HERE (not in global-bar D3-c):
//   The global bar shows AT-A-GLANCE posture. CLI test results are
//   per-profile + slow + need explicit operator action — they belong
//   in the modal where each profile gets its own row of buttons. The
//   bar stays honest ("standard / public-sector / dispatch / on (3)")
//   while the modal handles the "probe my CLI now" workflow.
//
// State lives in panel closures (NOT the store):
//   - profiles      — list from GET /api/profiles
//   - testResults   — Map<profileId, { claude, codex }>
//   - busy          — disables every button while a fetch is in flight
//   - toast         — last operator-readable message (timeouts auto-clear
//                     after TOAST_TTL_MS)
//
// All side-effects (fetch / window.confirm / setTimeout) are injectable
// for tests. The browser path uses sensible defaults (window.fetch,
// window.confirm, setTimeout). Test path injects stubs.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorSettingsAccounts = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const TOAST_TTL_MS = 4000;

  // Slice TRUST-STORE-0-e (Phase E Round 2, 2026-04-30): error code →
  // 한국어 매핑. Server route emits frozen codes; UI renders the
  // operator-facing line. Mirrors the run-viewer _formatExportError
  // pattern but stays in its own map (trust store + run-viewer
  // lifecycles diverge).
  function _formatTrustStoreError(code) {
    const mapping = {
      invalid_input: "잘못된 입력입니다.",
      invalid_public_key: "공개키 형식이 올바르지 않습니다 (Ed25519 SPKI DER 44바이트 필요).",
      private_key_rejected: "개인키는 신뢰 저장소에 저장할 수 없습니다.",
      duplicate_key_id: "이미 등록된 키입니다.",
      key_not_found: "해당 키를 찾을 수 없습니다.",
      trust_file_invalid: "신뢰 저장소 파일이 손상되었습니다.",
      store_unwritable: "신뢰 저장소를 쓸 수 없습니다.",
      confirm_required: "공공기관 모드 — 2단계 확인이 필요합니다.",
      confirm_token_invalid: "확인 토큰이 유효하지 않거나 만료되었습니다.",
      confirm_token_mismatch: "확인 토큰이 이 키와 일치하지 않습니다.",
      confirm_token_expired: "확인 토큰이 만료되었습니다 — 다시 시도해 주세요.",
      confirm_token_missing: "확인 토큰이 누락되었습니다.",
      confirm_not_required: "이 시점에서는 확인 토큰이 필요하지 않습니다.",
      trust_store_not_wired: "신뢰 저장소가 아직 구성되지 않았습니다.",
      network_error: "네트워크 오류 — 다시 시도해 주세요.",
    };
    if (typeof code === "string" && mapping[code]) return mapping[code];
    return "신뢰 저장소 작업 실패";
  }

  function _formatTestResult(runner, result) {
    if (!result) return runner + ": untested";
    if (result.errorCode) {
      // Operator-friendly: just the code + a "(see audit chain)" tail
      // when a stderr was clipped. We don't surface the full stderr in
      // the modal — the operator goes to the audit log for that.
      return runner + ": " + result.errorCode;
    }
    if (result.installed && result.authenticated) {
      const label = result.accountLabel ? " (" + result.accountLabel + ")" : "";
      return runner + ": ok" + label;
    }
    if (result.installed) return runner + ": not authenticated";
    return runner + ": not installed";
  }

  function create({
    root,
    store,
    fetchImpl,
    headers,
    onClose,
    doc,
    confirmImpl,
    setTimeoutFn,
    clearTimeoutFn,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("settings-accounts.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("settings-accounts.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("settings-accounts.create: no document available");
    }
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _confirm = confirmImpl
      || (typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm.bind(window) : null);
    const _setTimeout = setTimeoutFn
      || (typeof setTimeout !== "undefined" ? setTimeout : null);
    const _clearTimeout = clearTimeoutFn
      || (typeof clearTimeout !== "undefined" ? clearTimeout : null);

    let profiles = [];
    let testResults = new Map(); // profileId → { claude, codex }
    let busy = false;
    let toast = null;
    let toastTimer = null;

    // Slice TRUST-STORE-0-e: trust-store section state.
    //   trustKeys      — array of public-key shapes from GET /api/trust-store
    //   trustPosture   — "standard" | "public-sector" (server-reported)
    //   trustBusy      — true while a trust-store action is in flight
    //   trustError     — last error code (cleared on next action)
    //   trustForm      — { publicKey, label } — controlled add-form state
    //   trustEditing   — { keyId, label } — inline label edit state
    //   trustConfirm   — { keyId, token } — pending public-sector confirm
    let trustKeys = [];
    let trustPosture = "standard";
    let trustBusy = false;
    let trustError = null;
    let trustForm = { publicKey: "", label: "" };
    let trustEditing = null;
    let trustConfirm = null;

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

    async function refresh() {
      if (typeof _fetch !== "function") return null;
      try {
        const res = await _fetch("/api/profiles", {
          method: "GET",
          headers: { Accept: "application/json", ...(headers || {}) },
        });
        if (!res || typeof res.ok !== "boolean") return null;
        if (!res.ok) {
          // 401/403 means the operator isn't authenticated — the modal
          // can't fix that, but the toast tells them what's going on.
          _setToast("Failed to load profiles (status " + res.status + ")");
          render();
          return null;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        profiles = json && Array.isArray(json.profiles) ? json.profiles : [];
        render();
        return json;
      } catch (err) {
        _setToast("Failed to load profiles: " + (err && err.message ? err.message : "network"));
        render();
        return null;
      }
    }

    async function testProfile(profileId, runner) {
      if (busy || typeof _fetch !== "function") return;
      busy = true;
      render();
      try {
        const res = await _fetch("/api/setup/probe-provider", {
          method: "POST",
          headers: { "content-type": "application/json", ...(headers || {}) },
          body: JSON.stringify({ runner, profileId, mode: "tier1+2" }),
        });
        if (!res || typeof res.ok !== "boolean") return;
        const json = typeof res.json === "function" ? await res.json() : null;
        if (json && typeof json === "object") {
          const map = testResults.get(profileId) || {};
          map[runner] = { ...json, testedAt: Date.now() };
          testResults.set(profileId, map);
          if (json.errorCode === "PUBLIC_SECTOR_BLOCKED") {
            _setToast("Public-sector posture: use sandbox runner instead of local CLI test.");
          }
        } else {
          _setToast(`Test ${runner} failed: bad response`);
        }
      } catch (err) {
        _setToast(`Test ${runner} failed: ${err && err.message ? err.message : "network"}`);
      } finally {
        busy = false;
        render();
      }
    }

    async function switchProfile(profileId) {
      if (busy || typeof _fetch !== "function") return;
      busy = true;
      render();
      try {
        const res = await _fetch(
          "/api/profiles/" + encodeURIComponent(profileId) + "/switch",
          {
            method: "POST",
            headers: { "content-type": "application/json", ...(headers || {}) },
          },
        );
        if (!res || typeof res.ok !== "boolean") return;
        if (res.status === 409) {
          // active_run_blocks_switch — D1-e contract.
          _setToast("Active run is in flight — finish/stop it first, then switch.");
        } else if (!res.ok) {
          _setToast("Switch failed (status " + res.status + ")");
        } else {
          _setToast("Switched to " + profileId);
        }
      } catch (err) {
        _setToast("Switch failed: " + (err && err.message ? err.message : "network"));
      } finally {
        busy = false;
        render();
      }
    }

    async function deleteProfile(profileId) {
      if (busy || typeof _fetch !== "function") return;
      // Confirmation guard — accidental click can't wipe a profile.
      if (typeof _confirm === "function") {
        const ok = _confirm('Delete profile "' + profileId + '"? Credentials will also be cleared.');
        if (!ok) return;
      }
      busy = true;
      render();
      try {
        const res = await _fetch(
          "/api/profiles/" + encodeURIComponent(profileId),
          {
            method: "DELETE",
            headers: { ...(headers || {}) },
          },
        );
        if (!res || typeof res.ok !== "boolean") return;
        if (res.status === 409) {
          _setToast("Active run is in flight — finish/stop it first, then delete.");
        } else if (!res.ok) {
          _setToast("Delete failed (status " + res.status + ")");
        } else {
          _setToast("Deleted " + profileId);
          // Drop cached test results for the deleted id.
          testResults.delete(profileId);
          // Re-fetch the list — reflects the deletion.
          await refresh();
          return;
        }
      } catch (err) {
        _setToast("Delete failed: " + (err && err.message ? err.message : "network"));
      } finally {
        busy = false;
        render();
      }
    }

    // ── Slice TRUST-STORE-0-e: trust store actions ────────────────
    // These mirror the profile-action shape (busy gate + render +
    // try/finally). The single-flight gate is `trustBusy`, separate
    // from `busy` (profile actions) so a slow profile probe doesn't
    // block the operator from adding a key.

    async function refreshTrust() {
      if (typeof _fetch !== "function") return null;
      try {
        const res = await _fetch("/api/trust-store", {
          method: "GET",
          headers: { Accept: "application/json", ...(headers || {}) },
        });
        if (!res || typeof res.ok !== "boolean") return null;
        if (!res.ok) {
          // 503 (not wired) is informational — render the empty state.
          if (res.status !== 503) {
            trustError = "network_error";
          }
          render();
          return null;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        if (json && typeof json === "object") {
          trustKeys = Array.isArray(json.keys) ? json.keys : [];
          trustPosture = json.posture === "public-sector" ? "public-sector" : "standard";
          trustError = null;
          render();
          return json;
        }
        return null;
      } catch (err) {
        trustError = "network_error";
        render();
        return null;
      }
    }

    async function addTrustKey(input) {
      if (trustBusy || typeof _fetch !== "function") return;
      const publicKeyDerBase64 = (input && typeof input.publicKey === "string")
        ? input.publicKey.trim() : trustForm.publicKey.trim();
      const label = (input && typeof input.label === "string")
        ? input.label : trustForm.label;
      if (!publicKeyDerBase64) {
        trustError = "invalid_public_key";
        render();
        return;
      }
      trustBusy = true;
      trustError = null;
      render();
      try {
        const res = await _fetch("/api/trust-store/keys", {
          method: "POST",
          headers: { "content-type": "application/json", ...(headers || {}) },
          body: JSON.stringify({ publicKeyDerBase64, label: label || undefined }),
        });
        if (!res || typeof res.ok !== "boolean") {
          trustError = "network_error";
          return;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        if (res.ok) {
          // Reset the form on success so the operator can paste another
          // key without manually clearing.
          trustForm = { publicKey: "", label: "" };
          _setToast("키 등록됨");
          await refreshTrust();
        } else {
          trustError = (json && typeof json.error === "string") ? json.error : "network_error";
        }
      } catch (err) {
        trustError = "network_error";
      } finally {
        trustBusy = false;
        render();
      }
    }

    async function updateTrustKeyLabel(keyId, label) {
      if (trustBusy || typeof _fetch !== "function") return;
      trustBusy = true;
      trustError = null;
      render();
      try {
        const res = await _fetch(
          "/api/trust-store/keys/" + encodeURIComponent(keyId),
          {
            method: "PATCH",
            headers: { "content-type": "application/json", ...(headers || {}) },
            body: JSON.stringify({ label: label }),
          },
        );
        if (!res || typeof res.ok !== "boolean") {
          trustError = "network_error";
          return;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        if (res.ok) {
          trustEditing = null;
          _setToast("라벨 업데이트됨");
          await refreshTrust();
        } else {
          trustError = (json && typeof json.error === "string") ? json.error : "network_error";
        }
      } catch (err) {
        trustError = "network_error";
      } finally {
        trustBusy = false;
        render();
      }
    }

    async function deleteTrustKey(keyId) {
      if (trustBusy || typeof _fetch !== "function") return;
      // Standard mode: simple confirm dialog. Public-sector mode: the
      // server returns 409 + confirmToken on the first call; we surface
      // a separate "확인 필요" UI for the second click.
      if (trustPosture === "standard" && typeof _confirm === "function") {
        const ok = _confirm('Delete trust key "' + keyId + '"?');
        if (!ok) return;
      }
      trustBusy = true;
      trustError = null;
      render();
      try {
        const res = await _fetch(
          "/api/trust-store/keys/" + encodeURIComponent(keyId),
          { method: "DELETE", headers: { ...(headers || {}) } },
        );
        if (!res || typeof res.ok !== "boolean") {
          trustError = "network_error";
          return;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        if (res.ok) {
          _setToast("키 삭제됨");
          trustConfirm = null;
          await refreshTrust();
        } else if (res.status === 409 && json && json.error === "confirm_required") {
          // Public-sector second-step. Cache the token + keyId so the
          // confirm UI can fire the second call.
          trustConfirm = { keyId, token: json.confirmToken, expiresAt: Date.now() + (json.confirmTtlMs || 0) };
        } else {
          trustError = (json && typeof json.error === "string") ? json.error : "network_error";
        }
      } catch (err) {
        trustError = "network_error";
      } finally {
        trustBusy = false;
        render();
      }
    }

    async function confirmDeleteTrustKey(keyId) {
      if (trustBusy || typeof _fetch !== "function") return;
      if (!trustConfirm || trustConfirm.keyId !== keyId) {
        trustError = "confirm_token_missing";
        render();
        return;
      }
      const token = trustConfirm.token;
      trustBusy = true;
      trustError = null;
      render();
      try {
        const res = await _fetch(
          "/api/trust-store/keys/" + encodeURIComponent(keyId) + "/confirm",
          {
            method: "POST",
            headers: { "content-type": "application/json", ...(headers || {}) },
            body: JSON.stringify({ confirmToken: token }),
          },
        );
        if (!res || typeof res.ok !== "boolean") {
          trustError = "network_error";
          return;
        }
        const json = typeof res.json === "function" ? await res.json() : null;
        if (res.ok) {
          _setToast("키 삭제됨 (확인 완료)");
          trustConfirm = null;
          await refreshTrust();
        } else {
          trustError = (json && typeof json.error === "string") ? json.error : "network_error";
          // On any failure, drop the token — the operator must restart.
          trustConfirm = null;
        }
      } catch (err) {
        trustError = "network_error";
      } finally {
        trustBusy = false;
        render();
      }
    }

    function _renderTrustStoreSection() {
      const sec = _doc.createElement("section");
      sec.className = "sa-trust-store"
        + (trustPosture === "public-sector" ? " sa-trust-store-public-sector" : "");
      sec.setAttribute("aria-label", "신뢰 저장소");

      const header = _doc.createElement("div");
      header.className = "sa-trust-header";
      const title = _doc.createElement("h3");
      title.className = "sa-trust-title";
      title.textContent = trustPosture === "public-sector"
        ? "🛡 신뢰 저장소 (공공기관)"
        : "신뢰 저장소";
      header.appendChild(title);
      const sub = _doc.createElement("p");
      sub.className = "sa-trust-sub";
      sub.textContent = "Manifest 서명 키 (E3-F1 launcher signature gate)";
      header.appendChild(sub);
      sec.appendChild(header);

      // Public-sector + 0 keys → red warning banner. The launcher will
      // reject every install in this state (per E3-F1 fail-closed),
      // so the operator MUST add at least one key before the next
      // distribution attempt.
      if (trustPosture === "public-sector" && trustKeys.length === 0) {
        const warn = _doc.createElement("div");
        warn.className = "sa-trust-warn";
        warn.setAttribute("role", "alert");
        warn.textContent =
          "⚠ 공공기관 모드에 신뢰된 키가 없습니다. " +
          "다음 GOV-RELEASE-0 배포는 모두 차단됩니다.";
        sec.appendChild(warn);
      }

      // Error banner — surfaces the last action's failure.
      if (trustError) {
        const err = _doc.createElement("div");
        err.className = "sa-trust-error";
        err.setAttribute("role", "alert");
        err.textContent = _formatTrustStoreError(trustError);
        sec.appendChild(err);
      }

      // Pending public-sector confirm — operator clicked Delete, server
      // returned a confirm token, we render an inline confirm row.
      if (trustConfirm) {
        const confirm = _doc.createElement("div");
        confirm.className = "sa-trust-confirm";
        confirm.setAttribute("role", "dialog");
        confirm.setAttribute("aria-label", "Delete confirmation");
        const msg = _doc.createElement("p");
        msg.textContent =
          "정말 키 " + trustConfirm.keyId + " 을(를) 삭제하시겠습니까? " +
          "이 작업은 되돌릴 수 없습니다.";
        confirm.appendChild(msg);
        const btnConfirm = _doc.createElement("button");
        btnConfirm.type = "button";
        btnConfirm.className = "sa-trust-btn sa-trust-btn-danger";
        btnConfirm.textContent = "확인하고 삭제";
        if (trustBusy) btnConfirm.setAttribute("disabled", "disabled");
        btnConfirm.addEventListener("click", () => confirmDeleteTrustKey(trustConfirm.keyId));
        confirm.appendChild(btnConfirm);
        const btnCancel = _doc.createElement("button");
        btnCancel.type = "button";
        btnCancel.className = "sa-trust-btn";
        btnCancel.textContent = "취소";
        btnCancel.addEventListener("click", () => {
          trustConfirm = null;
          render();
        });
        confirm.appendChild(btnCancel);
        sec.appendChild(confirm);
      }

      // Key list
      const list = _doc.createElement("ul");
      list.className = "sa-trust-list";
      list.setAttribute("role", "list");
      if (trustKeys.length === 0) {
        const empty = _doc.createElement("li");
        empty.className = "sa-trust-empty";
        empty.textContent = "등록된 키가 없습니다.";
        list.appendChild(empty);
      } else {
        for (const k of trustKeys) {
          list.appendChild(_renderTrustKeyRow(k));
        }
      }
      sec.appendChild(list);

      // Add form
      sec.appendChild(_renderTrustAddForm());

      return sec;
    }

    function _renderTrustKeyRow(key) {
      const li = _doc.createElement("li");
      li.className = "sa-trust-row";
      li.setAttribute("data-key-id", key.keyId);

      const head = _doc.createElement("div");
      head.className = "sa-trust-row-head";
      const idEl = _doc.createElement("span");
      idEl.className = "sa-trust-row-id";
      idEl.textContent = key.keyId;
      head.appendChild(idEl);

      // Inline label edit. While `trustEditing.keyId === key.keyId`, we
      // show an <input> + Save/Cancel; otherwise the label as static
      // text + an Edit button.
      const isEditing = trustEditing && trustEditing.keyId === key.keyId;
      if (isEditing) {
        const input = _doc.createElement("input");
        input.type = "text";
        input.className = "sa-trust-row-label-input";
        input.value = trustEditing.label || "";
        input.setAttribute("aria-label", "키 라벨");
        input.addEventListener("input", (ev) => {
          trustEditing.label = ev && ev.target ? ev.target.value : "";
        });
        head.appendChild(input);
        const saveBtn = _doc.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "sa-trust-btn";
        saveBtn.textContent = "저장";
        if (trustBusy) saveBtn.setAttribute("disabled", "disabled");
        saveBtn.addEventListener("click", () => {
          updateTrustKeyLabel(key.keyId, trustEditing.label);
        });
        head.appendChild(saveBtn);
        const cancelBtn = _doc.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "sa-trust-btn";
        cancelBtn.textContent = "취소";
        cancelBtn.addEventListener("click", () => {
          trustEditing = null;
          render();
        });
        head.appendChild(cancelBtn);
      } else {
        const labelEl = _doc.createElement("span");
        labelEl.className = "sa-trust-row-label";
        labelEl.textContent = key.label || "(no label)";
        head.appendChild(labelEl);
        const editBtn = _doc.createElement("button");
        editBtn.type = "button";
        editBtn.className = "sa-trust-btn";
        editBtn.textContent = "라벨 수정";
        if (trustBusy) editBtn.setAttribute("disabled", "disabled");
        editBtn.addEventListener("click", () => {
          trustEditing = { keyId: key.keyId, label: key.label || "" };
          render();
        });
        head.appendChild(editBtn);
        const removeBtn = _doc.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "sa-trust-btn sa-trust-btn-danger";
        removeBtn.textContent = "삭제";
        if (trustBusy) removeBtn.setAttribute("disabled", "disabled");
        removeBtn.addEventListener("click", () => deleteTrustKey(key.keyId));
        head.appendChild(removeBtn);
      }
      li.appendChild(head);

      const meta = _doc.createElement("div");
      meta.className = "sa-trust-row-meta";
      meta.textContent = "추가됨: " + (key.addedAt || "—");
      li.appendChild(meta);

      return li;
    }

    function _renderTrustAddForm() {
      const form = _doc.createElement("div");
      form.className = "sa-trust-add";
      form.setAttribute("role", "group");
      form.setAttribute("aria-label", "키 추가");
      const heading = _doc.createElement("h4");
      heading.className = "sa-trust-add-title";
      heading.textContent = "공개키 추가";
      form.appendChild(heading);
      const hint = _doc.createElement("p");
      hint.className = "sa-trust-add-hint";
      hint.textContent =
        "Ed25519 공개키 (DER base64 또는 PEM PUBLIC KEY 블록). " +
        "개인키는 자동으로 거부됩니다.";
      form.appendChild(hint);

      const ta = _doc.createElement("textarea");
      ta.className = "sa-trust-pk-input";
      ta.rows = 4;
      ta.value = trustForm.publicKey;
      ta.setAttribute("aria-label", "공개키 (DER base64)");
      ta.setAttribute("placeholder", "MCowBQYDK2VwAyEA...");
      ta.addEventListener("input", (ev) => {
        trustForm.publicKey = ev && ev.target ? ev.target.value : "";
      });
      form.appendChild(ta);

      const labelInput = _doc.createElement("input");
      labelInput.type = "text";
      labelInput.className = "sa-trust-label-input";
      labelInput.value = trustForm.label;
      labelInput.setAttribute("aria-label", "키 라벨");
      labelInput.setAttribute("placeholder", "라벨 (예: Release 2026 publisher)");
      labelInput.addEventListener("input", (ev) => {
        trustForm.label = ev && ev.target ? ev.target.value : "";
      });
      form.appendChild(labelInput);

      const addBtn = _doc.createElement("button");
      addBtn.type = "button";
      addBtn.className = "sa-trust-btn sa-trust-btn-primary";
      addBtn.textContent = "키 추가";
      if (trustBusy) addBtn.setAttribute("disabled", "disabled");
      addBtn.addEventListener("click", () => addTrustKey());
      form.appendChild(addBtn);

      return form;
    }

    function _renderProfileRow(profile, activeId) {
      const row = _doc.createElement("div");
      row.className = "sa-row" + (profile.id === activeId ? " is-active" : "");

      const head = _doc.createElement("div");
      head.className = "sa-row-head";
      const name = _doc.createElement("span");
      name.className = "sa-row-name";
      name.textContent = profile.label || profile.id;
      head.appendChild(name);
      if (profile.id === activeId) {
        const badge = _doc.createElement("span");
        badge.className = "sa-row-badge is-active";
        badge.textContent = "active";
        head.appendChild(badge);
      }
      row.appendChild(head);

      const meta = _doc.createElement("div");
      meta.className = "sa-row-meta";
      const wsLabel = profile.workspacePath || "—";
      meta.textContent = "id: " + profile.id + " · workspace: " + wsLabel;
      row.appendChild(meta);

      const results = testResults.get(profile.id) || {};
      const resultsLine = _doc.createElement("div");
      resultsLine.className = "sa-row-results";
      resultsLine.textContent =
        _formatTestResult("claude", results.claude)
        + " · "
        + _formatTestResult("codex", results.codex);
      row.appendChild(resultsLine);

      const actions = _doc.createElement("div");
      actions.className = "sa-row-actions";

      function _btn(label, cls, handler) {
        const b = _doc.createElement("button");
        b.type = "button";
        b.className = "sa-btn" + (cls ? " " + cls : "");
        b.textContent = label;
        if (busy) b.disabled = true;
        b.addEventListener("click", () => {
          // Async but not awaited — render handles the busy flag.
          try { handler(); } catch (_) { /* never let one click break others */ }
        });
        return b;
      }

      actions.appendChild(_btn("Test Claude", null, () => testProfile(profile.id, "claude")));
      actions.appendChild(_btn("Test Codex", null, () => testProfile(profile.id, "codex")));
      if (profile.id !== activeId) {
        actions.appendChild(_btn("Switch", "sa-btn-primary", () => switchProfile(profile.id)));
      }
      actions.appendChild(_btn("Delete", "sa-btn-danger", () => deleteProfile(profile.id)));

      row.appendChild(actions);
      return row;
    }

    function render() {
      // Full repaint — the panel is small (typically 1-3 rows) so a
      // diff-render isn't worth the complexity.
      root.innerHTML = "";

      const snap = store.snapshot();
      const acct = snap && snap.accountStatus;
      const activeId = acct && acct.profile ? acct.profile.activeId : null;

      // Header
      const header = _doc.createElement("div");
      header.className = "sa-header";
      const title = _doc.createElement("h2");
      title.className = "sa-title";
      title.textContent = "Accounts";
      header.appendChild(title);
      if (typeof onClose === "function") {
        const closeBtn = _doc.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "sa-close";
        closeBtn.textContent = "닫기";
        closeBtn.setAttribute("aria-label", "Close accounts panel");
        closeBtn.addEventListener("click", () => {
          try { onClose(); } catch (_) { /* never let user callback abort */ }
        });
        header.appendChild(closeBtn);
      }
      root.appendChild(header);

      // List
      const list = _doc.createElement("div");
      list.className = "sa-list";
      if (profiles.length === 0) {
        const empty = _doc.createElement("p");
        empty.className = "sa-empty";
        empty.textContent =
          "No profiles yet. Run `node scripts/setup-wizard.js` to create one.";
        list.appendChild(empty);
      } else {
        for (const p of profiles) {
          list.appendChild(_renderProfileRow(p, activeId));
        }
      }
      root.appendChild(list);

      // Slice TRUST-STORE-0-e: trust-store section (manifest signing keys).
      // Lives between the profiles list and the footer so it visually
      // groups with "things you manage in this modal" but is clearly
      // separate from the profile rows.
      root.appendChild(_renderTrustStoreSection());

      // Footer
      const footer = _doc.createElement("div");
      footer.className = "sa-footer";
      const footerNote = _doc.createElement("p");
      footerNote.className = "sa-footer-note";
      footerNote.textContent =
        "Add a profile via `node scripts/setup-wizard.js`.";
      footer.appendChild(footerNote);
      root.appendChild(footer);

      // Toast
      if (toast) {
        const t = _doc.createElement("div");
        t.className = "sa-toast";
        t.setAttribute("role", "status");
        t.textContent = toast;
        root.appendChild(t);
      }
    }

    // Initial paint + subscribe + first refresh.
    render();
    const off = store.subscribe(render);
    refresh();
    // Slice TRUST-STORE-0-e: separate trust-store fetch on mount.
    // Tolerant of 503 (not wired) — render proceeds in standard mode
    // with an empty list. Resolves before tests assert on _state().
    refreshTrust();

    return {
      destroy() {
        try { off(); } catch (_) {}
        if (_clearTimeout && toastTimer) {
          try { _clearTimeout(toastTimer); } catch (_) {}
          toastTimer = null;
        }
        root.innerHTML = "";
      },
      refresh,
      refreshTrust,
      // Action invokers exposed so the layout (or tests) can drive
      // them without simulating clicks.
      testProfile,
      switchProfile,
      deleteProfile,
      // Slice TRUST-STORE-0-e: trust-store actions.
      addTrustKey,
      updateTrustKeyLabel,
      deleteTrustKey,
      confirmDeleteTrustKey,
      // Test hooks — internal state inspection.
      _state() {
        return {
          profiles: profiles.slice(),
          testResults: new Map(testResults),
          busy,
          toast,
          // Trust-store sub-state for UI tests.
          trustKeys: trustKeys.slice(),
          trustPosture,
          trustBusy,
          trustError,
          trustForm: { ...trustForm },
          trustEditing: trustEditing ? { ...trustEditing } : null,
          trustConfirm: trustConfirm ? { ...trustConfirm } : null,
        };
      },
    };
  }

  return { create, _formatTestResult, _formatTrustStoreError, TOAST_TTL_MS };
});
