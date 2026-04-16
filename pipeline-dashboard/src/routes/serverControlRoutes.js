// Server control routes (shutdown, restart, info)
const { Router } = require("express");

function createServerControlRoutes({ broadcast, clients, gracefulShutdown, server, CLIENT_GRACE_MS, shutdownTimerRef }) {
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
    res.json({
      pid: process.pid,
      supervised: !!process.send,
      clients: clients.size,
      uptime: process.uptime(),
      graceMs: CLIENT_GRACE_MS,
      shutdownArmed: !!(shutdownTimerRef && shutdownTimerRef.timer),
    });
  });

  return router;
}

module.exports = { createServerControlRoutes };
