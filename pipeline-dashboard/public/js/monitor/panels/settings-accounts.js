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
      // Action invokers exposed so the layout (or tests) can drive
      // them without simulating clicks.
      testProfile,
      switchProfile,
      deleteProfile,
      // Test hooks — internal state inspection.
      _state() {
        return {
          profiles: profiles.slice(),
          testResults: new Map(testResults),
          busy,
          toast,
        };
      },
    };
  }

  return { create, _formatTestResult, TOAST_TTL_MS };
});
