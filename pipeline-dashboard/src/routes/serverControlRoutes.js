// Server control routes (shutdown, restart, info)
const { Router } = require("express");

function createServerControlRoutes({
  broadcast,
  clients,
  gracefulShutdown,
  server,
  CLIENT_GRACE_MS,
  shutdownTimerRef,
  // Slice MA0 (Phase D, 2026-04-27): childRegistry exposes the live
  // snapshot of every spawned Codex/Claude child so /api/server/info
  // can surface S3-a's lifecycle work to operators. Optional for
  // backward-compat with legacy bare instantiation.
  childRegistry = null,
  // Slice R2.5-e (Phase D R2.5, 2026-04-28): hookRouter exposes
  // remote-hook dispatch counters via getStats() so operators can
  // observe bridge throughput at a glance. Optional.
  hookRouter = null,
  // Slice D3-a (Phase E1.5, 2026-04-29): account / deployment / bridge
  // / remote summaries for the monitor shell's account-status cells.
  // Each dep is optional — missing deps surface a stable null /
  // safe-default field so the UI can rely on the response shape.
  //
  //   profileStore       — D1-b. Used for activeId / activeLabel / count.
  //   credentialStore    — D1-a. Used for credentialBackend.
  //   deploymentProfile  — D1-gov-1 resolveDeploymentProfile() result.
  //                        Frozen object with mode + flag posture.
  //   runnerRegistry     — R3-c. Used for activeRunnerCount.
  //   bridgeMode         — R2.5 HARNESS_REMOTE_BRIDGE_MODE current value
  //                        ("off" | "report" | "dispatch"). String only —
  //                        the route doesn't re-resolve env per request.
  //   remoteMode         — R1 HARNESS_REMOTE_MODE current value
  //                        ("off" | "preview" | "on"). Same string-only
  //                        contract as bridgeMode.
  //
  // The new payload fields are ADDITIVE — existing consumers that
  // didn't read profile / deployment / bridge / remote keep working.
  profileStore = null,
  credentialStore = null,
  deploymentProfile = null,
  runnerRegistry = null,
  bridgeMode = null,
  remoteMode = null,
}) {
  const router = Router();

  router.post("/server/shutdown", (req, res) => {
    res.json({ status: "shutting-down" });
    setTimeout(() => gracefulShutdown("api-shutdown"), 100);
  });

  router.post("/server/restart", (req, res) => {
    if (!process.send) {
      res.status(409).json({ error: "not supervised — run via start.js for restart support" });
      return;
    }
    res.json({ status: "restarting" });
    setTimeout(() => {
      try { broadcast({ type: "server_restart", data: {} }); } catch (_) {}
      try { process.send({ type: "restart" }); } catch (_) {}
      try { server.close(); } catch (_) {}
      setTimeout(() => process.exit(0), 300);
    }, 100);
  });

  router.get("/server/info", (req, res) => {
    // Slice MA0: snapshot is read-only; missing registry → empty array
    // so the field is always present (UI can rely on its shape).
    let activeChildren = [];
    let activeChildCount = 0;
    if (childRegistry && typeof childRegistry.snapshot === "function") {
      try {
        activeChildren = childRegistry.snapshot();
        activeChildCount = childRegistry.size ? childRegistry.size() : activeChildren.length;
      } catch (_) {
        // never let an observability path break the info endpoint
        activeChildren = [];
        activeChildCount = 0;
      }
    }
    // Slice R2.5-e: hookRouter stats — never let an observability
    // path break the info endpoint.
    let hookStats = {};
    if (hookRouter && typeof hookRouter.getStats === "function") {
      try { hookStats = hookRouter.getStats() || {}; }
      catch (_) { hookStats = {}; }
    }
    // Slice D3-a: account-status summaries. Each block individually
    // try/catches so a single misbehaving dep can't break the entire
    // info endpoint.
    const profile = _summarizeProfile({ profileStore, credentialStore });
    const deployment = _summarizeDeployment(deploymentProfile);
    const bridge = _summarizeBridge(bridgeMode);
    const remote = _summarizeRemote({ runnerRegistry, remoteMode });

    res.json({
      pid: process.pid,
      supervised: !!process.send,
      clients: clients.size,
      uptime: process.uptime(),
      graceMs: CLIENT_GRACE_MS,
      shutdownArmed: !!(shutdownTimerRef && shutdownTimerRef.timer),
      // Slice MA0: child observability — surfaces S3-a's lifecycle data.
      // shape: [{ pid, label, runId, ageMs }] (see src/runtime/childRegistry.js).
      activeChildren,
      activeChildCount,
      // Slice R2.5-e: bridge dispatch counters. Operators can grep this
      // alongside the audit chain to verify the bridge is doing what
      // they think it's doing. Shape:
      //   { total, byEvent: {...}, remoteHooks, remoteHookSanitized,
      //     remoteHookRejected, remoteHookDispatched, remoteHookDispatchError }
      hookStats,
      // Slice D3-a: account-status summaries (additive). Shapes are
      // stable so the monitor's global-bar can rely on them without
      // null-checks past the top-level field.
      profile,
      deployment,
      bridge,
      remote,
      // Slice UI-H1 (Phase D / E1.5, 2026-04-30): monitor shell mode
      // default. Read from HARNESS_MONITOR_MODE env at request time.
      // Resolution priority on the client:
      //   URL ?mode= > localStorage > envDefault (this) > "simple"
      // Operators set this in the deployment env (e.g.,
      // public-sector-secure deployments may want HARNESS_MONITOR_MODE=
      // simple as default; power-user dev boxes may set "advanced").
      monitor: _summarizeMonitor(),
    });
  });

  return router;
}

