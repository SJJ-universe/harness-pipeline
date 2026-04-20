const express = require("express");
const { securityHeaders } = require("../security/auth");

/**
 * @param {object} options
 * @param {string} [options.staticDir]      Directory to serve static files from.
 * @param {string} [options.jsonLimit]      express.json body size limit (default 256kb).
 * @param {Function} [options.indexRenderer] Slice J (v5): route handler to take
 *     over `GET /` so the server can inject a per-request CSP nonce into
 *     index.html. When provided, static is mounted with `{ index: false }`
 *     so it does NOT auto-serve index.html (the renderer wins).
 */
function createApp({ staticDir, jsonLimit = "256kb", indexRenderer } = {}) {
  const app = express();
  app.use(securityHeaders);
  // Slice J (v5): indexRenderer (if provided) must be registered BEFORE
  // express.static so `/` is served by our nonce-injecting handler, not by
  // the static middleware's automatic index.html lookup.
  if (typeof indexRenderer === "function") {
    app.get("/", indexRenderer);
  }
  if (staticDir) {
    app.use(express.static(staticDir, { index: indexRenderer ? false : "index.html" }));
  }
  app.use(express.json({ limit: jsonLimit }));
  return app;
}

module.exports = { createApp };
