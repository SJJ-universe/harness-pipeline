// Slice SMART-0-a (Phase D Round UI-P / Phase 2 SMART arc start, 2026-05-04)
// — Decision Context Foundation.
//
// Pure synchronous module that maps live-server state into a single
// frozen "what should the operator look at right now" snapshot.
// Every subsequent SMART round reads this snapshot:
//   - SMART-1 Recommendation Cards: route operator to the most
//     blocking issue surfaced by these booleans
//   - SMART-2 Policy-backed Hard Gates: enforce deny when
//     (publicSector && hasPii) etc.
//   - SMART-3 Expert Review Presets: pre-fill review prompts based
//     on context flags
//   - SMART-4 Redacted Run Memory: sourcing for "what was happening"
//     at the time of a decision
//   - SMART-5 Institutional Policy Packs: pack rules consume same
//     adapter outputs
//
// Why pure + frozen + dependency-injected:
//   - Pure → trivially testable (no I/O)
//   - Frozen schema → other SMART rounds depend on the shape; a
//     casual addition is a deliberate, PR-reviewed change
//   - DI adapters → server wiring constructs the real adapters from
//     approvalManager / reviewSessionManager / runRegistry /
//     deploymentProfile / evidenceLedger / profileStore;
//     tests pass stub objects with the same shape
//   - Per-adapter try/catch → a single broken adapter doesn't break
//     the whole snapshot; sources.<id>.errored marks which one failed
//
// Schema: orchestrator-decision-context/v1
//   {
//     schema: "orchestrator-decision-context/v1",
//     timestamp: ISO,
//     booleans: { 8 documented flags, all default false },
//     counts:   { numeric counters, all default 0 },
//     posture:  { mode, requirePiiScan, allowLocalExecutor, ... },
//     sources:  { per-adapter status: "ok" | "absent" | { errored: true, message } },
//   }

"use strict";

const SCHEMA = "orchestrator-decision-context/v1";

// Frozen list of boolean flags. DO NOT add/remove without updating
// every consumer + their tests.
const BOOLEAN_KEYS = Object.freeze([
  "hasPii",
  "approvalPending",
  "codexReviewMissing",
  "auditExportReady",
  "publicSector",
  "hasActiveProfile",
  "needsHumanDecision",
  "remoteRunnerActive",
]);

// Frozen list of count keys. Counts are auxiliary numeric signals
// the panels can render alongside booleans (e.g., "3 pending
// approvals" vs just "approval pending: true").
const COUNT_KEYS = Object.freeze([
  "activeRuns",
  "pendingApprovals",
  "openReviewSessions",
  "remoteRunnerCount",
  "evidenceLedgerEntries",
]);

// Frozen list of source IDs (one per adapter). Each maps to a
// `sources.<id>` entry in the output. Status values:
//   "ok"      — adapter ran without error
//   "absent"  — adapter not provided (build context with fewer inputs)
//   { errored: true, message } — adapter threw
const SOURCE_IDS = Object.freeze([
  "approvalManager",
  "reviewSessionManager",
  "runRegistry",
  "deploymentProfile",
  "evidenceLedger",
  "profileStore",
  "remoteRunner",
]);

// ── Internal helpers ────────────────────────────────────────────

