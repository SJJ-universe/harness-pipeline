# External Review — Claim / Evidence Matrix

**Slice EXR-b (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05)**

This matrix is the bridge between **what the harness claims to do** and
**what we built + how it's verified**. An external reviewer reads it
top-to-bottom, picks any row, and follows the breadcrumbs to the code,
the test, the audit verb, the closeout report, and the operator-visible
signal that proves the claim is real.

The matrix is intentionally narrower than `docs/scorecard.md` — the
scorecard scores us on a 10-area rubric (rounds + cap movement); this
matrix gives the reviewer **per-claim spot-check ammunition** so a
"regression-free" verdict has cited evidence behind every row, not just
"passed CI".

This is the companion to `scripts/external-review-bundle.js`
(`harness-external-review-bundle/v1`) — the bundle compiles the **list
of artifacts** with sha256 fingerprints; this matrix compiles the
**claim → artifact map**.

---

## How to use this template

1. Copy this file to `docs/external-review/<review-id>/claim-evidence-matrix.md`
   at the start of an external review.
2. The matrix below is the **baseline** — everything closed at the time
   of the EXR-a/b/c round (RELEASE-READY-0 / SMART-LV-0 / POLICY-UX-0 /
   FIELD-PILOT-0 + every prior MA/MB/MC/MD/ME/MF/MG/R1/R2/R2.5/R3-c /
   E1/E1.5 round). Reviewers may add rows for new claims they care
   about, but should never remove baseline rows — they document what
   was true at the EXR-c snapshot.
3. For each row, the reviewer is expected to:
   - Open the code anchor and read the function (or at minimum the
     surrounding 30 lines)
   - Run the test anchor (`node --test <file>`) and confirm it passes
   - Grep the audit chain for the named verb (e.g. via the bundle's
     `auditChain.entries` or `verify-auditor-bundle.js`)
   - Read the closeout report (linked in `closeoutReports[]` of the
     external-review bundle)
   - Confirm the operator-observable signal is what the matrix says it
     is (e.g. exit code, UI badge, broadcast event)
4. Mark each row with a verdict in the **Reviewer verdict** column
   (PASS / DOUBT / FAIL) once spot-checked. A row left blank means
   "not spot-checked this review" — which is acceptable as long as the
   reviewer makes the sampling strategy explicit in the summary
   report.

> **Privacy reminder**: do not put real customer names, real internal
> project names, real pilot operator names, real prompts, or real
> credential strings in this matrix — even in the reviewer's notes
> column. Use abstract placeholders like "<operator A>" or "a public-
> sector pilot deployment".

---

## Claim categories (8)

The matrix is organized by claim category. Each category is one
operator-facing capability the harness markets; each row inside a
category is a more specific testable claim.

| # | Category | Round of record | Cap movement target |
|---|---|---|---|
| 1 | Pipeline orchestration & dual-agent loop | various → UI-H7-f / LV | Dual-agent integration |
| 2 | Multi-run isolation | Phase 2.5 | Pipeline orchestration |
| 3 | Long-running task survival | RELEASE-READY-0 (RR0-a/b/c) | Error resilience |
| 4 | Account / profile management & safe guidance | RR0-d / D1 / D3 | Safety + UI |
| 5 | Public-sector posture & GOV-* defenses | E1.5 GOV-SB-0 / GOV-PII-0/1 / GOV-AUDIT-0 / GOV-RELEASE-0 | Public-sector readiness |
| 6 | Smart arc (gates / context / recommendations / presets / packs) | SMART-2/3/4/5 / POLICY-UX-0 / SMART-LV-0 | Safety + Observability |
| 7 | Field-pilot evidence collection | FIELD-PILOT-0 (FP-a/b) | Public-sector readiness |
| 8 | External reviewer hand-off | EXTERNAL-REVIEW-0 (EXR-a/b/c — this round) | Testability + reviewer trust |

---

