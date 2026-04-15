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

// ── Codex Triggers API ──
// On-demand Codex invocation independent of the phase pipeline.
// The UI shows one card per trigger; clicking runs Codex against a
// trigger-specific context source (plan file / git diff / user input).
const CODEX_TRIGGER_DIR = path.resolve(__dirname, "..", "_workspace");

app.get("/api/codex/triggers", (req, res) => {
  res.json(getTriggers());
});

app.post("/api/codex/trigger", tokenGuard, async (req, res) => {
  const { triggerId, userInput } = req.body || {};
  const trigger = getTriggerById(triggerId);
  if (!trigger) return res.status(404).json({ error: "Unknown trigger" });

  let context;
  try {
    context = resolveTriggerContext(trigger, userInput);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!context || !context.trim()) {
    return res.status(400).json({ error: `컨텍스트가 비어있습니다 (${trigger.contextSource})` });
  }

  broadcast({
    type: "codex_trigger_started",
    data: { triggerId, name: trigger.name, contextBytes: context.length },
  });

  const prompt = trigger.promptTemplate(context);
  const result = await codexRunner.exec(prompt, {
    timeoutMs: trigger.timeoutMs || 300000,
    onChild: (c) => childRegistry.track(c, "codex"),
    // P1-6 — stream stdout/stderr chunks to the UI so the user can watch
    // Codex progress instead of staring at a spinning card. We trim each
    // chunk at the broadcast layer to keep event sizes reasonable.
    onChunk: ({ stream, text }) => {
      if (!text) return;
      const payload = text.length > 4000 ? text.slice(0, 4000) + "…" : text;
      broadcast({
        type: "codex_trigger_chunk",
        data: { triggerId, name: trigger.name, stream, text: payload },
      });
    },
  });

  let filePath = null;
  try {
    if (!fs.existsSync(CODEX_TRIGGER_DIR)) fs.mkdirSync(CODEX_TRIGGER_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    filePath = path.join(CODEX_TRIGGER_DIR, `codex-trigger-${triggerId}-${ts}.md`);
    const body = [
      `# Codex Trigger — ${trigger.name}`,
      `triggered: ${new Date().toISOString()}`,
      `contextSource: ${trigger.contextSource}`,
      `exitCode: ${result.exitCode}`,
      "",
      "## Summary",
      result.summary || "(empty)",
      "",
      "## Findings",
      (result.findings || []).length
        ? result.findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n")
        : "(none)",
      "",
      "## Raw stdout",
      "```",
      result.stdout || "",
      "```",
      "",
      "## Raw stderr",
      "```",
      result.stderr || "",
      "```",
      "",
      "## Prompt",
      "```",
      prompt,
      "```",
    ].join("\n");
    fs.writeFileSync(filePath, body, "utf-8");
  } catch (err) {
    console.error("[codex-trigger] persist failed:", err.message);
  }

  broadcast({
    type: "codex_trigger_done",
    data: {
      triggerId,
      name: trigger.name,
      ok: result.ok,
      summary: result.summary,
      findingsCount: (result.findings || []).length,
      filePath,
    },
  });

  res.json({
    ok: result.ok,
    summary: result.summary,
    findings: result.findings || [],
    filePath,
    exitCode: result.exitCode,
  });
});

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

// Track in-progress general-run orchestrations so shutdown can abort them.
let generalRunActive = null;
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

app.post("/api/pipeline/general-run", tokenGuard, async (req, res) => {
  const { task, maxIterations } = req.body || {};
  if (!task || typeof task !== "string" || task.trim().length < 3) {
    return res.status(400).json({ error: "task (string, 3+ chars) is required" });
  }
  if (generalRunActive) {
    return res.status(409).json({ error: "another general-run pipeline is already active" });
  }

  const maxIter = Math.max(1, Math.min(Number(maxIterations) || 3, 5));
  const runId = `gr-${Date.now()}`;
  generalRunActive = { runId, startedAt: Date.now(), aborted: false };

  // Respond immediately — the orchestration runs asynchronously and
  // streams events over the WebSocket so the dashboard updates live.
  res.json({ status: "started", runId, task, maxIterations: maxIter });

  runGeneralPipeline(task.trim(), maxIter, runId).catch((err) => {
    broadcast({ type: "error", data: { phase: "general", node: "orchestrator", message: err.message } });
  }).finally(() => {
    generalRunActive = null;
  });
});

app.post("/api/pipeline/general-abort", tokenGuard, (req, res) => {
  if (!generalRunActive) return res.json({ status: "no-active-run" });
  generalRunActive.aborted = true;
  res.json({ status: "abort-requested", runId: generalRunActive.runId });
});

async function runGeneralPipeline(task, maxIter, runId) {
  const started = Date.now();
  const history = [];
  let plan = "";
  let lastCritique = null;
  let iteration = 0;

  // Helper: abort check
  const isAborted = () => generalRunActive && generalRunActive.aborted;

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
  if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started });

  // ── Phase B (Claude 계획 수립) ──
  broadcast({ type: "phase_update", data: { phase: "B", status: "active" } });
  broadcast({ type: "node_update", data: { node: "task-planner", status: "active" } });

  const planPromptB = buildPlannerPrompt(task);
  const planResultB = await claudeRunner.exec(planPromptB, {
    timeoutMs: 180000,
    cwd: path.join(__dirname, ".."),
    onChild: (c) => childRegistry.track(c, "claude"),
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
  if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started });

  // ── Phase C ↔ D cycle ──
  while (iteration < maxIter) {
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
      onChild: (c) => childRegistry.track(c, "codex"),
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

    if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started, plan, lastCritique });

    const critiqueText =
      findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n") +
      (summary ? `\n\n## Summary\n${summary}` : "");
    const refineResult = await claudeRunner.exec(buildRefinerPrompt(task, plan, critiqueText), {
      timeoutMs: 180000,
      cwd: path.join(__dirname, ".."),
      onChild: (c) => childRegistry.track(c, "claude"),
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
