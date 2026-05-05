# EXTERNAL-REVIEW-0 — Round closeout (2026-05-05)

**Score**: 120/126 (maintained — see §Cap movement decision)
**Round id**: EXTERNAL-REVIEW-0
**Plan reference**: §S §S-rounds (priority 5) / §S-next-after
**Slices shipped**: EXR-a / EXR-b / EXR-c

This is the **fifth and final** priority round of the 2026-05-05
roadmap (RELEASE-READY-0 → SMART-LV-0 → POLICY-UX-0 → FIELD-PILOT-0 →
**EXTERNAL-REVIEW-0**). Where the prior 4 rounds shipped *behaviour*
(long-running task survival / live verification probe / runtime pack
wiring / field-pilot evidence apparatus), this round ships the
*reviewer hand-off* — the bridge between the committer's claim ("we
shipped X without regression") and the third party's verifiable answer
("yes, here is the evidence — sample N rows, all PASS").

---

## What this round shipped

### EXR-a — Evidence bundle exporter

**Files**:
- `scripts/external-review-bundle.js` (~480 LOC)
- `scripts/external-review-bundle.sh` (Node 18+ guard + arg pass-through)
- `scripts/external-review-bundle.ps1` (PowerShell wrapper, same shape
  as field-pilot-status.ps1)
- `tests/unit/external-review-bundle.test.js` (22 tests)

**Frozen schema**: `harness-external-review-bundle/v1`

The script walks the `pipeline-dashboard/` tree and emits one JSON
manifest with everything an external reviewer needs to walk:

- **repo** — git HEAD sha + branch + cleanWorkingTree + untracked +
  modifiedFiles (so the reviewer knows what state the bundle was
  generated from)
- **scorecard** — path + bytes + sha256 + parsed currentScore
  (`120/126`) + scoreNumerator (120) + scoreCap (126)
- **readinessRubric** — path + bytes + sha256
- **closeoutReports[]** — every `docs/reports/*-eval.md` (sha256 +
  date + slice id) sorted newest-first
- **fieldPilotSnapshots[]** — every `docs/reports/*-field-pilot-status.json`
  (parsed verdict + capturedAt) — empty before operator deployment;
  the structure is in place
- **rounds[]** — parsed trajectory banner lines (`ROUND-NAME closed at
  N/M (date) — title`) → `{id, score, scoreNumerator, scoreCap, date,
  title, lineNumber}`. Live test confirms ≥10 rounds parse from the
  current scorecard (8 visible in the dense closeout block + earlier).
- **live** — `--skip-live` opts out; otherwise probes `/api/health` +
  `/api/server/info` + `/api/audit/runs/system?limit=64` (chain
  validity) + spawns `scripts/readiness-report.js --json --no-spawn`
  for the totals
- **anomalies** + **notes** — operator commentary

**Verdict semantics** (frozen 4-tier, mirrors `field-pilot-status.js`):
- `OK` exit 0 — repo clean, scorecard parseable, ≥4 closeouts, live (when
  probed) green
- `DEGRADED` exit 1 — uncommitted work, fewer closeouts, or live
  readiness < cap
- `INCIDENT` exit 2 — `chain.valid === false`, scorecard parse FAILED,
  or `--strict` + offline
- `CONFIG` exit 3 — scorecard.md / readiness-rubric.md missing, not a
  git repo

The 22 CLI tests cover: `--help` + `-h` print legend with all 4 exit
codes + schema string; `--skip-live --json` emits 13 frozen top-level
keys; verdict is one of the 4 tiers; scorecard block has parsed
numerator + cap + 64-char sha256; readinessRubric block has bytes +
sha256; closeoutReports lists ≥4; rounds trajectory parses ≥4;
`live.skipped:true` under `--skip-live`; repo block has 40-char HEAD;
fieldPilotSnapshots is array (may be empty pre-deployment); `--label`
shapes output filename in file mode (round-trip); `--notes` defaults
empty; anomalies always an array; 5 library export tests including
`_computeVerdict` for CONFIG / INCIDENT / DEGRADED / OK / `--strict +
offline → INCIDENT`.

### EXR-b — Claim/evidence matrix template

