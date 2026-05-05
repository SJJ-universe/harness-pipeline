# Runbook — v1.0.0 Final-Readiness Blockers

**Slice V1-BLOCKERS-RUNBOOK (Phase 2 v2 follow-up, 2026-05-05)**

This runbook catalogs the three final-readiness blockers between
the current `v1.0.0-rc.2` snapshot and a tagged `v1.0.0` release.
For each blocker it documents **why** it blocks v1.0.0, **what**
the operator runs, **when** the blocker is considered closed
(acceptance criteria), and **where** the resulting evidence
should live.

The blockers are ordered by recommended close-out sequence: the
first two are code/evidence rounds where engineering work plus
operator verification close them; the third is a calendar-time
round that requires actual deployment.

---

## §1 Why this runbook exists

The v1.0.0-rc.2 release candidate satisfies the in-process gates
(visual / readiness / scorecard / hooks) and the documentation
discoverability arc, but **not** the live-evidence and field-time
gates that a `v1.0.0` final tag implies. Cap movement (the rubric
score 120/126 → 121/127) remains deferred until end-to-end trust
property closure.

This runbook converts that abstract "still pending" into concrete
operator instructions so the path to v1.0.0 is unambiguous.

---

## §2 Blocker #1 — Real-binary live verification

**Status**: Open. Tooling exists; operator-time evidence required.
**Priority**: Highest. Closes first because the artifacts feed §3
and §4.

### §2.1 Why it blocks v1.0.0

Both `live-verify-smart-arc.js` and `live-verify-review-relay.js`
are integration probes designed to drive the harness against
real Claude/Codex CLIs and produce verifiable evidence packets.
The CLI surface is unit-tested (CONFIG path, JSON mode, --help)
but no committed evidence file shows the probe ran successfully
against real binaries.

Without that evidence, the v1.0.0 release notes cannot honestly
claim "live-verified against real-binary Claude + Codex".

### §2.2 What the operator runs

**Prerequisites**:

