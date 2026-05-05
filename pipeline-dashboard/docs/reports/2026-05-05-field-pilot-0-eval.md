# FIELD-PILOT-0 Closeout — 1-week production no-regression evidence package

- **Date**: 2026-05-05
- **Round**: Phase 2 / FIELD-PILOT-0 (User-supplied 5-priority roadmap, priority 4)
- **Plan reference**: 2026-05-05 user recommendation (post POLICY-UX-0)
- **Score before**: 120/126
- **Score after**: 120/126 (cap movement candidate; **deferred — pending actual operator field deployment evidence**, see §"Cap movement decision" below)

## What this round shipped

This round prepares the **evidence-collection apparatus** for the 1-week
production deployment. It does not run the deployment itself — that is an
operator activity, not a code change. What ships here is everything an
operator needs to capture machine + human signal during the pilot, plus
the structural tests that keep that apparatus honest.

2 sub-slices closing the FIELD-PILOT-0 deliverables enumerated in plan §S
§S-next-after (POLICY-UX-0 → FIELD-PILOT-0):

### Sub-slice FP-a — Operator daily probe (`field-pilot-status.js`)
- New `scripts/field-pilot-status.js` (~400 LOC) with platform wrappers
  `field-pilot-status.sh` + `field-pilot-status.ps1`
- Frozen schema `harness-field-pilot-status/v1` with 8 top-level keys:
  `schema` / `capturedAt` / `verdict` / `environment` / `health` / `audit`
  / `runtime` / `notes`
- 7 health checks: server reachable / auth token / `/api/server/info`
  (pack + posture + runtime mode) / `/api/policy-packs` (POL-a runtime
  metadata) / audit chain / `/api/decision-context` (SMART-0 booleans)
- Frozen `KNOWN_AUDIT_VERBS` catalog of ~50 audit verbs from
  SMART/RR0/POL/review-session/runner/GOV-* slices — anything else is
  flagged as an anomaly in the snapshot
- 4-tier verdict semantics (per §S §S-FP plan):
  - **OK** (exit 0): no incidents detected; expected verbs in expected
    ranges; readiness 18/18
  - **DEGRADED** (exit 1): operator should review (idle kill / file
    conflict warning / readiness < 18); does not block deployment
  - **INCIDENT** (exit 2): operator MUST investigate (chain tampering /
    signature fail / key rejection / runner_handshake_collision /
    runner_host_lost / unknown verbs / readiness < 14)
  - **CONFIG** (exit 3): server unreachable / no token — operator cannot
    evaluate the day at all
- 6 CLI flags: `--base` / `--evidence-dir` / `--label` / `--notes` /
  `--quiet` / `--json` / `--timeout-ms` (15s default)
- 10 CLI surface tests (`tests/unit/field-pilot-status.cli.test.js`):
  --help + -h prints usage with the 4 exit-code legend / unreachable
  server → exit 3 / --json output is valid
  harness-field-pilot-status/v1 / 8 expected top-level keys / `audit`
  subschema has today + anomalies + unknownVerbs / --notes preserved /
  missing --notes defaults to empty string / --label custom value
  accepted / verdict semantics CONFIG when health probe fails