**Files**:
- `docs/external-review/claim-evidence-matrix.md` (~520 LOC)
- `tests/unit/external-review-matrix.test.js` (36 structure tests)

The matrix is the **claim → artifact map** companion to EXR-a's
**artifact list with sha256s**. It documents 8 claim categories with
30 baseline rows pulled from the rounds closed before this one:

| # | Category | Rows | Round of record |
|---|---|:---:|---|
| 1 | Pipeline orchestration & dual-agent loop | 4 | various → UI-H7-f / LV |
| 2 | Multi-run isolation | 4 | Phase 2.5 (Y/Z/AA-1/AA-2/AD) |
| 3 | Long-running task survival (RR0) | 4 | RELEASE-READY-0 (RR0-a/b/c/e) |
| 4 | Account / profile management & safe guidance | 4 | RR0-d / D1 / D3 |
| 5 | Public-sector posture & GOV-* defenses | 5 | E1.5 GOV-SB-0 / GOV-PII-0/1 / GOV-AUDIT-0 / GOV-RELEASE-0 |
| 6 | Smart arc (gates / context / recommendations / presets / packs) | 7 | SMART-2/3/4/5 / POLICY-UX-0 / SMART-LV-0 |
| 7 | Field-pilot evidence collection | 4 | FIELD-PILOT-0 (FP-a/b) |
| 8 | External reviewer hand-off | 5 | EXTERNAL-REVIEW-0 (EXR-a/b/c — this round) |

Each row = 8 columns: `# | Claim | Code | Test | Audit verb | Closeout |
Operator signal | Reviewer verdict`. Reviewer fills the verdict
column (PASS / DOUBT / FAIL / blank) as they spot-check.

The matrix self-references EXR-a + EXR-b + EXR-c so it acts as both
the baseline of what was true at this round's snapshot AND the
template the next reviewer copies + extends. It explicitly documents
the reviewer workflow:
1. Walk the EXR-a bundle first (sanity)
2. Pick a sampling strategy (random across categories or focused)
3. Per sampled row: open code anchor → run test anchor → grep audit
   verb → read closeout → reproduce operator signal → mark verdict
4. Aggregate verdicts in summary report; recommend cap movement OR
   list gaps

The 36 structure tests follow the `field-pilot-runbooks.test.js`
pattern (structural only, not stylistic). They fail fast when:
- A category section is renamed or deleted
- A required audit verb anchor disappears (e.g. `policy_gate_blocked`,
  `release_manifest_signed`, 5 GOV verb anchors, 6 SMART markers)
- The 8-column entry template is broken
- The "How to use this matrix during a review" guidance loses the
  sampling-strategy or `verify-auditor-bundle.js` mention
- Any of the 8 categories loses its numbered rows
- Cross-coherence with the 5 priority round groups (RELEASE-READY-0,
  SMART-LV-0, POLICY-UX-0, FIELD-PILOT-0, EXTERNAL-REVIEW-0) fails
- Cross-coherence with the 4 cap-movement targets (Dual-agent
  integration, Pipeline orchestration, Error resilience, Public-sector
  readiness) fails

### EXR-c — Closeout, scorecard trajectory, marker sync, push, CI

This file is the closeout. The scorecard trajectory entry is inserted
above the FIELD-PILOT-0 banner (newest priority at top per the
existing pattern). `scripts/sync-scorecard.js` refreshes the
auto-derived markers (test counts + readiness total).

---

## End-to-end behavior change

| Before EXTERNAL-REVIEW-0 | After EXTERNAL-REVIEW-0 |
|---|---|
| Reviewer reads scorecard + last few closeouts; samples are ad-hoc; "what should I check?" is not documented | Reviewer reads `<date>-external-review-bundle.json` first → sees `verdict` + `closeoutReports[]` + `rounds[]` → opens `claim-evidence-matrix.md` → picks sampling strategy → per row: code anchor → test anchor → audit verb → operator signal → marks PASS/DOUBT/FAIL |
| Bundle artifacts are scattered; sha256 spot-check requires manual recompute | Bundle has sha256 of every linked artifact; tampering is detected by recomputing one hash |
| Round trajectory only readable as scorecard prose | Round trajectory parsed into `{id, score, date, lineNumber}` — reviewer can `jq` for "all rounds at score 120" or "rounds in May" |
| Field-pilot snapshots, when they exist, must be located by hand | Bundle's `fieldPilotSnapshots[]` lists every `<date>-field-pilot-status.json` with parsed verdict |
| "What does the harness claim to do?" is implicit in scorecard prose | 30 claim rows across 8 categories with code + test + audit verb + closeout + operator signal — reviewer can sample any row in <5 minutes |

