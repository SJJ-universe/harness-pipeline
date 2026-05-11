// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — "Claude / Codex 연결 상태" card.
//
// Simple-mode card showing the active profile + Claude/Codex CLI
// readiness + bridge mode + remote runner count. Reads
// snapshot.accountStatus.{profile, deployment, bridge, remote}.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorConnectionStatusCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function create({ root, store, doc, onOpenSettings } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("connection-status-card.create: root must be an element");
    }
    if (!store) throw new Error("connection-status-card.create: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("connection-status-card.create: no document available");

    let unsubscribe = null;
    let destroyed = false;

    function _pill(label, value, tone) {
      const wrap = _doc.createElement("div");
      wrap.className = "csc-pill csc-tone-" + (tone || "neutral");
      const k = _doc.createElement("span");
      k.className = "csc-pill-label";
      k.textContent = label;
      const v = _doc.createElement("span");
      v.className = "csc-pill-value";
      v.textContent = value;
      wrap.appendChild(k);
      wrap.appendChild(v);
      return wrap;
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const ac = snap.accountStatus || {};
      const profile = ac.profile || {};
      const bridge = ac.bridge || {};
      const remote = ac.remote || {};

      root.innerHTML = "";
      root.classList.add("csc-card");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Claude / Codex 연결 상태");

      const title = _doc.createElement("h3");
      title.className = "csc-title";
      title.textContent = "연결 상태";
      root.appendChild(title);

      const grid = _doc.createElement("div");
      grid.className = "csc-grid";

      // Profile
      const profileLabel = profile.activeLabel || profile.activeId || "(설정 필요)";
      const profileTone = profile.activeId ? "ok" : "warn";
      grid.appendChild(_pill("프로필", profileLabel, profileTone));

      // Bridge mode
      const bridgeMode = bridge.mode || "off";
      const bridgeTone = bridgeMode === "dispatch" ? "warn" : "neutral";
      grid.appendChild(_pill("브리지", bridgeMode, bridgeTone));

      // Remote runners
      const remoteMode = remote.mode || "off";
      const runnerCount = typeof remote.activeRunnerCount === "number"
        ? remote.activeRunnerCount : 0;
      const remoteValue = remoteMode === "off"
        ? "off"
        : `${remoteMode} · ${runnerCount} runner${runnerCount === 1 ? "" : "s"}`;
      const remoteTone = runnerCount > 0 ? "info" : "neutral";
      grid.appendChild(_pill("원격", remoteValue, remoteTone));

      root.appendChild(grid);

      // Action: open settings to manage profile / test CLI.
      if (typeof onOpenSettings === "function") {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "csc-action";
        btn.textContent = "계정 설정 →";
        btn.addEventListener("click", () => {
          try { onOpenSettings(); } catch (_) { /* defensive */ }
        });
        root.appendChild(btn);
      }
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") unsubscribe();
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("csc-card");
      },
      _render: render,
    };
  }

  return { create };
});
