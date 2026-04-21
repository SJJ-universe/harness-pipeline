const ALLOWED_EVENT_TYPES = new Set([
  "auto_pipeline_detect",
  "codex_progress",
  "codex_started",
  "codex_trigger_done",
  "codex_trigger_started",
  "codex_verify_result",
  "codex_verify_started",
  "context_alarm",
  "critique_received",
  "cycle_iteration",
  "error",
  "gate_bypassed",
  "gate_evaluated",
  "gate_failed",
  "general_plan_complete",
  "harness_mode",
  // Slice A (v4): harness_notification surfaces Notification hook payloads
  "harness_notification",
  "hook_event",
  "log_message",
  "node_update",
  // Slice F (v5): broadcast whenever a phase attempt closes. Carries
  // per-attempt durationMs + running totalDurationMs + gate counters so
  // the analytics panel can render a timeline without re-computing.
  "phase_metrics",
  "phase_update",
  "heartbeat",
  "pipeline_complete",
  // Slice A (v4): pipeline_compacted fires on PreCompact so the UI can show a
  // "paused for compaction" indicator without guessing from hook_event alone.
  "pipeline_compacted",
  "pipeline_mutated",
  "pipeline_paused",
  "pipeline_replay",
  "pipeline_reset",
  "pipeline_restored",
  "pipeline_resume",
  "pipeline_start",
  "server_restart",
  "server_shutdown",
  // Slice A (v4): Claude subagent lifecycle surfaces via these two events
  "subagent_started",
  "subagent_completed",
  // Slice E (v4): emitted when custom templates are added/removed so the
  // client's pipeline-selector can re-fetch the merged list.
  "template_registry_reloaded",
  // Slice G (v5): TDD Guard emits this when a src Edit/Write is blocked
  // for lacking a prior test edit in the same phase. Distinct from the
  // generic tool_blocked so the UI can highlight TDD violations.
  "tdd_guard_blocked",
  // Slice J (v5): forwarded from /api/csp-report when the browser reports
  // a CSP violation (Report-Only rollout). Used by the dashboard to flag
  // deployment drift before promoting to enforce mode.
  "csp_violation",
  // Slice N (v6): shared child-process semaphore publishes queue depth on
  // every acquire/release/timeout. Dashboard can surface contention.
  "child_queue_depth",
  // Slice V (v6): multi-run signaling.
  "run_created",
  "run_capacity_reached",
  "file_conflict_warning",
  "tool_blocked",
  "tool_recorded",
]);

// Canonical Claude Code hook event names (e.g. SessionStart, PreCompact) map to
// the internal kebab-case aliases below in hooks/harness-hook.js via CLI args
// and in .claude/settings.json entries. This Set is the single source of truth
// for which aliases the dashboard's /api/hook endpoint accepts.
const ALLOWED_HOOK_EVENTS = new Set([
  "user-prompt",
  "pre-tool",
  "post-tool",
  "stop",
  "session-end",
  // Slice A (v4): expanded coverage for the remaining lifecycle events.
  //   SessionStart   ↔ session-start   (source: startup|resume|clear|compact)
  //   SubagentStart  ↔ subagent-start  (Agent tool dispatch — agent_id/agent_type)
  //   SubagentStop   ↔ subagent-stop   (subagent completion)
  //   Notification   ↔ notification    (level/message — surfaced as toast)
  //   PreCompact     ↔ pre-compact     (flush replay buffer + save summary)
  "session-start",
  "subagent-start",
  "subagent-stop",
  "notification",
  "pre-compact",
]);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function requireObject(value, label = "body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function optionalString(value, label, max = 4096) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.length > max) fail(`${label} is too long`);
  return value;
}

function validateEvent(body) {
  const obj = requireObject(body);
  const type = optionalString(obj.type, "type", 128);
  if (!type) fail("Missing event type");
  if (!ALLOWED_EVENT_TYPES.has(type)) fail(`event type is not allowed: ${type}`);
  const data = obj.data === undefined ? {} : requireObject(obj.data, "data");
  return { type, data };
}

