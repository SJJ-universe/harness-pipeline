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
// (RunnerRegistry + JWT key + ledger signing key) from HARNESS_REMOTE_MODE
// + HARNESS_TOKEN. Returns null/disabled shape when mode="off" (default).
const { setupRemoteRunner } = require("./src/server/remoteRunnerSetup");

const APP_ROOT = __dirname;
const REPO_ROOT = path.resolve(__dirname, "..");
const BOOT_TIME = new Date().toISOString();
const ALLOW_REMOTE = process.env.HARNESS_ALLOW_REMOTE === "1";
const HOST = process.env.HOST || process.env.HARNESS_HOST || (ALLOW_REMOTE ? "0.0.0.0" : "127.0.0.1");
const PORT = Number(process.env.PORT || process.env.HARNESS_PORT || 4201);
const MODE = ALLOW_REMOTE ? "remote" : "local";
const auth = createAuthMiddleware({ repoRoot: REPO_ROOT, host: HOST, allowRemote: ALLOW_REMOTE });
const runsDir = path.join(REPO_ROOT, "runs");
const runRegistry = new RunRegistry({ rootDir: runsDir });
// Slice R1-h: derive HARNESS_REMOTE_MODE + the two HKDF keys *before* the
// evidence ledger is constructed so the ledger can be configured with its
// signing key in one go (instead of mutating a half-built instance).
const _remoteRunner = setupRemoteRunner();
if (_remoteRunner.mode !== "off" && _remoteRunner.error === "token_missing") {
  console.warn(
    "[remote-runner] HARNESS_REMOTE_MODE=" + _remoteRunner.mode +
    " but HARNESS_TOKEN is missing — runner routes will 503.",
  );
}
const evidenceLedger = new EvidenceLedger({
  rootDir: runsDir,
  // R1-c + R1-h: when remote mode is preview/on AND HARNESS_TOKEN is set,
  // sign every appended entry. Existing unsigned entries in the JSONL files
  // continue to verify (verifyChain accepts the legacy shape).
  signingKey: _remoteRunner.ledgerKey,
});
// Slice J (v5): indexRenderer injects a per-request nonce into every
// <script> and <link rel="stylesheet"> tag in index.html, and sets the
// Content-Security-Policy (or Content-Security-Policy-Report-Only) header
// dynamically. The static CSP in auth.js still covers /api/* responses —
// indexRenderer only overrides for the / route.
//
// Rollout: defaults to Report-Only so real-world violations surface via
//   /api/csp-report before any production break. Promote via
//   HARNESS_CSP_MODE=enforce once /api/csp-report is quiet.
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");

function indexRenderer(req, res) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const html = INDEX_HTML
    .replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)
    .replace(/<link(\s[^>]*rel="stylesheet")/g, `<link nonce="${nonce}"$1`);

  // Slice P (v6): default flipped to enforce after Slice O removed the
  // last 'unsafe-inline' dependency and SRI integrity hashes pin the CDN
  // resources. Set HARNESS_CSP_MODE=report-only to roll back during
  // incident response.
  const cspMode = process.env.HARNESS_CSP_MODE || "enforce";
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
  res.json({ token: auth.token, header: "x-harness-token" });
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
// 404 when HARNESS_REMOTE_MODE === "off" (default), so this is dead-code
// in single-orchestrator deployments. Feature flag locked at boot.
const { createRunnerRoutes } = require("./src/routes/runnerRoutes");

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

wss.on("connection", (ws, req) => {
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

    // Terminal boundary hardening: filter sensitive env vars
    const safeEnv = { ...process.env };
    for (const key of Object.keys(safeEnv)) {
      if (/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i.test(key) && key !== "HARNESS_TOKEN") {
        delete safeEnv[key];
      }
    }
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
const hookRouter = new HookRouter({ broadcast, sessionWatcher, runRegistry });
// Slice N (v6): shared child-process semaphore across Codex + Claude so the
// two runners can't collectively spawn more than HARNESS_CHILD_MAX processes
// at once. Queue depth broadcasts as `child_queue_depth` → dashboard.
const { createChildSemaphore } = require("./src/runtime/childSemaphore");
const childSemaphore = createChildSemaphore({
  maxConcurrent: Number(process.env.HARNESS_CHILD_MAX || 2),
  timeoutMs: Number(process.env.HARNESS_CHILD_QUEUE_TIMEOUT_MS || 30000),
  broadcast,
});
// Slice S3 (Phase 3-S, 2026-04-27): child-process lifecycle registry.
// Complements childSemaphore (which limits concurrency) by tracking which
// processes are still alive at any moment, so gracefulShutdown can
// SIGTERM → 1s grace → SIGKILL the whole set instead of orphaning Codex
// critique calls (often 120s+).
const { createChildRegistry } = require("./src/runtime/childRegistry");
const childRegistry = createChildRegistry({ broadcast });

const codexRunner = new CodexRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  broadcast,
  childSemaphore,
  childRegistry,
});
const claudeRunner = new ClaudeRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  childSemaphore,
  childRegistry,
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
  // again. Users can still pin to 1 with HARNESS_MAX_RUNS=1 for
  // single-active compat.
  maxConcurrent: Number(process.env.HARNESS_MAX_RUNS || 3),
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
// re-entering the harness. Codex uses the same CodexRunner as the verify API.
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
  // HARNESS_REMOTE_MODE=off (default), in which case _resolveOrigin
  // / _resolveRunners fall through to the local defaults — matching
  // the pre-R1-h2 behavior exactly.
  runnerProvider: _remoteRunner.runnerRegistry,
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
    const dir = path.join(REPO_ROOT, ".harness");
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
  server.once("close", () => {
    try { sessionWatcher.stop(); } catch (_) {}
    if (_ledgerCleanupInterval) clearInterval(_ledgerCleanupInterval);
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
