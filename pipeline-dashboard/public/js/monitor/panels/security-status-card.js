// Slice UI-H5 (Phase D / Phase E1.5, 2026-04-30) — security-status card.
//
// Operator-facing card that summarizes the public-sector defense
// stack at a glance:
//
//   Posture  — Standard | Public-sector
//   Sandbox  — required vs. allowed (GOV-SB-0)
//   PII gate — inline scan active (GOV-PII-0)
//   File scan — deep scan endpoint available (GOV-PII-1)
//   Approval — pending count (R3-e + GOV-APPROVAL-0)
//
// Reads from store.snapshot:
//   accountStatus.deployment.{publicSector, requireSandboxWorkspace,
//                              requirePiiScan, allowLocalExecutor,
//                              allowPlaintextSecrets}
//   pendingApprovals.length
//
// Mounted in BOTH simple AND advanced modes; on simple it's a
// first-class card on the dashboard, on advanced it sits next to
// the orchestrator-track for at-a-glance posture confirmation.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorSecurityStatusCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("security-status-card.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("security-status-card.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("security-status-card.create: no document available");
    }

    let unsubscribe = null;
    let destroyed = false;

    function _readDeployment(snap) {
      const ac = snap && snap.accountStatus;
      const dep = ac && ac.deployment;
      // Stable shape — every field defaults explicitly so the card
      // has something to render even when the bridge hasn't fetched
      // /api/server/info yet.
      return {
        mode:                    dep && dep.mode || "standard",
        publicSector:            !!(dep && dep.publicSector),
        allowLocalExecutor:      !dep || dep.allowLocalExecutor !== false,
        allowPlaintextSecrets:   !!(dep && dep.allowPlaintextSecrets),
        requireSandboxWorkspace: !!(dep && dep.requireSandboxWorkspace),
        requirePiiScan:          !!(dep && dep.requirePiiScan),
      };
    }

    function _readApprovalCount(snap) {
      return Array.isArray(snap && snap.pendingApprovals)
        ? snap.pendingApprovals.length : 0;
    }

    function _row(label, value, tone) {
      const r = _doc.createElement("div");
      r.className = "ssc-row" + (tone ? " ssc-tone-" + tone : "");
      const k = _doc.createElement("span");
      k.className = "ssc-row-label";
      k.textContent = label;
      const v = _doc.createElement("span");
      v.className = "ssc-row-value";
      v.textContent = value;
      r.appendChild(k);
      r.appendChild(v);
      return r;
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const dep = _readDeployment(snap);
      const pending = _readApprovalCount(snap);

      root.innerHTML = "";
      root.classList.add("security-status-card");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Security status");
      root.setAttribute("data-posture", dep.publicSector ? "public-sector" : "standard");

      // Header — posture badge
      const header = _doc.createElement("header");
      header.className = "ssc-header";
      const title = _doc.createElement("span");
      title.className = "ssc-title";
      title.textContent = "보안 / 개인정보 상태";
      header.appendChild(title);
      const badge = _doc.createElement("span");
      badge.className = "ssc-posture-badge ssc-tone-"
        + (dep.publicSector ? "error" : "ok");
      badge.textContent = dep.publicSector ? "공공기관 모드" : "표준 모드";
      header.appendChild(badge);
      root.appendChild(header);

      // Rows
      const rows = _doc.createElement("div");
      rows.className = "ssc-rows";

      // Sandbox required
      rows.appendChild(_row(
        "샌드박스 워크스페이스",
        dep.requireSandboxWorkspace ? "필수 (GOV-SB-0)" : "선택",
        dep.requireSandboxWorkspace ? "info" : "neutral",
      ));

      // PII inline gate
      rows.appendChild(_row(
        "PII 인라인 스캔",
        dep.requirePiiScan ? "활성 (GOV-PII-0)" : "관찰 모드",
        dep.requirePiiScan ? "info" : "neutral",
      ));

      // PII deep file-import scan endpoint
      rows.appendChild(_row(
        "파일 PII 스캔",
        "/api/security/scan (GOV-PII-1)",
        "info",
      ));

      // Local executor
      rows.appendChild(_row(
        "로컬 실행기",
        dep.allowLocalExecutor ? "허용" : "차단",
        dep.allowLocalExecutor ? "neutral" : "warn",
      ));

      // Plaintext secrets
      rows.appendChild(_row(
        "평문 시크릿",
        dep.allowPlaintextSecrets ? "허용 (개발용)" : "차단",
        dep.allowPlaintextSecrets ? "warn" : "neutral",
      ));

      // Pending approvals
      rows.appendChild(_row(
        "승인 대기",
        pending === 0 ? "없음" : `${pending}건`,
        pending > 0 ? "warn" : "neutral",
      ));

      root.appendChild(rows);

      // Footer — operator-friendly hint
      const footer = _doc.createElement("div");
      footer.className = "ssc-footer";
      footer.textContent = dep.publicSector
        ? "공공기관 모드: Bash/Edit/Write는 승인 카드를 거쳐야 실행됩니다."
        : "표준 모드: 모든 도구가 정상 작동합니다.";
      root.appendChild(footer);
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.removeAttribute("data-posture");
        root.classList.remove("security-status-card");
      },
      _render: render,
    };
  }

  return { create };
});
