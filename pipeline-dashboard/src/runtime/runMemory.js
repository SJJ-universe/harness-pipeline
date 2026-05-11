// Slice S4-a (Phase 2 / SMART-4, 2026-05-05) — privacy-by-design run memory.
//
// What this module is
// ───────────────────
// "Run memory" is the orchestrator's lightweight, RECONSTRUCTABLE-FROM-LEDGER
// summary of what a pipeline run did. It's NOT the run's full transcript.
// Operators get to see "the orchestrator remembered this about run X" via a
// future UI tab + a token-gated HTTP route. SMART-5 (policy packs) +
// SMART-2 hard gate audit verbs + the recommendation engine all consume
// this.
//
// Why "privacy-by-design"
// ───────────────────────
// Plan §S §S-SMART-4 v2 explicitly flags "기억" (memory) as a NEW risk
// surface. A naïve implementation would dump every prompt + every patch
// + every Codex critique into a JSONL file. That's three privacy
// problems:
//   1. Prompts can carry PII that the orchestrator already chose to refuse
//      forwarding to the LLM (GOV-PII-0); persisting them anyway in
//      "memory" reintroduces the leak.
//   2. Patch / diff text can carry source-code secrets (API keys
//      hard-coded, env files mistakenly added to the change set).
//   3. Codex critique text can quote operator inputs verbatim.
//
// Six privacy guards SMART-4 v2 implements:
//
//   1. TTL — `ORCHESTRATOR_RUN_MEMORY_TTL_MS` (default 30 days). After
//      that, the entry can be cleaned by evidenceLedger.cleanup().
//      Records live in the ledger as `run_memory_recorded` rows so
//      the existing TTL machinery covers them automatically.
//
//   2. Opt-out — `ORCHESTRATOR_RUN_MEMORY_DISABLE=1` → recordRunMemory
//      returns {recorded:false, reason:"disabled_by_env"} immediately.
//
//   3. Max length per field — every text field has a hard cap
//      (FIELD_LIMITS below). Overflow → truncate + `truncated:true`
//      flag on the record so the operator sees "this was clipped".
//
//   4. NO raw text persistence — diff / patch raw bodies are never
//      stored. Instead a `sourceHash` (sha256 of the canonical change
//      content) lets a forensic auditor verify "yes, the orchestrator saw
//      this exact diff" by re-hashing source files, without the diff
//      itself being on disk.
//
//   5. Redaction status — when public-sector posture, every text
//      field passes through piiScanner.scanForPii (or the redactPii
//      helper); detected PII → replaced with `[REDACTED:<type>]`
//      tokens + `redacted:true` flag on the record.
//
//   6. Public-sector route auth + audit — getRunMemory itself is
//      pure (no auth check). The HTTP route layer (S4-b) enforces
//      loopback + x-orchestrator-token + emits `run_memory_accessed`
//      audit so a forensic auditor can see WHO read the memory.
//
// Schema (frozen)
// ───────────────
// {
//   schema:        "orchestrator-run-memory/v1",
//   runId:         string,
//   recordedAt:    ISO timestamp,
//   truncated:     bool (any field exceeded its FIELD_LIMITS cap),
//   redacted:      bool (any field had PII redacted),
//   redactedTypes: string[] (e.g. ["email", "krn"] — empty when no
//                  redaction; helps operator understand WHY redacted=true
//                  without exposing the values themselves),
//   sourceHash:    string|null (sha256 of canonical change content; null
//                  when no diff/patch was part of the run),
//   fields: {
//     goal,                // ≤ 256 chars
//     changeSummary,       // ≤ 2 KB
//     codexFindings,       // ≤ 4 KB (counts + top severities; not full text)
//     approvals,           // {granted, denied, timeout} counts only
//     piiDetected,         // {hasPii, types: ["krn","email",...]} (no samples)
//     failureCause,        // ≤ 512 chars (pipeline phase / first error)
//     nextTimeWatchOuts,   // ≤ 1 KB (operator-curated lessons learned)
//   },
// }
//
// Audit verb landed via evidenceLedger.append:
//   `run_memory_recorded` data shape =
//     {schema, recordedAt, truncated, redacted, redactedTypes,
//      sourceHash, fields, gateMode}
//
// gateMode comes from policyGates.resolveGateMode so the audit row
// shows whether the run was operating under hard or warn gates at
// the time of recording.

"use strict";

const crypto = require("node:crypto");

