// Event ingestion & reset routes
const { Router } = require("express");

function createEventRoutes({ broadcast, validateEvent, tokenUsageRef }) {
  const router = Router();

  router.post("/event", (req, res) => {
    let event;
    try {
      event = validateEvent(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    broadcast(event);
    res.json({ status: "received", type: event.type });
  });

  router.post("/reset", (req, res) => {
    tokenUsageRef.claude = 0;
    tokenUsageRef.codex = 0;
    broadcast({ type: "pipeline_reset", data: {} });
    res.json({ status: "reset" });
  });

  return router;
}

module.exports = { createEventRoutes };
