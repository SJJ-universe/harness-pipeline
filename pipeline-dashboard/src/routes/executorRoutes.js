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

  return router;
}

module.exports = { createExecutorRoutes };
