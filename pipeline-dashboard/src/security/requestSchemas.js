const ALLOWED_EVENT_TYPES = new Set([
  "auto_pipeline_detect",
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
  "hook_event",
  "log_message",
  "node_update",
  "phase_update",
  "pipeline_complete",
  "pipeline_mutated",
  "pipeline_reset",
  "pipeline_restored",
  "pipeline_resume",
  "pipeline_start",
  "server_restart",
  "server_shutdown",
  "tool_blocked",
  "tool_recorded",
]);

const ALLOWED_HOOK_EVENTS = new Set([
  "user-prompt",
  "pre-tool",
  "post-tool",
  "stop",
  "session-end",
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
