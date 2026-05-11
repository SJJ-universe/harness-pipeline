// HookRouter — routes incoming hook events to the pipeline executor.
//
// Phase 1 scope: the router exists, accepts all hook events, and broadcasts
// them to WebSocket clients so we can verify the hook bridge round-trip.
// Phase 2 will delegate to PipelineExecutor for real Phase transitions.

const fs = require("fs");
const path = require("path");
const { alarmForUsage, extractContextUsage } = require("../src/runtime/contextUsage");
const { sanitizeRemoteHook } = require("../src/runtime/remoteHookSanitizer");
const {
  EXECUTOR_DISPATCH,
  DEFAULT_BRIDGE_MODE,
  BRIDGE_MODES,
} = require("../src/runtime/remoteHookBridgeContract");
// Slice GOV-APPROVAL-0 (Phase E1.5, 2026-04-29) — PII-aware approval.
// The hook-router scans write-tool args for Korean PII before queueing
// an approval request, so the operator card surfaces detected types
// (krn / phone / email / ...) at the moment of decision rather than
// requiring a separate scan step. piiScanImpl is constructor-injectable
// for tests.
const { scanForPii: defaultScanForPii } = require("../src/security/piiScanner");
const {
  requiresWriteToolApproval,
  assertWriteToolApprovalAvailable,
} = require("../src/policy/publicSectorPolicy");

class HookRouter {
  constructor({ broadcast, sessionWatcher, runRegistry, fixturesDir, bridgeMode, approvalManager, deploymentProfile, scanForPii }) {
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
    // Slice R2.5-c: controlled execution bridge for remote hooks.
    // "off" (default) preserves R1/R2 behavior — sanitization runs but
    // no executor method is invoked. "report" runs sanitization + emits
    // sanitized/rejected audit verbs but skips dispatch. "dispatch"
    // forwards sanitized payloads to the local executor's mapped method.
    this._bridgeMode = BRIDGE_MODES.includes(bridgeMode) ? bridgeMode : DEFAULT_BRIDGE_MODE;
    // Slice R3-e-d: per-call approval manager. When wired, sanitized
    // payloads carrying `requiresApproval: true` (write tools — Bash /
    // Edit / Write) round-trip through the manager BEFORE any executor
    // method is invoked. When NOT wired, write-tool sanitized payloads
    // are dropped at the gate (fail-closed): the operator deliberately
    // disabled approvals, so we refuse to dispatch a write hook that
    // would have needed one. Read-only tools (Read / Grep / Glob)
    // dispatch unchanged regardless of this dependency.
    this.approvalManager = approvalManager || null;
    // Slice GOV-APPROVAL-0: deployment posture + injectable PII scanner.
    // When deploymentProfile.publicSector === true AND
    // requirePiiScanBeforeProviderDispatch === true, the gate scans
    // every write-tool arg payload for Korean PII before queueing the
    // approval request. The result lands in piiContext on the manager
    // request so the operator card surfaces what was detected.
    this.deploymentProfile = deploymentProfile || null;
    this.scanForPii = typeof scanForPii === "function" ? scanForPii : defaultScanForPii;
    // Public-sector deployments fail loud at construct time if approval
    // is mandatory but no manager is wired. Standard posture is
    // unaffected (the hook-router's own fail-closed handles missing
    // manager with `approval_unavailable` per slice R3-e-d).
    assertWriteToolApprovalAvailable(this.deploymentProfile, this.approvalManager);
  }

  /**
   * Slice R2.5-c: explicit setter for the bridge mode (tests + runtime
   * promotion). Anything outside BRIDGE_MODES is rejected so an attacker
   * with env-write access can't smuggle in an unrecognized mode that
   * the router would mishandle.
   */
  setBridgeMode(mode) {
    if (!BRIDGE_MODES.includes(mode)) {
      throw new TypeError("HookRouter.setBridgeMode: invalid mode " + mode);
    }
    this._bridgeMode = mode;
  }

  getBridgeMode() {
    return this._bridgeMode;
  }

