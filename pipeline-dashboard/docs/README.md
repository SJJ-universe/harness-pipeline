# Harness Pipeline Documentation Index

**Slice DOC-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05)**

This directory contains every long-form document for the harness
pipeline. It is organised by **the audience that gets the most value
out of it first**: a committer joining the project reads from
"Architecture & design"; an operator preparing a deployment reads from
"Operations & deployment"; an external reviewer reads from "Reviewer
protocol"; and so on.

The project-root [`README.md`](../README.md) covers the quick-start
path (install, run, test). This file is the entry point for everything
else.

---

## §1 Architecture & design

For committers and reviewers learning how the harness is shaped.

| Doc | One-line summary |
| --- | --- |
| [`harness-architecture.md`](harness-architecture.md) | Runtime shape, control flow, hook router, agent contracts. |
| [`security-model.md`](security-model.md) | Trust boundary, defense layers, threat assumptions for the local-first deployment. |
| [`container-sandbox.md`](container-sandbox.md) | Container sandbox shape; defers to the RFC for current authoritative design. |
| [`ui-dashboard-design-notes.md`](ui-dashboard-design-notes.md) | Dashboard design tokens (`public/css/harness-shell.css`) and panel layout rules. |
| [`ui-h-redesign-plan.md`](ui-h-redesign-plan.md) | UI-H hybrid redesign — SJ Harness mockup integration plan. |
| [`ui-reference-port-plan.md`](ui-reference-port-plan.md) | UI reference port plan (UI-P0, Phase E Round 3). |
| [`harness-pipeline-reference-guide-authoring-blueprint.md`](harness-pipeline-reference-guide-authoring-blueprint.md) | Forward-looking blueprint for a future GUIDE-* documentation round series. Plan only, not a finished guide. |
| [`visual-contract-governance.md`](visual-contract-governance.md) | Visual baseline workflow: `npm run visual:check`, regression detection, refresh policy. |

## §2 Operations & deployment

For operators running the harness in single-user, internal-team, or
public-sector deployments.

| Doc | One-line summary |
| --- | --- |
| [`operator-guide.md`](operator-guide.md) | `harness-start` launcher operator guide (Phase E1, D0). |
| [`harness-pipeline-distribution-guide.md`](harness-pipeline-distribution-guide.md) | 배포용 통합 가이드 — Korean distribution / installation / first-run instructions. |
| [`harness-pipeline-reference-guide-draft.md`](harness-pipeline-reference-guide-draft.md) | 전공서형 통합 가이드 초안 — comprehensive Korean reference draft. |

## §3 Policy, security & remote-mode design

For security reviewers, public-sector deployment leads, and committers
working on the remote-runner subsystem.

| Doc | One-line summary |
| --- | --- |
| [`public-sector-hardening-plan.md`](public-sector-hardening-plan.md) | Public-sector hardening implementation plan with task-tracking checkboxes. |
| [`security-reimpl-backlog.md`](security-reimpl-backlog.md) | Phase 3-S 보안 재구현 backlog (Korean). |
| [`remote-hook-bridge-contract.md`](remote-hook-bridge-contract.md) | Remote hook execution bridge contract (R2.5-a). |
| [`remote-mode-design.md`](remote-mode-design.md) | Remote/team mode design notes; defers to the RFC for the current shape. |
| [`remote-sandbox-rfc.md`](remote-sandbox-rfc.md) | Remote sandbox RFC — design-only. |
| [`remote-sandbox-impl.md`](remote-sandbox-impl.md) | Remote sandbox implementation RFC — design-only. |
| [`r3-rollout-plan.md`](r3-rollout-plan.md) | Phase D R3 rollout plan: multi-runner pool + Linux host networking + per-call approval. |

## §4 Reference & contracts

For committers building features on top of harness primitives.

| Doc | One-line summary |
| --- | --- |
| [`i18n-conventions.md`](i18n-conventions.md) | i18n key naming, placeholder regex, translation-quality rules, adding new locales. |
| [`readiness-rubric.md`](readiness-rubric.md) | 6-category readiness model with per-star rationale + operator workflow. |
| [`live-evidence-schema.md`](live-evidence-schema.md) | Locked schema reference for the two live-verification probes (`harness-smart-lv-evidence/v1` + `live-verify-review-relay/v1`); audit-chain anchors; v2 convergence notes. |

## §5 Status & health

For reviewers and leads tracking round-by-round progress.

| Doc | One-line summary |
| --- | --- |
| [`scorecard.md`](scorecard.md) | Round-by-round score trajectory, rubric breakdown, what-each-score-means. |

---

## §6 Sub-directories

These directories hold many small documents that are best entered
through their own indices, not listed individually here.

| Directory | Purpose | Entry point |
| --- | --- | --- |
| [`external-review/`](external-review/) | External reviewer protocol — claim-evidence matrix and summary template. | [`external-review/claim-evidence-matrix.md`](external-review/claim-evidence-matrix.md) |
| [`runbooks/`](runbooks/) | Operator runbooks — live-verify, field-pilot, visual-* probes. | [`runbooks/README.md`](runbooks/README.md) |
| [`reports/`](reports/) | Per-slice closeout reports (one per shipped round). | listed by date prefix |
| [`superpowers/specs/`](superpowers/specs/) | Cross-cutting specifications — 5-priority roadmap, run-monitor hybrid design. | listed by date prefix |

Each sub-directory's README (when one exists) is the better entry
point than this top-level index.

---

## §7 How to find what you need

Search strategies that work well in this layout:

- **By audience**: §1 for committers learning the system, §2 for
  operators, §3 for security/policy work, §4 for committers extending
  features, §5 for project leads.
- **By topic name**: filenames are the canonical handles. Prefer
  `git grep` over `grep` so the search respects `.gitignore` and
  doesn't search auto-generated reports.
- **By round name**: scorecard trajectory entries (§5) link the
  numeric round-by-round progression to specific commits and slices.
- **By doc-test**: every doc with a structural test (currently
  `i18n-conventions.md`, `readiness-rubric.md`, this index) has a
  `tests/unit/docs.<doc-name>.test.js` file that captures the
  load-bearing structure. If you change a doc's section names, run
  the matching test first.

## §8 Conventions

- Top-level docs are written in English unless they carry a clear
  Korean-audience tag (the two `harness-pipeline-*-guide-*.md` files,
  and `security-reimpl-backlog.md`).
- Round-specific evidence — closeout reports, JSON probe artifacts,
  visual baselines — lives under `docs/reports/` or in its own
  sub-directory, not at the top level.
- A doc that supersedes another should add a "**See also**" callout
  at the top of the older doc rather than deleting it; the older
  doc's URL may already be cited in commit messages or external
  reviews.

## §9 References

- Project-root [`README.md`](../README.md) — quick-start, environment,
  verification.
- [`scorecard.md`](scorecard.md) — current readiness score and round
  trajectory.
- [`readiness-rubric.md`](readiness-rubric.md) — what "ready" means
  category-by-category.
