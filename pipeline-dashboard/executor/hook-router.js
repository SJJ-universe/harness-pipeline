// HookRouter — routes incoming hook events to the pipeline executor.
//
// Phase 1 scope: the router exists, accepts all hook events, and broadcasts
// them to WebSocket clients so we can verify the hook bridge round-trip.
// Phase 2 will delegate to PipelineExecutor for real Phase transitions.

const fs = require("fs");
const path = require("path");
const { alarmForUsage, extractContextUsage } = require("../src/runtime/contextUsage");

class HookRouter {
  constructor({ broadcast, sessionWatcher, runRegistry, fixturesDir }) {
    this.broadcast = broadcast;
    this.sessionWatcher = sessionWatcher;
    this.runRegistry = runRegistry || null;
    this.fixturesDir = fixturesDir || path.resolve(__dirname, "..", "fixtures", "hooks");
    this.executor = null; // Phase 2: PipelineExecutor instance
    // Slice T (v6): when an orchestrator is attached, hook routing resolves
    // the target executor from payload.session_id (or agent_id, or default)
    // before calling onXxx. Single-active mode (maxConcurrent=1) still
    // collapses everything to the default run — this is the infra only.
    this.orchestrator = null;
    this.stats = { total: 0, byEvent: {} };
  }

  attachExecutor(executor) {
    this.executor = executor;
    // Hook-driven mode — disable SessionWatcher polling to avoid duplicates
    if (this.sessionWatcher) this.sessionWatcher.isHookDriven = true;
  }

  attachOrchestrator(orchestrator) {
    this.orchestrator = orchestrator;
  }

  /**
   * Slice T (v6): derive a runId from the hook payload. Preference:
   *   1. payload.session_id   (Claude Code hooks v0.2+)
   *   2. payload.agent_id     (SubagentStart/Stop)
   *   3. "default"            (backward compatible single-active)
   *
   * Returning a non-existent runId is fine — PipelineOrchestrator.get() will
   * return null and _resolveExecutor() falls through to the attached
   * executor. Real routing to new runs happens in Slice V when the
   * concurrency gate unlocks.
   */
  _resolveRunId(payload) {
    if (payload && typeof payload === "object") {
      if (payload.session_id) return String(payload.session_id);
      if (payload.agent_id) return String(payload.agent_id);
    }
    return "default";
  }

  /** Slice T (v6): pick the PipelineExecutor that owns this payload. */
  _resolveExecutor(payload) {
    if (this.orchestrator) {
      const runId = this._resolveRunId(payload);
      const exec = this.orchestrator.get(runId);
      if (exec) return exec;
    }
    return this.executor;
  }

  async route(event, payload) {
    this.stats.total++;
    this.stats.byEvent[event] = (this.stats.byEvent[event] || 0) + 1;
    this._samplePayload(event, payload);
    const usage = extractContextUsage(payload);
    const alarm = alarmForUsage(usage);
    if (usage) this.stats.lastContextUsage = usage;
    if (alarm) {
      this.broadcast({ type: "context_alarm", data: { ...usage, ...alarm } });
      if (alarm.level === "block" && event === "user-prompt" && !payload?.override_context_alarm) {
        return { decision: "block", reason: alarm.message };
      }
    }
    if (process.env.HARNESS_DEBUG === "1") {
      console.log(`[HookRouter] ${event} executor=${!!this.executor} enabled=${this.executor?.enabled}`);
    }

    // Always broadcast a raw hook trace for the UI (debug/telemetry)
    this.broadcast({
      type: "hook_event",
      data: {
        event,
        tool: payload?.tool_name || null,
        at: Date.now(),
      },
    });

    switch (event) {
      case "user-prompt":
        return this._onUserPrompt(payload);
      case "pre-tool":
        return this._onPreTool(payload);
      case "post-tool":
        return this._onPostTool(payload);
      case "stop":
        return this._onStop(payload);
      case "session-end":
        return this._onSessionEnd(payload);
      // Slice A (v4): full lifecycle coverage
      case "session-start":
        return this._onSessionStart(payload);
      case "subagent-start":
        return this._onSubagentStart(payload);
      case "subagent-stop":
        return this._onSubagentStop(payload);
      case "notification":
        return this._onNotification(payload);
      case "pre-compact":
        return this._onPreCompact(payload);
      default:
        return {};
    }
  }

  // Slice T (v6): every handler now resolves the target executor via the
  // orchestrator (if attached), so a future Slice V unlock can route
  // payloads with distinct session_id / agent_id to distinct runs. In
  // single-active compat (maxConcurrent=1), the lookup collapses back to
  // the same executor — zero behavior change.

  async _onUserPrompt(payload) {
    const prompt = payload?.prompt || payload?.user_prompt || "";
    const exec = this._resolveExecutor(payload);
    if (exec) return exec.startFromPrompt(prompt) || {};
    return {};
  }

  async _onPreTool(payload) {
    const tool = payload?.tool_name;
    const input = payload?.tool_input || {};
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onPreTool(tool, input)) || {};
    return {};
  }

  async _onPostTool(payload) {
    const tool = payload?.tool_name;
    const input = payload?.tool_input || {};
    const response = payload?.tool_response || {};
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onPostTool(tool, response, input)) || {};
    return {};
  }

  async _onStop(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onStop(payload)) || {};
    return {};
  }

  async _onSessionEnd(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onSessionEnd(payload)) || {};
    return {};
  }

  // ── Slice A (v4) lifecycle handlers ─────────────────────────────
  //
  // All five delegate to the executor; each executor method is designed to
  // be a no-op when the executor is disabled or has no active pipeline, so we
  // can return `{}` safely from these defensive paths.

  async _onSessionStart(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onSessionStart(payload || {})) || {};
    return {};
  }

  async _onSubagentStart(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onSubagentStart(payload || {})) || {};
    return {};
  }

  async _onSubagentStop(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onSubagentStop(payload || {})) || {};
    return {};
  }

  async _onNotification(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onNotification(payload || {})) || {};
    return {};
  }

  async _onPreCompact(payload) {
    const exec = this._resolveExecutor(payload);
    if (exec) return (await exec.onPreCompact(payload || {})) || {};
    return {};
  }

  getStats() {
    return { ...this.stats };
  }

  _samplePayload(event, payload) {
    if (process.env.HARNESS_SAMPLE_HOOKS !== "1") return;
    // P-4 Performance: async fire-and-forget — never block hook processing
    // Size cap: truncate large payloads to avoid disk/memory pressure
    const MAX_SAMPLE_SIZE = 32_000;
    const safeEvent = String(event || "unknown").replace(/[^a-z0-9_-]/gi, "_");
    const filePath = path.join(this.fixturesDir, `${Date.now()}-${safeEvent}.json`);
    let data;
    try {
      data = JSON.stringify({ event, payload }, null, 2);
    } catch (_) {
      return;
    }
    if (data.length > MAX_SAMPLE_SIZE) {
      data = data.slice(0, MAX_SAMPLE_SIZE) + "\n...(truncated)";
    }
    fs.promises.mkdir(this.fixturesDir, { recursive: true })
      .then(() => fs.promises.writeFile(filePath, data, "utf-8"))
      .catch(() => {});
    // Sampling is best-effort; hooks must never be blocked by fixture writes.
  }
}

module.exports = { HookRouter };
