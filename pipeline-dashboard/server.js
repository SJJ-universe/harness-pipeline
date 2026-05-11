// ORCHESTRATOR-RENAME-1 (2026-05-08): apply HARNESS_* → ORCHESTRATOR_*
// env aliases as the very first thing the process does, BEFORE any
// module reads process.env.ORCHESTRATOR_*. Without this, modules
// loaded by the requires below would see ORCHESTRATOR_TOKEN as
// undefined even though the operator's .env still uses ORCHESTRATOR_TOKEN.
require("./src/runtime/envAlias").applyEnvAliases({
  log: (msg) => { try { console.warn(msg); } catch (_) {} },
});

const { WebSocketServer } = require("ws");
const http = require("http");
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
// Slice J (v5): per-request CSP nonce + inline report endpoint.
const crypto = require("crypto");
const express = require("express");

// node-pty (optional — graceful fallback if not installed)
let pty = null;
try {
  pty = require("node-pty");
} catch (e) {
  console.warn("node-pty not available — terminal feature disabled. Run: npm install node-pty");
}

// New modules
const { scanSkills, getSkillsByCategory, getSkillsForHarness, getSkillContent, searchSkills } = require("./skill-registry");
const { discoverContextFiles, loadFileContent } = require("./context-loader");
const { getTriggers, getTriggerById } = require("./codex-triggers");
const { SessionWatcher } = require("./session-watcher");
const { HookRouter } = require("./executor/hook-router");
const { PipelineExecutor } = require("./executor/pipeline-executor");
const { CodexRunner } = require("./executor/codex-runner");
const { ClaudeRunner } = require("./executor/claude-runner");
const { PipelineState } = require("./executor/pipeline-state");
const { QualityGate } = require("./executor/quality-gate");
const { SkillInjector } = require("./executor/skill-injector");
const { PipelineAdapter } = require("./executor/pipeline-adapter");
const { createCheckpointStore } = require("./executor/checkpoint");
// MB4-d: createEventReplayBuffer is now owned by createEventBroadcaster
// (src/server/eventBroadcaster.js). Server.js still uses
// eventReplayBuffer through the broadcaster's exposed reference.
const { createHeartbeat } = require("./executor/heartbeat");
const skillRegistry = require("./skill-registry");
const builtInTemplates = require("./pipeline-templates.json");
// Slice E (v4): user-uploaded "custom-*" templates live in .harness/templates.json
// and get merged in at startup + after each successful upsert/delete.
const { createTemplateStore } = require("./src/templates/templateStore");
const { createAuthMiddleware, isLoopbackAddress, isLoopbackHost } = require("./src/security/auth");
const { resolveInsideRoot } = require("./src/security/pathSandbox");
// Slice P0 (Phase E, 2026-04-28): unified env filter for child-process spawns.
// Used by PTY (allowKeys: ["ORCHESTRATOR_TOKEN"]) and indirectly by claude-runner /
// codex-runner (no allowKeys — ORCHESTRATOR_TOKEN blocked from agent children).
const { filterSensitiveEnv } = require("./src/security/envFilter");
const {
  validateCodexTrigger,
  validateContextDiscover,
  validateContextLoad,
  validateEvent,
  validateExecutorMode,
  validateGeneralRun,
  validateHook,
} = require("./src/security/requestSchemas");
const { createVersionInfo } = require("./src/runtime/version");
const { RunRegistry } = require("./src/runtime/runRegistry");
const { EvidenceLedger } = require("./src/runtime/evidenceLedger");
const { createApp } = require("./src/server/createApp");
// Slice R1-h (Phase D R1, 2026-04-28): bring up the remote-runner subsystem
// (RunnerRegistry + JWT key + ledger signing key) from ORCHESTRATOR_REMOTE_MODE
// + ORCHESTRATOR_TOKEN. Returns null/disabled shape when mode="off" (default).
const { setupRemoteRunner } = require("./src/server/remoteRunnerSetup");

const APP_ROOT = __dirname;
const REPO_ROOT = path.resolve(__dirname, "..");
const BOOT_TIME = new Date().toISOString();
const ALLOW_REMOTE = process.env.ORCHESTRATOR_ALLOW_REMOTE === "1";
const HOST = process.env.HOST || process.env.ORCHESTRATOR_HOST || (ALLOW_REMOTE ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT || process.env.ORCHESTRATOR_PORT || 4201);
const MODE = ALLOW_REMOTE ? "remote" : "local";
const auth = createAuthMiddleware({ repoRoot: REPO_ROOT, host: HOST, allowRemote: ALLOW_REMOTE });
const runsDir = path.join(REPO_ROOT, "runs");
const runRegistry = new RunRegistry({ rootDir: runsDir });
// Slice R1-h: derive ORCHESTRATOR_REMOTE_MODE + the two HKDF keys *before* the
// evidence ledger is constructed so the ledger can be configured with its
// signing key in one go (instead of mutating a half-built instance).
const _remoteRunner = setupRemoteRunner();
if (_remoteRunner.mode !== "off" && _remoteRunner.error === "token_missing") {
  console.warn(
    "[remote-runner] ORCHESTRATOR_REMOTE_MODE=" + _remoteRunner.mode +
    " but ORCHESTRATOR_TOKEN is missing — runner routes will 503.",
  );
}
// Slice D1-f (Phase E1, 2026-04-29): defense-in-depth sanitizer that
// runs every audit `data` payload through a TOKEN/SECRET/KEY/PASSWORD/
// CREDENTIAL key-name redactor before it lands on disk. The audit
// verbs added in D1-a..e are constructed to NEVER include secret
// values, but the sanitizer catches a future verb that forgets the
// discipline (or a hook payload with a pathological field name).
// SAFE_KEY_NAMES allowlist preserves legitimate audit metadata
// (secretCount, secretsInjected, secretIds, key — name not value).
const { sanitizeAuditData } = require("./src/security/auditSanitizer");
// Slice D3-a (Phase E1.5, 2026-04-29): resolve the deployment profile
// once at boot so the /api/server/info account-status block can echo
// it without re-resolving env per request. Frozen — every consumer
// downstream (runners + profileSpawn) re-resolves at use-time, but
// the operator-visible posture in the UI shouldn't flicker between
// requests.
const {
  resolveDeploymentProfile,
  POLICY_PACK_UNKNOWN_CODE,
} = require("./src/policy/deploymentProfile");

// Slice S5-c (Phase 2 / SMART-5, 2026-05-05): production fail-closed
// boot when ORCHESTRATOR_DEPLOYMENT_PROFILE points at an unrecognized pack.
// Plan §S §S-SMART-5 v2 invariant: an operator typo (e.g. "publicsector"
// vs. "public-sector") MUST surface at boot rather than silently
// downgrade posture. Operators in dev/migration windows opt into the
// legacy fall-back-to-standard behavior with ORCHESTRATOR_POLICY_FAIL_OPEN=1
// (handled inside resolveDeploymentProfile; this block only catches
// the throw).
let _deploymentProfile;
try {
  _deploymentProfile = resolveDeploymentProfile();
} catch (err) {
  if (err && err.code === POLICY_PACK_UNKNOWN_CODE) {
    // No audit emit here — evidenceLedger isn't constructed yet, and
    // the process is about to exit. The error message goes to stderr
    // so the operator sees it in launcher logs / docker logs.
    process.stderr.write(
      `[orchestrator] FATAL: ${err.message}\n` +
      `[orchestrator] Set ORCHESTRATOR_POLICY_FAIL_OPEN=1 to fall back to standard with a warning.\n`,
    );
    process.exit(1);
  }
  throw err;
}

const evidenceLedger = new EvidenceLedger({
  rootDir: runsDir,
  // R1-c + R1-h: when remote mode is preview/on AND ORCHESTRATOR_TOKEN is set,
  // sign every appended entry. Existing unsigned entries in the JSONL files
  // continue to verify (verifyChain accepts the legacy shape).
  signingKey: _remoteRunner.ledgerKey,
  // D1-f: opt-in defense layer.
  sanitizer: sanitizeAuditData,
});

