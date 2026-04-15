// Codex trigger route — on-demand Codex invocation independent of the
// phase pipeline. The UI shows one card per trigger; clicking runs Codex
// against a trigger-specific context source (plan file / git diff / user
// input) and streams stdout/stderr to the dashboard console (P1-6).
//
// Extracted from server.js in P2-3. resolveTriggerContext is exported so
// the user-input branch can be unit-tested without HTTP or a subprocess.

const express = require("express");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const { getTriggers, getTriggerById } = require("../codex-triggers");

const DASH_DIR = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(DASH_DIR, "..");
const CODEX_TRIGGER_DIR = path.resolve(WORKSPACE_ROOT, "_workspace");

function resolveTriggerContext(trigger, userInput) {
  switch (trigger.contextSource) {
    case "plan": {
      const candidates = [
        path.join(CODEX_TRIGGER_DIR, "plan.md"),
        path.resolve(DASH_DIR, "..", "pipeline-dashboard", "plan.md"),
        path.resolve(DASH_DIR, "plan.md"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
      }
      throw new Error("plan.md를 찾지 못했습니다 (_workspace/ 또는 pipeline-dashboard/)");
    }
    case "git-diff": {
      try {
        const diff = execSync("git diff HEAD", {
          cwd: WORKSPACE_ROOT,
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

function createRouter({ tokenGuard, broadcast, codexRunner, childRegistry }) {
  const router = express.Router();

  router.get("/triggers", (req, res) => {
    res.json(getTriggers());
  });

  router.post("/trigger", tokenGuard, async (req, res) => {
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
      // Codex progress instead of staring at a spinning card.
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

  return router;
}

module.exports = { createRouter, resolveTriggerContext };
