// Health & basic info routes
const { Router } = require("express");

function createHealthRoutes({ pty }) {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), terminal: !!pty });
  });

  return router;
}

module.exports = { createHealthRoutes };
