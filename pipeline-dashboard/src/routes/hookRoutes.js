// Hook router API routes
const { Router } = require("express");

function createHookRoutes({ hookRouter, validateHook }) {
  const router = Router();

  router.post("/hook", async (req, res) => {
    // Separate validation errors (4xx) from runtime routing errors (200 {})
    let event, payload;
    try {
      ({ event, payload } = validateHook(req.body));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    try {
      const decision = await hookRouter.route(event, payload || {});
      res.json(decision || {});
    } catch (err) {
      // Never block Claude on harness routing errors
      console.error("[HookRouter] error:", err.message);
      res.json({});
    }
  });

  router.get("/hook/stats", (req, res) => {
    res.json(hookRouter.getStats());
  });

  return router;
}

module.exports = { createHookRoutes };
