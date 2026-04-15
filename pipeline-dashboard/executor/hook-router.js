// HookRouter — routes incoming hook events to the pipeline executor.
//
// Phase 1 scope: the router exists, accepts all hook events, and broadcasts
// them to WebSocket clients so we can verify the hook bridge round-trip.
// Phase 2 will delegate to PipelineExecutor for real Phase transitions.

class HookRouter {
  constructor({ broadcast, sessionWatcher }) {
    this.broadcast = broadcast;
    this.sessionWatcher = sessionWatcher;
    this.executor = null; // Phase 2: PipelineExecutor instance
    this.stats = { total: 0, byEvent: {} };
  }

  attachExecutor(executor) {
    this.executor = executor;
    // Hook-driven mode — tell the watcher to stop broadcasting so the
    // executor is the sole source of pipeline events. The watcher decides
    // whether the flip sticks based on its configured mode (P1-3).
    if (this.sessionWatcher && typeof this.sessionWatcher.markHookDriven === "function") {
      this.sessionWatcher.markHookDriven();
    }
  }

  async route(event, payload) {
    this.stats.total++;
    this.stats.byEvent[event] = (this.stats.byEvent[event] || 0) + 1;
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
}

module.exports = { HookRouter };