---

## Test counts + CI

| Suite | Pre-EXR | Post-EXR | Δ |
|---|:---:|:---:|:---:|
| unit | 3394 | 3452 | +58 (22 EXR-a + 36 EXR-b) |
| integration | 553 | 553 | 0 |
| smoke | 90 | 90 | 0 |
| readiness | 18/18 | 18/18 | 0 |

`npm run test:unit && test:integration && test:legacy && test:smoke`
all green. `npm run readiness:check` 18/18. `npm run scorecard:check`
exit 0 after marker sync. CI will catch regressions before next round.

---

## Cap movement decision — 120/126 maintained

Per the established **cap-movement deferral pattern** (RR0 / SMART-LV /
POL / FP all maintained 120/126 with deferred cap movement on
operator-time evidence):

EXTERNAL-REVIEW-0 ships the *reviewer convenience apparatus*. Cap
movement requires:
1. An actual external reviewer (not the committer) consumes a
   completed bundle
2. They walk a sampled subset of the matrix (≥1 row per category, or
   ≥10 rows total)
3. They mark verdicts (PASS dominant, no FAIL)
4. They produce a summary report recommending cap movement
5. The summary report is committed to `docs/reports/<date>-external-
   review-summary.md` (NOT a closeout — a reviewer-facing artifact)

When that loop closes once with a green verdict, **two cap movements
become defensible at once**:
- **Public-sector readiness +1** — the FIELD-PILOT-0 + EXTERNAL-
  REVIEW-0 chain documents the "deploy → daily probe → log + ledger →
  end-of-week survey → bundle → reviewer verifies" loop end-to-end
- **Testability and regression suite +1** — the matrix's structural
  tests + the bundle's sha256 + the round-trajectory parser turn the
  scorecard from a markdown narrative into a *machine-readable
  claim->evidence map* with regression protection

Per plan §S, the cap candidate is the FIELD-PILOT-0 + EXTERNAL-
REVIEW-0 pair held until a reviewer's PASS lands. Both rounds ship
their apparatus simultaneously; the cap event is the reviewer's
verdict, not the committer's announcement.

---

## 10 decisions worth re-reading

These are the design choices that took >5 minutes to settle and that
a future maintainer should NOT silently invert:

1. **Frozen schema vs evolving** — `harness-external-review-bundle/v1`
   is **frozen**. New fields are added with `v2` (or namespaced extension
   keys); existing fields never change shape. This is the same
   discipline as `harness-field-pilot-status/v1` and
   `harness-auditor-bundle/v1`.
2. **sha256 on every artifact, not signed** — the bundle is a
   **manifest**, not a signed envelope. GOV-AUDIT-0 already covers HMAC
   sealing for individual run audit chains; the EXR bundle's sha256 is
   *tamper-detection*, not non-repudiation. A reviewer who needs
   non-repudiation runs `verify-auditor-bundle.js --key` against the
   per-run audit exports the bundle points at.
3. **Structural tests > linting tests for the matrix** — same call as
   FP-b's runbook tests: tests catch deletions/renames; they don't
   over-block on prose. Wording can drift; section headers and audit
   verb anchors cannot.
4. **Closeout reports sorted newest-first** — reviewer's first sample
   is most recent. Previous newest-first ordering in the trajectory
   banners follows the same intent.
5. **Round trajectory parsed by regex, not hand-curated** — the scorecard
   is the source of truth; the bundle reads it. If a future round uses
   a different banner pattern, the regex must be updated and a unit
   test will fail loudly.
6. **`--skip-live` opt-out, not opt-in** — default is to probe the
   live server because the most useful bundle has the chain integrity
   verdict baked in. `--skip-live` exists for offline reviewer hand-
   offs (the bundle is generated on a connected machine then handed
   to an air-gapped reviewer).