## Claim categories — detail

For each row, fill the **Reviewer verdict** column once you've spot-
checked. Leave blank to mean "not sampled this review".

### Category 1 — Pipeline orchestration & dual-agent loop

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 1.1 | A user request runs through Plan → Codex critique → Claude hand-back | `executor/pipeline-executor.js` | `tests/integration/pipeline-orchestrator-runs.test.js` | `pipeline_complete` | various Phase D | Pipeline timeline shows phase transitions | |
| 1.2 | Codex critique chunks stream to the dual-agent console | `executor/codex-runner.js`, `src/runtime/reviewSpawnDispatcher.js` | `tests/integration/review-relay-spawn.test.js` | `review_session_dispatch_started` | UI-H7-f | dual-agent console shows live chunks | |
| 1.3 | Claude hand-back receives critique findings + can apply patches | `executor/claude-runner.js` | `tests/integration/review-relay-spawn.test.js` | `review_session_dispatch_completed` | UI-H7-f / LV | Claude rail re-renders with critique findings | |
| 1.4 | A real codex.cmd was actually executed (not a stub) | `scripts/live-verify-review-relay.js` | `tests/smoke/review-relay-end-to-end.test.js` | `review_session_dispatch_started` (with elapsedMs > 1000) | LV (live evidence) | 3045ms elapsed in live evidence JSON | |

### Category 2 — Multi-run isolation

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 2.1 | Two concurrent runs do not share `PipelineState` (no findings cross-pollution) | `executor/pipeline-executor.js`, `executor/pipeline-orchestrator.js` | `tests/integration/multi-run-isolation.test.js` | n/a (state-level invariant) | Phase 2.5 (Y/Z) | Each run's findings list independent | |
| 2.2 | Two concurrent runs do not share checkpoint files | `executor/checkpoint.js` | `tests/unit/checkpoint.perRun.test.js` | n/a | Phase 2.5 (Z) | `.harness/runs/<runId>/checkpoint.json` per-run | |
| 2.3 | Live UI events filter to the selected run tab | `public/app.js`, `public/js/run-tab-bar.js` | `tests/integration/ui-multi-run-filter.test.js` | n/a | Phase 2.5 (AA-1/AA-2) | Tab switch only re-renders that run | |
| 2.4 | File conflict between runs surfaces a warning (not silent overwrite) | `src/runtime/fileConflictDetector.js` | `tests/integration/file-conflict.test.js` | `file_conflict_warning` | Phase 2.5 (AD) | Toast on second-run touch of same path | |

### Category 3 — Long-running task survival (RR0)

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 3.1 | A 25-minute Codex critique with 30-second progress ticks survives idle watchdog | `src/runtime/activityWatchdog.js`, `executor/codex-runner.js` | `tests/integration/release-readiness-long-run.test.js` | `codex_idle_warning` (only on real silence) | RELEASE-READY-0 (RR0-b/e) | Probe `codex_killed_for_idle` count = 0 | |
| 3.2 | After 60s of true silence, Codex is killed with `codex_killed_for_idle` audit | same | same | `codex_killed_for_idle` | RR0-b/e | Probe count > 0 → DEGRADED verdict | |
| 3.3 | The 30-min total cap is enforced even if ticks keep arriving | `src/runtime/timeoutPolicy.js` | `tests/integration/release-readiness-long-run.test.js` | n/a (kill audit verb) | RR0-a/e | Total cap reached → kill | |
| 3.4 | `HARNESS_TIMEOUT_PRESET=public_sector` selects 30/45/30/2 min preset at boot | `src/runtime/timeoutPolicy.js` | `tests/unit/timeoutPolicy.test.js` | n/a (resolved at boot, surfaced in /api/server/info) | RR0-a | Server-info shows `timeoutPolicy` block | |

