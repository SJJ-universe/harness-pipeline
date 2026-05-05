// Slice FP-b (Phase 2 / FIELD-PILOT-0, 2026-05-05) — runbook structure
// tests for the four field-pilot templates.
//
// These tests are intentionally structural, not stylistic. The goal is
// "does the template still have the sections the operator (and external
// reviewer) needs to find?" — not "is the prose perfect?". Future edits
// to wording are expected; section deletions or renames are not.
//
// Each runbook has a small frozen contract:
//   - title pattern
//   - slice tag (FP-b)
//   - "How to use this template" block
//   - per-runbook required sections
//   - privacy reminder line
//
// If you legitimately need to rename a section, update the test and the
// runbook in the same commit.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RUNBOOK_DIR = path.resolve(__dirname, "..", "..", "docs", "runbooks");

function readRunbook(name) {
  return fs.readFileSync(path.join(RUNBOOK_DIR, name), "utf-8");
}

// ── Common contract for all 4 runbooks ───────────────────────────

const RUNBOOKS = [
  "field-pilot-deployment-log.md",
  "field-pilot-incident-ledger.md",
  "field-pilot-troubleshooting.md",
  "field-pilot-feedback-survey.md",
];

for (const name of RUNBOOKS) {
  test(`FP-b runbook ${name}: file exists and is non-empty`, () => {
    const p = path.join(RUNBOOK_DIR, name);
    assert.ok(fs.existsSync(p), `${p} should exist`);
    const stat = fs.statSync(p);
    assert.ok(stat.size > 1000,
      `${name} should be at least 1000 bytes (got ${stat.size})`);
  });

  test(`FP-b runbook ${name}: has H1 title`, () => {
    const md = readRunbook(name);
    assert.match(md, /^# Runbook —/m,
      `${name} should start with "# Runbook —" H1`);
  });

  test(`FP-b runbook ${name}: tagged with slice FP-b`, () => {
    const md = readRunbook(name);
    assert.match(md, /Slice FP-b \(Phase 2 \/ FIELD-PILOT-0, 2026-05-05\)/,
      `${name} should be tagged with the FP-b slice marker`);
  });

  test(`FP-b runbook ${name}: includes "How to use" block`, () => {
    const md = readRunbook(name);
    // Accept "How to use this template" OR "How to use this catalog"
    // (troubleshooting is a catalog, not a fill-in template).
    assert.match(md, /## How to use this (template|catalog)/,
      `${name} should explain how to use it`);
  });

  test(`FP-b runbook ${name}: privacy reminder present`, () => {
    const md = readRunbook(name);
    assert.match(md, /Privacy/i,
      `${name} should mention privacy somewhere`);
  });
}

// ── deployment-log.md contract ───────────────────────────────────

test("FP-b deployment-log: has Pilot context block", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /## Pilot context/);
  assert.match(md, /Pilot ID/);
  assert.match(md, /Operator/);
  assert.match(md, /Pack mode/);
  assert.match(md, /Harness version/);
});

test("FP-b deployment-log: has Daily entries section + 7 days", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /## Daily entries/);
  // 7 day stub headers
  for (let i = 1; i <= 7; i++) {
    assert.match(md, new RegExp(`### Day ${i} —`),
      `should have a Day ${i} stub`);
  }
});

test("FP-b deployment-log: daily entry template includes probe verdict", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /## Daily entry template/);
  assert.match(md, /Probe verdict/);
  assert.match(md, /OK \/ DEGRADED \/ INCIDENT \/ CONFIG/);
});

test("FP-b deployment-log: has Closeout section", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /## Closeout/);
  assert.match(md, /Pilot end date/);
  assert.match(md, /Operator overall verdict/);
});

test("FP-b deployment-log: cross-references field-pilot-status JSON schema", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /harness-field-pilot-status\/v1/,
    "should mention schema name harness-field-pilot-status/v1");
  // should mention the 8 frozen top-level keys
  for (const k of ["schema", "capturedAt", "verdict", "environment",
                   "health", "audit", "runtime", "notes"]) {
    assert.match(md, new RegExp(`\`${k}\``),
      `should mention the \`${k}\` snapshot key`);
  }
});

// ── incident-ledger.md contract ──────────────────────────────────

