const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── P0-1: .env loader must run before any process.env read ──
const { loadDotenv } = require("./executor/env-loader");
loadDotenv(__dirname);
const {
  resolveBindHost,
  createTokenMiddleware,
  verifyWsOrigin,
} = require("./executor/security");

// ── P0-2: File access sandbox root (workspace repo root) ──
const pathGuard = require("./executor/path-guard");
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

// ── P0-3: Unified child process registry ──
const { ChildRegistry } = require("./executor/child-registry");
const childRegistry = new ChildRegistry();

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
const { createGeneralPipeline } = require("./executor/general-pipeline");
const codexTriggersRoute = require("./routes/codex-triggers");
const { PipelineState } = require("./executor/pipeline-state");
const { QualityGate } = require("./executor/quality-gate");
const { SkillInjector } = require("./executor/skill-injector");
const { PipelineAdapter } = require("./executor/pipeline-adapter");
const { ContextAlarm } = require("./executor/context-alarm");
const dangerGate = require("./executor/danger-gate");
const skillRegistry = require("./skill-registry");
const pipelineTemplates = require("./pipeline-templates.json");

// ── Runtime identity (T0) ──
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_PID = process.pid;
let SERVER_COMMIT_SHA = "unknown";
try {
  SERVER_COMMIT_SHA = execSync("git rev-parse HEAD", {
    cwd: path.resolve(__dirname, ".."),
  }).toString().trim();
} catch (e) {
  console.warn("[T0] git rev-parse failed:", e.message);
}

const app = express();
const server = http.createServer(app);

// ── P0-1: token middleware (loopback bypass + X-Harness-Token on non-loopback) ──
const getHarnessToken = () => process.env.HARNESS_TOKEN || "";
const tokenGuard = createTokenMiddleware({ getToken: getHarnessToken });

// ── P0-1: WebSocket upgrade verifier ──
const wss = new WebSocketServer({
  server,
  verifyClient: (info, cb) => {
    const ok = verifyWsOrigin({ req: info.req, getToken: getHarnessToken });
    if (ok) return cb ? cb(true) : true;
    if (cb) return cb(false, 401, "unauthorized");
    return false;
  },
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── Health / Event / Reset API ──
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), terminal: !!pty });
});

// ── /api/version (T0): runtime proof endpoint ──
// Lets callers verify the live Node process actually loaded the expected commit.
app.get("/api/version", (req, res) => {
  res.json({
    commitSha: SERVER_COMMIT_SHA,
    startedAt: SERVER_STARTED_AT,
    pid: SERVER_PID,
    node: process.version,
    uptime: process.uptime(),
  });
});

