// Pipeline run & watcher routes
const { Router } = require("express");
const path = require("path");

function createPipelineRoutes({
  broadcast,
  REPO_ROOT,
  resolveInsideRoot,
  runGeneralPipeline,
  generalRunRef,
  validateGeneralRun,
  sessionWatcher,
  skillRegistry,
}) {
  const router = Router();

  // Legacy demo pipeline removed — return 410 Gone with migration info
  router.post("/run", (_req, res) => {
    res.status(410).json({
      error: "이 엔드포인트는 제거되었습니다. Hook-driven 파이프라인 또는 /api/pipeline/general-run을 사용하세요.",
      migration: "/api/pipeline/general-run",
    });
  });

  // General-run orchestration
  router.post("/pipeline/general-run", async (req, res) => {
    // AGENT-DESKTOP-0-diag2 (2026-05-06): server-side breadcrumb so the
    // bat console window shows the request flow when "modal closed but
    // server silent" surfaces. Visible via the launcher's stdout.
    console.log(`[pipeline-route] POST /api/pipeline/general-run received bodyTaskLen=${(req.body && typeof req.body.task === "string" ? req.body.task.length : 0)} maxIter=${(req.body && req.body.maxIterations) || "?"}`);
    let parsed;
    try {
      parsed = validateGeneralRun(req.body);
    } catch (err) {
      console.log(`[pipeline-route] validation FAILED status=${err.status || 400} message="${err.message}"`);
      return res.status(err.status || 400).json({ error: err.message });
    }
    const { task, maxIterations } = parsed;
    if (generalRunRef.active) {
      console.log(`[pipeline-route] LOCK CONFLICT — generalRunRef.active=${JSON.stringify(generalRunRef.active)}`);
      return res.status(409).json({ error: "another general-run pipeline is already active" });
    }

    const maxIter = maxIterations;
    const runId = `gr-${Date.now()}`;
    generalRunRef.active = { runId, startedAt: Date.now(), aborted: false };

    console.log(`[pipeline-route] kicking off runGeneralPipeline runId=${runId} taskLen=${task.length} maxIter=${maxIter}`);
    res.json({ status: "started", runId, task, maxIterations: maxIter });

    runGeneralPipeline(task.trim(), maxIter, runId).catch((err) => {
      console.error(`[pipeline-route] runGeneralPipeline THREW runId=${runId} err=${err && err.message ? err.message : err}`);
      broadcast({ type: "error", data: { phase: "general", node: "orchestrator", message: err.message } });
    }).finally(() => {
      console.log(`[pipeline-route] runGeneralPipeline finally clear lock runId=${runId} elapsedMs=${Date.now() - generalRunRef.active.startedAt}`);
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