  attachExecutor(executor) {
    this.executor = executor;
    // Hook-driven mode — disable SessionWatcher polling to avoid duplicates
    if (this.sessionWatcher) this.sessionWatcher.isHookDriven = true;
  }

  attachOrchestrator(orchestrator) {
    this.orchestrator = orchestrator;
  }

  /** Slice V (v6): optional file-conflict detector for multi-run Edit/Write. */
  attachFileConflictDetector(detector) {
    this.fileConflictDetector = detector;
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

  /**
   * Slice T (v6): pick the PipelineExecutor that owns this payload.
   * Slice V (v6): if runId is unknown and the orchestrator has headroom,
   * lazily create a new run for it so events don't collapse to the default.
   */
  _resolveExecutor(payload) {
    if (this.orchestrator) {
      const runId = this._resolveRunId(payload);
      if (typeof this.orchestrator.getOrCreateRun === "function") {
        const exec = this.orchestrator.getOrCreateRun(runId);
        if (exec) return exec;
      } else {
        const exec = this.orchestrator.get(runId);
        if (exec) return exec;
      }
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
        // Slice AB (Phase 2.5) carve-out: this is a UserPromptSubmit block,
        // NOT a PreToolUse block. Claude Code's UserPromptSubmit hook only
        // understands the legacy `{ decision, reason }` shape — the modern
        // `hookSpecificOutput.permissionDecision` field is PreToolUse-
        // specific (see src/hooks/hookDecisionAdapter.js comment header).
        // Running this through denyToolUse() would silently get ignored by
        // Claude Code because permissionDecision is not consulted for
        // UserPromptSubmit. Keep the legacy shape here; do not migrate.
        return { decision: "block", reason: alarm.message };
      }
    }
    if (process.env.ORCHESTRATOR_DEBUG === "1") {
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
    const result = exec ? (await exec.onPostTool(tool, response, input)) || {} : {};
    // Slice V (v6): record Edit/Write claims so cross-run collisions surface
    // as `file_conflict_warning` broadcasts. Warning only — no block.
    if (this.fileConflictDetector && (tool === "Edit" || tool === "Write")) {
      const filePath = input?.file_path || input?.filePath;
      if (filePath) {
        const runId = this._resolveRunId(payload);
        this.fileConflictDetector.recordEdit(runId, filePath);
      }
    }
    // Slice W (v6): if this payload's session_id is a known subagent of the
    // resolved executor, attribute the tool call to its SubRun too. Parent
    // state is already updated via exec.onPostTool above.
    const subagentSessionId = payload?.session_id;
    if (exec && exec.active && exec.active.subRuns && subagentSessionId) {
      const subRun = exec.active.subRuns.get(subagentSessionId);
      if (subRun && !subRun.completedAt) {
        subRun.recordTool(tool, {
          filePath: input?.file_path || input?.filePath || null,
          command: tool === "Bash" ? (input?.command || null) : null,
        });
      }
    }
    return result;
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

  /**
   * Slice R1-g (Phase D R1, 2026-04-28): hook event ingress from a remote
   * runner. Called by the runner WS handler when a `{type:"hook", event}`
   * frame arrives. The orchestrator-side semantics are intentionally
   * minimal in R1:
   *
   *   - record stats (`stats.remoteHooks`)
   *   - tag origin = "container-remote" so downstream consumers can
   *     distinguish locally-emitted hooks from runner-emitted ones
   *   - broadcast `runner_hook` so the dashboard can surface it
   *   - DO NOT execute the local on{Pre,Post,Stop,...} routes — the
   *     remote runner is the trust boundary; treating its hook frames
   *     as if they came from a local Codex/Claude would let it drive
   *     the orchestrator's pipeline executor. R2+ adds a controlled
   *     bridge with hook-name allowlist + tool-arg validation.
   *
   * Caller responsibilities:
   *
   *   - runId is already verified via runJWT in runnerWsAuth.js — the
   *     caller should NEVER trust runId from the frame body itself.
   *   - hookEvent is whatever the runner emitted; we copy a defensive
   *     subset rather than persist arbitrary structure.
   */
  /**
   * Slice R1-g: report-only fan-out for hook frames the WS handler
   *   accepted under a verified runJWT. NEVER drives the local
   *   executor — runners are across the trust boundary.
   *
   * Slice R1-k2: emits runner_hook_routed on every accepted frame so
   *   the audit chain can attest to what crossed the boundary (verdict
   *   runId is authoritative; frame body runId is ignored).
   *
   * Slice R2.5-b: extended to (a) sanitize against the bridge contract
   *   in `src/runtime/remoteHookBridgeContract.js`, and (b) return a
   *   structured result so the caller can emit fine-grained audit verbs
   *   (rejected / sanitized / dispatched / dispatch_error).
   *
   *   Backward compat: callers that ignored the return value (R1-k2
   *   integration test, etc.) keep working — broadcast still happens
   *   on every runId+event call as before. The result is an opt-in
   *   for callers that want to drive the audit chain.
   *
   * Slice R2.5-c: when bridgeMode === "dispatch", the sanitized
   *   payload is forwarded to the local executor's mapped method
   *   (per remoteHookBridgeContract.EXECUTOR_DISPATCH). The result
   *   lands in `result.dispatched`. In "off" or "report" modes,
   *   `result.dispatched` stays null.
   *
   *   The function is async because the executor methods may be async.
   *   Old callers that called this synchronously and ignored the
   *   return value still work — the broadcast is synchronous and
   *   happens before any async work.
   *
   * @param {string} runId  Verdict runId (NEVER trust frame body).
   * @param {object} hookEvent  The runner's event payload.
   * @param {object} [ctx]
   * @param {string} [ctx.hostIdentity]  Verdict-bound host identity.
   *   Plumbed into the approval request payload so the audit chain +
   *   operator card can name the runner that asked.
   * @param {string} [ctx.source]  Provenance label for the approval
   *   audit row. Defaults to "remote_hook".
   * @returns {Promise<{
   *   broadcast: boolean,                       // routeRemote happened
   *   rejected: null | {reason: string},        // sanitization verdict
   *   sanitized: null | object,                 // post-sanitizer payload
   *   approval: null | {
   *     requested: boolean,
   *     approvalId?: string,
   *     resolution?: "granted"|"denied"|"timeout"|"cancelled"|"unavailable",
   *     decidedAt?: number,
   *     deciderId?: string|null,
   *     reason?: string|null
   *   },
   *   dispatched: null | {ok: boolean, method?: string, error?: string}
   * }>}
   */
  async routeRemote(runId, hookEvent, ctx) {
    const result = {
      broadcast: false,
      rejected: null,
      sanitized: null,
      approval: null,
      dispatched: null,
    };
    if (typeof runId !== "string" || runId.length === 0) return result;
    if (!hookEvent || typeof hookEvent !== "object") return result;
    const callCtx = ctx && typeof ctx === "object" ? ctx : {};
    this.stats.total += 1;
    this.stats.remoteHooks = (this.stats.remoteHooks || 0) + 1;
    const event = {
      hook: typeof hookEvent.hook === "string" ? hookEvent.hook : null,
      tool: typeof hookEvent.tool === "string" ? hookEvent.tool : null,
      data: hookEvent.data && typeof hookEvent.data === "object" ? hookEvent.data : {},
    };
    this.stats.byEvent[event.hook || "unknown"] = (this.stats.byEvent[event.hook || "unknown"] || 0) + 1;
    if (typeof this.broadcast === "function") {
      this.broadcast({
        type: "runner_hook",
        data: { runId, origin: "container-remote", event },
      });
    }
    result.broadcast = true;

    // R2.5-b: sanitize against the bridge contract. The result lands
    // in `result` for the caller to emit audit verbs. Note we run the
    // sanitizer AFTER broadcast — even rejected frames are visible to
    // dashboard subscribers (they need to see the inbound traffic
    // even when validation will refuse to dispatch it).
    const verdict = sanitizeRemoteHook(hookEvent);
    if (!verdict.ok) {
      result.rejected = { reason: verdict.reason };
      this.stats.remoteHookRejected = (this.stats.remoteHookRejected || 0) + 1;
      return result;
    }
    result.sanitized = verdict.sanitized;
    this.stats.remoteHookSanitized = (this.stats.remoteHookSanitized || 0) + 1;

    // R2.5-c: dispatch only when bridge mode is "dispatch". "off" and
    // "report" stop here — operators can preview the validation
    // outcome (`runner_hook_sanitized` audit) before promoting.
    if (this._bridgeMode !== "dispatch") return result;

    // R3-e-d: write-tool sanitized payloads round-trip through the
    // approval manager before dispatch. _dispatchSanitized handles
    // the gate logic; the approval verdict (or null when no approval
    // was needed) lands in `result.approval` for the caller's audit.
    const dispatchResult = await this._dispatchSanitized(runId, verdict.sanitized, {
      hostIdentity: callCtx.hostIdentity || null,
      source: callCtx.source || null,
    });
    result.approval = dispatchResult.approval;
    result.dispatched = dispatchResult.dispatched;

    if (result.dispatched && result.dispatched.ok) {
      this.stats.remoteHookDispatched = (this.stats.remoteHookDispatched || 0) + 1;
    } else if (result.dispatched && !result.dispatched.ok) {
      this.stats.remoteHookDispatchError = (this.stats.remoteHookDispatchError || 0) + 1;
    }
    return result;
  }

  /**
   * Slice R2.5-c: forward a sanitized remote hook to the local
   * executor. NEVER touches the runner's frame body directly — the
   * sanitizer already produced a defensive copy with only allowlist
   * keys. Method binding lives in EXECUTOR_DISPATCH.
   *
   * Slice R3-e-d: write-tool sanitized payloads (Bash / Edit / Write
   * — sanitized.requiresApproval === true) round-trip through the
   * approvalManager before any executor method is invoked. The
   * approval verdict (granted / denied / timeout / cancelled /
   * unavailable) lands in the returned `approval` field; only
   * "granted" proceeds to dispatch. "unavailable" is the fail-closed
   * mode that fires when no approvalManager is wired — the operator
   * deliberately disabled approvals, so the router refuses to
   * dispatch a write hook that would have needed one.
   *
   * Failure modes:
   *   - no_executor — neither orchestrator nor attached executor available
   *   - executor_method_missing — executor lacks the expected onXxx method
   *   - unmapped_hook — sanitized.hook is not in EXECUTOR_DISPATCH
   *                     (should not happen if sanitizer is correct;
   *                     defensive nonetheless)
   *   - approval_unavailable — requiresApproval && no approvalManager
   *   - approval_denied — operator pressed deny
   *   - approval_timeout — operator did not respond in time
   *   - approval_cancelled — pending request cancelled (run completed
   *                         / WS dropped / orchestrator shutdown)
   *   - <executor's thrown message> — wrapped from the executor itself
   *
   * @param {string} runId
   * @param {object} sanitized — output of sanitizeRemoteHook (incl.
   *   `requiresApproval` flag).
   * @param {object} [ctx]
   * @param {string|null} [ctx.hostIdentity]
   * @param {string|null} [ctx.source]
   * @returns {Promise<{
   *   approval: null | object,
   *   dispatched: null | {ok: boolean, method?: string, error?: string}
   * }>}
   */
  async _dispatchSanitized(runId, sanitized, ctx) {
    const callCtx = ctx && typeof ctx === "object" ? ctx : {};
    const out = { approval: null, dispatched: null };

    const dispatch = EXECUTOR_DISPATCH[sanitized.hook];
    if (!dispatch) {
      out.dispatched = { ok: false, error: "unmapped_hook" };
      return out;
    }

    // R3-e-d: approval gate — only fires for write-tool sanitized
    // payloads. Read-only tools skip the gate entirely.
    if (sanitized.requiresApproval) {
      const gate = await this._gateOnApproval(sanitized, runId, callCtx);
      out.approval = gate.approval;
      if (!gate.proceed) {
        out.dispatched = { ok: false, method: dispatch.method, error: gate.error };
        return out;
      }
    }

    const executor = this._resolveExecutorByRunId(runId);
    if (!executor) {
      out.dispatched = { ok: false, method: dispatch.method, error: "no_executor" };
      return out;
    }
    const fn = executor[dispatch.method];
    if (typeof fn !== "function") {
      out.dispatched = {
        ok: false, method: dispatch.method, error: "executor_method_missing",
      };
      return out;
    }
    // Bind args from the sanitized payload by key. The contract pins
    // each binding key as one of {tool, response, _data}; the special
    // _data key passes the entire sanitized data object.
    const args = dispatch.args.map((argKey) => {
      if (argKey === "_data") return sanitized._data;
      return sanitized[argKey];
    });
    try {
      await fn.apply(executor, args);
      out.dispatched = { ok: true, method: dispatch.method };
    } catch (e) {
      out.dispatched = {
        ok: false, method: dispatch.method,
        error: (e && e.message) ? e.message : String(e),
      };
    }
    return out;
  }

  /**
   * R3-e-d: gate a write-tool sanitized payload behind operator
   * approval. Returns:
   *
   *   { proceed: true,  approval: {requested:true, resolution:"granted", ...} }
   *   { proceed: false, approval: {requested:true, resolution:"denied", ...},  error: "approval_denied" }
   *   { proceed: false, approval: {requested:true, resolution:"timeout", ...}, error: "approval_timeout" }
   *   { proceed: false, approval: {requested:true, resolution:"cancelled", ...}, error: "approval_cancelled" }
   *   { proceed: false, approval: {requested:false, resolution:"unavailable"}, error: "approval_unavailable" }
   *
   * Audit verbs (runner_hook_approval_*) fire from the manager's own
   * auditFn — the router does not emit them. The manager owns the
   * audit narration so a future router refactor can't accidentally
   * skip it.
   */
  async _gateOnApproval(sanitized, runId, ctx) {
    if (!this.approvalManager) {
      // Fail-closed: no manager wired but the sanitizer marked the
      // payload as approval-required. Refuse to dispatch.
      this.stats.remoteHookApprovalUnavailable = (this.stats.remoteHookApprovalUnavailable || 0) + 1;
      return {
        proceed: false,
        approval: { requested: false, resolution: "unavailable" },
        error: "approval_unavailable",
      };
    }
    this.stats.remoteHookApprovalRequested = (this.stats.remoteHookApprovalRequested || 0) + 1;

    // GOV-APPROVAL-0: scan args for Korean PII before queueing the
    // approval. Defensive try/catch — a scanner fault must not cause
    // the gate to fail open OR leak the args to the audit chain.
    // The result lands in piiContext on the manager request so the
    // operator card surfaces detected types at decision time.
    const piiContext = this._scanArgsForPii(sanitized.tool, sanitized._data);

    let result;
    try {
      result = await this.approvalManager.request({
        hook: sanitized.hook,
        tool: sanitized.tool,
        args: sanitized._data,  // already filtered to allowlist by sanitizer
        runId,
        hostIdentity: ctx.hostIdentity || null,
        source: ctx.source || "remote_hook",
        piiContext,
      });
    } catch (e) {
      // Manager.request() only throws on invalid input (caller bug).
      // Treat as fail-closed approval_unavailable.
      this.stats.remoteHookApprovalUnavailable = (this.stats.remoteHookApprovalUnavailable || 0) + 1;
      return {
        proceed: false,
        approval: { requested: false, resolution: "unavailable" },
        error: "approval_unavailable",
      };
    }

    const approval = {
      requested: true,
      approvalId: result.approvalId,
      resolution: result.resolution,
      decidedAt: result.decidedAt,
      deciderId: result.deciderId,
      reason: result.reason,
    };

    if (result.resolution === "granted") {
      this.stats.remoteHookApprovalGranted = (this.stats.remoteHookApprovalGranted || 0) + 1;
      return { proceed: true, approval };
    }
    if (result.resolution === "denied") {
      this.stats.remoteHookApprovalDenied = (this.stats.remoteHookApprovalDenied || 0) + 1;
      return { proceed: false, approval, error: "approval_denied" };
    }
    if (result.resolution === "timeout") {
      this.stats.remoteHookApprovalTimeout = (this.stats.remoteHookApprovalTimeout || 0) + 1;
      return { proceed: false, approval, error: "approval_timeout" };
    }
    // cancelled — caller-side cleanup (run completed, WS dropped, etc.)
    this.stats.remoteHookApprovalCancelled = (this.stats.remoteHookApprovalCancelled || 0) + 1;
    return { proceed: false, approval, error: "approval_cancelled" };
  }

  /**
   * Slice GOV-APPROVAL-0: scan a write-tool's args for Korean PII so
   * the operator approval card can surface detected types at decision
   * time. Returns a manager-shaped piiContext or null when scan
   * yields no PII (or a scanner fault — defensive fail-quiet).
   *
   * The deeper pattern set (BRN / driver license / passport in
   * addition to the GOV-PII-0 inline 5) is appropriate here — the
   * operator is reviewing a single tool call, not a stream of prompt
   * tokens, so the deeper scan's runtime cost is amortized across
   * the operator's review window.
   *
   * @param {string} tool
   * @param {object} args  sanitizer's defensive copy
   * @returns {object|null}  {hasPii, findingTypes, samples, scannedAt}
   *   or null when the scan yields no signals.
   */
  _scanArgsForPii(tool, args) {
    const text = _argsToScannableText(args);
    if (text.length === 0) return null;
    let scan;
    try {
      scan = this.scanForPii(text, { depth: "deep" });
    } catch (_) {
      // Scanner fault: better to surface a null piiContext than to
      // crash the gate or leak the raw args via the error path.
      return null;
    }
    if (!scan || !scan.hasPii) return null;
    const findingTypes = Array.isArray(scan.findings)
      ? scan.findings.map((f) => f.type) : [];
    const samples = {};
    if (Array.isArray(scan.findings)) {
      for (const f of scan.findings) {
        samples[f.type] = f.samples;  // already redacted by scanner
      }
    }
    return {
      hasPii: true,
      findingTypes,
      samples,
      scannedAt: Date.now(),
    };
  }

  /**
   * Slice R2.5-c: pick the executor for the JWT-verdict's runId.
   *
   * Uses the verdict runId DIRECTLY — never reads payload.session_id
   * etc. (that's how _resolveExecutor(payload) drives local pipeline
   * routing; for remote hooks the JWT is authoritative).
   *
   * Resolution order:
   *   1. orchestrator.getOrCreateRun(runId) — creates a new pipeline
   *      run if it doesn't exist + the orchestrator has headroom.
   *      This is what makes runner-claimed runs first-class in the
   *      monitor's run list (R2.5-d concern).
   *   2. orchestrator.get(runId) — fallback for orchestrators without
   *      the getOrCreateRun method.
   *   3. this.executor — last-resort fallback to the singleton
   *      executor (single-pipeline mode).
   */
  _resolveExecutorByRunId(runId) {
    if (this.orchestrator) {
      if (typeof this.orchestrator.getOrCreateRun === "function") {
        const exec = this.orchestrator.getOrCreateRun(runId);
        if (exec) return exec;
      } else if (typeof this.orchestrator.get === "function") {
        const exec = this.orchestrator.get(runId);
        if (exec) return exec;
      }
    }
    return this.executor;
  }

  getStats() {
    return { ...this.stats };
  }

  _samplePayload(event, payload) {
    if (process.env.ORCHESTRATOR_SAMPLE_HOOKS !== "1") return;
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

// Slice GOV-APPROVAL-0 helper. Build a flat scannable text from
// write-tool args so piiScanner can surface Korean PII matches. Each
// string-valued field becomes "key=value" on its own line; primitive
// number/bool fields collapse to "key=String(value)". Non-primitive
// values (arrays / nested objects) are skipped — the WRITE_TOOL_DATA_KEYS
// contract guarantees flat args for Bash / Edit / Write, so this only
// matters as a defensive fallback for future tool additions.
function _argsToScannableText(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const parts = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      parts.push(`${key}=${value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join("\n");
}

module.exports = { HookRouter, _argsToScannableText };
