const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");

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
const { recommendNext, getHarnessTypes, getHarnessById } = require("./harness-recommender");
const { SessionWatcher } = require("./session-watcher");
const { HookRouter } = require("./executor/hook-router");
const { PipelineExecutor } = require("./executor/pipeline-executor");
const { CodexRunner } = require("./executor/codex-runner");
const { ClaudeRunner } = require("./executor/claude-runner");
const { PipelineState } = require("./executor/pipeline-state");
const { QualityGate } = require("./executor/quality-gate");
const { SkillInjector } = require("./executor/skill-injector");
const { PipelineAdapter } = require("./executor/pipeline-adapter");
const skillRegistry = require("./skill-registry");
const pipelineTemplates = require("./pipeline-templates.json");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── Health / Event / Reset API ──
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), terminal: !!pty });
});

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
    ptyProcesses.add(ptyProcess);

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
      ptyProcesses.delete(ptyProcess);
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

// Utility: sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Token tracking
let tokenUsage = { claude: 0, codex: 0 };
let codexUsageAccum = { messages: 0, total: 0 };

// -------------------------------------------------------------------
// Pipeline execution
// -------------------------------------------------------------------

async function runPipeline(targetFile, mode = "demo") {
  const errors = [];
  tokenUsage = { claude: 0, codex: 0 };
  codexUsageAccum = { messages: 0, total: 0 };

  broadcast({ type: "pipeline_start", data: { targetFile, mode } });
  broadcast({ type: "token_update", data: { ...tokenUsage } });

  try {
    // ── PHASE A: Co-Planning ──
    broadcast({ type: "phase_update", data: { phase: "A", status: "active" } });
    broadcast({
      type: "node_update",
      data: { node: "claude-plan", status: "active" },
    });

    if (mode === "live") {
      // Real: Claude Code reads the file and creates a review plan
      await sleep(1500);
    } else {
      await sleep(2000);
    }

    tokenUsage.claude += 2840;
    broadcast({ type: "token_update", data: { ...tokenUsage } });
    broadcast({
      type: "node_update",
      data: { node: "claude-plan", status: "completed" },
    });

    // Codex reviews the plan
    broadcast({
      type: "node_update",
      data: { node: "codex-plan", status: "active" },
    });

    if (mode === "live") {
      try {
        const codexResult = execSync(
          `npx @openai/codex exec --full-auto --skip-git-repo-check "Review this plan briefly and suggest one improvement. Plan: review ${targetFile} for security, stability, readability. Respond in under 50 words."`,
          { cwd: path.dirname(targetFile), timeout: 60000, encoding: "utf8" }
        );
        tokenUsage.codex += 1200; codexUsageAccum.messages++; codexUsageAccum.total += 1200;
      } catch (e) {
        errors.push({
          phase: "A",
          node: "codex-plan",
          message: "Codex plan review failed: " + (e.message || "").slice(0, 100),
        });
        broadcast({
          type: "error",
          data: errors[errors.length - 1],
        });
      }
    } else {
      await sleep(1800);
      tokenUsage.codex += 1520; codexUsageAccum.messages++; codexUsageAccum.total += 1520;
    }

    broadcast({ type: "token_update", data: { ...tokenUsage } });
    broadcast({
      type: "node_update",
      data: { node: "codex-plan", status: "completed" },
    });
    broadcast({
      type: "phase_update",
      data: { phase: "A", status: "completed" },
    });

    // ── PHASE B: Implementation (skip for review-only) ──
    broadcast({ type: "phase_update", data: { phase: "B", status: "active" } });
    broadcast({
      type: "node_update",
      data: { node: "claude-code", status: "active" },
    });
    await sleep(800);
    tokenUsage.claude += 500;
    broadcast({ type: "token_update", data: { ...tokenUsage } });
    broadcast({
      type: "node_update",
      data: { node: "claude-code", status: "completed" },
    });
    broadcast({
      type: "phase_update",
      data: { phase: "B", status: "completed" },
    });

    // ── PHASE C: Review Cycle ──
    broadcast({ type: "phase_update", data: { phase: "C", status: "active" } });

    // C-1: Orchestrator dispatches
    broadcast({
      type: "node_update",
      data: { node: "orchestrator", status: "active" },
    });
    await sleep(600);
    tokenUsage.claude += 800;
    broadcast({ type: "token_update", data: { ...tokenUsage } });
    broadcast({
      type: "node_update",
      data: { node: "orchestrator", status: "completed" },
    });

    // C-2: Three reviewers in parallel
    broadcast({
      type: "node_update",
      data: { node: "saboteur", status: "active" },
    });
    broadcast({
      type: "node_update",
      data: { node: "security", status: "active" },
    });
    broadcast({
      type: "node_update",
      data: { node: "readability", status: "active" },
    });

    const reviewerResults = { saboteur: [], security: [], readability: [] };

    if (mode === "live") {
      // Real review would use Agent tool — simulate with timed delays
      // In production, these would be actual agent calls
      await sleep(3000);
      tokenUsage.claude += 28000;
    } else {
      // Staggered completion for visual effect
      await sleep(2200);
      tokenUsage.claude += 8500;
      broadcast({ type: "token_update", data: { ...tokenUsage } });

      reviewerResults.security = [
        { severity: "CRITICAL", file: "server.js", line: 15, message: "SQL Injection: req.params.id 직접 보간" },
        { severity: "CRITICAL", file: "server.js", line: 9, message: "하드코딩 비밀번호 admin123 노출" },
        { severity: "CRITICAL", file: "server.js", line: 23, message: "Path Traversal: req.query.file 미검증" },
      ];
      broadcast({
        type: "node_update",
        data: { node: "security", status: "completed", findings: reviewerResults.security.length },
      });
      broadcast({
        type: "findings",
        data: { persona: "security", findings: reviewerResults.security },
      });

      await sleep(1200);
      tokenUsage.claude += 9200;
      broadcast({ type: "token_update", data: { ...tokenUsage } });

      reviewerResults.saboteur = [
        { severity: "CRITICAL", file: "server.js", line: 16, message: "db.query err 미처리 → TypeError 크래시" },
        { severity: "CRITICAL", file: "server.js", line: 47, message: "setInterval 내 에러 → 프로세스 종료" },
        { severity: "CRITICAL", file: "server.js", line: 24, message: "createReadStream error 핸들러 없음" },
        { severity: "WARNING", file: "server.js", line: 44, message: "캐시 메모리 누수: 삭제 항목 미제거" },
      ];
      broadcast({
        type: "node_update",
        data: { node: "saboteur", status: "completed", findings: reviewerResults.saboteur.length },
      });
      broadcast({
        type: "findings",
        data: { persona: "saboteur", findings: reviewerResults.saboteur },
      });

      await sleep(800);
      tokenUsage.claude += 8800;
      broadcast({ type: "token_update", data: { ...tokenUsage } });

      reviewerResults.readability = [
        { severity: "CRITICAL", file: "server.js", line: 29, message: "함수 p() 한 글자 변수명 — 해독 불가" },
        { severity: "WARNING", file: "server.js", line: 35, message: "매직넘버 1.08 의미 불명" },
        { severity: "NOTE", file: "server.js", line: 53, message: "서버 시작 로그 없음" },
      ];
      broadcast({
        type: "node_update",
        data: { node: "readability", status: "completed", findings: reviewerResults.readability.length },
      });
      broadcast({
        type: "findings",
        data: { persona: "readability", findings: reviewerResults.readability },
      });
    }

    // C-3: Synthesizer
    broadcast({
      type: "node_update",
      data: { node: "synthesizer", status: "active" },
    });
    await sleep(1200);
    tokenUsage.claude += 3200;
    broadcast({ type: "token_update", data: { ...tokenUsage } });

    const totalFindings = {
      critical: 6,
      warning: 2,
      note: 1,
    };
    broadcast({
      type: "node_update",
      data: { node: "synthesizer", status: "completed", totalFindings },
    });

    // C-4: Codex 2nd review
    broadcast({
      type: "node_update",
      data: { node: "codex-review", status: "active" },
    });

    if (mode === "live") {
      try {
        const codexReview = execSync(
          `npx @openai/codex exec --full-auto --skip-git-repo-check "Read server.js. Find issues not in this list: SQL injection, hardcoded creds, path traversal, missing error handling, memory leak, unreadable function p. Output JSON [{severity,file,line,message}]."`,
          { cwd: path.dirname(targetFile), timeout: 120000, encoding: "utf8" }
        );
        tokenUsage.codex += 15000; codexUsageAccum.messages++; codexUsageAccum.total += 15000;
      } catch (e) {
        errors.push({
          phase: "C",
          node: "codex-review",
          message: "Codex review failed: " + (e.message || "").slice(0, 100),
        });
        broadcast({ type: "error", data: errors[errors.length - 1] });
      }
    } else {
      await sleep(2500);
      tokenUsage.codex += 15321; codexUsageAccum.messages++; codexUsageAccum.total += 15321;
      broadcast({
        type: "findings",
        data: {
          persona: "codex",
          findings: [
            { severity: "WARNING", file: "server.js", line: 15, message: "SELECT * 민감 컬럼 노출" },
            { severity: "WARNING", file: "server.js", line: 46, message: "5초마다 전체 테이블 조회 — DB 부하" },
            { severity: "NOTE", file: "server.js", line: 32, message: "느슨한 동등 비교(==) 사용" },
          ],
        },
      });
    }

    broadcast({ type: "token_update", data: { ...tokenUsage } });
    broadcast({
      type: "node_update",
      data: { node: "codex-review", status: "completed" },
    });

    // Verdict
    const verdict = "BLOCK";
    broadcast({
      type: "verdict",
      data: {
        verdict,
        stats: {
          critical: 6,
          warning: 4,
          note: 2,
          codexAdditional: 3,
          total: 15,
        },
      },
    });

    broadcast({
      type: "phase_update",
      data: { phase: "C", status: "completed" },
    });

    // ── PHASE D: Debug (only if issues found) ──
    if (verdict !== "CLEAN") {
      broadcast({
        type: "phase_update",
        data: { phase: "D", status: "active" },
      });
      broadcast({
        type: "node_update",
        data: { node: "debug", status: "active" },
      });
      await sleep(2000);
      tokenUsage.claude += 5000;
      broadcast({ type: "token_update", data: { ...tokenUsage } });
      broadcast({
        type: "node_update",
        data: { node: "debug", status: "completed" },
      });
      broadcast({
        type: "phase_update",
        data: { phase: "D", status: "completed" },
      });
    }
  } catch (err) {
    errors.push({
      phase: "unknown",
      node: "pipeline",
      message: err.message,
    });
    broadcast({ type: "error", data: errors[errors.length - 1] });
  }

  broadcast({
    type: "pipeline_complete",
    data: { tokenUsage, errors, duration: Date.now() },
  });
}