test("FP-b incident-ledger: defines 4 severity tiers", () => {
  const md = readRunbook("field-pilot-incident-ledger.md");
  assert.match(md, /## Severity guidance/);
  assert.match(md, /\|\s*`info`\s*\|/);
  assert.match(md, /\|\s*`degraded`\s*\|/);
  assert.match(md, /\|\s*`incident`\s*\|/);
  assert.match(md, /\|\s*`critical`\s*\|/);
});

test("FP-b incident-ledger: append-only contract stated", () => {
  const md = readRunbook("field-pilot-incident-ledger.md");
  assert.match(md, /append-only/i,
    "should call out the append-only ledger contract");
});

test("FP-b incident-ledger: has Entry template + Resolution template", () => {
  const md = readRunbook("field-pilot-incident-ledger.md");
  assert.match(md, /## Entry template/);
  assert.match(md, /## Resolution sub-entry template/);
  assert.match(md, /\*\*Severity\*\*/);
  assert.match(md, /\*\*Pilot day\*\*/);
});

test("FP-b incident-ledger: maps verdicts to severity", () => {
  const md = readRunbook("field-pilot-incident-ledger.md");
  assert.match(md, /Probe verdict/);
  // OK -> usually no entry
  assert.match(md, /usually no entry/);
});

test("FP-b incident-ledger: covers critical incident verbs", () => {
  const md = readRunbook("field-pilot-incident-ledger.md");
  // The critical-tier audit verbs should appear in the cross-reference
  // table so the operator knows when to escalate.
  for (const verb of ["claim_verification_failed",
                      "trust_store_private_key_rejected",
                      "credential_plaintext_fallback",
                      "launcher_signature_failed",
                      "runner_handshake_collision",
                      "runner_host_lost",
                      "pii_scan_blocked",
                      "policy_gate_blocked"]) {
    assert.match(md, new RegExp(`\`${verb}\``),
      `should reference verb \`${verb}\` in the cross-reference table`);
  }
});

// ── troubleshooting.md contract ──────────────────────────────────

test("FP-b troubleshooting: organized by failure surface (6 sections)", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  assert.match(md, /## Section 1 — Installation & launcher/);
  assert.match(md, /## Section 2 — Account & profile/);
  assert.match(md, /## Section 3 — Timeouts & long-running tasks/);
  assert.match(md, /## Section 4 — Permissions & policy gates/);
  assert.match(md, /## Section 5 — Network & runtime/);
  assert.match(md, /## Section 6 — Probe & evidence/);
});

test("FP-b troubleshooting: includes safe-guidance principle on each entry", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  // The principle should be referenced in the catalog overview AND
  // appear repeatedly in entries.
  const matches = md.match(/\*\*Safe-guidance principle\*\*/g) || [];
  assert.ok(matches.length >= 5,
    `expected ≥ 5 safe-guidance-principle entries, got ${matches.length}`);
});

test("FP-b troubleshooting: covers exit codes 37 + 38 from launcher", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  assert.match(md, /code 37/);
  assert.match(md, /code 38/);
  assert.match(md, /signature_missing/);
  assert.match(md, /unknown_key_id/);
});

test("FP-b troubleshooting: has 'adding a new entry' guidance + skeleton", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  assert.match(md, /## Adding a new entry/);
  assert.match(md, /\*\*Symptom\*\*/);
  assert.match(md, /\*\*Likely cause\*\*/);
  assert.match(md, /\*\*Workaround\*\*/);
  assert.match(md, /\*\*Status\*\*/);
});

test("FP-b troubleshooting: covers RR0 idle-watchdog timeouts", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  assert.match(md, /codex_killed_for_idle/);
  assert.match(md, /claude_killed_for_idle/);
  assert.match(md, /idle/i);
});

test("FP-b troubleshooting: covers POL-c pack-rule gate behavior", () => {
  const md = readRunbook("field-pilot-troubleshooting.md");
  assert.match(md, /policy_gate_blocked/);
  assert.match(md, /HARNESS_DEPLOYMENT_PROFILE/);
});

// ── feedback-survey.md contract ──────────────────────────────────

test("FP-b feedback-survey: explicit retrospective framing", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  // the survey is intentionally a retrospective, not a daily diary
  assert.match(md, /retrospective/i);
});

test("FP-b feedback-survey: 1–5 Likert scale defined", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  assert.match(md, /## Section 2 — Per-area Likert/);
  // each scale value should be defined
  assert.match(md, /\*\*1\*\* —/);
  assert.match(md, /\*\*2\*\* —/);
  assert.match(md, /\*\*3\*\* —/);
  assert.match(md, /\*\*4\*\* —/);
  assert.match(md, /\*\*5\*\* —/);
});

test("FP-b feedback-survey: has open-ended questions including safety probes", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  assert.match(md, /## Section 3 — Open-ended/);
  // the two safety questions (3.6 + 3.7) are critical
  assert.match(md, /3\.6 Did you ever feel the tool was making a decision/);
  assert.match(md, /3\.7 Did you ever feel the tool was being too cautious/);
});

test("FP-b feedback-survey: has pack-specific section", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  assert.match(md, /## Section 4 — Pack-specific feedback/);
  assert.match(md, /public-sector/);
  assert.match(md, /finance-high-privacy/);
});

test("FP-b feedback-survey: closing recommendation block", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  assert.match(md, /## Section 5 — Recommendation/);
  assert.match(md, /Recommend running another 1-week pilot/);
  assert.match(md, /Top 3 changes/);
});

test("FP-b feedback-survey: privacy & retention guidance at end", () => {
  const md = readRunbook("field-pilot-feedback-survey.md");
  assert.match(md, /## Privacy & retention/);
  assert.match(md, /Do \*\*not\*\* include/);
});

// ── Cross-runbook coherence ──────────────────────────────────────

test("FP-b cross-coherence: all 4 runbooks reference field-pilot-status.js", () => {
  for (const name of RUNBOOKS) {
    const md = readRunbook(name);
    assert.match(md, /field-pilot-status\.js|field-pilot-status/i,
      `${name} should reference field-pilot-status (the FP-a probe)`);
  }
});

test("FP-b cross-coherence: incident ledger + troubleshooting + survey are linked from deployment-log closeout", () => {
  const md = readRunbook("field-pilot-deployment-log.md");
  assert.match(md, /incident-ledger\.md/);
  assert.match(md, /feedback-survey\.md/);
  // Linked artifacts block
  assert.match(md, /Linked artifacts/);
});