7. **`--strict` makes offline an INCIDENT** — `--strict` is the
   "regulator's bundle" mode: every artifact must be present and the
   live probe must succeed. Default mode is the "operator's bundle":
   missing live probe is DEGRADED, not INCIDENT.
8. **Claim categories = 8** — 6 was too few (lumped GOV with SMART);
   10 was too many (split categories that share evidence). 8 is the
   number of distinct *evidence shapes* (code path + test + audit
   verb + operator signal) that show up in the harness; further
   splits or merges would obscure the shape.
9. **Reviewer verdict = PASS / DOUBT / FAIL / blank** — DOUBT is the
   important middle. A reviewer who is "not sure but not confident
   enough to PASS" must not be forced into PASS by a missing column.
   Blank means "not sampled" — also explicit.
10. **Self-referencing matrix** — Category 8 has rows for the bundle
    exporter, the matrix file, the structure tests, and this closeout.
    A future audit of EXR-a/b/c failures would notice missing rows in
    Category 8 first; the matrix is its own first canary.

---

## What's deferred / out of scope

Foundation is shipped; these are operator-time or follow-up rounds:

- **Actual external reviewer engagement** — finding a reviewer,
  scheduling a session, getting them set up
- **Reviewer-facing summary report template** — beyond the matrix
  itself, an aggregated `<date>-external-review-summary.md` template
  that the reviewer fills (verdicts grouped + sampling strategy +
  recommended cap movement + listed gaps)
- **Bundle signing** — GOV-AUDIT-0-style HMAC sealing of the EXR
  bundle for non-repudiation; today the bundle is sha256-fingerprinted
  but not signed
- **Multi-bundle diff** — a reviewer running the bundle weekly would
  benefit from a diff tool ("what changed since last week?"). Today
  they would diff the JSONs by hand.
- **Matrix verdict aggregation** — automated parser that reads filled
  matrix files and counts PASS / DOUBT / FAIL per category
- **Reviewer probe for cross-pilot evidence** — if multiple operator
  pilots exist, a tool that reads all `<date>-field-pilot-status.json`
  and aggregates verdicts cross-deployment (currently the bundle
  lists them; aggregation is hand work)
- **CI integration** — `npm run external-review:check` that runs the
  bundle in `--strict --skip-live` and fails CI if anomalies appear
  (today the structure tests catch regressions, but the bundle itself
  is operator-run)
- **i18n of the bundle CLI** — operator-facing colored output is
  English only; ko/en parity is a follow-up

---

## Per plan §S §S-next-after

This round closes the **5-priority roadmap** that opened on
2026-05-05. After this commit + push, the scorecard trajectory shows:

```
EXTERNAL-REVIEW-0 closed at 120/126 (2026-05-05)
FIELD-PILOT-0     closed at 120/126 (2026-05-05)
POLICY-UX-0       closed at 120/126 (2026-05-05)
SMART-LV-0        closed at 120/126 (2026-05-05)
RELEASE-READY-0   closed at 120/126 (2026-05-05)
```

Five rounds, one day, four cap-movement candidates held pending
operator-time + reviewer-time evidence. Per plan §S §S-out-of-scope,
the next candidates are:

- **Operator runs `harness-start.bat` in production for ≥1 week** — the
  FIELD-PILOT-0 bundle gets filled in, daily probes get committed,
  the deployment-log + incident-ledger become real artifacts
- **External reviewer engagement** — someone other than the committer
  walks the EXR bundle + matrix and produces a summary report
- **Phase 2 v2 next slices** — SMART-3 dropdown UI surface follow-ups
  (keyboard shortcut, recently-used preset memory) / SMART-1 panel
  (recommendations card actually mounted) / POL-d UI panel (real
  pack-info card with restart-instructions banner)
- **R3-d clean WS shutdown signal** (already DONE per docs/r3-rollout-plan.md
  — but the round is folded into Phase D R1 work and the trajectory
  banner is implicit, not explicit)

The cap-movement candidates that EXTERNAL-REVIEW-0 + FIELD-PILOT-0
unlock should land **only after** an actual reviewer has walked the
apparatus. Until then, 120/126 is the honest score.