function validateContextLoad(body) {
  const obj = requireObject(body);
  const filePath = optionalString(obj.filePath, "filePath", 4096);
  if (!filePath) fail("Missing filePath");
  return { filePath };
}

function validateContextDiscover(body) {
  const obj = requireObject(body || {});
  return { projectRoot: optionalString(obj.projectRoot, "projectRoot", 4096) };
}

function validateExecutorMode(body) {
  const obj = requireObject(body);
  if (typeof obj.enabled !== "boolean") fail("enabled must be a boolean");
  return { enabled: obj.enabled };
}

function validateGeneralRun(body) {
  const obj = requireObject(body);
  const task = optionalString(obj.task, "task", 10000);
  if (!task || task.trim().length < 3) fail("task (string, 3+ chars) is required");
  const rawMax = obj.maxIterations === undefined ? 3 : Number(obj.maxIterations);
  if (!Number.isFinite(rawMax)) fail("maxIterations must be a number");
  return {
    task: task.trim(),
    maxIterations: Math.max(1, Math.min(Math.trunc(rawMax), 5)),
  };
}

function validateHook(body) {
  const obj = requireObject(body);
  const event = optionalString(obj.event, "event", 64);
  if (!event) fail("missing event");
  if (!ALLOWED_HOOK_EVENTS.has(event)) fail(`hook event is not allowed: ${event}`);
  const payload = obj.payload === undefined ? {} : requireObject(obj.payload, "payload");
  return { event, payload };
}

function validateCodexTrigger(body) {
  const obj = requireObject(body);
  const triggerId = optionalString(obj.triggerId, "triggerId", 128);
  if (!triggerId) fail("triggerId is required");
  return {
    triggerId,
    userInput: optionalString(obj.userInput, "userInput", 50000) || "",
  };
}

// ── Slice E (v4): Template upload validation ──────────────────────
//
// Mirrors src/templates/pipelineTemplate.schema.json. We hand-roll the check
// instead of pulling in ajv so the security surface stays small (no new
// transitive deps) and the rejection reasons are precise in Korean/English.
//
// Accepts templates whose id matches ^custom-[a-z0-9_-]{1,40}$ only —
// built-in ids (default, code-review, testing) are rejected here so
// templateStore.upsert() is a belt-and-suspenders second line of defense.

const CUSTOM_TEMPLATE_ID_RE = /^custom-[a-z0-9_-]{1,40}$/;
const PHASE_ID_RE = /^[A-Z][A-Z0-9_-]{0,15}$/;
const ARTIFACT_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const ALLOWED_PHASE_TOOLS = new Set([
  "Read", "Write", "Edit", "NotebookEdit",
  "Glob", "Grep", "Bash",
  "Agent", "TodoWrite",
  "WebSearch", "WebFetch",
]);
const ALLOWED_AGENTS = new Set(["claude", "codex"]);
const ALLOWED_SEVERITIES = new Set(["critical", "high", "medium", "low", "note"]);
const ALLOWED_NODE_ICON_TYPES = new Set([
  "claude", "codex", "orch", "sabo", "sec", "read", "synth", "debug", "emoji",
]);
const ALLOWED_ARTIFACT_TOOL_MATCH = new Set(["Write", "Edit", "NotebookEdit"]);
const ALLOWED_EXIT_CRITERION_TYPES = new Set([
  "min-tools", "min-tools-in-phase", "has-artifact",
  "no-critical-findings", "critique-received",
  "files-edited", "bash-ran", "used-tool",
]);

// Per-template hard cap: JSON.stringify size. Prevents a single upload from
// ballooning the .harness/templates.json manifest even when each piece is
// individually within schema limits.
const MAX_TEMPLATE_JSON_BYTES = 64 * 1024;

function _assertInteger(value, label, { min, max }) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  if (min != null && value < min) fail(`${label} must be >= ${min}`);
  if (max != null && value > max) fail(`${label} must be <= ${max}`);
}

function _assertStringEnum(value, label, allowed) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (!allowed.has(value)) {
    fail(`${label} must be one of: ${[...allowed].join(", ")}`);
  }
}

