// Executor mode control routes
const { Router } = require("express");

function createExecutorRoutes({ pipelineExecutor, validateExecutorMode }) {
  const router = Router();

  router.get("/executor/mode", (req, res) => {
    res.json(pipelineExecutor.getStatus());
  });

  router.post("/executor/mode", (req, res) => {
    let parsed;
    try {
      parsed = validateExecutorMode(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const { enabled } = parsed;
    pipelineExecutor.setEnabled(!!enabled);
    res.json(pipelineExecutor.getStatus());
  });

  router.post("/executor/reset", (_req, res) => {
    if (typeof pipelineExecutor.resetActive !== "function") {
      return res.status(501).json({ error: "executor reset is unavailable" });
    }
    res.json(pipelineExecutor.resetActive("manual-reset"));
  });

  return router;
}

module.exports = { createExecutorRoutes };