// Slice S5-c (Phase 2 / SMART-5, 2026-05-05): emit a single
// `deployment_profile_resolved` audit row at boot. Carries the
// resolved pack id + every rule field a forensic auditor needs to
// reconstruct posture without re-reading env. Lands under the
// "system" runId (same convention as policy_gate / runner_handshake
// boot events). When resolveDeploymentProfile fell back via the
// ORCHESTRATOR_POLICY_FAIL_OPEN escape hatch, the row also carries
// `resolvedFromFallback:true` + `unknownRequested:<typo>` so the
// audit trail captures the dev-escape decision.
try {
  evidenceLedger.append("system", {
    type: "deployment_profile_resolved",
    data: {
      pack: _deploymentProfile.pack,
      packLabel: _deploymentProfile.packLabel,
      publicSector: _deploymentProfile.publicSector,
      allowLocalExecutor: _deploymentProfile.allowLocalExecutor,
      allowPlaintextSecrets: _deploymentProfile.allowPlaintextSecrets,
      requireSandboxWorkspace: _deploymentProfile.requireSandboxWorkspace,
      requireSignedManifest: _deploymentProfile.requireSignedManifest,
      requirePiiScanBeforeProviderDispatch: _deploymentProfile.requirePiiScanBeforeProviderDispatch,
      scannerFailurePolicy: _deploymentProfile.scannerFailurePolicy,
      hardGatesDefault: _deploymentProfile.hardGatesDefault,
      runMemoryEnabled: _deploymentProfile.runMemoryEnabled,
      resolvedFromFallback: _deploymentProfile.resolvedFromFallback,
      unknownRequested: _deploymentProfile.unknownRequested,
    },
  });
} catch (_err) {
  // Defensive: ledger append failure (disk full, ledger corrupt) MUST
  // NOT block boot. The orchestrator runs without the boot audit row;
  // operators triaging missing rows can re-derive posture from env +
  // profile.
}

// Slice R3-c-2 (Phase D R3, 2026-04-28): periodic stale-runner monitor.
// Tied to the runnerRegistry lifecycle — only constructed when remote mode
// is preview/on AND a registry exists. Single-emit semantics + dedupe-on-
// recovery keep the audit chain quiet outside of actual host-loss events.
// Idle stale hosts (no claimed runs) are intentionally NOT audited; only
// hosts with stranded runs surface as `runner_host_lost` rows.
const { RunnerStaleMonitor } = require("./src/runtime/runnerStaleMonitor");
const _runnerStaleMonitor = _remoteRunner.runnerRegistry
  ? new RunnerStaleMonitor({
      registry: _remoteRunner.runnerRegistry,
      ledger: evidenceLedger,
      // intervalMs default = 30000ms = RunnerRegistry.heartbeatDropMs.
      // Operators can tighten this via ORCHESTRATOR_RUNNER_STALE_INTERVAL_MS
      // for faster signal in deployments where a runner host failure
      // must be reflected in the chain quickly.
      intervalMs: Number(process.env.ORCHESTRATOR_RUNNER_STALE_INTERVAL_MS) || 30000,
    })
  : null;
// Slice J (v5): indexRenderer injects a per-request nonce into every
// <script> and <link rel="stylesheet"> tag in index.html, and sets the
// Content-Security-Policy (or Content-Security-Policy-Report-Only) header
// dynamically. The static CSP in auth.js still covers /api/* responses —
// indexRenderer only overrides for the / route.
//
// Rollout: defaults to Report-Only so real-world violations surface via
//   /api/csp-report before any production break. Promote via
//   ORCHESTRATOR_CSP_MODE=enforce once /api/csp-report is quiet.
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");
// Slice LEGACY-VIEW-REMOVE-0 (2026-05-11): the preserved legacy view
// (index.legacy.html + public/app.js + UI-P8 banner) was retired. The
// product shell at index.html is now the only first-paint experience.
// Operators arriving via old `?mode=legacy` bookmarks get a 302
// redirect to `/` so they land on the product shell instead of a
// stale 404 / mystery blank page. The redirect is permanent in intent
// but we use 302 (not 301) so browsers don't cache the redirect — if
// we ever bring back a different "legacy" page we won't be fighting
// stale client caches.

function indexRenderer(req, res) {
  // LEGACY-VIEW-REMOVE-0: ?mode=legacy is no longer routed to a
  // preserved DOM. Redirect to / so old bookmarks / menu links still
  // land somewhere useful. Empty query string drops the hash too —
  // operators who had `?mode=legacy#analytics` lose the deep-link
  // (analytics page is gone with the legacy view).
  if (req && req.query && req.query.mode === "legacy") {
    res.redirect(302, "/");
    return;
  }
  const nonce = crypto.randomBytes(16).toString("base64");
  const html = INDEX_HTML
    .replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)
    .replace(/<link(\s[^>]*rel="stylesheet")/g, `<link nonce="${nonce}"$1`);

  // Slice P (v6): default flipped to enforce after Slice O removed the
  // last 'unsafe-inline' dependency and SRI integrity hashes pin the CDN
  // resources. Set ORCHESTRATOR_CSP_MODE=report-only to roll back during
  // incident response.
  const cspMode = process.env.ORCHESTRATOR_CSP_MODE || "enforce";
  const headerName = cspMode === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

  // script-src: removes 'unsafe-inline' via nonce-based policy — any injected
  //   <script> without the matching nonce is blocked.
  // style-src: Slice O (v6) — 'unsafe-inline' REMOVED. The last holdout
  //   (context bar .style.width) was converted to an SVG <rect width="...">
  //   attribute, which is governed by default-src, not style-src. Other
  //   callers already use classList for visibility toggles.
  // report-uri: browser will POST violations to /api/csp-report.
  res.setHeader(headerName, [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' https://cdn.jsdelivr.net",
    "connect-src 'self' ws: wss:",
    "img-src 'self' data:",
    "font-src 'self' https://cdn.jsdelivr.net",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
  ].join("; "));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

const app = createApp({
  staticDir: path.join(__dirname, "public"),
  jsonLimit: "256kb",
  indexRenderer,
});

// Slice J (v5): CSP violation report endpoint. Browser-initiated (no CSRF
// token), accepts both the legacy application/csp-report shape and the
// Reporting API's application/reports+json. Cap at 64KB per report to avoid
// a malicious page flooding us. `broadcast` is declared later in this file
// but hoisted as a function declaration, so it's safe to reference here.
app.post(
  "/api/csp-report",
  express.json({
    type: ["application/csp-report", "application/json", "application/reports+json"],
    limit: "64kb",
  }),
  (req, res) => {
    const body = req.body || {};
    const report = body["csp-report"] || body; // normalize legacy shape
    console.warn(
      "[csp-violation]",
      JSON.stringify({
        directive: report["violated-directive"] || report.effectiveDirective,
        blocked: report["blocked-uri"] || report.blockedURL,
        source: report["source-file"] || report.sourceFile,
        line: report["line-number"] || report.lineNumber,
      })
    );
    try {
      broadcast({
        type: "csp_violation",
        data: {
          documentURI: report["document-uri"] || report.documentURL || null,
          violatedDirective: report["violated-directive"] || report.effectiveDirective || null,
          blockedURI: report["blocked-uri"] || report.blockedURL || null,
          disposition: report.disposition || null,
        },
      });
    } catch (_) {
      // broadcast may throw at startup if wss has no clients — swallow.
    }
    res.status(204).end();
  }
);
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get("/api/auth/token", (req, res) => {
  if (!ALLOW_REMOTE && !isLoopbackAddress(req.socket.remoteAddress)) {
    return res.status(403).json({ error: "remote clients are disabled" });
  }
  res.json({ token: auth.token, header: "x-orchestrator-token" });
});

app.get("/api/version", (req, res) => {
  res.json(createVersionInfo({ repoRoot: REPO_ROOT, appRoot: APP_ROOT, bootTime: BOOT_TIME, mode: MODE }));
});

app.use("/api", auth.requireTrustedOrigin);
app.use("/api", auth.requireStateChangingToken);

// ── Route modules (extracted from monolithic server.js) ──
const { createHealthRoutes } = require("./src/routes/healthRoutes");
const { createEventRoutes } = require("./src/routes/eventRoutes");
const { createContextRoutes } = require("./src/routes/contextRoutes");
const { createHookRoutes } = require("./src/routes/hookRoutes");
const { createExecutorRoutes } = require("./src/routes/executorRoutes");
const { createTemplateRoutes } = require("./src/routes/templateRoutes");
const { createServerControlRoutes } = require("./src/routes/serverControlRoutes");
const { createCodexRoutes } = require("./src/routes/codexRoutes");
const { createPipelineRoutes } = require("./src/routes/pipelineRoutes");
// Slice E (v4): export the current run for the run-history drawer
const { createRunsRoutes } = require("./src/routes/runsRoutes");
// Slice MA2 (Phase D, 2026-04-27): single hydration endpoint for the
// future monitoring console — consolidates server summary, orchestrator
// run list, active children, and recent replay events into one response.
const { createMonitorRoutes } = require("./src/routes/monitorRoutes");
// Slice R1-h (Phase D R1, 2026-04-28): three-step handshake routes for
// remote runners — /api/runner/handshake, /heartbeat, /hook. All routes
// 404 when ORCHESTRATOR_REMOTE_MODE === "off" (default), so this is dead-code
// in single-orchestrator deployments. Feature flag locked at boot.
const { createRunnerRoutes } = require("./src/routes/runnerRoutes");
// Slice SMART-0-b (Phase D Round UI-P / Phase 2 SMART arc, 2026-05-04):
// `/api/decision-context` foundation that every subsequent SMART
// round (recommendation cards / hard gates / review presets / run
// memory / policy packs) reads as input. Read-only, no token gate
// (loopback binding is the existing safeguard).
const { createDecisionContextRoutes } = require("./src/routes/decisionContextRoutes");