function _safeNumber(n) {
  if (typeof n !== "number" || !isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function _emptyOutput(timestamp) {
  const booleans = {};
  for (const k of BOOLEAN_KEYS) booleans[k] = false;
  const counts = {};
  for (const k of COUNT_KEYS) counts[k] = 0;
  const sources = {};
  for (const id of SOURCE_IDS) sources[id] = "absent";
  return {
    schema: SCHEMA,
    timestamp,
    booleans,
    counts,
    posture: { mode: "standard", publicSector: false },
    sources,
  };
}

// Wrap one adapter call. Mutates `out.booleans`, `out.counts`,
// `out.posture`, `out.sources[id]` based on the result of `fn(adapter)`.
// If `adapter` is null/undefined → sources.<id> stays "absent".
// If fn throws → sources.<id> = { errored, message } and all writes
// from this adapter are reverted (snapshot integrity).
function _runAdapter(out, id, adapter, fn) {
  if (adapter == null) return;
  try {
    fn(adapter);
    out.sources[id] = "ok";
  } catch (err) {
    out.sources[id] = {
      errored: true,
      message: String(err && err.message ? err.message : err).slice(0, 200),
    };
  }
}

// ── Adapter readers ─────────────────────────────────────────────
// Each reader knows the contract of one server-side service and
// updates the corresponding booleans/counts. Keep these short and
// boring — they're the source-of-truth for "what does this signal
// mean".

function _readApprovalManager(out, m) {
  // ApprovalManager.list() returns array of pending requests
  if (typeof m.list !== "function") return;
  const list = m.list();
  const count = Array.isArray(list) ? list.length : 0;
  out.counts.pendingApprovals = _safeNumber(count);
  out.booleans.approvalPending = count > 0;
}

function _readReviewSessionManager(out, m) {
  // ReviewSessionManager.list() returns array of sessions; we
  // count "open" (not archived) and flag awaiting_critique.
  if (typeof m.list !== "function") return;
  const list = m.list();
  if (!Array.isArray(list)) return;
  let open = 0;
  let awaitingCritique = false;
  for (const s of list) {
    if (!s || typeof s !== "object") continue;
    if (s.state !== "archived") open += 1;
    if (s.state === "awaiting_critique") awaitingCritique = true;
  }
  out.counts.openReviewSessions = _safeNumber(open);
  out.booleans.codexReviewMissing = awaitingCritique;
}

function _readRunRegistry(out, r) {
  // runRegistry.list() returns array of active runs (orchestrator
  // contract). Each run has at least { runId, state }.
  if (typeof r.list !== "function") return;
  const list = r.list();
  if (!Array.isArray(list)) return;
  let active = 0;
  for (const run of list) {
    if (!run || typeof run !== "object") continue;
    if (run.state === "running" || run.state === "active") active += 1;
  }
  out.counts.activeRuns = _safeNumber(active);
}

function _readDeploymentProfile(out, dp) {
  // deploymentProfile is a frozen-ish object with mode + flags.
  // We surface the entire posture sub-object verbatim (operator-side
  // panels rely on stable keys).
  const mode = (dp && typeof dp.mode === "string") ? dp.mode : "standard";
  const publicSector = !!(dp && dp.publicSector);
  out.posture = {
    mode,
    publicSector,
    allowLocalExecutor: !!(dp && dp.allowLocalExecutor),
    requirePiiScan: !!(dp && dp.requirePiiScan),
    requireSandboxWorkspace: !!(dp && dp.requireSandboxWorkspace),
    requireSignedManifest: !!(dp && dp.requireSignedManifest),
  };
  out.booleans.publicSector = publicSector;
}

function _readEvidenceLedger(out, el) {
  // EvidenceLedger has chain entries. Adapter contract: count() →
  // total entries; hasRecentEntries(intervalMs) → boolean (optional).
  if (typeof el.count === "function") {
    out.counts.evidenceLedgerEntries = _safeNumber(el.count());
  } else if (typeof el.size === "function") {
    out.counts.evidenceLedgerEntries = _safeNumber(el.size());
  }
  // auditExportReady: any entries available means auditor bundle
  // can be exported. Conservative — actual export-readiness has
  // additional signing requirements GOV-AUDIT-0 covers.
  out.booleans.auditExportReady = out.counts.evidenceLedgerEntries > 0;
}

function _readProfileStore(out, ps) {
  // profileStore has list() + active() (or activeProfileId getter).
  let activeId = null;
  if (typeof ps.active === "function") {
    const active = ps.active();
    activeId = active && active.id ? active.id : null;
  } else if (typeof ps.activeProfileId === "function") {
    activeId = ps.activeProfileId();
  }
  out.booleans.hasActiveProfile = !!activeId;
}

function _readRemoteRunner(out, rr) {
  // remoteRunner adapter — when in remote mode, surfaces active runner
  // count. Adapter contract: snapshot() → array of runners.
  if (typeof rr.snapshot !== "function") return;
  const list = rr.snapshot();
  if (!Array.isArray(list)) return;
  let active = 0;
  for (const runner of list) {
    if (!runner || typeof runner !== "object") continue;
    if (runner.healthy === true || runner.online === true) active += 1;
  }
  out.counts.remoteRunnerCount = _safeNumber(list.length);
  out.booleans.remoteRunnerActive = active > 0;
}

// ── needsHumanDecision aggregator ──────────────────────────────
//
// Final boolean derived AFTER all adapters run. Tracks whether
// any blocking operator-attention signal is true. Recommendation
// cards (SMART-1) use this to decide if any "지금 해야 할 일"
// recommendation should fire at all.
function _aggregateNeedsHumanDecision(out) {
  const b = out.booleans;
  out.booleans.needsHumanDecision = !!(
    b.approvalPending ||
    b.codexReviewMissing ||
    (b.publicSector && b.hasPii) ||
    !b.hasActiveProfile
  );
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Build a decision-context snapshot.
 *
 * @param {object} adapters  { approvalManager?, reviewSessionManager?,
 *                            runRegistry?, deploymentProfile?,
 *                            evidenceLedger?, profileStore?, remoteRunner? }
 * @param {object} [opts]
 *   @param {Function} [opts.nowFn]     Inject Date.now for tests
 *   @param {boolean}  [opts.hasPii]    Override hasPii from external
 *                                     scanner (piiScanner is stateless,
 *                                     so this flag comes from the
 *                                     scanning caller)
 * @returns {object} frozen snapshot
 */
function buildContext(adapters = {}, opts = {}) {
  const nowFn = opts.nowFn || (() => Date.now());
  const timestamp = new Date(nowFn()).toISOString();
  const out = _emptyOutput(timestamp);

  // Apply caller-provided hasPii BEFORE adapters, so a public-sector
  // adapter result combined with hasPii flips needsHumanDecision.
  if (opts.hasPii === true) out.booleans.hasPii = true;

  _runAdapter(out, "approvalManager", adapters.approvalManager, function (m) {
    _readApprovalManager(out, m);
  });
  _runAdapter(out, "reviewSessionManager", adapters.reviewSessionManager, function (m) {
    _readReviewSessionManager(out, m);
  });
  _runAdapter(out, "runRegistry", adapters.runRegistry, function (r) {
    _readRunRegistry(out, r);
  });
  _runAdapter(out, "deploymentProfile", adapters.deploymentProfile, function (dp) {
    _readDeploymentProfile(out, dp);
  });
  _runAdapter(out, "evidenceLedger", adapters.evidenceLedger, function (el) {
    _readEvidenceLedger(out, el);
  });
  _runAdapter(out, "profileStore", adapters.profileStore, function (ps) {
    _readProfileStore(out, ps);
  });
  _runAdapter(out, "remoteRunner", adapters.remoteRunner, function (rr) {
    _readRemoteRunner(out, rr);
  });

  _aggregateNeedsHumanDecision(out);

  // Freeze the result + nested objects so consumers can't mutate
  // a snapshot they're holding.
  Object.freeze(out.booleans);
  Object.freeze(out.counts);
  Object.freeze(out.posture);
  Object.freeze(out.sources);
  Object.freeze(out);
  return out;
}

module.exports = {
  SCHEMA,
  BOOLEAN_KEYS,
  COUNT_KEYS,
  SOURCE_IDS,
  buildContext,
  // Internal helpers exported for shape testing
  _emptyOutput,
  _safeNumber,
};