### Sub-slice FP-b — 4 runbook templates + structure tests
- `docs/runbooks/field-pilot-deployment-log.md`: per-day operator log
  with Pilot context block (operator / pack / harness commit / Codex CLI
  version / Claude CLI version / trust-store keys / manifest signing
  state / pilot goal / incident threshold) + 7-day stub + Daily entry
  template (probe verdict + label + snapshot file + what was deployed +
  operator activity counts + anomalies + operator note + tomorrow's plan)
  + Closeout block (final commit / days OK/DEGRADED/INCIDENT /
  recommendation for next pilot) + cross-reference to the 8 frozen JSON
  keys
- `docs/runbooks/field-pilot-incident-ledger.md`: append-only severity
  ledger with 4 tiers (info / degraded / incident / critical), Entry
  template + Resolution sub-entry template, mapping of probe verdict →
  typical severity, cross-reference of 8 critical-tier audit verbs
  (claim_verification_failed / trust_store_private_key_rejected /
  credential_plaintext_fallback / launcher_signature_failed /
  runner_handshake_collision / runner_host_lost / pii_scan_blocked /
  policy_gate_blocked) + privacy reminder sanitization rules
- `docs/runbooks/field-pilot-troubleshooting.md`: 6-section catalog by
  failure surface (1 install/launcher / 2 account/profile / 3
  timeouts/long-running / 4 permissions/policy gates / 5 network/runtime
  / 6 probe/evidence). Each entry has Symptom + Likely cause +
  Workaround + Safe-guidance principle (15+ entries). Covers E3-F1 exit
  codes 37+38, RR0 idle watchdog kills, POL-c pack-rule gate behavior,
  GOV-PII deep scan false-positives, runner WebSocket flapping, probe
  unknown-verb canary
- `docs/runbooks/field-pilot-feedback-survey.md`: end-of-week
  retrospective (deliberately not a daily diary). 1-5 Likert scale with
  16 evaluation areas (install / login flow / profile management /
  Codex critique / Claude hand-back / approval flow / pack-rule blocks /
  PII scan / long-running survival / daily probe / audit chain
  readability / simple shell / advanced shell / first-run guidance /
  i18n parity / overall trust). Open-ended section with 7 questions
  including 2 safety probes (3.6 over-stepping, 3.7 over-restriction).
  Pack-specific section for public-sector / finance-high-privacy /
  offline-internal-network. Recommendation block with top-3-changes
  field. Privacy & retention guidance.
- `tests/unit/field-pilot-runbooks.test.js`: 44 structure tests covering
  4 runbook common contract (file exists / H1 title / FP-b slice tag /
  "How to use" block / privacy reminder) + per-runbook required sections
  (deployment-log: Pilot context / Daily entries with 7 days / Daily
  entry template / Closeout / cross-reference to all 8 schema keys;
  incident-ledger: 4 severity tiers / append-only contract / Entry +
  Resolution template / verdict→severity mapping / 8 critical verbs;
  troubleshooting: 6 failure-surface sections / safe-guidance principle
  on each entry (≥5 occurrences) / E3-F1 exit codes 37+38 / "adding a
  new entry" guidance + skeleton / RR0 idle watchdog / POL-c pack-rule;
  feedback-survey: retrospective framing / 1-5 Likert / safety probes
  3.6+3.7 / pack-specific section / closing recommendation /
  privacy & retention) + cross-coherence (all 4 reference probe / log
  closeout links to ledger + survey)

## End-to-end behavior change

**Pre-FIELD-PILOT-0**:
- Operator running the harness in production has no canonical way to
  capture "did anything go wrong today" as evidence
- Operator must manually inspect the audit chain, decision-context,
  policy-packs API, server-info — different tools for different signals
- No structured place to record per-day deployment context, anomalies,
  operator activity counts
- No append-only place to record incidents with severity + resolution
  trail
- No catalog for repeated install/account/timeout/permission issues
- No retrospective survey to capture subjective tool-trust signal
- A 1-week pilot ends with the operator's verbal "it worked" or "it
  didn't" — not auditable

**Post-FIELD-PILOT-0**:
- Operator runs `field-pilot-status.js` once per working day
  (recommended end-of-day) → JSON snapshot + verdict + exit code
- 7 daily JSON files share the same frozen schema → reviewer can `jq`
  across them for trend (e.g.
  `jq -r '.audit.today.byVerb.policy_gate_blocked' day-*.json`)
- 4 runbooks form a coherent evidence bundle:
  deployment-log captures activity + intent / incident-ledger captures
  deviations / troubleshooting captures fixes / survey captures
  experience
- Each runbook has structure tests so operators (or future maintainers)
  can rename the template without breaking reviewer expectations
- The probe's `audit.unknownVerbs` field acts as a canary: if a feature
  shipped without updating the probe's `KNOWN_AUDIT_VERBS`, the operator
  sees it on day 1
- The whole bundle is committed to the repo (with sanitization
  reminders) so external reviewers (EXTERNAL-REVIEW-0) can read the
  evidence the same way they read the audit chain

## Cap movement decision

**Decision: Stay at 120/126.**

Rationale:
1. FP-a + FP-b ship the **apparatus** for collecting field-pilot
   evidence — they do not, by themselves, produce the evidence
2. The actual cap movement (Safety / Maintainability / Public-sector
   readiness, depending on what fills) requires:
   - An operator running the harness in production for at least 5
     working days (the 1-week pilot window)
   - Daily probe snapshots collected + committed
   - Deployment log + incident ledger filled in real time
   - Final feedback survey submitted
   - Closeout in the deployment-log Closeout block referencing all
     above
3. Plan §S §S-score-trajectory pattern from POL-d / SMART-2/4/5 / RR0 /
   LV0: the pattern is "ship the contract, defer the cap movement to
   actual field evidence". FIELD-PILOT-0 is the round where the
   *meaning* of "field evidence" gets crystallized into a concrete
   bundle — but the deployment week itself is operator-time, not
   round-time
4. EXTERNAL-REVIEW-0 (priority 5 in the user-supplied roadmap) is the
   round that consumes a completed pilot bundle and produces the
   claim/evidence matrix. The cap movement decision logically belongs
   there — the reviewer reads the evidence and either confirms a
   regression-free week (cap can move) or finds gaps (cap stays
   pending another pilot)
5. The probe + runbooks + tests are themselves regression-anchor: any
   future change to schemas / verb catalog / pack runtime metadata
   will be caught by the structure tests + the audit-chain integration
   tests; they preserve the contract operators rely on during the
   pilot

## Test counts

|              | Before | After  | Δ    |
|--------------|-------:|-------:|-----:|
| Unit         |   3340 |   3394 | +54  |
| Integration  |    553 |    553 |   0  |
| Smoke        |     90 |     90 |   0  |

Per sub-slice:
- FP-a: +10 unit (`field-pilot-status.cli.test.js`)
- FP-b: +44 unit (`field-pilot-runbooks.test.js`)

Live readiness: 18/18 (unchanged).

## Files touched

### Created
- `scripts/field-pilot-status.js` (Node probe, ~400 LOC)
- `scripts/field-pilot-status.sh` (bash wrapper)
- `scripts/field-pilot-status.ps1` (PowerShell wrapper)
- `docs/runbooks/field-pilot-deployment-log.md`
- `docs/runbooks/field-pilot-incident-ledger.md`
- `docs/runbooks/field-pilot-troubleshooting.md`
- `docs/runbooks/field-pilot-feedback-survey.md`
- `tests/unit/field-pilot-status.cli.test.js`
- `tests/unit/field-pilot-runbooks.test.js`
- `docs/reports/2026-05-05-field-pilot-0-eval.md` (this file)

### Modified
- `docs/scorecard.md` (FIELD-PILOT-0 closure marker, after sync)

## Decisions worth re-reading later

1. **Probe schema is frozen, verb catalog is frozen, but
   `audit.unknownVerbs` is open**: Operators can see new verbs as
   anomalies on day 1. When a new feature ships an audit verb, two
   things must happen: probe's `KNOWN_AUDIT_VERBS` updated, and a
   troubleshooting catalog entry added (per the catalog's own
   "Adding a new entry" guidance). The probe pattern is intentionally
   a canary — it costs operator attention by design, because that
   attention is what catches drift.

2. **Verdict tiers + exit codes are the operator interface**: An
   operator can wire `field-pilot-status.sh` into a cron job and rely
   on the exit code (0/1/2/3) without reading the JSON. The JSON is
   for forensics + reviewers. This split — exit code = operator,
   schema = reviewer — keeps both audiences served without forcing
   either to read the other's surface.

3. **Append-only incident ledger over editable**: The temptation is
   to "fix" an incident entry post-hoc when the root cause turns out
   to be different from the initial hypothesis. Resisting this is
   what makes the ledger trustworthy. Resolution sub-entries append;
   they do not edit. This mirrors the audit chain's append-only
   contract — same reasoning, same operational posture.

4. **Troubleshooting organized by failure surface, not by symptom**:
   When an operator hits an issue, they typically know which surface
   they are on (install / account / timeout / permission / network)
   before they know what the symptom means. Catalog entries find
   them faster this way. Symptom-indexed catalogs invert this — more
   work for the operator, less work for the catalog author. We chose
   the operator's side.

5. **Survey is end-of-week, not daily**: A daily survey would
   capture noise — the operator's mood today, the last task they
   ran. End-of-week captures retrospective synthesis: what would
   they recommend for the next pilot? This is the question that
   matters for cap movement and for shaping future rounds.

6. **2 safety probes in the survey (3.6 + 3.7)**: "Did the tool
   make a decision you should have made?" + "Did the tool feel
   too cautious?". Both directions matter equally. AI tools failing
   *toward* over-stepping is a safety regression; failing *toward*
   over-restriction is a usability regression that drives operators
   to disable safeguards — also a safety regression. The two
   questions form a symmetric pair; surveys with only one direction
   tend to bias the responses.

7. **Privacy reminders are repeated, not centralized**: Every
   runbook + survey + ledger entry template + closeout has its own
   privacy block. Operators read these in different orders and
   different sessions; centralizing the reminder elsewhere means
   they will eventually paste a real prompt into a sanitized field.
   Repetition is the cost of doing privacy right at the field-pilot
   layer.

8. **Pack-specific section in the survey is opt-in**: An operator
   running standard mode skips the pack-specific section entirely.
   This avoids forced-choice answers that would dilute the
   public-sector / finance-high-privacy signal. Survey design rule:
   ask the right people the right questions, do not coerce
   completion.

9. **Structure tests over linting**: We test for required sections,
   not for prose quality. Linting prose either over-blocks (rejects
   reasonable rephrasings) or under-blocks (passes empty headings).
   Required-sections tests catch deletions and renames — which are
   the regressions that actually matter for the reviewer.

10. **Runbooks committed as evidence, not as docs**: The runbooks
    are templates *and* the structural skeleton of the eventually-
    filled evidence. Reviewers grep them. Tests pin them. Operators
    copy them per pilot. The same file in the same path serves all
    three roles. This is why the structure tests exist — the file
    has multiple jobs, and the tests pin the contract that makes
    all jobs work.

## What's deferred / out of scope

- **The actual 1-week deployment**: This is operator-time, not round-
  time. Schedule + run + collect + closeout happens outside the code
  cadence
- **Probe extensions for upcoming rounds**: As new features ship new
  audit verbs, `KNOWN_AUDIT_VERBS` will need updates. Each such
  update is a separate small commit; the existing CLI tests pass
  through (the schema doesn't change)
- **Auto-classification of operator activity**: The deployment log
  asks for human-curated counts (review sessions / approvals /
  long-running). A future round could derive these from the
  decision-context snapshot — but the human curation has value
  because it captures intent, not just count
- **Ledger entries with structured root-cause tags**: A future
  reviewer-friendly extension could tag each Resolution sub-entry
  with a category (config / network / runner / pack / unknown) for
  faster aggregation. Out of scope for FIELD-PILOT-0; the prose
  Resolution is sufficient for the 1-week window
- **Survey responses aggregated across pilots**: Each pilot's
  survey lives in its `<pilot-id>` directory. A future tool could
  aggregate Likert scores across pilots; meanwhile, individual
  reviewers read individual surveys
- **Operator-defined custom verb catalogs**: The probe's
  `KNOWN_AUDIT_VERBS` is frozen in the script. Operators with
  custom integrations would need to fork the probe — out of scope
- **Probe i18n**: All probe output is English. Operators in
  Korean-language environments would still understand the verdict
  + exit code (the most important signal); the prose is in
  English. Future i18n could mirror the dashboard's ko/en parity

## Per plan §S §S-next-after — FIELD-PILOT-0 → EXTERNAL-REVIEW-0

User-supplied roadmap: "FIELD-PILOT-0 뒤에는 EXTERNAL-REVIEW-0를
추천합니다 — evidence bundle + claim/evidence matrix".

EXTERNAL-REVIEW-0 deliverables (per user spec):
- Evidence bundle (audit chain export + readiness export + scorecard
  + completed FIELD-PILOT-0 bundle)
- Claim/evidence matrix mapping each round's claim to the artifact
  that proves it
- Reviewer-facing summary report (regression-free verdict + cap
  movement recommendation if any)
- Cross-link to FIELD-PILOT-0 closeout (this file) + each round's
  individual closeout

The cap movement decision deferred from this round logically belongs
to EXTERNAL-REVIEW-0: the reviewer reads the completed pilot bundle
and either confirms a regression-free week (Safety cap can move) or
finds gaps (cap stays pending another pilot).

End of FIELD-PILOT-0 closeout.
