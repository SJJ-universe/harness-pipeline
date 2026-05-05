# Runbooks Index

**Slice RUNBOOKS-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05)**

This directory holds operator runbooks — step-by-step playbooks for
verifications and field-deployment tasks that an operator runs by
hand outside the regular `npm test` cycle.

Every runbook in this directory targets a specific operator workflow
and is independently usable. The two families below collect runbooks
that are consumed together in practice.

---

## §1 Field-pilot family

**Audience**: operator running a field-pilot deployment (slice **FP-b**,
Phase 2 / FIELD-PILOT-0).

These four runbooks form a single deployment kit. Open the deployment
log on day 0, the troubleshooting catalog when something breaks, the
incident ledger if the incident is severity ≥ S2, and the feedback
survey at the end of the pilot window.

| Runbook | One-line summary |
| --- | --- |
| [`field-pilot-deployment-log.md`](field-pilot-deployment-log.md) | Day-by-day deployment log template — what was deployed, what passed, what was blocked. |
| [`field-pilot-troubleshooting.md`](field-pilot-troubleshooting.md) | Troubleshooting catalog — symptom → diagnosis → fix, indexed by error pattern. |
| [`field-pilot-incident-ledger.md`](field-pilot-incident-ledger.md) | Incident ledger — append-only record of every S2+ event during the pilot. |
| [`field-pilot-feedback-survey.md`](field-pilot-feedback-survey.md) | Pilot-end feedback survey — structured questionnaire for operator + end-user retrospective. |

## §2 Pre-deployment family

**Audience**: operator preparing a release or shipping a build to
end users (slice **PREFLIGHT-CHECKLIST**, Phase 2 v2 follow-up).
Includes the first-time-use guide for non-technical end users
(slice **END-USER-DEPLOY-POLISH**).

| Runbook | Audience | Probe script | One-line summary |
| --- | --- | --- | --- |
| [`deployment-readiness.md`](deployment-readiness.md) | operator | [`preflight.js`](../../scripts/preflight.js) | Pre-deployment health check — visual / readiness / scorecard / hooks gates plus optional smoke. |
| [`first-time-use.md`](first-time-use.md) | 일반 사용자 (non-technical end user) | (none — handbook only) | Korean-primary first-time-use guide. Setup → first run → connecting Claude/Codex → understanding approval cards. |
| [`v1-blockers.md`](v1-blockers.md) | operator + release-lead | (multiple — see runbook) | The three v1.0.0 final-readiness blockers in priority order: real-binary live verification → trust-store + signed-manifest E2E → 1-week field-pilot evidence. Acceptance criteria + evidence locations. |
| [`trust-store-e2e.md`](trust-store-e2e.md) | deployer + installation operator | [`sign-manifest.js`](../../scripts/sign-manifest.js) + [`launcher/install-version.ps1`](../../scripts/launcher/install-version.ps1) | Phase 1/2/3 sign / install / tampering-rejection loop for v1.0.0 Blocker #2. Public-sector posture variant + dev-escape carve-out. |

## §3 Live-verify family

**Audience**: operator (or CI in opt-in mode) verifying a live
running harness against a real browser or real Claude/Codex
binaries.

Each runbook here drives a specific probe script in `scripts/` and
captures its acceptance criteria. The probes are listed in
[`scripts/README.md`](../../scripts/README.md) §5 and §7.

(The pre-deployment runbook in §2 above is a related but distinct
audience: §2 is for one-shot release verification, §3 is for
ongoing live verification of a running deployment.)

| Runbook | Probe script | Slice |
| --- | --- | --- |
| [`live-verify-review-relay.md`](live-verify-review-relay.md) | [`live-verify-review-relay.js`](../../scripts/live-verify-review-relay.js) | LV (Phase E1.5) |
| [`visual-capture-live.md`](visual-capture-live.md) | [`visual-capture-live.js`](../../scripts/visual-capture-live.js) | UI-P10 |
| [`visual-assert-live.md`](visual-assert-live.md) | [`visual-assert-live.js`](../../scripts/visual-assert-live.js) | UI-P11 |
| [`visual-a11y-live.md`](visual-a11y-live.md) | [`visual-a11y-live.js`](../../scripts/visual-a11y-live.js) | UI-P12 |
| [`visual-button-live.md`](visual-button-live.md) | [`visual-button-live.js`](../../scripts/visual-button-live.js) | UI-P13 |
| [`visual-fused-live.md`](visual-fused-live.md) | [`visual-fused-live.js`](../../scripts/visual-fused-live.js) | UI-Fuse |

The four `visual-*-live` runbooks share a common shape: prerequisite
check → probe invocation → expected output → known false-positives
→ how to refresh the baseline. Reading one is enough to navigate
the others.

---

## §4 How to add a new runbook

When a new operator workflow lands, add the runbook here following
the established conventions:

1. **Filename**: lowercase, hyphenated, descriptive. Match the
   probe-script name when the runbook drives a probe (e.g.
   `visual-button-live.md` ↔ `scripts/visual-button-live.js`).
2. **Title**: H1 with " — 운영자 Runbook" or " Runbook" suffix
   so the audience is unambiguous.
3. **Slice tag**: bold callout on line 3 naming the slice that
   shipped the runbook (e.g. `**Slice FP-b (Phase 2 / FIELD-PILOT-0,
   2026-05-05)**`). The tag is what makes the runbook traceable to
   a specific commit.
4. **Sections** (in order):
   - Prerequisites (env, profile, network, etc.)
   - Steps (numbered)
   - Expected output (sample shown)
   - Known false-positives + remediation
   - References (back-pointers to scripts and other runbooks)
5. **Add to this index**: list the new runbook in §1 or §2 (whichever
   family it joins) before merging. The structural test
   [`tests/unit/docs.runbooks-readme.test.js`](../../tests/unit/docs.runbooks-readme.test.js)
   enforces that every tracked runbook is referenced here.

If the new runbook starts a third family, add a new section here
and update the test's expected-section list in the same commit.

## §5 Conventions

- **Korean / English**: runbooks are written in either language but
  the title makes the choice clear ("Runbook" only → English content;
  "운영자 Runbook" → Korean primary, English allowed for code blocks).
- **Slice tag is load-bearing**: when refactoring a runbook, keep the
  original slice tag and add a new "Last updated: …" line rather than
  rewriting the original. The slice tag links the runbook to the round
  that introduced it.
- **Probe pairs**: a runbook that drives a script in `scripts/` should
  share the script's base name. `live-verify-review-relay.md` ↔
  `scripts/live-verify-review-relay.js` is the canonical pattern.
- **No transient data**: runbooks document procedure, not specific
  evidence. Per-run evidence (probe outputs, screenshots, JSON
  artifacts) lives under `docs/reports/`.

## §6 References

- [`docs/README.md`](../README.md) — top-level documentation index.
- [`scripts/README.md`](../../scripts/README.md) — operator/CI scripts
  (most live-verify runbooks pair with a script here).
- [`tests/README.md`](../../tests/README.md) — test-suite layout
  (visual baselines that live-verify runbooks compare against).
- [`docs/external-review/`](../external-review/) — external reviewer
  protocol; some runbooks feed evidence into bundles produced there.