// Slice AGENT-DESKTOP-0-a (2026-05-06): chat intent route — translates
// free-form natural-language input into a typed actionProposal that
// the frontend renders as an Approve/Edit/Cancel card. The route never
// fires the underlying action; approval triggers the existing endpoints
// (e.g. /api/pipeline/general-run) through the chat panel directly.
const { createChatIntentRoutes } = require("./src/routes/chatIntentRoutes");
const piiScannerModule = require("./src/security/piiScanner");

app.use("/api", createHealthRoutes({ pty }));

// Track connected clients + pty subprocesses so we can reap them on shutdown
const clients = new Set();
const ptyProcesses = new Set();
const activeCodexChildren = new Set();

// ── Auto-shutdown when webpage closes ──
// When the last WebSocket client disconnects, wait a short grace period for
// a reconnect (handles page refreshes) before tearing down the process.
let shutdownTimer = null;
const CLIENT_GRACE_MS = Number(process.env.CLIENT_GRACE_MS || 8000);

function cancelShutdownTimer() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
    console.log("[shutdown] cancelled — new client connected");
  }
}

function armShutdownTimer() {
  if (shutdownTimer) return;
  console.log(`[shutdown] no clients — arming ${CLIENT_GRACE_MS}ms grace timer`);
  shutdownTimer = setTimeout(() => {
    console.log("[shutdown] grace period expired, shutting down");
    gracefulShutdown("no-clients");
  }, CLIENT_GRACE_MS);
}

function gracefulShutdown(reason = "manual") {
  console.log(`[shutdown] graceful shutdown (${reason})`);
  try { broadcast({ type: "server_shutdown", data: { reason } }); } catch (_) {}
  try { sessionWatcher && sessionWatcher.stop && sessionWatcher.stop(); } catch (_) {}
  for (const p of ptyProcesses) { try { p.kill(); } catch (_) {} }
  for (const c of activeCodexChildren) { try { c.kill(); } catch (_) {} }
  // Slice S3 (Phase 3-S, 2026-04-27): SIGTERM every spawned Codex/Claude
  // child via the lifecycle registry. childRegistry is declared further
  // down in this file (line ~590) — by the time gracefulShutdown runs,
  // module evaluation has already initialised it; we still guard with
  // typeof to keep the early-exit case (signal during boot) safe.
  try {
    if (typeof childRegistry !== "undefined" && childRegistry && childRegistry.killAll) {
      childRegistry.killAll("SIGTERM");
    }
  } catch (_) { /* never let shutdown signal handler throw */ }
  // Slice R3-d (Phase D R3, 2026-04-28): send WS close 1000 to runner-
  // bound connections BEFORE server.close() so the runner agent's state
  // machine can distinguish clean orchestrator shutdown (1000 → exit 0,
  // no reconnect) from crash (1006 → backoff retry). Runner connections
  // were marked `ws._isRunnerWs = true` at upgrade time. Dashboard
  // clients keep the legacy close() (defaults to 1005, no reason).
  try {
    for (const ws of wss.clients) {
      try {
        if (ws._isRunnerWs) {
          ws.close(1000, "orchestrator_shutdown");
        }
      } catch (_) {}
    }
  } catch (_) {}
  try {
    for (const ws of clients) { try { ws.close(); } catch (_) {} }
  } catch (_) {}
  try { server.close(); } catch (_) {}
  if (process.send) {
    try { process.send({ type: "shutdown" }); } catch (_) {}
  }
  // S3: 1s grace for SIGTERM → SIGKILL holdouts → process.exit(0).
  // Old timing was 400ms with no kill follow-through; the extra 600ms
  // gives Codex/Claude children time to flush stdout + close pipes
  // before we hard-kill anything still alive. Net shutdown UX cost is
  // sub-second and avoids zombies on Linux.
  setTimeout(() => {
    try {
      if (typeof childRegistry !== "undefined" && childRegistry && childRegistry.killAll) {
        childRegistry.killAll("SIGKILL");
      }
    } catch (_) {}
    process.exit(0);
  }, 1000);
}

// Slice S1 (Phase 3-S, 2026-04-27) — WS upgrade auth gate.
// Slice MA0 (Phase D, 2026-04-27): function body extracted to
// `src/server/wsAuth.js`. The factory is invoked here with the same
// runtime values (ALLOW_REMOTE / HOST / auth / loopback helpers) so the
// behaviour is bit-for-bit identical and the test surface (Phase 3-S
// `tests/integration/ws-loopback-guard.test.js` source-grep anchors)
// stays intact.
const { createWsAuth } = require("./src/server/wsAuth");
const verifyWsConnection = createWsAuth({
  allowRemote: ALLOW_REMOTE,
  host: HOST,
  auth,
  isLoopbackAddress,
  isLoopbackHost,
});

// Slice R1-e-2 (Phase D R1, 2026-04-28) — path-aware demux for runner WS.
//
// `/api/runner/events` upgrades use a fundamentally different auth model
// than dashboard/terminal upgrades (per-run JWT instead of orchestrator token,
// no loopback exception, etc.). Stuffing both policies into one
// `verifyWsConnection` would either weaken the dashboard gate or break the
// runner flow — see runnerWsAuth.js header for the rationale.
const { createRunnerWsAuth, isRunnerWsPath } = require("./src/server/runnerWsAuth");
const { createRunnerWsHandler } = require("./src/server/runnerWsHandler");
const verifyRunnerWsConnection = createRunnerWsAuth({
  jwtKey: _remoteRunner.jwtKey,
  mode: _remoteRunner.mode,
});
// Slice R1-g (Phase D R1, 2026-04-28): pass childRegistry + hookRouter so
// the handler can project agent_started/stopped frames into childRegistry
// (visible via /api/server/info.activeChildren + monitor bootstrap) and
// route hook frames into hookRouter.routeRemote(runId, event).
//
// Both childRegistry and hookRouter are declared FURTHER DOWN in this
// file (lines ~600-615). To avoid the temporal-dead-zone error we'd hit
// by referencing them up here directly, we wrap them in tiny adapter
// objects whose methods capture the variables lazily inside their bodies.
// At handler-call time (which only happens after the WS upgrade arrives,
// long after server boot), the closures resolve to the live instances.
const handleRunnerWsConnection = createRunnerWsHandler({
  ledger: evidenceLedger,
  childRegistry: {
    registerRemote: (opts) => childRegistry && childRegistry.registerRemote(opts),
    unregisterRemote: (opts) => childRegistry && childRegistry.unregisterRemote(opts),
  },
  hookRouter: {
    routeRemote: (runId, event) => hookRouter && hookRouter.routeRemote(runId, event),
  },
  // Slice R2.5-d: pass the runnerRegistry so the handler can mark
  // active-run on connect / unmark on close. Wrapped because
  // _remoteRunner.runnerRegistry is null when ORCHESTRATOR_REMOTE_MODE=off.
  runnerRegistry: {
    markRunActive: (opts) => _remoteRunner.runnerRegistry
      && _remoteRunner.runnerRegistry.markRunActive(opts),
    unmarkRunActive: (runId) => _remoteRunner.runnerRegistry
      && _remoteRunner.runnerRegistry.unmarkRunActive(runId),
  },
});

