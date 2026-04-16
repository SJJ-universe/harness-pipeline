// Pipeline run & watcher routes
const { Router } = require("express");
const path = require("path");

function createPipelineRoutes({
  broadcast,
  REPO_ROOT,
  resolveInsideRoot,
  runPipeline,
  runGeneralPipeline,
  generalRunRef,
  validateGeneralRun,
  sessionWatcher,
  skillRegistry,
}) {
  const router = Router();

  // Legacy demo pipeline (deprecated — uses execSync, not policy-checked)
  router.post("/run", (req, res) => {
    const { targetFile, mode } = req.body;
    let file;
    try {
      file = targetFile
        ? resolveInsideRoot(targetFile, REPO_ROOT, { purpose: "targetFile" })
        : path.join(REPO_ROOT, "test-sample", "server.js");
    } catch (err) {
      return res.status(err.code === "PATH_OUTSIDE_ROOT" ? 403 : 400).json({ error: err.message });
    }
    res.json({ status: "started", targetFile: file, mode: mode || "demo" });
    runPipeline(file, mode || "demo");
  });

  // General-run orchestration
  router.post("/pipeline/general-run", async (req, res) => {
    let parsed;
    try {
      parsed = validateGeneralRun(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const { task, maxIterations } = parsed;
    if (generalRunRef.active) {
      return res.status(409).json({ error: "another general-run pipeline is already active" });
    }

    const maxIter = maxIterations;
    const runId = `gr-${Date.now()}`;
    generalRunRef.active = { runId, startedAt: Date.now(), aborted: false };

    res.json({ status: "started", runId, task, maxIterations: maxIter });

    runGeneralPipeline(task.trim(), maxIter, runId).catch((err) => {
      broadcast({ type: "error", data: { phase: "general", node: "orchestrator", message: err.message } });
    }).finally(() => {
      generalRunRef.active = null;
    });
  });

  router.post("/pipeline/general-abort", (req, res) => {
    if (!generalRunRef.active) return res.json({ status: "no-active-run" });
    generalRunRef.active.aborted = true;
    res.json({ status: "abort-requested", runId: generalRunRef.active.runId });
  });

  // Session watcher
  router.get("/watcher/status", (req, res) => {
    res.json(sessionWatcher.getStatus());
  });

  router.post("/watcher/complete", (req, res) => {
    sessionWatcher.completePipeline();
    res.json({ status: "completed" });
  });

  // Skill registry
  const { scanSkills, getSkillsByCategory, getSkillsForHarness, getSkillContent, searchSkills } = skillRegistry;

  router.get("/skills", (req, res) => {
    if (req.query.category === "grouped") {
      res.json(getSkillsByCategory());
    } else if (req.query.q) {
      res.json(searchSkills(req.query.q));
    } else {
      res.json(scanSkills());
    }
  });

  router.get("/skills/:id", (req, res) => {
    const content = getSkillContent(req.params.id);
    if (content) {
      res.json({ id: req.params.id, content });
    } else {
      res.status(404).json({ error: "Skill not found" });
    }
  });

  router.get("/skills/harness/:type", (req, res) => {
    res.json(getSkillsForHarness(req.params.type));
  });

  return router;
}

module.exports = { createPipelineRoutes };
