// Slice MA1 (Phase D, 2026-04-27) — HarnessMonitorNormalizer.
//
// Translates the harness's heterogeneous broadcast events into the single
// canonical envelope spec section 6.5 defines:
//
//   { type, runId, ts, scope, summary, payload }
//
// Goals
//   - One shape for the monitor store + future export hooks
//     (Langfuse / OpenLIT / remote run observers).
//   - Preserve runId so downstream filters (run-id-filter, run-tab-bar)
//     still work without changes.
//   - Keep "global" events explicit by setting scope:"global" + runId:null,
//     mirroring the eventReplayBuffer includeGlobal policy (Phase 2.5 AA-2).
//   - DOM-free + framework-free so Node tests + browser both work.
//
// The server is not yet emitting envelopes natively; the spec calls for
// client-side normalization first and a server-side native emit later.
//
// Unknown event types are accepted with scope:"unknown" so we never drop
// data — the envelope contract is intentionally permissive.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorNormalizer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Scope routing — keep tight to known categories so the inspector +
  // panel filters can pick the right surface for each envelope.
  const SCOPE_BY_TYPE = {
    // pipeline lifecycle
    "pipeline_start":      "pipeline",
    "pipeline_complete":   "pipeline",
    "pipeline_reset":      "pipeline",
    "pipeline_resume":     "pipeline",
    "pipeline_restored":   "pipeline",
    "pipeline_paused":     "pipeline",
    "pipeline_compacted":  "pipeline",
    // phase + node
    "phase_update":        "phase",
    "phase_metrics":       "phase",
    "node_update":         "phase",
    // tools + gates
    "tool_recorded":       "tool",
    "tool_blocked":        "tool",
    "tdd_guard_blocked":   "tool",
    "gate_failed":         "gate",
    "gate_evaluated":      "gate",
    "gate_bypassed":       "gate",
    // codex
    "codex_started":       "codex",
    "codex_progress":      "codex",
    "critique_received":   "codex",
    "critique_persist_failed": "codex",
    // findings + verification
    "claim_verification_failed": "verification",
    "artifact_captured":   "artifact",
    // subagent
    "subagent_started":    "subagent",
    "subagent_completed":  "subagent",
    // child / runtime
    "child_queue_depth":   "child",
    "child_registered":    "child",
    "child_unregistered":  "child",
    "child_kill_all":      "child",
    "file_conflict_warning": "child",
    // run lifecycle
    "run_created":         "orchestrator",
    "run_capacity_reached": "orchestrator",
    // server / context
    "server_shutdown":     "server",
    "server_restart":      "server",
    "context_alarm":       "context",
    "harness_notification": "ui",
    "toast":               "ui",
    "hook_event":          "telemetry",
    "auto_pipeline_detect": "telemetry",
    "pipeline_mutated":    "telemetry",
    // cycle
    "cycle_iteration":     "cycle",
  };

  const GLOBAL_TYPES = new Set([
    "toast", "hook_event", "context_alarm", "harness_notification",
    "server_shutdown", "server_restart", "child_queue_depth",
    "child_registered", "child_unregistered", "child_kill_all",
    "run_created", "run_capacity_reached",
  ]);

  function _scopeOf(type) {
    return SCOPE_BY_TYPE[type] || "unknown";
  }

  function _summaryOf(type, data) {
    if (!data || typeof data !== "object") return type;
    // Prefer a short human-readable label depending on event family.
    if (data.phase && (type === "phase_update" || type === "phase_metrics" || type === "node_update")) {
      return `${type} ${data.phase}${data.status ? ` ${data.status}` : ""}`;
    }
    if (type === "tool_recorded" || type === "tool_blocked" || type === "tdd_guard_blocked") {
      return data.tool ? `${type} ${data.tool}` : type;
    }
    if (type === "child_registered" || type === "child_unregistered") {
      return `${type} ${data.label || "?"}/${data.pid != null ? data.pid : "?"}`;
    }
    if (type === "child_kill_all") {
      return `child_kill_all ${data.signal || "?"} count=${data.count != null ? data.count : 0}`;
    }
    if (type === "child_queue_depth") {
      return `child_queue inFlight=${data.inFlight} waiting=${data.waiting}`;
    }
    if (type === "subagent_started" || type === "subagent_completed") {
      return `${type} ${data.session_id || data.agent_id || "?"}`;
    }
    if (type === "run_created" || type === "run_capacity_reached") {
      return `${type} ${data.runId || data.requestedRunId || "?"} active=${data.active != null ? data.active : "?"}`;
    }
    if (type === "context_alarm") {
      return `context_alarm ${data.level || "?"} ${data.percent != null ? data.percent + "%" : ""}`.trim();
    }
    if (type === "toast") {
      return `toast ${data.type || "info"}: ${data.message || ""}`.slice(0, 120);
    }
    return type;
  }

  // ── Slice R1-a (Phase D Round MH, 2026-04-28): envelope `origin` field ─
  //
  // MF1 §3.1 reserved an OPTIONAL top-level `origin` field on the canonical
  // envelope to carry remote-execution metadata:
  //
  //   origin: {
  //     runOrigin: "local" | "container-local" | "container-remote" | "vm-remote",
  //     sandboxClass: "none" | "container-strict" | "vm-strict",
  //     hostIdentity: string,
  //     isolationStatus: "healthy" | "degraded" | "lost",
  //   }
  //
  // R1-a wires the field as a pass-through:
  //   - input has `event.origin` (already-envelope path)        → carry it
  //   - input has `event.data.origin` (raw event from remote)   → hoist it
  //   - neither (today's local broadcasts)                       → omit field entirely
  //
  // The omit-when-absent policy preserves MF1 §3.4 invariant 1: a local-mode
  // event's normalized envelope is byte-identical to today (no `origin` key).
  // Only when a remote runner emits an event with `data.origin` does the
  // envelope grow the field.
  //
  // Validation is intentionally minimal: we accept any shape and let the
  // server contract (monitorRoutes.js /api/monitor/runs/:runId default-fill)
  // be the source of truth for the canonical local-mode shape.

  function _hoistOrigin(source) {
    if (!source || typeof source !== "object") return undefined;
    if (!source.origin || typeof source.origin !== "object") return undefined;
    const o = source.origin;
    // Shallow copy with only known keys. Extra keys silently dropped to keep
    // future schema additions explicit (additive via this list).
    const out = {};
    if (typeof o.runOrigin === "string") out.runOrigin = o.runOrigin;
    if (typeof o.sandboxClass === "string") out.sandboxClass = o.sandboxClass;
    if (typeof o.hostIdentity === "string") out.hostIdentity = o.hostIdentity;
    if (typeof o.isolationStatus === "string") out.isolationStatus = o.isolationStatus;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * Normalize one broadcast event into the canonical envelope.
   *
   * Input shapes accepted:
   *   - WebSocket pipeline event : { type: string, data?: object }
   *   - already-an-envelope      : returned as-is (idempotent)
   *
   * Returns null when the input cannot reasonably be turned into an
   * envelope (e.g. null, string, missing type). Callers should guard.
   */
  function normalize(event) {
    if (!event || typeof event !== "object") return null;
    // Idempotency: if it already looks like an envelope, return a copy.
    if (typeof event.type === "string" && Object.prototype.hasOwnProperty.call(event, "scope")) {
      const env = {
        type: event.type,
        runId: event.runId == null ? null : event.runId,
        ts: event.ts || Date.now(),
        scope: event.scope || _scopeOf(event.type),
        summary: event.summary || _summaryOf(event.type, event.payload || event.data || {}),
        payload: event.payload || {},
      };
      // R1-a: carry forward `origin` when present; omit otherwise.
      const origin = _hoistOrigin(event) || _hoistOrigin(event.payload || event.data);
      if (origin) env.origin = origin;
      return env;
    }
    if (typeof event.type !== "string") return null;
    const data = event.data && typeof event.data === "object" ? event.data : {};
    const isGlobal = GLOBAL_TYPES.has(event.type);
    const runIdFromData = data.runId;
    const runId = isGlobal
      ? (runIdFromData == null ? null : runIdFromData)
      : (runIdFromData == null ? null : runIdFromData);
    const env = {
      type: event.type,
      runId,
      ts: data.at || data.ts || Date.now(),
      scope: isGlobal ? "global" : _scopeOf(event.type),
      summary: _summaryOf(event.type, data),
      payload: data,
    };
    // R1-a: hoist `origin` from event.data (or top-level if remote runner
    // emits the envelope shape directly); omit when absent.
    const origin = _hoistOrigin(event) || _hoistOrigin(data);
    if (origin) env.origin = origin;
    return env;
  }

  /**
   * Normalize a list of events; non-normalizable entries are skipped.
   */
  function normalizeAll(events) {
    if (!Array.isArray(events)) return [];
    const out = [];
    for (const e of events) {
      const env = normalize(e);
      if (env) out.push(env);
    }
    return out;
  }

  function isGlobalType(type) {
    return GLOBAL_TYPES.has(type);
  }

  function scopeOf(type) {
    return _scopeOf(type);
  }

  return {
    normalize,
    normalizeAll,
    isGlobalType,
    scopeOf,
    SCOPE_BY_TYPE,
    GLOBAL_TYPES,
  };
});
