// Slice S (v6) — PipelineOrchestrator: wraps one-or-more PipelineExecutor
// instances so the harness can someday handle multiple concurrent runs
// without touching the hook router / route handlers / UI every time.
//
// Phase 1 (this slice) ships in **single-active compat mode**: exactly one
// executor with runId="default", pre-bootstrapped, and `getActive()` returns
// it. External callers see no behavioral change — they just access the same
// executor through the orchestrator instead of a bare reference.
//
// Phase 1 later slices:
//   - Slice T: hook router uses `routeHook(runId, event, payload)` to pick
//     the right executor from `payload.session_id` / `agent_id`.
//   - Slice U: dashboard tabs per run.
//   - Slice V: `MAX_CONCURRENT_RUNS` raised past 1, orchestrator creates
//     runs on demand.
//
// Phase 2 (W): sub-runs (subagent fan-out) nest under their parent run.
// Phase 3 (D): per-user/org scoping sits above the orchestrator.

const DEFAULT_RUN_ID = "default";

class PipelineOrchestrator {
  /**
   * @param {object} opts
   * @param {Function} opts.createExecutor  factory: (runId) => PipelineExecutor
   * @param {number} [opts.maxConcurrent]   max active runs (1 in Slice S)
   * @param {Function} [opts.broadcast]     for orchestrator-level events
   */
  constructor({ createExecutor, maxConcurrent = 1, broadcast = () => {} } = {}) {
    if (typeof createExecutor !== "function") {
      throw new Error("PipelineOrchestrator requires a createExecutor factory");
    }
    if (maxConcurrent < 1) {
      throw new Error(`maxConcurrent must be >= 1, got ${maxConcurrent}`);
    }
    this.createExecutor = createExecutor;
    this.maxConcurrent = maxConcurrent;
    this.broadcast = broadcast;
    this.runs = new Map();
    this.defaultRunId = DEFAULT_RUN_ID;
    // Eagerly bootstrap the default run so getActive() never returns null.
    // Slice V will flip to lazy creation once multiple runs are allowed.
    const defaultExec = this.createExecutor(this.defaultRunId);
    this.runs.set(this.defaultRunId, defaultExec);
  }

  /** The canonical "current" executor. Single-active mode returns default. */
  getActive() {
    return this.runs.get(this.defaultRunId) || null;
  }

  get(runId) {
    return this.runs.get(runId) || null;
  }

  list() {
    return Array.from(this.runs.keys());
  }

  /**
   * Remove a non-default run from the orchestrator. The default run is
   * protected because it's the single-active mode's anchor.
   */
  remove(runId) {
    if (runId === this.defaultRunId) return false;
    return this.runs.delete(runId);
  }

  /**
   * Enforce the concurrency cap. Returns true when a new run can be created,
   * false when at capacity.
   */
  canAddRun() {
    return this.runs.size < this.maxConcurrent;
  }

  /**
   * Slice V (v6): lazily create a run for an unknown runId when capacity
   * allows. Returns the existing executor if runId is known, a newly-created
   * one if capacity headroom exists, or null when at cap. The broadcast
   * notifies the dashboard so the tab bar can surface the new run
   * immediately (before any events carry that runId in data).
   */
  getOrCreateRun(runId) {
    if (!runId || typeof runId !== "string") return this.getActive();
    if (this.runs.has(runId)) return this.runs.get(runId);
    if (!this.canAddRun()) {
      // At capacity — broadcast once so the UI can warn the user. Caller
      // decides whether to fall back to getActive() or reject the event.
      this.broadcast({
        type: "run_capacity_reached",
        data: { requestedRunId: runId, active: this.runs.size, max: this.maxConcurrent, runId: null },
      });
      return null;
    }
    const exec = this.createExecutor(runId);
    this.runs.set(runId, exec);
    this.broadcast({
      type: "run_created",
      data: { runId, active: this.runs.size, max: this.maxConcurrent },
    });
    return exec;
  }

  /**
   * Route a hook event to the executor that owns this runId. In Slice V
   * unknown runIds become new runs when capacity allows; otherwise we fall
   * back to the current active run so the event doesn't get dropped.
   */
  routeHook(runId, event, payload) {
    const exec =
      this.getOrCreateRun(runId) ||
      this.runs.get(runId) ||
      this.getActive();
    if (!exec || typeof exec.route !== "function") return null;
    return exec.route(event, payload);
  }

  /** Test helper: reset to a clean single-run state. */
  _resetForTests() {
    this.runs.clear();
    const defaultExec = this.createExecutor(this.defaultRunId);
    this.runs.set(this.defaultRunId, defaultExec);
  }
}

module.exports = { PipelineOrchestrator, DEFAULT_RUN_ID };