### Category 4 — Account / profile management & safe guidance

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 4.1 | The harness never accepts user passwords or OAuth tokens via any route | `server.js` (route inventory), `src/security/auth.js` | n/a (negative invariant — verified by grep + audit) | n/a | RR0-d (safe-guidance principle) | Safe-guidance footnote in setup wizard | |
| 4.2 | First-run guidance walks operator through `claude auth login` / `codex auth login` only | `src/runtime/firstRunClassifier.js` | `tests/unit/firstRunClassifier.test.js` | n/a (CTAs only) | RR0-d / D1 | Setup wizard shows COPY_LOGIN_COMMAND_* | |
| 4.3 | Profile switch fails if any run is active (409 + audit) | `src/runtime/profileStore.js`, `src/routes/profileRoutes.js` | `tests/integration/profile-switch-blocked.test.js` | `profile_switch_blocked` | D1 | UI shows "wait for active run" toast | |
| 4.4 | Credential plaintext fallback emits LOUD warning + audit verb | `src/security/credentialStore.js` | `tests/unit/credentialStore.test.js` | `credential_plaintext_fallback` | D1 | Probe + UI both surface fallback state | |

### Category 5 — Public-sector posture & GOV-* defenses

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 5.1 | Public-sector mode blocks local Claude execution unless explicitly allowed | `src/policy/publicSectorPolicy.js`, `src/runtime/reviewSpawnDispatcher.js` | `tests/integration/review-relay-spawn.test.js` (public-sector branch) | `local_executor_blocked` | E1.5 GOV-SB-0 | `/api/review-sessions/...` returns 409 | |
| 5.2 | Korean PII (KRN / BRN / driver / passport) is detected inline in user prompts | `src/security/piiScanner.js` | `tests/unit/piiScanner.test.js` | `pii_scan_blocked` (public-sector) / `pii_scan_warn` (standard) | E1.5 GOV-PII-0 | Pre-send scan blocks message | |
| 5.3 | File-import deep PII scan covers BRN with check-digit + driver + passport | `src/security/piiScanner.js` (deep mode) | `tests/integration/security-scan-routes.test.js` | `pii_file_scan_blocked` / `pii_file_scan_warn` | E1.5 GOV-PII-1-a/b | `/api/security/scan` blocks upload | |
| 5.4 | Auditor evidence export is HMAC-sealed against an out-of-band key | `src/runtime/auditorBundle.js`, `scripts/verify-auditor-bundle.js` | `tests/smoke/verify-auditor-bundle.test.js` | `audit_bundle_exported` | GOV-AUDIT-0 | `verify-auditor-bundle.js` exit 0 only with correct key | |
| 5.5 | Release manifest is Ed25519-signed; install gate refuses unsigned in public-sector | `scripts/launcher/launcher-cli.js` (verify-manifest-signature), `src/security/manifestSigner.js` | `tests/unit/manifestSigner.test.js`, `tests/smoke/release-manifest-signature.test.js` | `release_manifest_signed`, `launcher_signature_verified`, `launcher_signature_failed` | GOV-RELEASE-0 | Install exit 37 on unsigned | |