- Claude CLI installed and authenticated (`claude --version` + `claude login`)
- Codex CLI installed and authenticated (`codex --version` + `codex login`)
- Harness server booted with the right env (see each probe's header)

**Probe 1 — SMART arc** (6 properties: hard gates, finance pack,
PII block, redacted memory, recommendations, preset dispatch):

```powershell
$env:HARNESS_DEPLOYMENT_PROFILE = "finance-high-privacy"
$env:HARNESS_HARD_GATES = "1"
$env:HARNESS_TOKEN = "<test-token>"
node start.js          # in a separate terminal
node scripts/live-verify-smart-arc.js
```

Expected verdict: `PASS` (all 6 SMART arc properties evidenced).
Evidence: `docs/reports/<date>-smart-arc-live-verify.json`.

**Probe 2 — Review relay** (Claude → Codex critique → Claude
hand-back end-to-end):

```powershell
$env:HARNESS_TOKEN = "<test-token>"
node start.js          # in a separate terminal
node scripts/live-verify-review-relay.js
```

Expected verdict: `PASS` (round-trip succeeded with audit chain
verifying). Evidence: `docs/reports/<date>-review-relay-live-verify.json`.

### §2.3 Acceptance criteria

The blocker closes when **all** of the following are true:

1. `<date>-smart-arc-live-verify.json` exists with `verdict: "PASS"`
   in `docs/reports/`, committed to git.
2. `<date>-review-relay-live-verify.json` exists with `verdict: "PASS"`
   in `docs/reports/`, committed to git.
3. Both files were produced from a probe run that spawned **real**
   Claude / Codex binaries (not test stubs). The `auditChain`
   section of each evidence packet must include child-process
   spawn events with non-zero `pid` values.
4. The dual-agent review-relay live verification report
   (`docs/reports/2026-04-30-review-relay-live-verification.md`)
   is updated with the new evidence file references and a
   verdict statement.

### §2.4 Where evidence lives

- Probe outputs: `docs/reports/<YYYY-MM-DD>-smart-arc-live-verify.json`
  and `docs/reports/<YYYY-MM-DD>-review-relay-live-verify.json`.
- Live verification report: `docs/reports/<YYYY-MM-DD>-review-relay-live-verification.md`.
- Aggregation: a single sealed bundle is recommended for v1.0.0;
  see §5 below.

### §2.5 Risks

- Probes may fail with environment-specific issues (CLI not on
  PATH, auth token expired, network egress blocked). Each probe's
  `verdict: "CONFIG"` distinguishes this from a real regression.
- The probes run **read-only by design**. They do not exercise
  Bash/Edit/Write tools; that surface is gated by
  `runner_hook_approval` and remains operator-time.

---

## §3 Blocker #2 — Trust-store + signed-manifest end-to-end

**Status**: Open. UI work + operator verification required.
**Priority**: Second. Depends on §2 closure for the audit-chain
property.

### §3.1 Why it blocks v1.0.0

`scripts/sign-manifest.js` exists as the manifest-signing tool;
`scripts/launcher/install-version.ps1` enforces the production
fail-closed gate (exit 37 / 38 on unsigned manifest, unknown
keyId, or trust-store unavailable). However:

- No committed UI surfaces trust-store CRUD (TRUST-STORE-0 is
  in `swift-waddling-hanrahan.md` §S as a planned round).
- No committed evidence demonstrates the end-to-end loop:
  operator generates signed manifest → installs into client →
  client verifies → unsigned tampered version is rejected.

The plan §S-LV-6 calls this trust-property closure the first
cap-movement trigger.

### §3.2 What the operator runs

The end-to-end loop has three phases. Each must be exercised at
least once with evidence captured.

**Phase 1 — Generate a signed release manifest**:

```powershell
node scripts/sign-manifest.js --help        # confirm tool reachable
# Generate keypair, sign a sample release manifest. Specifics
# depend on the deployer's signing infrastructure.
```

**Phase 2 — Install via the launcher with the gate active**:

```powershell
$env:HARNESS_TRUST_STORE = "C:\path\to\trust-store.json"
$env:HARNESS_REQUIRE_SIGNED_MANIFEST = "1"
.\harness-start.bat
# Expected: install proceeds when manifest is signed by a
# trust-store key; exits 37 / 38 when not.
```

**Phase 3 — Tampering rejection probe**:

```powershell
# Modify a byte of the release zip post-signature, retry install.
# Expected: launcher exits 37 due to SHA256 mismatch.
```

### §3.3 Acceptance criteria

The blocker closes when **all** of the following are true:

1. A committed runbook in `docs/runbooks/` walks Phases 1–3 with
   exact commands.
2. A committed report in `docs/reports/<date>-trust-store-e2e-eval.md`
   documents at least one successful end-to-end run with audit-chain
   anchors:
   - `launcher_signature_verified` (signed manifest accepted)
   - `launcher_signature_failed` (unsigned manifest rejected)
   - `launcher_signature_failed` with `cause=hash_mismatch` (tampered manifest rejected)
3. The trust-store path resolver (`scripts/launcher/trust-store-path.js`)
   has at least one integration test that exercises the full
   precedence chain (CLI flag → env → portable → AppData → fallback).
4. UI work (TRUST-STORE-0) is either landed or formally deferred
   to a post-v1.0.0 round, with the deferral documented in
   `docs/scorecard.md` backlog.

### §3.4 Where evidence lives

- E2E report: `docs/reports/<YYYY-MM-DD>-trust-store-e2e-eval.md`.
- Trust-store fixture (sample, not real keys): `docs/fixtures/trust-store-example.json`.
- Audit chain anchors: in the harness audit ledger, exported via
  `scripts/external-review-bundle.js`.

### §3.5 Risks

- Generating real signing keys requires deployer-side infrastructure
  (key custody, rotation policy). The runbook should not commit
  real keys; it should describe the convention and link to the
  deployer's signing playbook.
- HARNESS_ALLOW_UNSIGNED_MANIFEST=1 dev-escape MUST NOT be set in
  the production-posture phases. The operator runbook explicitly
  documents this carve-out.

---

## §4 Blocker #3 — 1-week field-pilot evidence

**Status**: Open. Operator-time only; no further engineering work
expected.
**Priority**: Last. Closes after §2 and §3 because field-pilot
evidence references the artifacts those rounds produce.

### §4.1 Why it blocks v1.0.0

FIELD-PILOT-0 shipped the apparatus (`field-pilot-deployment-log.md`,
`field-pilot-troubleshooting.md`, `field-pilot-incident-ledger.md`,
`field-pilot-feedback-survey.md`) but did not produce the evidence
that demonstrates the apparatus actually catches incidents over a
realistic deployment window.

A `v1.0.0` tag without a 1-week field-pilot run carries the risk
that the apparatus has untested failure modes — the kind of gaps
that only surface during sustained real use.

### §4.2 What the operator runs

The field-pilot is a **calendar-time** procedure, not a single
command. The four runbooks in `docs/runbooks/field-pilot-*.md`
define the daily, on-incident, and end-of-week protocols:

- Day 0: bring up the harness on the pilot deployment, capture
  baseline state. Fill `field-pilot-deployment-log.md` Day 0
  template.
- Days 1–7: daily activity log entries; on incident → fill
  `field-pilot-incident-ledger.md` per S2+ event; troubleshooting
  catalog updated with any new patterns.
- Day 7: collect operator + end-user retrospective via
  `field-pilot-feedback-survey.md`.

### §4.3 Acceptance criteria

The blocker closes when **all** of the following are true:

1. `field-pilot-deployment-log.md` has 7 daily entries (Day 0
   through Day 7) committed.
2. `field-pilot-incident-ledger.md` either has at least one
   resolved S2+ entry, OR has an explicit "no S2+ incidents during
   pilot window" entry signed by the operator.
3. `field-pilot-feedback-survey.md` has both operator and at least
   one end-user response.
4. A summary report `docs/reports/<date>-field-pilot-eval.md`
   distills the 7-day evidence into a v1.0.0 readiness statement
   (PASS / PASS-WITH-CONCERNS / FAIL).

### §4.4 Where evidence lives

- Daily entries: `docs/runbooks/field-pilot-deployment-log.md`
  (in place; updated daily during the pilot window).
- Incident ledger: `docs/runbooks/field-pilot-incident-ledger.md`.
- Survey responses: `docs/runbooks/field-pilot-feedback-survey.md`.
- Closeout: `docs/reports/<YYYY-MM-DD>-field-pilot-eval.md`.

### §4.5 Risks

- A 1-week window may be too short to surface all failure modes.
  If §4 PASS-WITH-CONCERNS, document the residual risks in the
  closeout report; do not block v1.0.0 indefinitely waiting for
  zero-risk evidence.
- An over-isolated pilot (single operator, no real users) under-
  tests the apparatus. The pilot should aim for 2+ operator
  perspectives + 1+ end-user perspective.

---

## §5 Aggregation — sealed evidence bundle

After §2, §3, §4 close, an aggregated evidence bundle ships
alongside the v1.0.0 release. The bundle structure (suggested):

```text
docs/reports/v1.0.0-evidence-bundle/
  README.md                                 — bundle index + verdict
  <date>-smart-arc-live-verify.json         — §2.4
  <date>-review-relay-live-verify.json      — §2.4
  <date>-review-relay-live-verification.md  — §2.4
  <date>-trust-store-e2e-eval.md            — §3.4
  <date>-field-pilot-eval.md                — §4.4
  signature.bundle                          — Ed25519 over the bundle
```

The bundle is signed with the same key as the release manifest;
operators verifying v1.0.0 can confirm the evidence was produced
by the deployer's signing identity.

A future `scripts/collect-live-evidence.js` orchestrator (planned
follow-up round) will mechanize bundle assembly. For now this is
a manual step.

## §6 Cap-movement policy

This runbook does not cause cap movement. The score remains
**120/126** until §2, §3, and §4 all close with the acceptance
criteria above met. Cap movement to **121/127** is contingent on
end-to-end trust property closure across all three blockers.

## §7 References

- [`../scorecard.md`](../scorecard.md) — current score and round
  trajectory; backlog entries for v1.0.0 blockers.
- [`../readiness-rubric.md`](../readiness-rubric.md) — what live
  readiness measures; §6 Remote isolation closeout depends on §2
  here.
- [`../../scripts/live-verify-smart-arc.js`](../../scripts/live-verify-smart-arc.js)
  — SMART arc probe.
- [`../../scripts/live-verify-review-relay.js`](../../scripts/live-verify-review-relay.js)
  — review-relay probe.
- [`../../scripts/sign-manifest.js`](../../scripts/sign-manifest.js)
  — manifest-signing tool.
- [`../../scripts/launcher/install-version.ps1`](../../scripts/launcher/install-version.ps1)
  — production fail-closed gate.
- [`field-pilot-deployment-log.md`](field-pilot-deployment-log.md) — daily log template.
- [`first-time-use.md`](first-time-use.md) — Korean-primary onboarding for end users.
- [`deployment-readiness.md`](deployment-readiness.md) — pre-deployment preflight.
