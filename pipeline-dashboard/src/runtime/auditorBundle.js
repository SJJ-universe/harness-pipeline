// Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30) — auditor evidence bundle.
//
// Produces a tamper-evident JSON bundle that an external auditor can
// inspect and verify against a published HMAC seal. The bundle is
// **sealed** (HMAC over canonical-encoded fields) rather than zipped —
// every supported auditor environment reads JSON, no archive library
// dependency, no offset/encoding pitfalls.
//
// Two modes:
//   - byRun: pull entries for a single runId (read + verifyChain)
//   - byWindow: pull entries across a date window (across all runs;
//     requires evidenceLedger.listRuns to enumerate)
//
// Bundle shape:
//   {
//     schema: "harness-auditor-bundle/v1",
//     exportedAt: ISO,
//     mode: "byRun" | "byWindow",
//     scope: { runId | windowFromAt+windowToAt },
//     deployment: { mode, publicSector, allowLocalExecutor, ... },
//     totalEntries: N,
//     truncated: bool,
//     limit: N,
//     entries: [...],            // entries (oldest-first)
//     chain: { valid, entries, brokenAt?, reason? },
//     seal: {
//       alg: "HMAC-SHA256" | "none",
//       info: "auditor-bundle",
//       computedAt: ISO,
//       coverage: ["schema","exportedAt","mode","scope","deployment",
//                  "entriesHash","chainHash","totalEntries","limit"],
//       value: "<hex>" | null
//     },
//     verify: {
//       command: "node scripts/verify-auditor-bundle.js <path>",
//       notes: "..."
//     }
//   }
//
// Seal omitted (alg:"none", value:null) when no sealing key is wired.
// Chain hashes still travel inside `entries[].previousHash` /
// `entries[].eventHash`, so even an unsealed bundle is internally
// consistent — the auditor verifies the chain locally and accepts
// the result if the chain is `valid:true`.
//
// What this does NOT do:
//   - No zip / tar / archive — JSON only.
//   - No PII redaction beyond what evidenceLedger already stripped.
//   - No public-key signature — HMAC is symmetric. External auditor
//     verification needs the same key the orchestrator uses (operators
//     in the same agency / paired through the deployment manifest).
//   - No CSV / human-readable export. Auditor scripts are JSON-aware.

"use strict";

const crypto = require("crypto");

const SCHEMA = "harness-auditor-bundle/v1";
const SEAL_INFO = "auditor-bundle";
const DEFAULT_LIMIT = 1024;
const MAX_LIMIT = 8192;

const COVERAGE_FIELDS = Object.freeze([
  "schema",
  "exportedAt",
  "mode",
  "scope",
  "deployment",
  "entriesHash",
  "chainHash",
  "totalEntries",
  "limit",
]);

function _sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function _stableStringify(value) {
  // Stable JSON: sort object keys recursively. Arrays stay in order
  // (audit chain ordering is part of the integrity claim).
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(_stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + _stableStringify(value[k])).join(",") + "}";
}

function _hashEntries(entries) {
  // Hash a representation of the entries array. We hash the
  // already-canonical JSON so the auditor can re-derive without
  // calling our code.
  return _sha256Hex(_stableStringify(entries));
}

function _chainHashSummary(chain) {
  return _sha256Hex(_stableStringify(chain));
}

