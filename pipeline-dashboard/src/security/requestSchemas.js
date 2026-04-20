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

module.exports = {
  ALLOWED_EVENT_TYPES,
  validateCodexTrigger,
  validateContextDiscover,
  validateContextLoad,
  validateEvent,
  validateExecutorMode,
  validateGeneralRun,
  validateHook,
};