function _assertRegex(value, label, maxLen = 200) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.length < 1 || value.length > maxLen) {
    fail(`${label} must be 1–${maxLen} chars`);
  }
  try { new RegExp(value); }
  catch (err) { fail(`${label} is not a valid regex: ${err.message}`); }
}

function _assertNoExtraKeys(obj, allowed, label) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) fail(`${label} has unknown property "${k}"`);
  }
}

function _validateArtifactRule(rule, label) {
  requireObject(rule, label);
  _assertNoExtraKeys(rule, new Set(["toolMatch", "pathMatch", "artifactKey"]), label);
  _assertStringEnum(rule.toolMatch, `${label}.toolMatch`, ALLOWED_ARTIFACT_TOOL_MATCH);
  _assertRegex(rule.pathMatch, `${label}.pathMatch`);
  if (!ARTIFACT_KEY_RE.test(String(rule.artifactKey || ""))) {
    fail(`${label}.artifactKey must match /^[a-z0-9][a-z0-9_-]{0,39}$/`);
  }
}

function _validateExitCriterion(c, label) {
  requireObject(c, label);
  if (!ALLOWED_EXIT_CRITERION_TYPES.has(c.type)) {
    fail(`${label}.type must be one of: ${[...ALLOWED_EXIT_CRITERION_TYPES].join(", ")}`);
  }
  // Per-type allowed-key sets (matches the JSON Schema oneOf branches).
  const allowed = new Set(["type", "message"]);
  switch (c.type) {
    case "min-tools":
    case "min-tools-in-phase":
      allowed.add("count");
      if (c.count !== undefined) _assertInteger(c.count, `${label}.count`, { min: 1, max: 100 });
      break;
    case "has-artifact":
      allowed.add("key");
      allowed.add("scope");
      if (!ARTIFACT_KEY_RE.test(String(c.key || ""))) {
        fail(`${label}.key must match /^[a-z0-9][a-z0-9_-]{0,39}$/`);
      }
      if (c.scope !== undefined) _assertStringEnum(c.scope, `${label}.scope`, new Set(["phase", "any"]));
      break;
    case "no-critical-findings":
      allowed.add("scope");
      allowed.add("severities");
      if (c.scope !== undefined) _assertStringEnum(c.scope, `${label}.scope`, new Set(["latest"]));
      if (c.severities !== undefined) {
        if (!Array.isArray(c.severities) || c.severities.length > 5) {
          fail(`${label}.severities must be an array of ≤5 items`);
        }
        for (const s of c.severities) {
          if (!ALLOWED_SEVERITIES.has(s)) {
            fail(`${label}.severities contains invalid severity: ${s}`);
          }
        }
      }
      break;
    case "critique-received":
      break;
    case "files-edited":
      allowed.add("min");
      allowed.add("scope");
      allowed.add("pathMatch");
      if (c.min !== undefined) _assertInteger(c.min, `${label}.min`, { min: 1, max: 1000 });
      if (c.scope !== undefined) _assertStringEnum(c.scope, `${label}.scope`, new Set(["phase"]));
      if (c.pathMatch !== undefined) _assertRegex(c.pathMatch, `${label}.pathMatch`);
      break;
    case "bash-ran":
      allowed.add("min");
      allowed.add("scope");
      allowed.add("commandMatch");
      if (c.min !== undefined) _assertInteger(c.min, `${label}.min`, { min: 1, max: 1000 });
      if (c.scope !== undefined) _assertStringEnum(c.scope, `${label}.scope`, new Set(["phase"]));
      if (c.commandMatch !== undefined) _assertRegex(c.commandMatch, `${label}.commandMatch`);
      break;
    case "used-tool":
      allowed.add("tool");
      allowed.add("min");
      if (typeof c.tool !== "string" || c.tool.length < 1 || c.tool.length > 40) {
        fail(`${label}.tool must be a string of 1–40 chars`);
      }
      if (c.min !== undefined) _assertInteger(c.min, `${label}.min`, { min: 1, max: 1000 });
      break;
    default:
      fail(`${label}.type is not allowed`);
  }
  if (c.message !== undefined) {
    if (typeof c.message !== "string" || c.message.length > 200) {
      fail(`${label}.message must be a string ≤200 chars`);
    }
  }
  _assertNoExtraKeys(c, allowed, label);
}