const { scanForPii, redactPii } = require("../security/piiScanner");
const { resolveDeploymentProfile } = require("../policy/deploymentProfile");

// ── Frozen vocabulary ──────────────────────────────────────────────

const SCHEMA = "orchestrator-run-memory/v1";

// Audit verb. Operators grep this when a forensic question lands:
// "what did the orchestrator remember about run X?"
const AUDIT_VERBS = Object.freeze({
  RECORDED: "run_memory_recorded",
  ACCESSED: "run_memory_accessed",
});

// Per-field length caps in characters (UTF-16 code units; same as
// JS string .length). Authored for the Korean public-sector use
// case where mixed Hangul + ASCII content commonly bytes ≈ 1.5×
// chars; the caps stay friendly to that ratio.
const FIELD_LIMITS = Object.freeze({
  goal:              256,
  changeSummary:     2 * 1024,
  codexFindings:     4 * 1024,
  failureCause:      512,
  nextTimeWatchOuts: 1024,
});

const REASON_DISABLED = "disabled_by_env";
const REASON_RECORDED = "recorded";

// ── Helpers ────────────────────────────────────────────────────────

function _isOptOut(env, deploymentProfile) {
  // Slice POL-a (POLICY-UX-0): pack-level runMemoryEnabled=false
  // also disables run memory writes. All 5 SMART-5 packs ship with
  // runMemoryEnabled=true today, but a future "minimal-debug" pack
  // could disable memory at the rule level.
  // Precedence (high → low):
  //   1. env ORCHESTRATOR_RUN_MEMORY_DISABLE truthy → opt out (operator
  //      override, beats pack default)
  //   2. pack.runMemoryEnabled === false → opt out
  //   3. record (default)
  // Backwards compat: pre-POL-a 1-arg callers (no deploymentProfile)
  // see step 1 only — identical to legacy behavior.
  const e = env || (typeof process !== "undefined" ? process.env : {});
  const v = String(e.ORCHESTRATOR_RUN_MEMORY_DISABLE || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (deploymentProfile && deploymentProfile.runMemoryEnabled === false) {
    return true;
  }
  return false;
}

function _truncateField(text, limit) {
  if (typeof text !== "string") return { text: "", truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  // Truncate + ellipsis marker so the UI can show "this was clipped"
  // without scanning the field.
  return {
    text: text.slice(0, limit - 3) + "...",
    truncated: true,
  };
}

function _safeRedactString(text, deploymentProfile) {
  if (typeof text !== "string" || text.length === 0) {
    return { text: text || "", redacted: false, types: [] };
  }
  if (!deploymentProfile || deploymentProfile.publicSector !== true) {
    return { text, redacted: false, types: [] };
  }
  // Public-sector: scan + redact. piiScanner.redactPii returns the
  // text with detected PII replaced by `[REDACTED:<type>]` tokens.
  let scan;
  try {
    scan = scanForPii(text);
  } catch (_) {
    // Scanner failure under public-sector → fail-loud: redact
    // EVERYTHING by replacing with a placeholder. This is more
    // conservative than "let plaintext through".
    return {
      text: "[REDACTED:scanner_failure]",
      redacted: true,
      types: ["scanner_failure"],
    };
  }
  if (!scan || scan.hasPii !== true) {
    return { text, redacted: false, types: [] };
  }
  let redacted;
  try {
    redacted = redactPii(text);
  } catch (_) {
    return {
      text: "[REDACTED:scanner_failure]",
      redacted: true,
      types: ["scanner_failure"],
    };
  }
  const types = (scan.findings || [])
    .map((f) => f && f.type)
    .filter(Boolean);
  return { text: redacted, redacted: true, types };
}

/**
 * Compute a stable sha256 over the canonical change content (a
 * diff / patch / file list). Returns hex digest or null when no
 * content provided. Operators use this to verify "yes, this run
 * touched these exact bytes" without the bytes being on disk.
 *
 * @param {string|object|null} content
 * @returns {string|null} 64-hex-char sha256, or null
 */
function computeSourceHash(content) {
  if (content === null || content === undefined) return null;
  let canonical;
  if (typeof content === "string") {
    if (content.length === 0) return null;
    canonical = content;
  } else if (typeof content === "object") {
    try {
      canonical = JSON.stringify(content, Object.keys(content).sort());
    } catch (_) {
      return null;
    }
    if (canonical === "{}" || canonical === "null") return null;
  } else {
    canonical = String(content);
  }
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ── Build the redacted record ─────────────────────────────────────

/**
 * Pure builder — takes raw inputs + posture, returns the frozen
 * record that recordRunMemory persists.
 *
 * Caller passes the `inputs` shape:
 *   {
 *     goal:              string,
 *     changeSummary:     string,
 *     codexFindings:     string,
 *     approvals:         { granted, denied, timeout, ... },
 *     piiDetected:       { hasPii, types: [] },
 *     failureCause:      string,
 *     nextTimeWatchOuts: string,
 *     sourceContent:     any  (will be hashed; not persisted),
 *   }
 *
 * @param {string} runId
 * @param {object} inputs
 * @param {object} [opts]
 * @param {object} [opts.deploymentProfile]
 * @param {string} [opts.gateMode]  - "hard" | "warn" | null
 * @param {function} [opts.clockFn] - testable wall-clock
 * @returns {object} frozen record
 */
function buildRunMemoryRecord(runId, inputs, opts = {}) {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new TypeError("runId required");
  }
  const dp = opts.deploymentProfile || resolveDeploymentProfile({});
  const clockFn = typeof opts.clockFn === "function" ? opts.clockFn : () => new Date().toISOString();
  const raw = inputs && typeof inputs === "object" ? inputs : {};

  // Process each text field: truncate first (cheap), then redact
  // (potentially expensive). Truncation FIRST means the redactor
  // works on a bounded input.
  const allTypes = new Set();
  let truncatedAny = false;
  let redactedAny = false;

  function _processText(rawText, limit) {
    const t = _truncateField(rawText, limit);
    if (t.truncated) truncatedAny = true;
    const r = _safeRedactString(t.text, dp);
    if (r.redacted) {
      redactedAny = true;
      for (const ty of r.types) allTypes.add(ty);
    }
    return r.text;
  }

  const goal = _processText(raw.goal, FIELD_LIMITS.goal);
  const changeSummary = _processText(raw.changeSummary, FIELD_LIMITS.changeSummary);
  const codexFindings = _processText(raw.codexFindings, FIELD_LIMITS.codexFindings);
  const failureCause = _processText(raw.failureCause, FIELD_LIMITS.failureCause);
  const nextTimeWatchOuts = _processText(raw.nextTimeWatchOuts, FIELD_LIMITS.nextTimeWatchOuts);

  // approvals: defensive — only stash counts, never names / decider IDs.
  let approvals = null;
  if (raw.approvals && typeof raw.approvals === "object") {
    approvals = {
      granted: Number(raw.approvals.granted) || 0,
      denied: Number(raw.approvals.denied) || 0,
      timeout: Number(raw.approvals.timeout) || 0,
    };
  }

  // piiDetected: counts + types only (NO samples — those would
  // re-leak the redacted PII).
  let piiDetected = null;
  if (raw.piiDetected && typeof raw.piiDetected === "object") {
    piiDetected = {
      hasPii: !!raw.piiDetected.hasPii,
      types: Array.isArray(raw.piiDetected.types)
        ? raw.piiDetected.types.filter((t) => typeof t === "string").slice(0, 16)
        : [],
    };
  }

  const sourceHash = computeSourceHash(raw.sourceContent);

  const record = Object.freeze({
    schema: SCHEMA,
    runId,
    recordedAt: clockFn(),
    truncated: truncatedAny,
    redacted: redactedAny,
    redactedTypes: Object.freeze(Array.from(allTypes).sort()),
    sourceHash,
    fields: Object.freeze({
      goal,
      changeSummary,
      codexFindings,
      approvals: approvals ? Object.freeze(approvals) : null,
      piiDetected: piiDetected ? Object.freeze({
        hasPii: piiDetected.hasPii,
        types: Object.freeze(piiDetected.types.slice()),
      }) : null,
      failureCause,
      nextTimeWatchOuts,
    }),
    gateMode: opts.gateMode || null,
  });
  return record;
}

// ── Recorder ───────────────────────────────────────────────────────

/**
 * Persist a run memory record via evidenceLedger.append.
 *
 * Returns {recorded, reason, record?} so the caller can audit + emit
 * downstream events. Defensive: ledger.append throwing does NOT
 * propagate (memory recording must never break pipeline_complete).
 *
 * @param {object} opts
 * @param {string} opts.runId
 * @param {object} opts.inputs   - raw inputs, see buildRunMemoryRecord
 * @param {object} opts.ledger   - evidenceLedger instance (must have .append(runId,{type,data}))
 * @param {object} [opts.deploymentProfile]
 * @param {string} [opts.gateMode]
 * @param {object} [opts.env]    - default process.env
 * @param {function} [opts.clockFn]
 * @returns {{recorded: boolean, reason: string, record?: object, error?: string}}
 */
function recordRunMemory(opts = {}) {
  const env = opts.env || (typeof process !== "undefined" ? process.env : {});
  // Slice POL-a: pass deploymentProfile to _isOptOut so a pack with
  // runMemoryEnabled=false disables writes at runtime (in addition
  // to env opt-out).
  if (_isOptOut(env, opts.deploymentProfile)) {
    return { recorded: false, reason: REASON_DISABLED };
  }
  if (!opts.ledger || typeof opts.ledger.append !== "function") {
    return { recorded: false, reason: "ledger_unavailable" };
  }
  let record;
  try {
    record = buildRunMemoryRecord(opts.runId, opts.inputs, {
      deploymentProfile: opts.deploymentProfile,
      gateMode: opts.gateMode,
      clockFn: opts.clockFn,
    });
  } catch (err) {
    return {
      recorded: false,
      reason: "build_failed",
      error: String(err && err.message ? err.message : err).slice(0, 256),
    };
  }
  try {
    // The audit-verb shape carries the WHOLE record (it IS the
    // memory; there's no separate persistence). Tests pin this.
    opts.ledger.append(opts.runId, {
      type: AUDIT_VERBS.RECORDED,
      data: record,
    });
  } catch (err) {
    return {
      recorded: false,
      reason: "ledger_append_failed",
      error: String(err && err.message ? err.message : err).slice(0, 256),
      record,
    };
  }
  return { recorded: true, reason: REASON_RECORDED, record };
}

// ── Reader ────────────────────────────────────────────────────────

// ── Derivation: pipeline snapshot → runMemory inputs ──────────────

/**
 * Project a pipeline_complete snapshot into the runMemory inputs
 * shape. The derivation is intentionally LOSSY — long phase logs,
 * raw findings text, full approval audit data are dropped/condensed
 * because runMemory is a SUMMARY (privacy-by-design field 6 of 6).
 *
 * The snapshot shape (from PipelineExecutor._complete):
 *   {
 *     templateId: string,
 *     durationMs: number,
 *     iteration: number,
 *     state: {
 *       templateId, phases: [{id, status, ...}],
 *       findings: [{severity, message, ...}],
 *       artifacts: [{phaseId, kind, ...}],
 *       ...,
 *     },
 *     reason: "complete" | "disabled" | "session-end" | ...,
 *     verification: { pass, missing: [], results: [] },
 *   }
 *
 * Output is the inputs shape recordRunMemory expects.
 *
 * @param {object} snapshot
 * @returns {object}
 */
function deriveFromPipelineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return {};
  const state = (snapshot.state && typeof snapshot.state === "object")
    ? snapshot.state : {};

  const templateId = String(snapshot.templateId || state.templateId || "unknown");
  const iteration = Number.isFinite(Number(snapshot.iteration))
    ? Number(snapshot.iteration) : 0;

  // goal: short, human-friendly. Template id + iteration captures
  // "what did this run try to do" without leaking prompt text.
  const goal = `${templateId} (iteration ${iteration})`;

  // changeSummary: phase outcomes + duration. Lists each phase's
  // completed/skipped/failed status as a single line, then the total
  // duration. This is short + pure metadata — no prompt / patch text.
  const phases = Array.isArray(state.phases) ? state.phases : [];
  const phaseLines = phases
    .filter((p) => p && typeof p === "object" && p.id)
    .map((p) => {
      const status = p.status || "?";
      const dur = Number.isFinite(Number(p.durationMs)) ? `${p.durationMs}ms` : "";
      return `${p.id}: ${status}${dur ? ` (${dur})` : ""}`;
    });
  const totalLine = `total ${snapshot.durationMs || 0}ms (${snapshot.reason || "unknown"})`;
  const changeSummary = [...phaseLines, totalLine].join("\n");

  // codexFindings: severity counts + the first 3 messages per
  // severity. The piiScanner-redactor + truncate cap will catch any
  // leak in the messages.
  const findings = Array.isArray(state.findings) ? state.findings : [];
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
  const samplesByLevel = { critical: [], high: [], medium: [], low: [] };
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    const sev = String(f.severity || "note").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(bySeverity, sev)) {
      bySeverity[sev] += 1;
      if (samplesByLevel[sev] && samplesByLevel[sev].length < 3) {
        const msg = String(f.message || "").slice(0, 200);
        if (msg) samplesByLevel[sev].push(msg);
      }
    }
  }
  let codexFindings = `Counts: critical=${bySeverity.critical} high=${bySeverity.high} medium=${bySeverity.medium} low=${bySeverity.low} note=${bySeverity.note}`;
  for (const sev of ["critical", "high", "medium", "low"]) {
    if (samplesByLevel[sev].length === 0) continue;
    codexFindings += `\n[${sev}]\n` + samplesByLevel[sev].map((m) => `- ${m}`).join("\n");
  }

  // approvals: if state.approvalCounts is present (the pipelineState
  // is free to expose this) use it; otherwise leave null. recordRunMemory
  // strips any non-counts fields automatically.
  const approvals = (state.approvalCounts && typeof state.approvalCounts === "object")
    ? {
        granted: Number(state.approvalCounts.granted) || 0,
        denied: Number(state.approvalCounts.denied) || 0,
        timeout: Number(state.approvalCounts.timeout) || 0,
      }
    : null;

  // piiDetected: types-only summary. recordRunMemory enforces the
  // "no samples" invariant.
  const piiDetected = (state.piiDetected && typeof state.piiDetected === "object")
    ? {
        hasPii: !!state.piiDetected.hasPii,
        types: Array.isArray(state.piiDetected.types) ? state.piiDetected.types : [],
      }
    : null;

  // failureCause: condense reason + first verification miss.
  let failureCause = "";
  if (snapshot.reason && snapshot.reason !== "complete" && snapshot.reason !== "ok") {
    failureCause = `reason=${snapshot.reason}`;
  }
  const verification = snapshot.verification || {};
  if (!verification.pass && Array.isArray(verification.missing) && verification.missing.length > 0) {
    const missingNote = verification.missing.slice(0, 3)
      .map((m) => (m && typeof m === "object") ? (m.id || JSON.stringify(m)) : String(m))
      .join(", ");
    failureCause = (failureCause ? failureCause + "; " : "") + `missing: ${missingNote}`;
  }

  // nextTimeWatchOuts: derive from verification.results when failures
  // exist. Operator can supplement this via S4-c follow-up routes
  // (out of scope for this slice).
  let nextTimeWatchOuts = "";
  if (Array.isArray(verification.results)) {
    const failed = verification.results.filter((r) => r && r.pass === false);
    if (failed.length > 0) {
      nextTimeWatchOuts = failed.slice(0, 5)
        .map((r) => `- ${r.id || "unknown"}: ${r.message || r.reason || "no detail"}`)
        .join("\n");
    }
  }

  return {
    goal,
    changeSummary,
    codexFindings,
    approvals,
    piiDetected,
    failureCause,
    nextTimeWatchOuts,
    // sourceContent: not derivable from snapshot at this layer.
    // Pipeline-executor doesn't carry diff blobs through state by
    // default; future enhancement can add a `state.lastDiff` channel.
    sourceContent: null,
  };
}

