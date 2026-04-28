// Slice R2.5-b (Phase D R2.5, 2026-04-28) — remote hook sanitizer.
//
// `sanitizeRemoteHook(rawEvent)` is the pure function that converts a
// runner-supplied frame body into either a {ok: true, sanitized}
// payload safe to dispatch, or an {ok: false, reason} rejection. No
// I/O, no broadcasts, no logging — the caller (hook-router.routeRemote)
// owns those side-effects so this module can be exercised by unit
// tests without any environment.
//
// Sanitization is by ALLOWLIST only:
//
//   - hook name:        must be in remoteHookBridgeContract.ALLOWED_HOOKS
//   - tool (Pre/Post):  must be in remoteHookBridgeContract.ALLOWED_TOOLS
//   - data keys:        each schema.dataKeys allowlist; everything
//                       else is dropped (defensive copy)
//   - required keys:    each schema.dataKeysRequired must be present
//   - response (Post):  capped at schema.responseMaxBytes
//
// The caller MUST treat any returned `sanitized` object as the only
// thing it dispatches. Echoing the raw frame body or trusting fields
// not in the schema would defeat the whole point.

"use strict";

const {
  ALLOWED_HOOKS,
  ALLOWED_TOOLS,
  PAYLOAD_SCHEMAS,
} = require("./remoteHookBridgeContract");

/**
 * Sanitize a raw remote hook frame body.
 *
 * @param {*} rawEvent  Whatever came in over the WS. Must NOT be trusted.
 * @returns {{ok: true, sanitized: object} | {ok: false, reason: string}}
 */
function sanitizeRemoteHook(rawEvent) {
  // Frame must be a non-null object.
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return { ok: false, reason: "frame_malformed" };
  }

  // Hook name must be a non-empty string in the allowlist.
  const hook = rawEvent.hook;
  if (typeof hook !== "string" || hook.length === 0) {
    return { ok: false, reason: "hook_missing" };
  }
  if (!ALLOWED_HOOKS.includes(hook)) {
    return { ok: false, reason: "hook_not_allowed" };
  }

  const schema = PAYLOAD_SCHEMAS[hook];

  // Tool: required for Pre/PostToolUse, must be in allowlist when present.
  let sanitizedTool = null;
  if (schema.requireTool) {
    const tool = rawEvent.tool;
    if (typeof tool !== "string" || tool.length === 0) {
      return { ok: false, reason: "tool_required_missing" };
    }
    if (!ALLOWED_TOOLS.includes(tool)) {
      return { ok: false, reason: "tool_not_allowed" };
    }
    sanitizedTool = tool;
  }

  // Data: must be an object (can be absent — we treat absent as {}).
  // The runner sometimes passes data: null; treat that the same as
  // absent so we don't reject benignly empty frames.
  let rawData = rawEvent.data;
  if (rawData === undefined || rawData === null) {
    rawData = {};
  }
  if (typeof rawData !== "object" || Array.isArray(rawData)) {
    return { ok: false, reason: "data_invalid_type" };
  }

  // Required data keys: every entry in dataKeysRequired must be a
  // non-empty value in rawData.
  for (const key of schema.dataKeysRequired) {
    const v = rawData[key];
    if (v === undefined || v === null || (typeof v === "string" && v.length === 0)) {
      return { ok: false, reason: "data_required_missing" };
    }
  }

  // Defensive copy of allowed data keys ONLY. Anything else in rawData
  // is silently dropped — this is the explicit point of the allowlist.
  const sanitizedData = {};
  for (const key of schema.dataKeys) {
    if (key in rawData) {
      sanitizedData[key] = rawData[key];
    }
  }

  // Response: only PostToolUse declares responseMaxBytes. Cap by JSON
  // serialized length (the runtime cost approximation operators care
  // about); reject when oversize to make the audit trail explicit
  // rather than silently truncating.
  let sanitizedResponse = null;
  if ("responseMaxBytes" in schema) {
    const rawResponse = rawEvent.response;
    if (rawResponse !== undefined && rawResponse !== null) {
      let serialized;
      try { serialized = JSON.stringify(rawResponse); }
      catch (_) { return { ok: false, reason: "data_invalid_type" }; }
      if (typeof serialized !== "string") {
        return { ok: false, reason: "data_invalid_type" };
      }
      if (serialized.length > schema.responseMaxBytes) {
        return { ok: false, reason: "response_oversize" };
      }
      // Re-parse so the caller gets a fresh object reference (avoids
      // any aliasing surprises if the caller mutates).
      try { sanitizedResponse = JSON.parse(serialized); }
      catch (_) { return { ok: false, reason: "data_invalid_type" }; }
    }
  }

  // Pack the result. The dispatcher reads tool / response / _data from
  // here per remoteHookBridgeContract.EXECUTOR_DISPATCH bindings.
  const sanitized = {
    hook,
    tool: sanitizedTool,
    response: sanitizedResponse,
    _data: sanitizedData,
  };
  return { ok: true, sanitized };
}

module.exports = { sanitizeRemoteHook };