function _validateNode(node, label) {
  requireObject(node, label);
  _assertNoExtraKeys(
    node,
    new Set(["id", "icon", "iconType", "label", "sublabel", "group"]),
    label
  );
  if (!NODE_ID_RE.test(String(node.id || ""))) {
    fail(`${label}.id must match /^[a-z0-9][a-z0-9_-]{0,39}$/`);
  }
  if (node.icon !== undefined) optionalString(node.icon, `${label}.icon`, 10);
  if (node.iconType !== undefined) {
    _assertStringEnum(node.iconType, `${label}.iconType`, ALLOWED_NODE_ICON_TYPES);
  }
  if (node.label !== undefined) optionalString(node.label, `${label}.label`, 40);
  if (node.sublabel !== undefined) optionalString(node.sublabel, `${label}.sublabel`, 40);
  if (node.group !== undefined) optionalString(node.group, `${label}.group`, 40);
}

function _validatePhase(phase, label) {
  requireObject(phase, label);
  _assertNoExtraKeys(
    phase,
    new Set([
      "id", "name", "label", "layout", "agent", "allowedTools",
      "timeoutMs", "cycle", "maxIterations", "linkedCycle",
      "connector", "artifactRules", "exitCriteria", "nodes",
      // Slice G (v5): optional TDD Guard config — validated below.
      "tddGuard",
    ]),
    label
  );
  if (!PHASE_ID_RE.test(String(phase.id || ""))) {
    fail(`${label}.id must match /^[A-Z][A-Z0-9_-]{0,15}$/`);
  }
  if (typeof phase.name !== "string" || phase.name.length < 1 || phase.name.length > 60) {
    fail(`${label}.name must be a string of 1–60 chars`);
  }
  if (phase.label !== undefined) optionalString(phase.label, `${label}.label`, 40);
  if (phase.layout !== undefined) _assertStringEnum(phase.layout, `${label}.layout`, new Set(["row"]));
  if (phase.agent !== undefined) _assertStringEnum(phase.agent, `${label}.agent`, ALLOWED_AGENTS);
  if (phase.allowedTools !== undefined) {
    if (!Array.isArray(phase.allowedTools) || phase.allowedTools.length > 20) {
      fail(`${label}.allowedTools must be an array of ≤20 items`);
    }
    for (const t of phase.allowedTools) {
      if (!ALLOWED_PHASE_TOOLS.has(t)) {
        fail(`${label}.allowedTools contains unsupported tool: ${t}`);
      }
    }
  }
  if (phase.timeoutMs !== undefined) {
    _assertInteger(phase.timeoutMs, `${label}.timeoutMs`, { min: 1000, max: 600000 });
  }
  if (phase.cycle !== undefined && typeof phase.cycle !== "boolean") {
    fail(`${label}.cycle must be a boolean`);
  }
  if (phase.maxIterations !== undefined) {
    _assertInteger(phase.maxIterations, `${label}.maxIterations`, { min: 1, max: 10 });
  }
  if (phase.linkedCycle !== undefined && !PHASE_ID_RE.test(String(phase.linkedCycle))) {
    fail(`${label}.linkedCycle must match the phase id pattern`);
  }
  if (phase.connector !== undefined) {
    _assertStringEnum(phase.connector, `${label}.connector`, new Set(["bidirectional"]));
  }
  if (phase.artifactRules !== undefined) {
    if (!Array.isArray(phase.artifactRules) || phase.artifactRules.length > 10) {
      fail(`${label}.artifactRules must be an array of ≤10 items`);
    }
    phase.artifactRules.forEach((r, i) =>
      _validateArtifactRule(r, `${label}.artifactRules[${i}]`));
  }
  if (phase.exitCriteria !== undefined) {
    if (!Array.isArray(phase.exitCriteria) || phase.exitCriteria.length > 10) {
      fail(`${label}.exitCriteria must be an array of ≤10 items`);
    }
    phase.exitCriteria.forEach((c, i) =>
      _validateExitCriterion(c, `${label}.exitCriteria[${i}]`));
  }
  if (phase.nodes !== undefined) {
    if (!Array.isArray(phase.nodes) || phase.nodes.length > 8) {
      fail(`${label}.nodes must be an array of ≤8 items`);
    }
    phase.nodes.forEach((n, i) =>
      _validateNode(n, `${label}.nodes[${i}]`));
  }
  if (phase.tddGuard !== undefined) {
    _validateTddGuard(phase.tddGuard, `${label}.tddGuard`);
  }
}