// ── Slice D3-a helpers ─────────────────────────────────────────
//
// Each summarizer returns a STABLE-SHAPE object even when the dep is
// missing. The monitor shell can render `body.profile.count` without
// having to defensively check `body.profile != null` first.

// Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30): monitor shell mode
// default. Reads HARNESS_MONITOR_MODE env at request time and returns
// a normalized value. Garbage values fall through to "simple" (the
// operator-friendly default per docs/ui-h-redesign-plan.md §2.2).
function _summarizeMonitor() {
  const VALID = ["simple", "advanced", "legacy"];
  const raw = String(process.env.HARNESS_MONITOR_MODE || "").trim().toLowerCase();
  const envDefault = VALID.includes(raw) ? raw : "simple";
  return { envDefault };
}

function _summarizeProfile({ profileStore, credentialStore }) {
  const out = {
    activeId: null,
    activeLabel: null,
    count: 0,
    credentialBackend: null,
  };
  if (profileStore && typeof profileStore.list === "function") {
    try {
      const list = profileStore.list();
      out.count = Array.isArray(list) ? list.length : 0;
    } catch (_) { /* keep defaults */ }
  }
  if (profileStore && typeof profileStore.getActive === "function") {
    try {
      const active = profileStore.getActive();
      if (active && typeof active === "object") {
        out.activeId = active.id || null;
        out.activeLabel = active.label || null;
      }
    } catch (_) { /* keep defaults */ }
  }
  if (credentialStore && credentialStore.backend) {
    out.credentialBackend = credentialStore.backend;
  }
  return out;
}

function _summarizeDeployment(deploymentProfile) {
  // Always return a stable shape so the UI doesn't have to handle
  // "is the field missing" vs "is the value falsy". When the dep
  // is null we return safe defaults that mean "treat as standard
  // mode, all fail-closed flags off" — this matches what the rest
  // of the harness behaves like before D1-gov-1 wired in.
  if (!deploymentProfile) {
    return {
      mode: "standard",
      publicSector: false,
      allowLocalExecutor: true,
      allowPlaintextSecrets: false,
      requireSandboxWorkspace: false,
      requirePiiScan: false,
    };
  }
  return {
    mode: deploymentProfile.mode || "standard",
    publicSector: !!deploymentProfile.publicSector,
    allowLocalExecutor: deploymentProfile.allowLocalExecutor !== false,
    allowPlaintextSecrets: !!deploymentProfile.allowPlaintextSecrets,
    requireSandboxWorkspace: !!deploymentProfile.requireSandboxWorkspace,
    requirePiiScan: !!deploymentProfile.requirePiiScanBeforeProviderDispatch,
  };
}

function _summarizeBridge(bridgeMode) {
  // Mirrors HARNESS_REMOTE_BRIDGE_MODE values: off / report / dispatch.
  // Anything unrecognized degrades to "off" so the UI shows safe
  // default rather than mystery-state.
  const allowed = new Set(["off", "report", "dispatch"]);
  const mode = typeof bridgeMode === "string" && allowed.has(bridgeMode)
    ? bridgeMode
    : "off";
  return { mode };
}

function _summarizeRemote({ runnerRegistry, remoteMode }) {
  const allowed = new Set(["off", "preview", "on"]);
  const mode = typeof remoteMode === "string" && allowed.has(remoteMode)
    ? remoteMode
    : "off";
  let activeRunnerCount = 0;
  if (runnerRegistry && typeof runnerRegistry.list === "function") {
    try {
      const list = runnerRegistry.list();
      activeRunnerCount = Array.isArray(list) ? list.length : 0;
    } catch (_) { /* keep 0 */ }
  }
  return { mode, activeRunnerCount };
}

module.exports = {
  createServerControlRoutes,
  // Helpers exposed for unit tests
  _summarizeProfile,
  _summarizeDeployment,
  _summarizeMonitor,
  _summarizeBridge,
  _summarizeRemote,
};