wss.on("connection", (ws, req) => {
  // Slice R1-e-2: runner path uses runJWT auth, NOT the dashboard token.
  // Demux first so misconfigured runners can't accidentally bypass the
  // dashboard's loopback gate by hitting /api/runner/events.
  if (isRunnerWsPath(req.url)) {
    const runnerVerdict = verifyRunnerWsConnection(req);
    if (!runnerVerdict.ok) {
      try { ws.close(runnerVerdict.code, runnerVerdict.reason); } catch (_) {}
      return;
    }
    // Slice R3-d (Phase D R3, 2026-04-28): mark runner-bound connections
    // so gracefulShutdown can send close 1000 selectively. Without this
    // mark, server.close() would yank the socket and the agent would see
    // 1006 (abnormal) and start a backoff/reconnect loop pointlessly.
    ws._isRunnerWs = true;
    handleRunnerWsConnection(ws, req, runnerVerdict);
    return;
  }

  // Slice S1: gate first — terminal-specific token check below remains as a
  // belt-and-suspenders second layer for the /terminal subpath.
  const verdict = verifyWsConnection(req);
  if (!verdict.ok) {
    try { ws.close(verdict.code, verdict.reason); } catch (_) {}
    return;
  }

  // ── Terminal WebSocket ──
  if (req.url.startsWith("/terminal")) {
    const terminalUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const suppliedToken = terminalUrl.searchParams.get("token");
    if ((!ALLOW_REMOTE && !isLoopbackAddress(req.socket.remoteAddress)) || !auth.validateToken(suppliedToken)) {
      ws.close(1008, "unauthorized terminal");
      return;
    }
    if (!pty) {
      ws.send(JSON.stringify({ type: "output", data: "\r\n[node-pty 미설치] 터미널 기능을 사용하려면: npm install node-pty\r\n" }));
      ws.close();
      return;
    }

    const shell = process.platform === "win32"
      ? (fs.existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
          ? "C:\\Program Files\\Git\\bin\\bash.exe"
          : "powershell.exe")
      : "bash";

    // Slice P0 (Phase E, 2026-04-28): unified through src/security/envFilter
    // (was inline regex pre-P0). PTY allows ORCHESTRATOR_TOKEN to pass — operator
    // may type `curl http://127.0.0.1:4201/api/...` from the terminal and
    // needs the token. All other sensitives (RUNNER_BOOTSTRAP_TOKEN,
    // ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.) stay blocked.
    const safeEnv = filterSensitiveEnv(process.env, { allowKeys: ["ORCHESTRATOR_TOKEN"] });
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd: path.join(__dirname, ".."),
      env: safeEnv,
    });
    ptyProcesses.add(ptyProcess);

    ptyProcess.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "output", data }));
    });

    const MAX_TERMINAL_MSG = 16 * 1024; // 16KB message size limit
    ws.on("message", (msg) => {
      try {
        const raw = msg.toString();
        if (raw.length > MAX_TERMINAL_MSG) return; // drop oversized messages
        const parsed = JSON.parse(raw);
        if (parsed.type === "input") ptyProcess.write(parsed.data);
        if (parsed.type === "resize") ptyProcess.resize(parsed.cols, parsed.rows);
      } catch (e) { /* ignore malformed messages */ }
    });

    ws.on("close", () => {
      try { ptyProcess.kill(); } catch (_) {}
      ptyProcesses.delete(ptyProcess);
    });
    return;
  }

  // ── Pipeline event WebSocket ──
  clients.add(ws);
  cancelShutdownTimer();
  console.log(`[ws] client connected — total=${clients.size}`);

  // Half-open connection detection: ping/pong
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected — total=${clients.size}`);
    if (clients.size === 0) armShutdownTimer();
  });

  // Slice AA-2 (Phase 2.5, v6): run-scoped replay on tab switch.
  // The dashboard sends `{ type: "replay_request", runId, includeGlobal }`
  // when the user clicks a tab so the server re-emits only that run's
  // events (plus global UI events when includeGlobal=true). `includeGlobal`
  // defaults to false from the client because tab switches should NOT
  // re-fire past toast / hook_event traces that already rendered before.
  // Other message types are ignored — the pipeline WS is otherwise read-
  // only from the client's side.
  ws.on("message", (msg) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.toString());
    } catch (_) {
      return; // drop malformed
    }
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.type !== "replay_request") return;
    const runId = typeof parsed.runId === "string" && parsed.runId.length > 0
      ? parsed.runId
      : null;
    if (!runId) return;
    const includeGlobal = parsed.includeGlobal === true; // explicit opt-in
    try {
      const exec =
        (pipelineOrchestrator && typeof pipelineOrchestrator.get === "function"
          ? pipelineOrchestrator.get(runId)
          : null) || pipelineExecutor;
      const snapshot =
        exec && typeof exec.getReplaySnapshot === "function"
          ? exec.getReplaySnapshot()
          : {};
      const events = eventReplayBuffer
        .snapshot({ runId, includeGlobal })
        .map((e) => e.event);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "pipeline_replay",
          data: { ...snapshot, runId, events },
        }));
      }
    } catch (err) {
      console.error("[ws] replay_request failed:", err.message);
    }
  });

  // Send replay snapshot so reconnecting clients restore UI state
  try {
    if (pipelineExecutor && typeof pipelineExecutor.getReplaySnapshot === "function") {
      const snapshot = pipelineExecutor.getReplaySnapshot();
      const events = eventReplayBuffer.snapshot().map((e) => e.event);
      ws.send(JSON.stringify({
        type: "pipeline_replay",
        data: { ...snapshot, events },
      }));
    }
  } catch (err) {
    console.error("[ws] failed to send replay:", err.message);
  }
});

// Ping all clients every 30s; terminate stale ones
const _pingInterval = setInterval(() => {
  for (const ws of clients) {
    if (ws.isAlive === false) {
      clients.delete(ws);
      try { ws.terminate(); } catch (_) {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30_000);
// Unref so the interval doesn't keep Node alive during shutdown
if (_pingInterval.unref) _pingInterval.unref();

// MB4-d (Phase D Round 2, 2026-04-27): the ~60 lines of broadcast +
// throttle + replay buffer plumbing that lived here have been lifted
// to src/server/eventBroadcaster.js. Same wire contract — broadcast(event)
// JSON-stringifies + sends to every OPEN ws in `clients`, with throttle
// on non-IMMEDIATE types and pipeline-lifecycle hooks. heartbeat is
// attached separately because it's constructed later in this file.
const { createEventBroadcaster } = require("./src/server/eventBroadcaster");
const _eb = createEventBroadcaster({ clients });
const broadcast = _eb.broadcast;
const eventReplayBuffer = _eb.eventReplayBuffer;

// Slice R3-e-c (Phase D R3, 2026-04-29): per-call approval manager.
// One instance, shared by /api/approvals routes (this slice) and the
// hook-router approval gate (slice R3-e-d). Wired NOW so the route
// mount below has the same instance the gate will eventually call.
//
// auditFn -> evidenceLedger.append("system", {type, data}) so every
//   runner_hook_approval_{requested,granted,denied,timeout} verb
//   lands in the signed + sanitized chain alongside R2.5's
//   runner_hook_routed family.
//
// broadcastFn -> broadcast({type, data}) so dashboard clients see
//   approval_requested + approval_resolved events in real time. The
//   monitor store slice (UX-2-a) translates these into pendingApprovals.
const { ApprovalManager } = require("./src/runtime/approvalManager");
const _approvalManager = new ApprovalManager({
  auditFn: (verb, data) => {
    try { evidenceLedger.append("system", { type: verb, data }); }
    catch (_) { /* never break the manager on ledger faults */ }
  },
  broadcastFn: (type, data) => {
    try { broadcast({ type, data }); }
    catch (_) { /* never break the manager on WS faults */ }
  },
});

// Token tracking stub — kept for eventRoutes /api/reset compatibility
const tokenUsage = {};

// Route modules mounted after auth middleware
app.use("/api", createEventRoutes({ broadcast, validateEvent, tokenUsageRef: tokenUsage }));

app.use("/api", createContextRoutes({
  REPO_ROOT,
  validateContextDiscover,
  validateContextLoad,
  resolveInsideRoot,
  discoverContextFiles,
  loadFileContent,
}));

const CODEX_TRIGGER_DIR = path.resolve(__dirname, "..", "_workspace");

function resolveTriggerContext(trigger, userInput) {
  switch (trigger.contextSource) {
    case "plan": {
      const candidates = [
        path.join(CODEX_TRIGGER_DIR, "plan.md"),
        path.resolve(__dirname, "..", "pipeline-dashboard", "plan.md"),
        path.resolve(__dirname, "plan.md"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
      }
      throw new Error("plan.md를 찾지 못했습니다 (_workspace/ 또는 pipeline-dashboard/)");
    }
    case "git-diff": {
      try {
        const diff = execSync("git diff HEAD", {
          cwd: path.resolve(__dirname, ".."),
          encoding: "utf-8",
          maxBuffer: 4 * 1024 * 1024,
        });
        return diff || "(no staged or unstaged changes)";
      } catch (err) {
        throw new Error(`git diff 실행 실패: ${err.message}`);
      }
    }
    case "user-input": {
      if (!userInput || !String(userInput).trim()) {
        throw new Error("입력이 비어있습니다 (userInput 필요)");
      }
      return String(userInput);
    }
    default:
      throw new Error(`알 수 없는 contextSource: ${trigger.contextSource}`);
  }
}

// Slice E (v4): build the initial merged registry (built-ins + any customs
// already in .harness/templates.json) and keep a single `pipelineTemplates`
// reference that downstream components can read. After a successful upload
// or delete, `_refreshTemplatesRegistry` rebuilds the merged map in place so
// running executors see the new template without a server restart.
const templateStore = createTemplateStore({ repoRoot: REPO_ROOT, builtins: builtInTemplates });
let pipelineTemplates = templateStore.listAll();

function _refreshTemplatesRegistry() {
  const next = templateStore.listAll();
  // In-place mutation: downstream components (pipelineExecutor, pipelineAdapter)
  // capture the object reference at construction time, so we must preserve it.
  for (const k of Object.keys(pipelineTemplates)) {
    if (!(k in next)) delete pipelineTemplates[k];
  }
  Object.assign(pipelineTemplates, next);
}

app.use("/api", createTemplateRoutes({
  pipelineTemplates,
  templateStore,
  broadcast,
  onRegistryChange: _refreshTemplatesRegistry,
}));

// ── Session Watcher (auto-pipeline detection) ──
const sessionWatcher = new SessionWatcher(broadcast, path.resolve(__dirname, ".."));

// Remaining routes mounted below after dependency construction

// ── Hook Router + Pipeline Executor (Phase 1 + 2 + 3 + 4) ──
// Slice R2.5-c (Phase D R2.5): bridge mode comes from env. Default
// "off" preserves R1/R2 broadcast-only behavior. Operators promote
// via ORCHESTRATOR_REMOTE_BRIDGE_MODE=report (validate-only, see audit
// chain) and then ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch (forward
// sanitized hooks to the local executor's on{Pre,Post}Tool/onStop/
// onSubagentStart/onSubagentStop methods).
const { resolveBridgeMode } = require("./src/runtime/remoteHookBridgeContract");
const hookRouter = new HookRouter({
  broadcast, sessionWatcher, runRegistry,
  bridgeMode: resolveBridgeMode(process.env),
  // Slice R3-e-d: write-tool sanitized payloads (Bash/Edit/Write)
  // round-trip through the approvalManager before dispatch. Same
  // singleton instance the /api/approvals routes use — operator
  // grant/deny in the dashboard resolves the same Promise the
  // hook-router awaits.
  approvalManager: _approvalManager,
  // Slice GOV-APPROVAL-0: deployment posture context lets the gate
  // run a piiScanner over write-tool args before queueing an
  // approval, and triggers the public-sector "manager required"
  // assertion at construct time so operators get a specific
  // remediation hint when posture mandates approval but no manager
  // is wired.
  deploymentProfile: _deploymentProfile,
});
// Slice N (v6): shared child-process semaphore across Codex + Claude so the
// two runners can't collectively spawn more than ORCHESTRATOR_CHILD_MAX processes
// at once. Queue depth broadcasts as `child_queue_depth` → dashboard.
const { createChildSemaphore } = require("./src/runtime/childSemaphore");
const childSemaphore = createChildSemaphore({
  maxConcurrent: Number(process.env.ORCHESTRATOR_CHILD_MAX || 2),
  timeoutMs: Number(process.env.ORCHESTRATOR_CHILD_QUEUE_TIMEOUT_MS || 30000),
  broadcast,
});
// Slice S3 (Phase 3-S, 2026-04-27): child-process lifecycle registry.
// Complements childSemaphore (which limits concurrency) by tracking which
// processes are still alive at any moment, so gracefulShutdown can
// SIGTERM → 1s grace → SIGKILL the whole set instead of orphaning Codex
// critique calls (often 120s+).
const { createChildRegistry } = require("./src/runtime/childRegistry");
const childRegistry = createChildRegistry({ broadcast });

// Slice D1 (Phase E1, 2026-04-29): per-operator profile + credential
// layer. `profileStore` persists profiles.json under ORCHESTRATOR_CONFIG_DIR;
// `credentialStore` fronts the OS keychain (keytar) — falls back to
// "none" backend when keytar is missing AND ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS
// isn't set (fail-closed default). Both are wired into ClaudeRunner +
// CodexRunner below so profileSpawn engages on every spawn; profileRoutes
// (mounted further down) exposes the HTTP surface.
const { resolve: resolveConfigPaths } = require("./src/runtime/configPaths");
const { createProfileStore } = require("./src/runtime/profileStore");
const { createCredentialStore } = require("./src/security/credentialStore");
const _configPaths = resolveConfigPaths();
const profileStore = createProfileStore({
  filePath: _configPaths.profileFile,
  ledger: evidenceLedger,
});
const credentialStore = createCredentialStore({
  fsPaths: _configPaths,
  ledger: evidenceLedger,
});

// Slice TRUST-STORE-0-d (Phase E Round 2, 2026-04-30): manifest-signing
// trust store. The launcher install path (E3-F1) reads the file the
// operator manages here. Resolver shared with the launcher so both
// agree on path under any env (ORCHESTRATOR_TRUST_STORE / ORCHESTRATOR_CONFIG_DIR
// / OS default / portable install). Routes mounted further below.
const { resolveTrustStorePath } = require("./src/runtime/trustStorePath");
const { createTrustStore } = require("./src/runtime/trustStore");
const _trustStoreResolved = resolveTrustStorePath({
  // Explicit installDir hint = REPO_ROOT so the portable-install
  // fallback finds a bundled trust-store.json next to orchestrator-start.
  // The resolver's existing priority chain still honors env overrides.
  installDir: REPO_ROOT,
});
const trustStore = createTrustStore({
  filePath: _trustStoreResolved.path,
  ledger: evidenceLedger,
});

// Slice UI-H7-d (Phase D / Phase E1.5, 2026-04-30): the
// reviewSessionManager is created upstream of the runners now (was
// created at line ~1067 in MA4). Moved here so claude-runner +
// codex-runner can hold a reference at construction time. The actual
// route mount + audit/broadcast wiring still happens at the original
// location — see comment block there. This split is safe because
// the manager doesn't depend on routes; routes depend on the manager.
const { ReviewSessionManager } = require("./src/runtime/reviewSessionManager");
const _reviewSessionManager = new ReviewSessionManager({
  auditFn: (verb, data) => {
    try { evidenceLedger.append("system", { type: verb, data }); }
    catch (_) { /* never break the manager on ledger faults */ }
  },
  broadcastFn: (type, data) => {
    try { broadcast({ type, data }); }
    catch (_) { /* never break the manager on WS faults */ }
  },
});

// Slice RR0-a/b (Phase 2 / RELEASE-READY-0, 2026-05-05): central timeout
// policy + activity-based watchdog. resolveTimeoutPolicy reads
// ORCHESTRATOR_TIMEOUT_PRESET / HARNESS_<field>_TIMEOUT_MS env + posture to
// pick presets (interactive default; long_run / public_sector for
// production deployments). The resolved policy supplies
// defaultTimeoutMs to each runner. When the resolved preset is NOT
// "interactive", we also wire a watchdog idle timeout — long-but-
// streaming runs survive the total timeout window as long as output
// keeps flowing.
const { resolveTimeoutPolicy } = require("./src/runtime/timeoutPolicy");
const _timeoutPolicy = resolveTimeoutPolicy({
  env: process.env,
  deploymentProfile: _deploymentProfile,
});
// Idle threshold: 60s for long-running deployments — operator should
// see "no output in last minute" warning before the kill. Only engage
// the watchdog when the chosen preset is genuinely long (interactive
// preserves pre-RR0-b single-timer behavior verbatim).
const _idleTimeoutMs = (_timeoutPolicy.preset !== "interactive") ? 60_000 : null;

const codexRunner = new CodexRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  broadcast,
  childSemaphore,
  childRegistry,
  // D1-d: profileSpawn engages when both stores are wired.
  profileStore,
  credentialStore,
  ledger: evidenceLedger,
  // UI-H7-d: when an exec opts.reviewSessionId is provided, codex
  // stdout chunks pipe to manager.recordCodexChunk + close emits
  // recordCritiqueReceived.
  reviewSessionManager: _reviewSessionManager,
  // Slice RR0-a/b: timeout policy-derived defaults + watchdog wiring.
  defaultTimeoutMs: _timeoutPolicy.codexTimeoutMs,
  idleTimeoutMs: _idleTimeoutMs,
});
const claudeRunner = new ClaudeRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  // Slice RR0-b: claude_idle_warning / claude_killed_for_idle WS
  // events flow through the same broadcast as codex. Operators see
  // "마지막 출력 후 N초" toasts in the dashboard.
  broadcast,
  childSemaphore,
  childRegistry,
  // D1-d: same wiring as codex side.
  profileStore,
  credentialStore,
  ledger: evidenceLedger,
  // UI-H7-d: claude-side mirror.
  reviewSessionManager: _reviewSessionManager,
  // Slice RR0-a/b: timeout policy + watchdog wiring (mirror of codex).
  defaultTimeoutMs: _timeoutPolicy.claudeTimeoutMs,
  idleTimeoutMs: _idleTimeoutMs,
});

// Slice UI-H7-f (Phase D / Phase E1.5, 2026-04-30): server-side
// review-session spawn dispatcher. Lives between the routes layer
// (state machine + posture gate) and the runners (chunk pipeline).
// Per-session in-flight tracking + dispatch failure audit. The
// dispatcher's `auditFn` writes to evidenceLedger so a forensic
// auditor's grep for `review_session_dispatch_*` lands in the
// signed chain.
const { ReviewSpawnDispatcher } = require("./src/runtime/reviewSpawnDispatcher");
const _reviewSpawnDispatcher = new ReviewSpawnDispatcher({
  reviewSessionManager: _reviewSessionManager,
  codexRunner,
  claudeRunner,
  auditFn: (verb, data) => {
    try { evidenceLedger.append("system", { type: verb, data }); }
    catch (_) { /* never break the dispatcher on ledger faults */ }
  },
  deploymentProfile: _deploymentProfile,
});

// generalRunRef.active is set by pipelineRoutes — see above
// Slice Y (Phase 2.5): the global singleton PipelineState / checkpointStore
// were shared across every run the orchestrator created, so concurrent runs
// would overwrite each other's findings, metrics, and checkpoint file. Both
// are now instantiated fresh inside `createExecutor(runId)` below — each
// run gets its own state container and its own checkpoint path.
const qualityGate = new QualityGate();
const skillInjector = new SkillInjector({ skillRegistry });
const pipelineAdapter = new PipelineAdapter({ templates: pipelineTemplates });

// Slice V (v6): cross-run file edit collision detector. Moved above the
// orchestrator so Slice AD can inject it into every executor and the
// orchestrator itself — otherwise completed runs' Edit/Write claims would
// linger and produce false file_conflict_warning broadcasts for the next
// run that touches the same file.
const { createFileConflictDetector } = require("./src/runtime/fileConflictDetector");
const fileConflictDetector = createFileConflictDetector({ broadcast });

// Slice S (v6): wrap the singleton executor in a PipelineOrchestrator so
// later slices (T: runId routing, U: tabs, V: concurrent unlock) can grow
// naturally. Single-active compat: maxConcurrent=1, default run eagerly
// bootstrapped. External references (routes, hookRouter, heartbeat) still
// talk to the same `pipelineExecutor` reference — now sourced from
// `orchestrator.getActive()`.
const { PipelineOrchestrator } = require("./executor/pipeline-orchestrator");
const pipelineOrchestrator = new PipelineOrchestrator({
  broadcast,
  // Slice AD (Phase 2.5): the orchestrator uses this detector in
  // remove(runId) so manual-teardown paths also clear stale claims.
  fileConflictDetector,
  // Slice V (v6): multi-run unlock capability (up to N concurrent runs).
  // Slice A0 rollback (Phase 2.5, 2026-04-21 final): Phase 2.5 landed
  // Y+Z (per-run PipelineState + checkpointStore), AA-1 (live run-scoped
  // DOM filter), AA-2 (run-scoped replay + includeGlobal policy), AD
  // (fileConflictDetector.clear wiring on complete/reset/remove), and AB
  // (hook-adapter carve-out audit). The A0 hotfix that temporarily forced
  // the default down to 1 is now lifted — multi-run is safe by default
  // again. Users can still pin to 1 with ORCHESTRATOR_MAX_RUNS=1 for
  // single-active compat.
  maxConcurrent: Number(process.env.ORCHESTRATOR_MAX_RUNS || 3),
  createExecutor: (runId) => new PipelineExecutor({
    broadcast,
    templates: pipelineTemplates,
    codex: codexRunner,
    // Slice Y (Phase 2.5): per-run PipelineState — no more cross-run
    // findings/metrics bleed.
    state: new PipelineState(),
    gate: qualityGate,
    injector: skillInjector,
    adapter: pipelineAdapter,
    repoRoot: REPO_ROOT,
    // Slice Z (Phase 2.5): per-run checkpoint. The default run keeps the
    // legacy `.harness/pipeline-checkpoint.json` path (zero migration for
    // single-run users); non-default runs get `.harness/runs/{runId}/…`.
    checkpointStore: createCheckpointStore({ repoRoot: REPO_ROOT, runId }),
    // Slice AD (Phase 2.5): each executor clears its own claims on
    // _complete() / resetActive() so finished runs don't trigger false
    // `file_conflict_warning` broadcasts for later runs.
    fileConflictDetector,
    runId,
    // Slice SMART-4-c (2026-05-05): on every pipeline_complete the
    // recorder derives a redacted summary (privacy-by-design schema
    // S4-a) and lands it in the evidence ledger as a
    // `run_memory_recorded` audit row. The opt-out env
    // (ORCHESTRATOR_RUN_MEMORY_DISABLE=1) is checked inside recordRunMemory
    // — if set, the call is a no-op. Public-sector posture triggers
    // PII redaction at write time. The PipelineExecutor wraps the
    // call in defensive try/catch so a recorder failure NEVER breaks
    // _complete (broadcast pipeline_complete still fires).
    onRunComplete: (runIdArg, snapshot) => {
      const _runMemory = require("./src/runtime/runMemory");
      _runMemory.recordRunMemory({
        runId: runIdArg,
        inputs: _runMemory.deriveFromPipelineSnapshot(snapshot),
        ledger: evidenceLedger,
        deploymentProfile: _deploymentProfile,
      });
    },
  }),
});
const pipelineExecutor = pipelineOrchestrator.getActive();
// Heartbeat: broadcasts elapsed time every 5s while a pipeline is active.
// Reads through the orchestrator so a Slice V unlock picks up new runs.
const heartbeat = createHeartbeat({
  broadcast,
  getActive: () => pipelineOrchestrator.getActive().active,
  getCurrentPhase: () => pipelineOrchestrator.getActive()._currentPhase(),
  intervalMs: 5000,
});
// MB4-d: hand the heartbeat to the lifted broadcaster so its
// pipeline-lifecycle hooks (start/stop on pipeline_start/complete) fire.
_eb.attachHeartbeat(heartbeat);
hookRouter.attachExecutor(pipelineExecutor);
// Slice T (v6): give hookRouter access to the orchestrator so it can
// resolve session_id / agent_id → runId.
hookRouter.attachOrchestrator(pipelineOrchestrator);
// Slice V (v6): surface cross-run file edit collisions as
// file_conflict_warning broadcasts so the dashboard can flag them.
// (The detector instance was constructed above, before the orchestrator,
// so Slice AD can inject it into each executor and into remove(runId).)
hookRouter.attachFileConflictDetector(fileConflictDetector);

app.use("/api", createHookRoutes({ hookRouter, validateHook }));
app.use("/api", createExecutorRoutes({ pipelineExecutor, validateExecutorMode }));
app.use("/api", createServerControlRoutes({
  broadcast,
  clients,
  gracefulShutdown,
  server,
  CLIENT_GRACE_MS,
  shutdownTimerRef: { get timer() { return shutdownTimer; } },
  // Slice MA0 (Phase D, 2026-04-27): expose childRegistry to /api/server/info
  // so operators can see active Codex/Claude children at a glance.
  childRegistry,
  // Slice R2.5-e (Phase D R2.5, 2026-04-28): expose hookRouter so
  // /api/server/info.hookStats surfaces remote-hook dispatch counters
  // (remoteHookSanitized / Rejected / Dispatched / DispatchError).
  // Operators can see live bridge throughput without grepping the
  // audit chain.
  hookRouter,
  // Slice D3-a (Phase E1.5, 2026-04-29): account-status summaries
  // for the monitor shell's global-bar 5-cell extension (D3-c) +
  // settings-accounts modal (D3-d). Each dep is optional from the
  // route module's POV — wiring all four here gives the UI a stable,
  // ALWAYS-PRESENT contract:
  //   profile.{activeId,activeLabel,count,credentialBackend}
  //   deployment.{mode,publicSector,allowLocalExecutor,
  //               allowPlaintextSecrets,requireSandboxWorkspace,
  //               requirePiiScan}
  //   bridge.{mode}        — off | report | dispatch
  //   remote.{mode,activeRunnerCount}
  profileStore,
  credentialStore,
  deploymentProfile: _deploymentProfile,
  runnerRegistry: _remoteRunner.runnerRegistry,
  bridgeMode: hookRouter && typeof hookRouter.getBridgeMode === "function"
    ? hookRouter.getBridgeMode()
    : null,
  remoteMode: _remoteRunner.mode,
}));
app.use("/api", createCodexRoutes({
  codexRunner,
  broadcast,
  CODEX_TRIGGER_DIR,
  getTriggers,
  getTriggerById,
  validateCodexTrigger,
  resolveTriggerContext,
}));

// generalRunRef is shared with pipelineRoutes
const generalRunRef = { active: null };

// ── Automated General Pipeline (Claude plan ↔ Codex critique cycle) ──
//
// Flow: Phase B (Claude plans) → Phase C (Codex critiques) → if critical/high
// findings AND iteration < max: Phase D (Claude refines) → Phase C again.
// Each phase broadcasts phase_update / node_update / critique_received events
// so the existing dashboard visualizes the cycle on the "default" template.
//
// Implementation note: Claude is invoked via `claude -p --bare` to avoid
// re-entering the orchestrator. Codex uses the same CodexRunner as the verify API.
//
// Slice MB4-b (Phase D Round 2, 2026-04-27): runGeneralPipeline +
// finalizeGeneralRun + buildPlannerPrompt/buildRefinerPrompt/buildCriticPrompt
// were 280 lines of inline closures. Behaviour-preserving lift to
// src/server/generalPipelineRunner.js. The runtime contract (one async
// fn (task, maxIter, runId)) stays identical.
const { createGeneralPipelineRunner } = require("./src/server/generalPipelineRunner");
const _generalPipeline = createGeneralPipelineRunner({
  broadcast,
  claudeRunner,
  codexRunner,
  generalRunRef,
  activeCodexChildren,
  workingDir: path.join(__dirname, ".."),
});
const runGeneralPipeline = _generalPipeline.runGeneralPipeline;

app.use("/api", createPipelineRoutes({
  broadcast,
  REPO_ROOT,
  resolveInsideRoot,
  runGeneralPipeline,
  generalRunRef,
  validateGeneralRun,
  sessionWatcher,
  skillRegistry,
}));

// Slice E (v4): Run-history drawer's snapshot endpoint. Readonly — returns
// the same data a reconnecting WebSocket client would see via pipeline_replay.
app.use("/api", createRunsRoutes({ pipelineExecutor, eventReplayBuffer }));

// Slice MA2 (Phase D, 2026-04-27): /api/monitor/bootstrap. Mounted after
// the orchestrator + childRegistry + eventReplayBuffer are constructed so
// the route can read them on demand. Token middleware (auth.requireStateChangingToken)
// is GET-tolerant, so the dashboard can hydrate without an extra header dance.
app.use("/api", createMonitorRoutes({
  // Slice MA2 (Phase D): consolidated bootstrap — orchestrator + registry
  // + replay buffer + boot meta funnel into a single hydration response so
  // the dashboard avoids a 3–4 round-trip cold start.
  pipelineOrchestrator,
  childRegistry,
  eventReplayBuffer,
  bootTime: BOOT_TIME,
  mode: MODE,
  // Slice R1-h2 (Phase D R1, 2026-04-28): wire the runner registry so
  // /api/monitor/bootstrap.runners and /api/monitor/runs/:runId.origin
  // reflect REAL remote state instead of the local-default placeholder.
  // R1-h built the registry; R1-a built the contract; R1-h2 closes the
  // production wiring gap caught by review. The registry is null when
  // ORCHESTRATOR_REMOTE_MODE=off (default), in which case _resolveOrigin
  // / _resolveRunners fall through to the local defaults — matching
  // the pre-R1-h2 behavior exactly.
  runnerProvider: _remoteRunner.runnerRegistry,
}));

// Slice SMART-0-b (2026-05-04): /api/decision-context — pure
// snapshot of operator-attention state for SMART arc consumers.
// All adapters optional; missing dep → corresponding source "absent".
app.use("/api", createDecisionContextRoutes({
  approvalManager: _approvalManager,
  reviewSessionManager: _reviewSessionManager,
  runRegistry: pipelineOrchestrator,
  deploymentProfile: _deploymentProfile,
  evidenceLedger,
  profileStore,
  runnerRegistry: _remoteRunner.runnerRegistry,
}));

// Slice AGENT-DESKTOP-0-a (2026-05-06): POST /api/chat/intent. Routes
// the chat panel's natural-language input through the pure intent
// parser + the existing PII scanner + the audit ledger. Returns a
// typed proposal — approval triggers existing endpoints via the
// frontend (no new execution path). See src/routes/chatIntentRoutes.js
// header for the contract.
app.use("/api", createChatIntentRoutes({
  piiScanner: piiScannerModule,
  evidenceLedger,
  deploymentProfile: _deploymentProfile,
}));

// Slice R1-h (Phase D R1, 2026-04-28): /api/runner/handshake, /heartbeat,
// /hook. The router itself enforces feature-flag gating — when mode="off"
// (default for single-orchestrator deployments) every route returns 404,
// so this mount is harmless dead code in the local-only path. We pass the
// shared evidenceLedger so handshake/heartbeat/hook decisions land in the
// same audit chain that signed-key signing covers (R1-c). hookRouter is
// intentionally NOT wired here — that's R1-e's job (WS path is primary,
// /hook is partition-recovery fallback). For now the route accepts a
// valid runJWT and acknowledges, but the body is dropped.
app.use("/api", createRunnerRoutes({
  runnerRegistry: _remoteRunner.runnerRegistry,
  jwtKey: _remoteRunner.jwtKey,
  mode: _remoteRunner.mode,
  ledger: evidenceLedger,
  hookRouter: null,
}));

// Slice D1-e (Phase E1, 2026-04-29): operator-facing profile + credential
// routes. Mounted under /api/profiles. The active-run gate uses
// childRegistry.snapshot() — switching profile is blocked while any
// Claude/Codex child is in flight (audit chain forks between
// profile-A start and profile-B end-of-run otherwise).
const _isActiveRun = () => {
  try {
    const snap = childRegistry.snapshot();
    return Array.isArray(snap) && snap.length > 0;
  } catch (_) { return false; }
};
const { createProfileRoutes } = require("./src/routes/profileRoutes");
app.use("/api", createProfileRoutes({
  profileStore,
  credentialStore,
  ledger: evidenceLedger,
  isActiveRun: _isActiveRun,
}));

// Slice TRUST-STORE-0-c/d (Phase E Round 2, 2026-04-30): trust-store
// management routes. Mounted under /api/trust-store. Public-sector
// posture switches DELETE to a 2-step confirm flow + injects audit
// emission via evidenceLedger so trust_store_* verbs land in the
// signed chain. Standard posture omits the second step but still
// emits the same key_added / _updated / _removed verbs.
const { createTrustStoreRoutes } = require("./src/routes/trustStoreRoutes");
app.use("/api", createTrustStoreRoutes({
  trustStore,
  audit: (verb, data) => {
    try { evidenceLedger.append("system", { type: verb, data }); }
    catch (_) { /* never break the route on ledger faults */ }
  },
  deploymentProfile: _deploymentProfile,
}));

// Slice D2-c (Phase E1.5, 2026-04-29): setup-wizard HTTP API. Mounted
// under /api/setup. 5 endpoints: probe-node / probe-cli / probe-provider
// / probe-workspace / finalize. The wizard scripts (D2-d) consume these
// endpoints; the D3 UI account-status panel will too. Same active-run
// gate as the profile routes — finalize that would yank the active
// profile out from under an in-flight run is refused with 409.
const { createSetupRoutes } = require("./src/routes/setupRoutes");
app.use("/api", createSetupRoutes({
  profileStore,
  credentialStore,
  ledger: evidenceLedger,
  isActiveRun: _isActiveRun,
}));

// Slice GOV-PII-1-b (Phase E1.5, 2026-04-29): file-import scan API.
// Mounted under /api/security. ONE endpoint:
//   POST /api/security/scan — body { content, filename?, source?, depth? }
// Default depth is "deep" (file-import context opts INTO the deeper
// 8-pattern set including 사업자등록번호 / 운전면허 / 여권). Audit
// verbs pii_file_scan_blocked / pii_file_scan_warn ride the same
// signed + sanitized chain that D1-f set up. The deploymentProfile
// resolved at boot drives block-vs-warn (mirrors GOV-PII-0 piiGate
// fail-closed semantics).
const { createSecurityRoutes } = require("./src/routes/securityRoutes");
app.use("/api", createSecurityRoutes({
  ledger: evidenceLedger,
  deploymentProfile: _deploymentProfile,
}));

// Slice R3-e-c (Phase D R3, 2026-04-29): approval HTTP API.
// Mounted under /api/approvals. Three endpoints:
//   GET  /api/approvals/pending
//   POST /api/approvals/:id/grant   body: {deciderId?, reason?}
//   POST /api/approvals/:id/deny    body: {deciderId?, reason?}
// The audit chain entries fire from the manager's auditFn (wired
// above); the routes only translate HTTP into manager calls. 404 on
// unknown / already-resolved approvalIds keeps the chain clean.
const { createApprovalRoutes } = require("./src/routes/approvalRoutes");
app.use("/api", createApprovalRoutes({ approvalManager: _approvalManager }));

// Slice UI-H4 (Phase D / Phase E1.5, 2026-04-30): review session
// HTTP API. Five endpoints under /api/review-sessions/* per UI Plan
// §UX-H4. Backs the Claude→Codex→Claude review relay flow.
//
// Slice UI-H7-d note (2026-04-30): the manager itself was hoisted
// upstream so claude-runner + codex-runner can hold a reference at
// construction time. Look for `_reviewSessionManager =` near the
// runner construction. This block now only handles route mount.
//
// Slice UI-H7-f note (2026-04-30): the dispatcher is now also
// constructed upstream and injected here so POST /:id/send-codex
// + /:id/hand-back-claude actually trigger codex/claude runners
// with the reviewSessionId hint. See `_reviewSpawnDispatcher =`
// near the runner construction.
const { createReviewSessionRoutes } = require("./src/routes/reviewSessionRoutes");
app.use("/api", createReviewSessionRoutes({
  reviewSessionManager: _reviewSessionManager,
  reviewSpawnDispatcher: _reviewSpawnDispatcher,
  deploymentProfile: _deploymentProfile,
  // Slice SMART-2-b (2026-05-05): pre-state policy gate audit emitter.
  // policy_gate_blocked / policy_gate_warn entries land in the same
  // evidence ledger as the rest of the orchestrator audit chain so a
  // forensic auditor sees the gate decision alongside the dispatcher
  // verbs. Bound to evidenceLedger.append matching the dispatcher
  // wiring above.
  auditFn: evidenceLedger.append.bind(evidenceLedger),
}));

// Slice UI-H9-a (Phase D / Phase E1.5, 2026-04-30): audit read API
// powering the recent-results drill-down view. Read-only — operator
// inspects the evidence ledger for a specific run.
//
// Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30): same router exposes
// sealed evidence-bundle export (POST /api/audit/runs/:runId/export
// + POST /api/audit/export). The seal key is the ledger's HMAC key
// derived via HKDF info="audit-ledger" so the bundle inherits the
// existing trust root. When the orchestrator runs in local-only mode
// (no ORCHESTRATOR_TOKEN configured for remote runners) the bundle still
// ships unsealed — chain hashes alone are enough for an internal
// auditor; sealed bundles are for cross-org / agency-to-agency
// transmission.
const { createAuditRoutes } = require("./src/routes/auditRoutes");
app.use("/api", createAuditRoutes({
  evidenceLedger,
  sealKey: (_remoteRunner && _remoteRunner.ledgerKey) || null,
  deploymentProfile: _deploymentProfile,
}));

// Slice SMART-4-b (2026-05-05): /api/runs/:runId/memory — read-only
// run-memory endpoint. Records are written by pipeline-executor's
// _complete hook (SMART-4-c) via runMemory.recordRunMemory; this
// endpoint is the operator-UI read seam. auditFn is bound to the same
// evidence ledger so run_memory_accessed audit lands in the same chain
// the recorded memory itself uses.
const { createRunMemoryRoutes } = require("./src/routes/runMemoryRoutes");
app.use("/api", createRunMemoryRoutes({
  evidenceLedger,
  auditFn: evidenceLedger.append.bind(evidenceLedger),
}));

// Slice POL-b (Phase 2 / POLICY-UX-0, 2026-05-05): operator-facing
// policy pack catalog. Read-only — pack changes still require server
// restart (ORCHESTRATOR_DEPLOYMENT_PROFILE env). The catalog returns:
//   - currentPack: which pack the orchestrator booted with
//   - packs: full rule shape for all 5 frozen packs
//   - metadata.hardGatesEffectiveMode: POL-a runtime mode (env or pack)
//   - metadata.runMemoryEffective: POL-a runtime opt-out resolution
//   - metadata.publicSectorRequirements: 5-bullet operator checklist
const { createPolicyPackRoutes } = require("./src/routes/policyPackRoutes");
app.use("/api", createPolicyPackRoutes({
  deploymentProfile: _deploymentProfile,
  env: process.env,
}));

// MB4-b (Phase D Round 2, 2026-04-27): the ~270 lines of
// runGeneralPipeline + finalizeGeneralRun + 3 prompt builders that
// lived here have been lifted to src/server/generalPipelineRunner.js.
// The factory call sits just above the createPipelineRoutes mount;
// the bound runGeneralPipeline is what /api/pipeline/general invokes.
// Tests in tests/unit/general-pipeline-runner.test.js (14 cases) lock
// the public contract. Use `git log -- server.js` to see the lift
// commit if you need history. Anchor strings for grep:
//   runGeneralPipeline finalizeGeneralRun buildPlannerPrompt
//   buildRefinerPrompt buildCriticPrompt

// P-1 Performance: write fast-policy.json at boot so hooks can do local checks
function writeFastPolicy() {
  try {
    const policy = {};
    for (const [id, tmpl] of Object.entries(pipelineTemplates)) {
      if (!tmpl.phases) continue;
      policy[id] = {};
      for (const phase of tmpl.phases) {
        policy[id][phase.id] = {
          allowedTools: phase.allowedTools || [],
          agent: phase.agent || null,
        };
      }
    }
    const dir = path.join(REPO_ROOT, ".orchestrator");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "fast-policy.json"), JSON.stringify(policy, null, 2), "utf-8");
  } catch (_) {
    // Best-effort — hooks fall back to full HTTP if file missing
  }
}

// OS signals → graceful shutdown
let _ledgerCleanupInterval = null;

function start(port = PORT, host = HOST) {
  sessionWatcher.start();
  writeFastPolicy();
  // Evidence ledger cleanup — TTL-based, every 6 hours
  try { evidenceLedger.cleanup(); } catch (_) {}
  _ledgerCleanupInterval = setInterval(() => {
    try { evidenceLedger.cleanup(); } catch (_) {}
  }, 6 * 3600 * 1000);
  // Slice R3-c-2: start the periodic stale-runner monitor (only when
  // remote mode is preview/on). Mirrors the ledger-cleanup pattern
  // — start at boot, tear down via server.close hook below.
  if (_runnerStaleMonitor) {
    try { _runnerStaleMonitor.start(); } catch (_) {}
  }
  server.once("close", () => {
    try { sessionWatcher.stop(); } catch (_) {}
    if (_ledgerCleanupInterval) clearInterval(_ledgerCleanupInterval);
    if (_runnerStaleMonitor) {
      try { _runnerStaleMonitor.stop(); } catch (_) {}
    }
  });
  return server.listen(port, host, () => {
    console.log(`Pipeline Dashboard: http://${host}:${port}`);
    console.log(`  Terminal: ${pty ? "enabled" : "disabled (install node-pty)"}`);
    console.log(`  Session Watcher: active`);
    console.log(`  Supervised: ${process.send ? "yes (restart enabled)" : "no (start via start.js for restart)"}`);
    console.log(`  Client grace period: ${CLIENT_GRACE_MS}ms`);
  });
}

if (require.main === module) {
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  start();
}

module.exports = {
  app,
  auth,
  REPO_ROOT,
  server,
  start,
};
