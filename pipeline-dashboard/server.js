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
const { createEventReplayBuffer } = require("./src/runtime/eventReplayBuffer");
const { createHeartbeat } = require("./executor/heartbeat");
const skillRegistry = require("./skill-registry");
const builtInTemplates = require("./pipeline-templates.json");
// Slice E (v4): user-uploaded "custom-*" templates live in .harness/templates.json
// and get merged in at startup + after each successful upsert/delete.
const { createTemplateStore } = require("./src/templates/templateStore");
const { createAuthMiddleware, isLoopbackAddress } = require("./src/security/auth");
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
const evidenceLedger = new EvidenceLedger({ rootDir: runsDir });
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

  const cspMode = process.env.HARNESS_CSP_MODE || "report-only";
  const headerName = cspMode === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

  // script-src: removes 'unsafe-inline' via nonce-based policy — any injected
  //   <script> without the matching nonce is blocked.
  // style-src: retains 'unsafe-inline' because the context bar (.style.width)
  //   still drives a dynamic percentage. Deferred to Slice K (SVG conversion).
  // report-uri: browser will POST violations to /api/csp-report.
  res.setHeader(headerName, [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
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
  try {
    for (const ws of clients) { try { ws.close(); } catch (_) {} }
  } catch (_) {}
  try { server.close(); } catch (_) {}
  if (process.send) {
    try { process.send({ type: "shutdown" }); } catch (_) {}
  }
  setTimeout(() => process.exit(0), 400);
}

wss.on("connection", (ws, req) => {
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

// P-5 Performance: throttle high-frequency events, deliver critical events immediately
const IMMEDIATE_TYPES = new Set([
  "pipeline_start", "pipeline_complete", "pipeline_reset",
  "phase_update", "gate_failed", "gate_evaluated", "gate_bypassed",
  "tool_blocked", "error", "server_shutdown", "server_restart",
  "general_plan_complete", "critique_received", "codex_trigger_done",
  "codex_started", "codex_progress", "context_alarm", "pipeline_mutated",
  // Audit/append-only events — must not be coalesced (Codex T0 fix)
  "tool_recorded", "hook_event", "log_message", "cycle_iteration",
  "node_update", "artifact_captured",
  // Slice A (v4): user-facing lifecycle — never throttle
  //   harness_notification feeds toasts (Slice C)
  //   pipeline_compacted tells the UI the pipeline pauses briefly for compaction
  "harness_notification", "pipeline_compacted",
]);
const _broadcastTimers = new Map();
const THROTTLE_MS = 100;

function _broadcastRaw(event) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// Replay buffer captures UI-relevant events for reconnect replay
const eventReplayBuffer = createEventReplayBuffer({ maxSize: 500 });

function broadcast(event) {
  const type = event && event.type;
  // Capture before send so reconnecting clients see consistent history
  eventReplayBuffer.append(event);
  // Auto-manage heartbeat and replay buffer on pipeline lifecycle events
  if (type === "pipeline_start" || type === "pipeline_reset") {
    eventReplayBuffer.clear();
    if (heartbeat) heartbeat.start();
  } else if (type === "pipeline_complete") {
    if (heartbeat) heartbeat.stop();
  } else if (type === "auto_pipeline_detect") {
    // Hook-driven pipeline start
    if (heartbeat) heartbeat.start();
  } else if (type === "pipeline_paused") {
    if (heartbeat) heartbeat.stop();
  }
  if (!type || IMMEDIATE_TYPES.has(type)) {
    _broadcastRaw(event);
    return;
  }
  // Throttle: first event of a type sends immediately, subsequent debounce 100ms
  if (!_broadcastTimers.has(type)) {
    _broadcastRaw(event);
    _broadcastTimers.set(type, setTimeout(() => {
      _broadcastTimers.delete(type);
    }, THROTTLE_MS));
  } else {
    // Replace pending — when timer fires the latest event is already sent above
    // on next fresh cycle. Store for edge case where timer just expired.
    clearTimeout(_broadcastTimers.get(type));
    _broadcastTimers.set(type, setTimeout(() => {
      _broadcastTimers.delete(type);
      _broadcastRaw(event);
    }, THROTTLE_MS));
  }
}

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
const codexRunner = new CodexRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  broadcast,
  childSemaphore,
});
const claudeRunner = new ClaudeRunner({
  runRegistry,
  repoRoot: REPO_ROOT,
  childSemaphore,
});

// generalRunRef.active is set by pipelineRoutes — see above
const pipelineState = new PipelineState();
const qualityGate = new QualityGate();
const skillInjector = new SkillInjector({ skillRegistry });
const pipelineAdapter = new PipelineAdapter({ templates: pipelineTemplates });
const checkpointStore = createCheckpointStore({ repoRoot: REPO_ROOT });

// Slice S (v6): wrap the singleton executor in a PipelineOrchestrator so
// later slices (T: runId routing, U: tabs, V: concurrent unlock) can grow
// naturally. Single-active compat: maxConcurrent=1, default run eagerly
// bootstrapped. External references (routes, hookRouter, heartbeat) still
// talk to the same `pipelineExecutor` reference — now sourced from
// `orchestrator.getActive()`.
const { PipelineOrchestrator } = require("./executor/pipeline-orchestrator");
const pipelineOrchestrator = new PipelineOrchestrator({
  broadcast,
  maxConcurrent: Number(process.env.HARNESS_MAX_RUNS || 1),
  createExecutor: (runId) => new PipelineExecutor({
    broadcast,
    templates: pipelineTemplates,
    codex: codexRunner,
    state: pipelineState,
    gate: qualityGate,
    injector: skillInjector,
    adapter: pipelineAdapter,
    repoRoot: REPO_ROOT,
    checkpointStore,
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
hookRouter.attachExecutor(pipelineExecutor);
// Slice T (v6): give hookRouter access to the orchestrator so it can
// resolve session_id / agent_id → runId. In single-active mode (max=1)
// unknown runIds fall back to the default executor, so behavior is
// unchanged — the routing just becomes available for Slice V to use.
hookRouter.attachOrchestrator(pipelineOrchestrator);

app.use("/api", createHookRoutes({ hookRouter, validateHook }));
app.use("/api", createExecutorRoutes({ pipelineExecutor, validateExecutorMode }));
app.use("/api", createServerControlRoutes({
  broadcast,
  clients,
  gracefulShutdown,
  server,
  CLIENT_GRACE_MS,
  shutdownTimerRef: { get timer() { return shutdownTimer; } },
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
function buildPlannerPrompt(task) {
  return (
    `You are a software planner. Create a concrete implementation plan for the task below.\n` +
    `Respond in Korean using this exact markdown structure:\n\n` +
    `# 목표\n(1-2 sentences)\n\n` +
    `# 범위\n- (in-scope bullet)\n- (out-of-scope bullet)\n\n` +
    `# 작업 단계\n1. (actionable step)\n2. ...\n\n` +
    `# 리스크\n- (risk)\n\n` +
    `# 검증\n- (how to verify)\n\n` +
    `Do NOT write code or modify any files. Planning only. Keep it under 700 words.\n\n` +
    `TASK: ${task}`
  );
}

function buildRefinerPrompt(task, prevPlan, critique) {
  return (
    `You are a software planner. Revise the implementation plan below based on the critic's feedback.\n` +
    `Address every critical and high severity finding explicitly.\n` +
    `Respond in Korean using the same markdown structure (# 목표 / # 범위 / # 작업 단계 / # 리스크 / # 검증).\n` +
    `Do NOT write code or modify any files. Planning only.\n\n` +
    `TASK: ${task}\n\n` +
    `PREVIOUS PLAN:\n${prevPlan.slice(0, 4500)}\n\n` +
    `CRITIC FEEDBACK:\n${critique.slice(0, 3000)}`
  );
}

function buildCriticPrompt(task, plan) {
  return (
    `You are a plan critic. Review this implementation plan and list concrete risks, missing steps, and improvements.\n` +
    `Respond in Korean. Use bullet lines in this exact format:\n` +
    `- [critical|high|medium|low] <message>\n` +
    `End with a "## Summary" section (1-2 sentences).\n\n` +
    `TASK: ${task}\n\nPLAN:\n${plan.slice(0, 6000)}`
  );
}

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

async function runGeneralPipeline(task, maxIter, runId) {
  const started = Date.now();
  const history = [];
  let plan = "";
  let lastCritique = null;
  let iteration = 0;

  // P-2 Performance: cumulative wall-clock timeout (default 10 min)
  const PIPELINE_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS) || 600_000;
  const isTimedOut = () => (Date.now() - started) > PIPELINE_TIMEOUT_MS;

  // Helper: abort or timeout check
  const isAborted = () => generalRunRef.active && generalRunRef.active.aborted;

  broadcast({
    type: "pipeline_start",
    data: { targetFile: `task: ${task.slice(0, 80)}`, mode: "live", runId, template: "default" },
  });

  // ── Phase A (컨텍스트 수집): marked as completed immediately.
  // The user-provided task IS the context for this automated flow.
  broadcast({ type: "phase_update", data: { phase: "A", status: "active" } });
  broadcast({ type: "node_update", data: { node: "context-analyzer", status: "active" } });
  await new Promise((r) => setTimeout(r, 200));
  broadcast({ type: "node_update", data: { node: "context-analyzer", status: "completed" } });
  broadcast({ type: "phase_update", data: { phase: "A", status: "completed" } });
  if (isAborted() || isTimedOut()) return finalizeGeneralRun({ aborted: true, runId, started, reason: isTimedOut() ? "pipeline-timeout" : undefined });

  // ── Phase B (Claude 계획 수립) ──
  broadcast({ type: "phase_update", data: { phase: "B", status: "active" } });
  broadcast({ type: "node_update", data: { node: "task-planner", status: "active" } });

  const planPromptB = buildPlannerPrompt(task);
  const planResultB = await claudeRunner.exec(planPromptB, {
    timeoutMs: 180000,
    cwd: path.join(__dirname, ".."),
    onChild: (c) => activeCodexChildren.add(c),
  });

  if (!planResultB.ok || !planResultB.text) {
    broadcast({
      type: "error",
      data: {
        phase: "B",
        node: "task-planner",
        message: `Claude 플래닝 실패: exit=${planResultB.exitCode} ${(planResultB.stderr || planResultB.error || "").slice(0, 300)}`,
      },
    });
    broadcast({ type: "node_update", data: { node: "task-planner", status: "error" } });
    broadcast({ type: "phase_update", data: { phase: "B", status: "error" } });
    return finalizeGeneralRun({ failed: true, reason: "claude-plan-failed", runId, started });
  }
  plan = planResultB.text;
  history.push({ phase: "B", iteration: 0, plan });
  broadcast({
    type: "log_message",
    data: { level: "info", message: `[B] Claude 플랜 생성 완료 (${plan.length}자)` },
  });
  broadcast({ type: "node_update", data: { node: "task-planner", status: "completed" } });
  broadcast({ type: "phase_update", data: { phase: "B", status: "completed" } });
  if (isAborted() || isTimedOut()) return finalizeGeneralRun({ aborted: true, runId, started, plan, reason: isTimedOut() ? "pipeline-timeout" : undefined });

  // ── Phase C ↔ D cycle ──
  while (iteration < maxIter) {
    if (isTimedOut()) {
      broadcast({ type: "log_message", data: { level: "warn", message: `[pipeline] wall-clock timeout (${PIPELINE_TIMEOUT_MS}ms) — stopping cycle` } });
      return finalizeGeneralRun({ runId, started, plan, lastCritique, iterations: iteration, history, failed: true, reason: "pipeline-timeout" });
    }
    // Phase C: Codex critique
    broadcast({ type: "phase_update", data: { phase: "C", status: "active" } });
    broadcast({ type: "node_update", data: { node: "plan-critic", status: "active" } });
    broadcast({
      type: "codex_started",
      data: { phase: "C", iteration, promptPreview: `Critique iteration ${iteration + 1}/${maxIter}` },
    });

    const critiqueResult = await codexRunner.exec(buildCriticPrompt(task, plan), {
      timeoutMs: 150000,
      cwd: path.join(__dirname, ".."),
      phaseId: "C",
      iteration,
      source: "general-pipeline",
    });

    const findings = critiqueResult.findings || [];
    const summary = critiqueResult.summary || "";
    lastCritique = { findings, summary, ok: critiqueResult.ok, iteration };

    broadcast({
      type: "critique_received",
      data: {
        phase: "C",
        iteration,
        ok: critiqueResult.ok,
        summary,
        findings,
        error: critiqueResult.error || null,
      },
    });

    if (!critiqueResult.ok) {
      broadcast({
        type: "error",
        data: {
          phase: "C",
          node: "plan-critic",
          message: `Codex 비평 실패: exit=${critiqueResult.exitCode} ${(critiqueResult.stderr || critiqueResult.error || "").slice(0, 300)}`,
        },
      });
      broadcast({ type: "node_update", data: { node: "plan-critic", status: "error" } });
      return finalizeGeneralRun({
        failed: true,
        reason: "codex-critique-failed",
        runId,
        started,
        plan,
        lastCritique,
      });
    }

    broadcast({ type: "node_update", data: { node: "plan-critic", status: "completed", findings: findings.length } });

    const hasCriticalOrHigh = findings.some((f) => f.severity === "critical" || f.severity === "high");
    const canIterate = iteration + 1 < maxIter;

    if (!hasCriticalOrHigh) {
      broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
      broadcast({
        type: "log_message",
        data: { level: "info", message: `[C] critical/high 없음 — 사이클 종료` },
      });
      break;
    }

    if (!canIterate) {
      broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
      broadcast({
        type: "log_message",
        data: {
          level: "warn",
          message: `[C] 최대 반복(${maxIter}) 도달 — 남은 critical/high: ${findings.filter((f) => f.severity === "critical" || f.severity === "high").length}`,
        },
      });
      break;
    }

    // Phase D: Claude refines
    iteration++;
    broadcast({ type: "cycle_iteration", data: { phase: "C", iteration, linkedTo: "D" } });
    broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
    broadcast({ type: "phase_update", data: { phase: "D", status: "active" } });
    broadcast({ type: "node_update", data: { node: "plan-refiner", status: "active" } });

    if (isAborted() || isTimedOut()) return finalizeGeneralRun({ aborted: true, runId, started, plan, lastCritique, reason: isTimedOut() ? "pipeline-timeout" : undefined });

    const critiqueText =
      findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n") +
      (summary ? `\n\n## Summary\n${summary}` : "");
    const refineResult = await claudeRunner.exec(buildRefinerPrompt(task, plan, critiqueText), {
      timeoutMs: 180000,
      cwd: path.join(__dirname, ".."),
    });

    if (!refineResult.ok || !refineResult.text) {
      broadcast({
        type: "error",
        data: {
          phase: "D",
          node: "plan-refiner",
          message: `Claude 수정 실패: exit=${refineResult.exitCode} ${(refineResult.stderr || refineResult.error || "").slice(0, 300)}`,
        },
      });
      broadcast({ type: "node_update", data: { node: "plan-refiner", status: "error" } });
      return finalizeGeneralRun({ failed: true, reason: "claude-refine-failed", runId, started, plan, lastCritique });
    }
    plan = refineResult.text;
    history.push({ phase: "D", iteration, plan });
    broadcast({
      type: "log_message",
      data: { level: "info", message: `[D] Claude 플랜 수정 완료 (${plan.length}자, 반복 ${iteration})` },
    });
    broadcast({ type: "node_update", data: { node: "plan-refiner", status: "completed" } });
    broadcast({ type: "phase_update", data: { phase: "D", status: "completed" } });
  }

  return finalizeGeneralRun({ runId, started, plan, lastCritique, iterations: iteration, history });
}

function finalizeGeneralRun({ runId, started, plan, lastCritique, iterations, history, aborted, failed, reason }) {
  const duration = Date.now() - (started || Date.now());
  const verdict = failed ? "ERROR" : aborted ? "ABORTED" : (lastCritique && lastCritique.findings || []).some((f) => f.severity === "critical" || f.severity === "high") ? "CONCERNS" : "CLEAN";

  broadcast({
    type: "general_plan_complete",
    data: {
      runId,
      verdict,
      iterations: iterations || 0,
      durationMs: duration,
      finalPlan: plan || "",
      lastCritique: lastCritique || null,
      reason: reason || null,
      aborted: !!aborted,
      failed: !!failed,
    },
  });

  broadcast({
    type: "pipeline_complete",
    data: {
      tokenUsage: {},
      errors: failed ? [{ phase: "general", node: "orchestrator", message: reason || "failed" }] : [],
      duration,
      harnessId: "general-plan",
    },
  });
  return { verdict, iterations: iterations || 0, durationMs: duration, plan };
}

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