### Category 6 — Smart arc (gates / context / recommendations / presets / packs)

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 6.1 | A PII-laden message hits a hard gate that emits exactly ONE `policy_gate_blocked` (state-immutability) | `src/policy/policyGates.js` | `tests/integration/smart-arc-live-evidence.test.js` (P3) | `policy_gate_blocked` | SMART-2 / SMART-LV-0 | UI shows "차단됨" toast | |
| 6.2 | `runMemory` writes redact PII before persisting (raw email/secret never in ledger) | `src/runtime/runMemory.js` | `tests/integration/smart-arc-live-evidence.test.js` (P4) | `run_memory_recorded` | SMART-4 | Memory row has sourceHash, not raw text | |
| 6.3 | `decisionContext` booleans drive recommendation engine output | `src/runtime/decisionContext.js`, `src/runtime/recommendationEngine.js` | `tests/integration/smart-arc-live-evidence.test.js` (P5) | n/a | SMART-0 / SMART-1 | Simple-shell shows recommendation card | |
| 6.4 | Dispatch with `presetId` injects `[Preset: <Label>]` header + audit attribution | `src/runtime/reviewSpawnDispatcher.js`, `src/runtime/presetLibrary.js` | `tests/integration/smart-arc-live-evidence.test.js` (P6) | `review_session_dispatch_started` (with `presetId` field) | SMART-3 | dual-agent console shows preset name | |
| 6.5 | `HARNESS_DEPLOYMENT_PROFILE=finance-high-privacy` automatically applies `hardGatesDefault=true` | `src/policy/policyGates.js` (resolveGateMode), `src/policy/policyPackRegistry.js` | `tests/unit/policyGates.resolve.test.js` | `deployment_profile_resolved` | SMART-5 / POLICY-UX-0 (POL-a) | `/api/policy-packs` shows `hardGatesEffectiveMode=hard` | |
| 6.6 | `GET /api/policy-packs` returns frozen catalog with `currentPack` + `metadata.hardGatesEffectiveMode` | `src/routes/policyPackRoutes.js` | `tests/integration/policy-packs.routes.test.js` | n/a (read-only) | POLICY-UX-0 (POL-b) | Operator can compare 5 pack rule sets | |
| 6.7 | Live verification probe captures all 6 SMART properties end-to-end | `scripts/live-verify-smart-arc.js` | `tests/unit/live-verify-smart-arc.test.js` | n/a (compiles audit chain) | SMART-LV-0 (LV0-b) | `<date>-smart-arc-live-verify.json` verdict=PASS | |