function _validateTddGuard(rule, label) {
  requireObject(rule, label);
  _assertNoExtraKeys(
    rule,
    new Set(["stage", "srcPattern", "testPattern", "message", "failingProofMessage"]),
    label
  );
  // Slice Q (v6): "failing-proof" stage added for Stage 2 TDD Guard.
  _assertStringEnum(rule.stage, `${label}.stage`, new Set(["edit-first", "failing-proof"]));
  _assertRegex(rule.srcPattern, `${label}.srcPattern`);
  _assertRegex(rule.testPattern, `${label}.testPattern`);
  if (rule.message !== undefined) optionalString(rule.message, `${label}.message`, 300);
  if (rule.failingProofMessage !== undefined) {
    optionalString(rule.failingProofMessage, `${label}.failingProofMessage`, 300);
  }
}

function validateTemplateUpload(body) {
  const obj = requireObject(body);
  _assertNoExtraKeys(obj, new Set(["id", "name", "phases"]), "template");

  if (!CUSTOM_TEMPLATE_ID_RE.test(String(obj.id || ""))) {
    fail(`template.id must match /^custom-[a-z0-9_-]{1,40}$/ (built-in ids are reserved)`);
  }
  if (typeof obj.name !== "string" || obj.name.length < 1 || obj.name.length > 80) {
    fail(`template.name must be a string of 1–80 chars`);
  }
  if (!Array.isArray(obj.phases) || obj.phases.length < 1 || obj.phases.length > 20) {
    fail(`template.phases must be an array of 1–20 items`);
  }

  // Per-phase validation + duplicate-id detection.
  const phaseIds = new Set();
  for (let i = 0; i < obj.phases.length; i++) {
    const phase = obj.phases[i];
    _validatePhase(phase, `template.phases[${i}]`);
    if (phaseIds.has(phase.id)) fail(`template.phases[${i}].id is a duplicate: ${phase.id}`);
    phaseIds.add(phase.id);
  }

  // Cross-phase: linkedCycle must point at an existing phase id in this template.
  for (let i = 0; i < obj.phases.length; i++) {
    const phase = obj.phases[i];
    if (phase.linkedCycle && !phaseIds.has(phase.linkedCycle)) {
      fail(`template.phases[${i}].linkedCycle "${phase.linkedCycle}" does not reference a phase in this template`);
    }
  }

  // Size cap — belt-and-suspenders on top of Express body limit, applied after
  // shape validation so the message makes sense.
  const serialized = JSON.stringify(obj);
  if (serialized.length > MAX_TEMPLATE_JSON_BYTES) {
    fail(`template exceeds ${MAX_TEMPLATE_JSON_BYTES} bytes when serialized`);
  }

  // Return a normalized copy (no extra keys, strict shape).
  return {
    id: obj.id,
    name: obj.name,
    phases: obj.phases.map((p) => ({ ...p })),
  };
}

function validateTemplateId(id) {
  if (typeof id !== "string") fail("template id must be a string");
  if (!CUSTOM_TEMPLATE_ID_RE.test(id)) {
    fail(`template id must match /^custom-[a-z0-9_-]{1,40}$/`);
  }
  return id;
}

module.exports = {
  ALLOWED_EVENT_TYPES,
  validateCodexTrigger,
  validateContextDiscover,
  validateContextLoad,
  validateEvent,
  validateExecutorMode,
  validateGeneralRun,
  validateHook,
  validateTemplateUpload,
  validateTemplateId,
  CUSTOM_TEMPLATE_ID_RE,
  MAX_TEMPLATE_JSON_BYTES,
};