function _validIso(value) {
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function _entryAtAsIso(entry) {
  if (!entry) return null;
  if (typeof entry.at === "string") return entry.at;
  if (typeof entry.at === "number") return new Date(entry.at).toISOString();
  return null;
}

function _entryWithinWindow(entry, fromIso, toIso) {
  const at = _entryAtAsIso(entry);
  if (!at) return false;
  if (fromIso && at < fromIso) return false;
  if (toIso && at > toIso) return false;
  return true;
}

function _signSeal({ payload, sealKey, computedAt }) {
  if (!sealKey) {
    return Object.freeze({
      alg: "none",
      info: SEAL_INFO,
      computedAt,
      coverage: COVERAGE_FIELDS.slice(),
      value: null,
    });
  }
  // Sign over the canonical-encoded `coverage` projection of the
  // bundle. The auditor recomputes the projection + recomputes the
  // HMAC; mismatch = tampered.
  const projection = {};
  for (const k of COVERAGE_FIELDS) projection[k] = payload[k];
  const canonical = _stableStringify(projection);
  const h = crypto.createHmac("sha256", sealKey);
  h.update(canonical);
  const value = h.digest("hex");
  return Object.freeze({
    alg: "HMAC-SHA256",
    info: SEAL_INFO,
    computedAt,
    coverage: COVERAGE_FIELDS.slice(),
    value,
  });
}

function _safeDeployment(profile) {
  if (!profile || typeof profile !== "object") {
    return { mode: "standard", publicSector: false };
  }
  // Whitelist — mirror what /api/server/info ships under deployment.
  return {
    mode: profile.mode || (profile.publicSector ? "public-sector" : "standard"),
    publicSector: !!profile.publicSector,
    allowLocalExecutor: profile.allowLocalExecutor !== false,
    allowPlaintextSecrets: profile.allowPlaintextSecrets !== false,
    requireSandboxWorkspace: !!profile.requireSandboxWorkspace,
    requirePiiScan: !!profile.requirePiiScan,
  };
}

function buildByRun({
  evidenceLedger, runId, deployment, sealKey, limit,
  clockFn = () => new Date().toISOString(),
}) {
  if (!evidenceLedger || typeof evidenceLedger.read !== "function" || typeof evidenceLedger.verifyChain !== "function") {
    throw new Error("auditorBundle.buildByRun: evidenceLedger required");
  }
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("auditorBundle.buildByRun: runId required");
  }
  const cap = _normalizeLimit(limit);

  const all = evidenceLedger.read(runId);
  if (!Array.isArray(all)) {
    throw new Error("auditorBundle.buildByRun: ledger.read returned non-array");
  }
  const totalEntries = all.length;
  const truncated = totalEntries > cap;
  // Last N — auditor cares about most-recent end-of-run rows. The
  // chain itself still verifies in full because verifyChain reads
  // its own copy; the bundle's chain summary covers the WHOLE chain
  // even when entries[] is truncated.
  const sliced = truncated ? all.slice(all.length - cap) : all;
  const chain = evidenceLedger.verifyChain(runId);

  return _packageBundle({
    mode: "byRun",
    scope: Object.freeze({ runId }),
    entries: sliced,
    totalEntries,
    truncated,
    limit: cap,
    chain,
    deployment,
    sealKey,
    clockFn,
  });
}

function buildByWindow({
  evidenceLedger, windowFromAt, windowToAt,
  deployment, sealKey, limit,
  clockFn = () => new Date().toISOString(),
}) {
  if (!evidenceLedger
    || typeof evidenceLedger.read !== "function"
    || typeof evidenceLedger.verifyChain !== "function"
    || typeof evidenceLedger.listRuns !== "function") {
    throw new Error("auditorBundle.buildByWindow: evidenceLedger.{read,verifyChain,listRuns} required");
  }
  const fromIso = _validIso(windowFromAt);
  const toIso = _validIso(windowToAt);
  if (!fromIso && !toIso) {
    throw new Error("auditorBundle.buildByWindow: at least one of windowFromAt/windowToAt required");
  }
  if (fromIso && toIso && fromIso > toIso) {
    throw new Error("auditorBundle.buildByWindow: windowFromAt must be ≤ windowToAt");
  }
  const cap = _normalizeLimit(limit);

  const allRuns = evidenceLedger.listRuns() || [];
  const collected = [];
  const chains = {};
  for (const r of allRuns) {
    const entries = evidenceLedger.read(r) || [];
    for (const e of entries) {
      if (_entryWithinWindow(e, fromIso, toIso)) collected.push(e);
    }
    chains[r] = evidenceLedger.verifyChain(r);
  }
  // Sort collected entries by `at` ASC for a deterministic timeline.
  collected.sort((a, b) => {
    const ai = _entryAtAsIso(a) || "";
    const bi = _entryAtAsIso(b) || "";
    if (ai === bi) return 0;
    return ai < bi ? -1 : 1;
  });

  const totalEntries = collected.length;
  const truncated = totalEntries > cap;
  const sliced = truncated ? collected.slice(0, cap) : collected;

  // Per-run chain summary; aggregate validity is the AND of all chains.
  let allValid = true;
  for (const r of Object.keys(chains)) {
    if (!chains[r] || chains[r].valid === false) { allValid = false; break; }
  }
  const aggregateChain = {
    valid: allValid,
    runs: chains,
    runCount: Object.keys(chains).length,
  };

  return _packageBundle({
    mode: "byWindow",
    scope: Object.freeze({
      windowFromAt: fromIso,
      windowToAt: toIso,
    }),
    entries: sliced,
    totalEntries,
    truncated,
    limit: cap,
    chain: aggregateChain,
    deployment,
    sealKey,
    clockFn,
  });
}

