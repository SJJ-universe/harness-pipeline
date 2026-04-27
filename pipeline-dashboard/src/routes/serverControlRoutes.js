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
    });
  });

  return router;
}

module.exports = { createServerControlRoutes };
