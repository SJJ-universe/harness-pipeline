const express = require("express");
const { securityHeaders } = require("../security/auth");

function createApp({ staticDir, jsonLimit = "256kb" } = {}) {
  const app = express();
  app.use(securityHeaders);
  if (staticDir) app.use(express.static(staticDir));
  app.use(express.json({ limit: jsonLimit }));
  return app;
}

module.exports = { createApp };