function _packageBundle({
  mode, scope, entries, totalEntries, truncated, limit, chain,
  deployment, sealKey, clockFn,
}) {
  const exportedAt = clockFn();
  const dep = _safeDeployment(deployment);
  // Pre-seal payload (without the seal field — that's the last to add)
  const entriesHash = _hashEntries(entries);
  const chainHash = _chainHashSummary(chain);
  const projection = {
    schema: SCHEMA,
    exportedAt,
    mode,
    scope,
    deployment: dep,
    entriesHash,
    chainHash,
    totalEntries,
    limit,
  };
  const seal = _signSeal({
    payload: projection,
    sealKey,
    computedAt: exportedAt,
  });
  return {
    schema: SCHEMA,
    exportedAt,
    mode,
    scope,
    deployment: dep,
    totalEntries,
    truncated,
    limit,
    entriesHash,
    chainHash,
    entries,
    chain,
    seal,
    verify: Object.freeze({
      command: "node scripts/verify-auditor-bundle.js <path>",
      notes: "Recompute entriesHash / chainHash / projection HMAC; mismatch → tampered.",
    }),
  };
}

function _normalizeLimit(value) {
  if (value == null || value === "") return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function verifyBundle(bundle, sealKey) {
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, reason: "invalid_input" };
  }
  if (bundle.schema !== SCHEMA) {
    return { ok: false, reason: "unknown_schema" };
  }
  // entries hash check
  const recomputedEntriesHash = _hashEntries(Array.isArray(bundle.entries) ? bundle.entries : []);
  if (recomputedEntriesHash !== bundle.entriesHash) {
    return { ok: false, reason: "entries_hash_mismatch", expected: bundle.entriesHash, actual: recomputedEntriesHash };
  }
  const recomputedChainHash = _chainHashSummary(bundle.chain);
  if (recomputedChainHash !== bundle.chainHash) {
    return { ok: false, reason: "chain_hash_mismatch", expected: bundle.chainHash, actual: recomputedChainHash };
  }
  // chain validity (does NOT require key)
  if (bundle.chain && bundle.chain.valid === false) {
    return { ok: false, reason: "chain_invalid", chain: bundle.chain };
  }
  // seal verification (skipped when alg=none)
  const seal = bundle.seal || {};
  if (seal.alg === "none") {
    return { ok: true, sealed: false, chain: bundle.chain };
  }
  if (!sealKey) return { ok: false, reason: "key_required_for_sealed_bundle" };
  if (seal.alg !== "HMAC-SHA256") {
    return { ok: false, reason: "unknown_seal_alg", alg: seal.alg };
  }
  const projection = {};
  const fields = Array.isArray(seal.coverage) ? seal.coverage : COVERAGE_FIELDS;
  for (const k of fields) projection[k] = bundle[k];
  const canonical = _stableStringify(projection);
  const h = crypto.createHmac("sha256", sealKey);
  h.update(canonical);
  const recomputed = h.digest("hex");
  if (recomputed !== seal.value) {
    return { ok: false, reason: "seal_mismatch", expected: seal.value, actual: recomputed };
  }
  return { ok: true, sealed: true, chain: bundle.chain };
}

module.exports = {
  buildByRun,
  buildByWindow,
  verifyBundle,
  SCHEMA,
  SEAL_INFO,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  COVERAGE_FIELDS,
  _stableStringify,
  _hashEntries,
  _chainHashSummary,
  _normalizeLimit,
  _entryWithinWindow,
};