### Category 7 — Field-pilot evidence collection

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 7.1 | Daily probe captures verdict in `harness-field-pilot-status/v1` JSON | `scripts/field-pilot-status.js` | `tests/unit/field-pilot-status.test.js` | n/a (consumes audit chain; doesn't append) | FIELD-PILOT-0 (FP-a) | `<date>-field-pilot-status.json` exit code 0/1/2/3 | |
| 7.2 | Probe canary fires on unknown audit verbs (drift detection) | `scripts/field-pilot-status.js` (`KNOWN_AUDIT_VERBS`) | `tests/unit/field-pilot-status.test.js` | n/a | FP-a | `audit.unknownVerbs` non-empty → DEGRADED | |
| 7.3 | Operator-facing 4 runbook templates each have a "How to use" + privacy reminder | `docs/runbooks/field-pilot-*.md` | `tests/unit/field-pilot-runbooks.test.js` | n/a (documents) | FP-b | Operator can fill template without reading code | |
| 7.4 | Critical audit verbs are documented in `incident-ledger.md` cross-ref | `docs/runbooks/field-pilot-incident-ledger.md` | `tests/unit/field-pilot-runbooks.test.js` (verb cross-ref) | 8 critical verbs | FP-b | Operator knows which verbs halt the pilot | |

### Category 8 — External reviewer hand-off

| # | Claim | Code | Test | Audit verb | Closeout | Operator signal | Reviewer verdict |
|---|---|---|---|---|---|---|---|
| 8.1 | Evidence bundle exporter writes frozen-schema JSON | `scripts/external-review-bundle.js` | `tests/unit/external-review-bundle.test.js` | n/a | EXTERNAL-REVIEW-0 (EXR-a) | `<date>-external-review-bundle.json` schema string matches | |
| 8.2 | Bundle includes sha256 of every linked artifact (tamper-detect) | same | `tests/unit/external-review-bundle.test.js` | n/a | EXR-a | Reviewer recomputes sha256 → matches | |
| 8.3 | Bundle parses round-trajectory closure banners (id + score + date) | same | `tests/unit/external-review-bundle.test.js` | n/a | EXR-a | Reviewer sees ≥4 priority rounds in `rounds[]` | |
| 8.4 | This claim/evidence matrix has structural tests (deletions/renames blocked) | this file | `tests/unit/external-review-matrix.test.js` | n/a | EXR-b | Test file fails fast on missing section | |
| 8.5 | EXTERNAL-REVIEW-0 closeout report exists + cross-links to bundle + matrix | `docs/reports/2026-05-05-external-review-0-eval.md` | (covered by `external-review-matrix.test.js` cross-ref) | n/a | EXR-c | Bundle's `closeoutReports[]` lists this file | |

---

## Entry template

When a reviewer finds a claim that the baseline matrix does not cover —
or when the harness ships a new round and adds a new claim — copy this
template at the bottom of the matching category, or open a new
category if needed:

```markdown
| N.M | <one-sentence claim, present tense> | `<code-anchor>` | `<test-anchor>` | `<audit-verb-or-n/a>` | <closeout-name> | <one-sentence operator signal> | <reviewer verdict> |
```

Rules:
- **Claim** is one sentence, present tense, falsifiable. "X happens
  when Y" beats "X is supported".
- **Code anchor** is a real file path (relative to `pipeline-dashboard/`).
  If the path includes a function or method, name it
  (`file.js::funcName`) — line numbers drift, names don't.
- **Test anchor** is a real test file. The reviewer will run it.
- **Audit verb** is the exact frozen verb string (without quotes), or
  `n/a` if the claim is invariant rather than event-emitting.
- **Closeout** is the round id (e.g. `RR0-b/e`) — the reviewer can
  find the closeout report by date prefix in the external-review
  bundle.
- **Operator signal** is what the operator sees in the UI / log /
  exit code that proves the claim is live in deployment.
- **Reviewer verdict** is `PASS` / `DOUBT` / `FAIL` / blank.

---

## How to use this matrix during a review

1. **Walk the bundle first**: open the
   `<date>-external-review-bundle.json`, confirm `verdict` is OK or
   acceptable DEGRADED, glance at `rounds[]` (≥4) and `closeoutReports[]`
   (≥4 for the 5-priority roadmap).
2. **Pick a sampling strategy**: random across categories, or focused
   on a specific concern (e.g. "I only care about public-sector
   posture this review" — sample category 5 + relevant 6/7 rows).
3. **For each sampled row**:
   - Open the code anchor in your IDE
   - Run the test anchor: `cd pipeline-dashboard && node --test <test-file>`
   - Grep the audit chain (live or via `verify-auditor-bundle.js`) for
     the named verb — confirm the verb actually fires on the path
   - Read the closeout report
   - Reproduce the operator signal (run the live-verify probe, click
     the UI button, etc.)
   - Mark the row PASS / DOUBT / FAIL in the **Reviewer verdict**
     column with a brief note
4. **Write the summary report**: aggregate verdicts by category, note
   the sampling strategy, recommend cap movement (or list gaps that
   block it). Use the EXR-d template at
   `docs/external-review/summary-template.md` — copy it to
   `docs/reports/<YYYY-MM-DD>-external-review-summary.md` and fill
   the required sections (§0 Header / §1 Verdict / §2 Sampling
   strategy / §3 Per-category aggregation / §8 Privacy statement
   are all `<!-- REQUIRED -->`).

---

## Privacy & retention

This matrix is **committed evidence**. Do **not** include:
- Real customer / project / pilot operator names
- Real prompts that contained PII or proprietary code
- Specific credential values (even fake-looking ones)
- Real machine identifiers (hostnames, IPs, MAC)

When reviewer notes need to reference a specific incident, use abstract
language ("the public-sector pilot deployment", "operator A") rather
than identifying detail.

When the review closes, the matrix becomes part of the EXTERNAL-REVIEW-0
round bundle. Matrix entries are not retroactively edited — if a
verdict needs to change post-review, append a `Postscript` section, do
not edit the original verdict column.
