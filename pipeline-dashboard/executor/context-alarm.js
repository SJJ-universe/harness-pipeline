// ContextAlarm — T2 (rev2 H4/H5)
//
// Watches hook payloads for context pressure and broadcasts `context_alarm`
// events at 40% (notice) and 55% (warn). Never blocks — the dashboard shows a
// banner recommending the user run /compact.
//
// Design notes:
// - `context_usage` is NOT present in real Claude Code hook payloads (confirmed
//   by T2.0 payload dumper). We fall back to estimating from `transcript_path`
//   file size at ~4 bytes/token.
// - Duplicate suppression is per session_id so one long session doesn't spam.
// - `evaluate()` returns a plain info object with no `block`/`decision` keys
//   (rev2 H5: never block Stop on context pressure).

const fs = require("fs");

const CONTEXT_LIMIT_TOKENS = 200_000;
const THRESHOLD_NOTICE = 0.40;
const THRESHOLD_WARN = 0.55;

function estimateContextUsage(transcriptPath) {
  if (!transcriptPath) return 0;
  try {
    const bytes = fs.statSync(transcriptPath).size;
    const tokensApprox = Math.round(bytes / 4);
    return Math.min(tokensApprox / CONTEXT_LIMIT_TOKENS, 1.0);
  } catch (_) {
    return 0;
  }
}

function getContextUsage(payload) {
  if (payload && typeof payload.context_usage === "number") {
    return Math.min(Math.max(payload.context_usage, 0), 1);
  }
  return estimateContextUsage(payload && payload.transcript_path);
}

class ContextAlarm {
  constructor({ broadcast } = {}) {
    this.broadcast = typeof broadcast === "function" ? broadcast : () => {};
    this.sessions = new Map();
  }

  _getSession(sessionId) {
    const key = sessionId || "__default__";
    if (!this.sessions.has(key)) {
      this.sessions.set(key, { at40: false, at55: false });
    }
    return this.sessions.get(key);
  }

  evaluate(payload) {
    const usage = getContextUsage(payload || {});
    const sessionId = payload && payload.session_id;
    const sent = this._getSession(sessionId);
    const fired = [];

    if (usage >= THRESHOLD_WARN && !sent.at55) {
      sent.at55 = true;
      sent.at40 = true;
      fired.push({ severity: "warn", threshold: THRESHOLD_WARN, usage });
    } else if (usage >= THRESHOLD_NOTICE && !sent.at40) {
      sent.at40 = true;
      fired.push({ severity: "notice", threshold: THRESHOLD_NOTICE, usage });
    }

    for (const ev of fired) {
      this.broadcast({
        type: "context_alarm",
        data: {
          severity: ev.severity,
          threshold: ev.threshold,
          usage: ev.usage,
          sessionId: sessionId || null,
          at: Date.now(),
        },
      });
    }

    return { usage, fired: fired.length };
  }

  reset(sessionId) {
    if (sessionId) this.sessions.delete(sessionId);
    else this.sessions.clear();
  }

  getState(sessionId) {
    return this._getSession(sessionId);
  }
}

module.exports = {
  ContextAlarm,
  estimateContextUsage,
  getContextUsage,
  CONTEXT_LIMIT_TOKENS,
  THRESHOLD_NOTICE,
  THRESHOLD_WARN,
};