// API endpoint to trigger pipeline
app.post("/api/run", (req, res) => {
  const { targetFile, mode } = req.body;
  const file = targetFile || path.join(__dirname, "..", "test-sample", "server.js");
  res.json({ status: "started", targetFile: file, mode: mode || "demo" });
  runPipeline(file, mode || "demo");
});

// External event ingestion — skill posts events here via curl
app.post("/api/event", (req, res) => {
  const event = req.body;
  if (!event || !event.type) {
    return res.status(400).json({ error: "Missing event type" });
  }
  broadcast(event);
  res.json({ status: "received", type: event.type });
});

// Reset dashboard state
app.post("/api/reset", (req, res) => {
  tokenUsage = { claude: 0, codex: 0 };
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
app.post("/api/context/discover", (req, res) => {
  const projectRoot = req.body.projectRoot || path.join(__dirname, "..");
  const context = discoverContextFiles(projectRoot);
  res.json(context);
});

app.post("/api/context/load", (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "Missing filePath" });
  const content = loadFileContent(filePath);
  if (content !== null) {
    res.json({ filePath, content });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// ── Harness API ──
app.get("/api/harness/types", (req, res) => {
  res.json(getHarnessTypes());
});

app.get("/api/harness/:id", (req, res) => {
  const harness = getHarnessById(req.params.id);
  if (harness) {
    res.json(harness);
  } else {
    res.status(404).json({ error: "Harness not found" });
  }
});

app.post("/api/harness/recommend", (req, res) => {
  const { completedHarnessId, projectContext } = req.body;
  const recommendations = recommendNext(completedHarnessId || "planning", projectContext || {});
  res.json(recommendations);
});

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
const sessionWatcher = new SessionWatcher(broadcast, path.resolve(__dirname, ".."));
sessionWatcher.start();

app.get("/api/watcher/status", (req, res) => {
  res.json(sessionWatcher.getStatus());
});

app.post("/api/watcher/complete", (req, res) => {
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

app.post("/api/hook", async (req, res) => {
  try {
    const { event, payload } = req.body || {};
    if (!event) return res.status(400).json({ error: "missing event" });
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

app.post("/api/executor/mode", (req, res) => {
  const { enabled } = req.body || {};
  pipelineExecutor.setEnabled(!!enabled);
  res.json(pipelineExecutor.getStatus());
});

// ── Server Control API (stop / restart) ──
app.post("/api/server/shutdown", (req, res) => {
  res.json({ status: "shutting-down" });
  setTimeout(() => gracefulShutdown("api-shutdown"), 100);
});

app.post("/api/server/restart", (req, res) => {
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
app.post("/api/codex/verify", async (req, res) => {
  const start = Date.now();
  broadcast({ type: "codex_verify_started", data: {} });
  const result = await codexRunner.exec(
    "Respond with exactly the phrase: CODEX_OK. Do not run any tools or shell commands.",
    { timeoutMs: 60000, cwd: path.join(__dirname, "..") }
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

app.post("/api/pipeline/general-run", async (req, res) => {
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

app.post("/api/pipeline/general-abort", (req, res) => {
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
server.listen(PORT, () => {
  console.log(`Pipeline Dashboard: http://localhost:${PORT}`);
  console.log(`  Terminal: ${pty ? "enabled" : "disabled (install node-pty)"}`);
  console.log(`  Session Watcher: active`);
  console.log(`  Supervised: ${process.send ? "yes (restart enabled)" : "no (start via start.js for restart)"}`);
  console.log(`  Client grace period: ${CLIENT_GRACE_MS}ms`);
});
