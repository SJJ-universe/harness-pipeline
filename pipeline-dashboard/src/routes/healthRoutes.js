// Health & basic info routes
const { Router } = require("express");

// Slice D0-e (Phase E1, 2026-04-29): the launcher discriminator.
//
// `app` distinguishes "OrchestratorPipeline is running here" from "some
// unrelated service squatted port 4201 first" — without it, an unrelated
// HTTP server returning {status:"ok"} would let harness-start.bat /
// .sh skip the startup ("already running, opening browser") and leave
// the operator clicking through to a stranger's app.
//
// `healthVersion` lets future schema bumps to the response body roll
// out without breaking the launcher's verification (the launcher only
// requires `app === "OrchestratorPipeline"`; it ignores other fields).
//
// Don't change these two field shapes lightly — they are part of the
// launcher's verification contract:
const HEALTH_APP_NAME = "OrchestratorPipeline";
const HEALTH_VERSION = 1;

function createHealthRoutes({ pty }) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      app: HEALTH_APP_NAME,
      healthVersion: HEALTH_VERSION,
      uptime: process.uptime(),
      terminal: !!pty,
    });
  });

  return router;
}

module.exports = { createHealthRoutes, HEALTH_APP_NAME, HEALTH_VERSION };