/**
 * Read the most recent run_memory_recorded entry for a runId from
 * the ledger. Returns null when no record exists.
 *
 * NOTE: this is a pure read; it doesn't enforce auth. The HTTP
 * route layer (S4-b) does that.
 *
 * @param {string} runId
 * @param {object} ledger
 * @returns {object|null} the record (frozen — same shape buildRunMemoryRecord returned)
 */
function getRunMemory(runId, ledger) {
  if (typeof runId !== "string" || runId.length === 0) return null;
  if (!ledger || typeof ledger.read !== "function") return null;
  let entries;
  try {
    entries = ledger.read(runId);
  } catch (_) {
    return null;
  }
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // Walk backwards for the LATEST run_memory_recorded.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e.type === AUDIT_VERBS.RECORDED && e.data) {
      return e.data;
    }
  }
  return null;
}

module.exports = {
  SCHEMA,
  AUDIT_VERBS,
  FIELD_LIMITS,
  buildRunMemoryRecord,
  recordRunMemory,
  getRunMemory,
  computeSourceHash,
  deriveFromPipelineSnapshot,
  // Exposed for tests + S4-b route's audit-verb wiring
  REASON_DISABLED,
  REASON_RECORDED,
  // Internal helpers exposed for fine-grained tests
  _isOptOut,
  _truncateField,
  _safeRedactString,
};
