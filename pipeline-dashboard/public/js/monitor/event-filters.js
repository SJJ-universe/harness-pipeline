// Slice UI-H3 (Phase D / Phase E1.5, 2026-04-30) — event filter helpers.
//
// Pure functions that filter the bounded events ring (snapshot.events)
// for the dual agent console + the bottom-dock raw-log + future
// runner-stream views. Splitting filter logic into a dedicated
// module keeps each consumer thin and lets the tests pin behavior
// once.
//
// Event envelope shape (from monitor/normalizer.js):
//   { type, runId, ts, scope, summary, payload }
//
//   scope:    "global" | "phase" | "tool" | "child" | "subagent" |
//             "claude" | "codex" | "verify" | "audit" | ... (future)
//   payload.runner: optional — "claude" / "codex" / "verifier" /
//             "system" — set when the event originates from a
//             runner-bound stream chunk.
//
// Filter helpers favor TOLERANT input handling — they accept
// non-arrays / null / undefined and return [] gracefully so a panel
// rendering before a snapshot has loaded doesn't crash.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorEventFilters = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  /**
   * @param {Array} events       envelopes from snapshot.events
   * @param {string} scope       e.g. "claude" / "codex" / "verify"
   * @returns {Array} envelopes whose `scope` matches; empty array on
   *   garbage input.
   */
  function filterEventsByScope(events, scope) {
    if (!Array.isArray(events) || typeof scope !== "string") return [];
    if (scope.length === 0) return [];
    const out = [];
    for (const e of events) {
      if (e && typeof e === "object" && e.scope === scope) out.push(e);
    }
    return out;
  }

  /**
   * @param {Array} events
   * @param {string} runner      e.g. "claude" / "codex"
   * @returns {Array} envelopes whose `payload.runner` matches.
   */
  function filterEventsByRunner(events, runner) {
    if (!Array.isArray(events) || typeof runner !== "string") return [];
    if (runner.length === 0) return [];
    const out = [];
    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const p = e.payload;
      if (p && typeof p === "object" && p.runner === runner) out.push(e);
    }
    return out;
  }

  /**
   * Combined filter — match by scope OR payload.runner. Useful for
   * the dual-agent console which renders Claude lines whether they
   * arrive labelled `scope: "claude"` (new contract) or
   * `payload.runner: "claude"` (legacy chunks routed through
   * tool_recorded events).
   *
   * @param {Array} events
   * @param {string|string[]} matchers   single label or array of labels
   * @returns {Array}
   */
  function filterEventsByLabel(events, matchers) {
    if (!Array.isArray(events)) return [];
    const labels = Array.isArray(matchers) ? matchers
      : (typeof matchers === "string" && matchers.length > 0 ? [matchers] : []);
    if (labels.length === 0) return [];
    const out = [];
    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const scope = e.scope;
      const runner = e.payload && e.payload.runner;
      for (const l of labels) {
        if (scope === l || runner === l) {
          out.push(e);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Tail the last N items. Used by the dual-console view to show the
   * most-recent stream output without scrolling miles of back-history.
   *
   * @param {Array} events
   * @param {number} n
   * @returns {Array} last n entries (same order as input)
   */
  function tailEvents(events, n) {
    if (!Array.isArray(events) || typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      return [];
    }
    if (events.length <= n) return events.slice();
    return events.slice(events.length - n);
  }

  /**
   * Convert an envelope to a single line of operator-readable text.
   * The dual-console panel renders one envelope per line; this helper
   * picks whichever field carries the most useful chunk text.
   *
   * Priority:
   *   1. payload.chunk      (review-relay stream chunks)
   *   2. payload.text       (free-form text payloads)
   *   3. payload.message    (toast / log messages)
   *   4. summary            (normalizer's compressed form)
   *   5. type               (last-resort label)
   *
   * @param {object} envelope
   * @returns {string}
   */
  function envelopeToLine(envelope) {
    if (!envelope || typeof envelope !== "object") return "";
    const p = envelope.payload || {};
    if (typeof p.chunk === "string" && p.chunk.length > 0) return p.chunk;
    if (typeof p.text === "string" && p.text.length > 0) return p.text;
    if (typeof p.message === "string" && p.message.length > 0) return p.message;
    if (typeof envelope.summary === "string" && envelope.summary.length > 0) return envelope.summary;
    return typeof envelope.type === "string" ? envelope.type : "";
  }

  return {
    filterEventsByScope,
    filterEventsByRunner,
    filterEventsByLabel,
    tailEvents,
    envelopeToLine,
  };
});
