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
    this.stats = { total: 0, byEvent: {} };
  }

  attachExecutor(executor) {
    this.executor = executor;
    // Hook-driven mode — disable SessionWatcher polling to avoid duplicates
    if (this.sessionWatcher) this.sessionWatcher.isHookDriven = true;
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
      default:
        return {};
    }
  }

  async _onUserPrompt(payload) {
    const prompt = payload?.prompt || payload?.user_prompt || "";
    if (this.executor) return this.executor.startFromPrompt(prompt) || {};
    return {};
  }

  async _onPreTool(payload) {
    const tool = payload?.tool_name;
    const input = payload?.tool_input || {};
    if (this.executor) return (await this.executor.onPreTool(tool, input)) || {};
    return {};
  }

  async _onPostTool(payload) {
    const tool = payload?.tool_name;
    const response = payload?.tool_response || {};
    if (this.executor) return (await this.executor.onPostTool(tool, response)) || {};
    return {};
  }

  async _onStop(payload) {
    if (this.executor) return (await this.executor.onStop(payload)) || {};
    return {};
  }

  async _onSessionEnd(payload) {
    if (this.executor) return (await this.executor.onSessionEnd(payload)) || {};
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