// Track connected clients. All subprocess tracking goes through childRegistry (P0-3).
const clients = new Set();

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
  console.log(`[shutdown] graceful shutdown (${reason}) — reaping ${childRegistry.size()} children`);
  try { broadcast({ type: "server_shutdown", data: { reason } }); } catch (_) {}
  try { sessionWatcher && sessionWatcher.stop && sessionWatcher.stop(); } catch (_) {}
  childRegistry.killAll();
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
  if (req.url === "/terminal") {
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

    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd: path.join(__dirname, ".."),
      env: process.env,
    });
    childRegistry.track(ptyProcess, "pty");

    ptyProcess.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "output", data }));
    });

    ws.on("message", (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === "input") ptyProcess.write(parsed.data);
        if (parsed.type === "resize") ptyProcess.resize(parsed.cols, parsed.rows);
      } catch (e) { /* ignore malformed messages */ }
    });

    ws.on("close", () => {
      try { ptyProcess.kill(); } catch (_) {}
      childRegistry.untrack(ptyProcess);
    });
    return;
  }

  // ── Pipeline event WebSocket ──
  clients.add(ws);
  cancelShutdownTimer();
  console.log(`[ws] client connected — total=${clients.size}`);
  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected — total=${clients.size}`);
    if (clients.size === 0) armShutdownTimer();
  });
});

function broadcast(event) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// -------------------------------------------------------------------
// P0-3: Legacy runPipeline() + /api/run removed.
// The demo pipeline used execSync with interpolated paths (shell injection)
// and was no longer called from the frontend. The live general-plan flow
// at /api/pipeline/general-run replaces it.
// -------------------------------------------------------------------


// External event ingestion — skill posts events here via curl
app.post("/api/event", tokenGuard, (req, res) => {
  const event = req.body;
  if (!event || !event.type) {
    return res.status(400).json({ error: "Missing event type" });
  }
  broadcast(event);
  res.json({ status: "received", type: event.type });
});

// Reset dashboard state
app.post("/api/reset", tokenGuard, (req, res) => {
  broadcast({ type: "pipeline_reset", data: {} });
  res.json({ status: "reset" });
});

// ── Skill Registry API ──
app.get("/api/skills", (req, res) => {
  if (req.query.category === "grouped") {
    res.json(getSkillsByCategory());
  } else if (req.query.q) {
    res.json(searchSkills(req.query.q));
  } else {
    res.json(scanSkills());
  }
});

app.get("/api/skills/:id", (req, res) => {
  const content = getSkillContent(req.params.id);
  if (content) {
    res.json({ id: req.params.id, content });
  } else {
    res.status(404).json({ error: "Skill not found" });
  }
});

app.get("/api/skills/harness/:type", (req, res) => {
  res.json(getSkillsForHarness(req.params.type));
});

// ── Context Discovery API ──
app.post("/api/context/discover", tokenGuard, (req, res) => {
  const projectRoot = req.body.projectRoot || WORKSPACE_ROOT;
  if (!pathGuard.isInside(WORKSPACE_ROOT, projectRoot)) {
    return res.status(403).json({ error: "projectRoot escapes workspace sandbox" });
  }
  const context = discoverContextFiles(projectRoot, { sandboxRoot: WORKSPACE_ROOT });
  res.json(context);
});

app.post("/api/context/load", tokenGuard, (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "Missing filePath" });
  let resolved;
  try {
    resolved = pathGuard.realpathInside(WORKSPACE_ROOT, filePath);
  } catch (e) {
    if (e && e.code === "EPATHESCAPE") {
      return res.status(403).json({ error: "filePath escapes workspace sandbox" });
    }
    throw e;
  }
  if (resolved === null) {
    return res.status(404).json({ error: "File not found" });
  }
  const content = loadFileContent(resolved);
  if (content !== null) {
    res.json({ filePath: resolved, content });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// ── Codex Triggers API ── (extracted to routes/codex-triggers.js in P2-3)
// Mounted below after codexRunner is constructed.

// ── Pipeline Templates API ──
app.get("/api/pipeline/templates", (req, res) => {
  res.json(pipelineTemplates);
});

app.get("/api/pipeline/templates/:id", (req, res) => {
  const template = pipelineTemplates[req.params.id];
  if (template) {
    res.json(template);
  } else {
    res.status(404).json({ error: "Template not found" });
  }
});

// ── Session Watcher (auto-pipeline detection) ──
// P1-3: HARNESS_WATCHER_MODE env controls dedup with HookRouter.
//   auto    (default) start polling; flip to hook-driven when executor attaches
//   hook    always hook-driven (broadcasts suppressed)
//   watcher always watcher-driven (legacy fallback, broadcasts always flow)
//   off     no polling at all
const sessionWatcher = new SessionWatcher(broadcast, path.resolve(__dirname, ".."));
sessionWatcher.start();

app.get("/api/watcher/status", (req, res) => {
  res.json(sessionWatcher.getStatus());
});

app.post("/api/watcher/complete", tokenGuard, (req, res) => {
  sessionWatcher.completePipeline();
  res.json({ status: "completed" });
});

// ── Hook Router + Pipeline Executor (Phase 1 + 2 + 3 + 4) ──
const hookRouter = new HookRouter({ broadcast, sessionWatcher });
const codexRunner = new CodexRunner({});
const claudeRunner = new ClaudeRunner({});

// Mount Codex triggers route now that codexRunner exists.
app.use(
  "/api/codex",
  codexTriggersRoute.createRouter({ tokenGuard, broadcast, codexRunner, childRegistry })
);

const pipelineState = new PipelineState();
const qualityGate = new QualityGate();
const skillInjector = new SkillInjector({ skillRegistry });
const pipelineAdapter = new PipelineAdapter({ templates: pipelineTemplates });
const pipelineExecutor = new PipelineExecutor({
  broadcast,
  templates: pipelineTemplates,
  codex: codexRunner,
  state: pipelineState,
  gate: qualityGate,
  injector: skillInjector,
  adapter: pipelineAdapter,
});
hookRouter.attachExecutor(pipelineExecutor);

// ── T2: context usage banner (rev2 H4/H5) ──
// Evaluates every hook payload for context pressure and broadcasts
// `context_alarm` at 40% / 55%. Never returns block — UI shows a banner
// recommending /compact.
const contextAlarm = new ContextAlarm({ broadcast });

app.post("/api/hook", tokenGuard, async (req, res) => {
  try {
    const { event, payload } = req.body || {};
    if (!event) return res.status(400).json({ error: "missing event" });

    try {
      contextAlarm.evaluate(payload || {});
    } catch (e) {
      console.warn("[T2] contextAlarm error:", e.message);
    }

    // T9 danger gate — second entry point (H6: single gate, dual entry).
    // Runs independently of the executor so dangerous ops are blocked even
    // when harness mode is off.
    if (event === "pre-tool" || event === "PreToolUse") {
      const p = payload || {};
      const reason = dangerGate.isDangerous(p.tool_name, p.tool_input || {});
      if (reason) {
        broadcast({
          type: "dangers_blocked",
          data: { tool: p.tool_name, reason, entry: "hook" },
        });
        return res.json({
          decision: "block",
          reason: `위험 작업 차단 (${reason}) — 하네스 danger-gate에서 차단됨.`,
        });
      }
    }

    const decision = await hookRouter.route(event, payload || {});
    res.json(decision || {});
  } catch (err) {
    // Never block Claude on harness errors
    console.error("[HookRouter] error:", err.message);
    res.json({});
  }
});

app.get("/api/hook/stats", (req, res) => {
  res.json(hookRouter.getStats());
});

// ── Executor Mode Control ──
app.get("/api/executor/mode", (req, res) => {
  res.json(pipelineExecutor.getStatus());
});

app.post("/api/executor/mode", tokenGuard, (req, res) => {
  const { enabled } = req.body || {};
  pipelineExecutor.setEnabled(!!enabled);
  res.json(pipelineExecutor.getStatus());
});

// ── Server Control API (stop / restart) ──
app.post("/api/server/shutdown", tokenGuard, (req, res) => {
  res.json({ status: "shutting-down" });
  setTimeout(() => gracefulShutdown("api-shutdown"), 100);
});

app.post("/api/server/restart", tokenGuard, (req, res) => {
  if (!process.send) {
    res.status(409).json({ error: "not supervised — run via start.js for restart support" });
    return;
  }
  res.json({ status: "restarting" });
  setTimeout(() => {
    try { broadcast({ type: "server_restart", data: {} }); } catch (_) {}
    try { process.send({ type: "restart" }); } catch (_) {}
    try { server.close(); } catch (_) {}
    setTimeout(() => process.exit(0), 300);
  }, 100);
});

app.get("/api/server/info", (req, res) => {
  res.json({
    pid: process.pid,
    supervised: !!process.send,
    clients: clients.size,
    uptime: process.uptime(),
    graceMs: CLIENT_GRACE_MS,
    shutdownArmed: !!shutdownTimer,
  });
});

// ── Codex CLI verification + general-plan critique ──
// Uses CodexRunner so we exercise the exact code path the pipeline executor uses.
app.post("/api/codex/verify", tokenGuard, async (req, res) => {
  const start = Date.now();
  broadcast({ type: "codex_verify_started", data: {} });
  const result = await codexRunner.exec(
    "Respond with exactly the phrase: CODEX_OK. Do not run any tools or shell commands.",
    {
      timeoutMs: 60000,
      cwd: path.join(__dirname, ".."),
      onChild: (c) => childRegistry.track(c, "codex"),
    }
  );
  const durationMs = Date.now() - start;
  const detectedMarker = /CODEX_OK/.test(result.stdout || "");
  const payload = {
    ok: !!result.ok,
    detectedMarker,
    exitCode: result.exitCode,
    durationMs,
    stdoutSnippet: (result.stdout || "").slice(0, 1200),
    stderrSnippet: (result.stderr || "").slice(0, 600),
    error: result.error || null,
    command: "codex exec --full-auto --skip-git-repo-check",
  };
  broadcast({ type: "codex_verify_result", data: payload });
  res.json(payload);
});

// ── Automated General Pipeline (Claude plan ↔ Codex critique cycle) ──
// Orchestrator lives in executor/general-pipeline.js (extracted in P2-3).
const generalPipeline = createGeneralPipeline({
  broadcast,
  claudeRunner,
  codexRunner,
  childRegistry,
  workspaceRoot: path.join(__dirname, ".."),
});

app.post("/api/pipeline/general-run", tokenGuard, (req, res) => {
  const { task, maxIterations } = req.body || {};
  if (!task || typeof task !== "string" || task.trim().length < 3) {
    return res.status(400).json({ error: "task (string, 3+ chars) is required" });
  }
  const maxIter = Math.max(1, Math.min(Number(maxIterations) || 3, 5));
  const started = generalPipeline.start(task.trim(), maxIter);
  if (started.error) {
    return res.status(409).json({ error: started.error });
  }
  res.json({ status: "started", runId: started.runId, task, maxIterations: maxIter });
});

app.post("/api/pipeline/general-abort", tokenGuard, (req, res) => {
  const runId = generalPipeline.abort();
  if (!runId) return res.json({ status: "no-active-run" });
  res.json({ status: "abort-requested", runId });
});

// OS signals → graceful shutdown
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

const PORT = process.env.PORT || 4200;
const { host: BIND_HOST, loopbackOnly: BIND_LOOPBACK_ONLY } = resolveBindHost(process.env);
const HARNESS_TOKEN_SET = !!process.env.HARNESS_TOKEN;
server.listen(PORT, BIND_HOST, () => {
  console.log(`Pipeline Dashboard: http://${BIND_HOST}:${PORT}`);
  console.log(`  Bind host: ${BIND_HOST} (${BIND_LOOPBACK_ONLY ? "loopback-only" : "network-exposed"})`);
  console.log(`  Harness token: ${HARNESS_TOKEN_SET ? "configured" : "UNSET"}`);
  if (!BIND_LOOPBACK_ONLY && !HARNESS_TOKEN_SET) {
    console.warn(
      "  [WARN] Server is bound to a non-loopback host with no HARNESS_TOKEN. " +
      "Mutating routes are unprotected — set HARNESS_TOKEN in pipeline-dashboard/.env."
    );
  }
  console.log(`  Terminal: ${pty ? "enabled" : "disabled (install node-pty)"}`);
  console.log(`  Session Watcher: active`);
  console.log(`  Supervised: ${process.send ? "yes (restart enabled)" : "no (start via start.js for restart)"}`);
  console.log(`  Client grace period: ${CLIENT_GRACE_MS}ms`);
});
