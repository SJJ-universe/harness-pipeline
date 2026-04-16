// Codex trigger & verify routes
const { Router } = require("express");
const path = require("path");
const fs = require("fs");

function createCodexRoutes({
  codexRunner,
  broadcast,
  CODEX_TRIGGER_DIR,
  getTriggers,
  getTriggerById,
  validateCodexTrigger,
  resolveTriggerContext,
}) {
  const router = Router();

  router.get("/codex/triggers", (req, res) => {
    res.json(getTriggers());
  });

  router.post("/codex/trigger", async (req, res) => {
    let parsed;
    try {
      parsed = validateCodexTrigger(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const { triggerId, userInput } = parsed;
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
    const result = await codexRunner.exec(prompt, { timeoutMs: 120000 });

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

  router.post("/codex/verify", async (req, res) => {
    const start = Date.now();
    broadcast({ type: "codex_verify_started", data: {} });
    const result = await codexRunner.exec(
      "Respond with exactly the phrase: CODEX_OK. Do not run any tools or shell commands.",
      { timeoutMs: 60000, cwd: path.join(__dirname, "..", "..") }
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

  return router;
}

module.exports = { createCodexRoutes };
