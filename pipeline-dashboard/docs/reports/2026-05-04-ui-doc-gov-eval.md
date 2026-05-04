# UI-Doc-Gov Visual Contract Governance — Round Closeout

> **Slice**: UI-Doc-Gov (Phase D Round UI-P, 2026-05-04)
>
> **Round goal**: Phase 2 UI Reference Port의 visual contract family (UI-P9 ~ UI-P13)를 한 곳에 governance 문서로 정착. 5개 contract type을 **언제 / 어떻게 / 왜** 사용하는지에 대한 단일 진입점 + 자주 발생하는 anti-pattern 명문화.
>
> **Round verdict**: GO — master governance doc (Doc-Gov-a) + cross-links from distribution + reference guides (Doc-Gov-b) + scorecard backlog refresh + closeout (Doc-Gov-c) all landed and unit-green.

---

## 1. What landed

### 1.1 Doc-Gov-a — Master governance doc + drift test (commit `d0a11f9`)

| File | Role |
|---|---|
| `docs/visual-contract-governance.md` | 391줄 governance master (9 sections, KO) |
| `tests/unit/visual-contract-governance.test.js` | 8 drift tests locking doc claims to source |

**문서 9 sections**:
1. 5-row contract table (npm command / schema / PR-gate)
2. Contract 1 (UI-P9) governance — what's frozen / when refresh / PR review checklist / CI policy
3. Contract 2-5 governance — common policy / per-contract commit policy / manifest stability / no baseline-comparison / catalog frozen-list change procedure
4. Anti-patterns (5 documented: baseline-only PR / capture-diff-rationalized refresh / unclaimed manifest / catalog bypass / refresh-as-means)
5. Decision tree — "I'm changing UI" → which tool
6. CI policy — current state + 4 fused-workflow entry conditions
7. Catalog versions table (cross-referenced to source)
8. Next-round connections (UI-FirstRun / UI-Fuse / SMART rounds)
9. Change log

**Drift test 8 cases**:
- Doc exists at canonical path
- All 5 npm commands mentioned
- All 5 manifest schemas / baseline path mentioned
- §7 catalog version table echoes ACTUAL frozen-list counts (`ASSERTIONS.length`, `A11Y_CUSTOM_RULES.length`, `BUTTONS.length`)
- §1 mentions documented count claims ("6 frozen rules" / "13 buttons" / "4 routes × 4 viewports")
- §4 has at least 5 anti-patterns
- §5 + §6 sections present
- Doc explicitly identifies UI-P9 as the SINGLE CI-gated contract

This test ensures a future round can't add an axe custom rule or a button without updating §7 of the governance doc — the doc stays honest.

### 1.2 Doc-Gov-b — Cross-links from production guides (commit `634b35d`)

| File | Section |
|---|---|
| `docs/harness-pipeline-distribution-guide.md` | NEW §16-A "Visual Contract Family (UI-P9~P13 통합)" |
| `docs/harness-pipeline-reference-guide-draft.md` | NEW §19-A "Visual Contract Family와 운영 governance" |

Distribution guide adds an operator-facing summary table + anti-pattern hint + pointers to runbooks + governance doc as single entry-point.

Reference guide draft adds the dev/operator audience write-up: contract types as "operator decision procedure", baseline refresh policy as "result not means", manifest stability anchors, public-sector procurement context, anti-patterns. "추가 작성 필요" lists 5 follow-up bullets for guide finalization.

Both docs cross-link the new `docs/visual-contract-governance.md` so operators reading either guide land at the authoritative source.

### 1.3 Doc-Gov-c — This closeout + scorecard backlog refresh

| File | Change |
|---|---|
| `docs/reports/2026-05-04-ui-doc-gov-eval.md` | This file (NEW) |
| `docs/scorecard.md` | Phase 2 UI-P10/P11/P12/P13 + UI-Doc-Gov closure marker section refreshed |

---

## 2. Verification

### 2.1 Test counts (pre-round → post-round)

| Suite | Pre Doc-Gov | Post Doc-Gov | Δ |
|---|---:|---:|---:|
| Unit | 2694 | 2702 | +8 (drift test) |
| Integration | 457 | 457 | 0 |
| Smoke | 80 | 80 | 0 |
| Live readiness | 18/18 | 18/18 | 0 |

### 2.2 Backwards-compat invariants preserved

- UI-P9 visual contract gate — still runs every push
- UI-P10/P11/P12/P13 manual workflows — unaffected
- All other CI gates — untouched

### 2.3 Doc drift defenses

The 8-test drift suite locks the governance doc to actual source state. If a PR adds an a11y custom rule but forgets to update §7 of the governance doc, `npm run test:unit` fails — keeping the doc and source in sync.

---

## 3. Score impact

| Stage | Score |
|---|:---:|
| Entry (UI-P13 closed) | 120/126 |
| +Doc-Gov-a (governance + drift test) | 120/126 |
| +Doc-Gov-b (distribution + reference cross-links) | 120/126 |
| +Doc-Gov-c (closeout + scorecard refresh) | **120/126** (documentation completeness) |

UI-Doc-Gov is documentation that **prevents** future operator confusion about visual contracts. It doesn't add a new defense or gate, so no cap movement. The cap movement (Public-sector readiness 5 → 6) was the UI-P12 a11y closeout.

What this round changes operationally: future PRs touching visual contracts can be reviewed against a documented policy instead of relying on whoever wrote that round to remember the rules.

---

## 4. Round artifacts

| Path | Type |
|---|---|
| `docs/visual-contract-governance.md` | docs — master governance (391 lines) |
| `tests/unit/visual-contract-governance.test.js` | test (8) — drift detection |
| `docs/harness-pipeline-distribution-guide.md` (modified) | docs — §16-A added |
| `docs/harness-pipeline-reference-guide-draft.md` (modified) | docs — §19-A added |
| `docs/reports/2026-05-04-ui-doc-gov-eval.md` | docs — this closeout |

---

## 5. Known limitations + follow-ups

### 5.1 UI-Doc-Gov round itself
- The reference guide is still a `-draft.md` file. Finalization is a future round (when scope is locked).
- Distribution guide §16-A is operator-facing summary; the per-tool runbooks remain the authoritative place for command-line details.
- No automated cross-link checker (e.g., "does every runbook link back to governance?"). Could be added if cross-link drift becomes a problem.

### 5.2 Out-of-scope (later rounds)
- **UI-Fuse**: actually implementing the fused workflow that PR-gates capture/assert/a11y/button. Conditions documented in governance §6.2.
- **UI-FirstRun**: first-run no-profile UX polish. Will need governance + manifest implications.
- **SMART rounds**: governance must extend when SMART contracts (decision context, recommendations, presets) introduce new manifest types.
- **Korean WCAG conformance certification process** — operator workflow round.

---

## 6. Sign-off

- ✅ All 3 sub-slices (Doc-Gov-a/b/c) land in this round
- ✅ 8 new unit tests (drift detection), 0 regression
- ✅ Master governance doc covers all 5 contracts: 9 sections + decision tree + 5 anti-patterns + CI policy + future fused-workflow entry conditions
- ✅ Distribution + reference guides cross-link governance as single entry-point
- ✅ Score 120/126 unchanged (documentation completeness; cap movement was UI-P12)

**Next round candidate**: UI-FirstRun — first-run / no-profile operator UX polish. Or jump to SMART-0 for decision context foundation.

---

## 7. Reproduction

```bash
cd pipeline-dashboard

# Read the governance doc
cat docs/visual-contract-governance.md

# Verify drift tests pass
node --test tests/unit/visual-contract-governance.test.js

# Read the cross-linked sections in production guides
grep -A 20 "16-A" docs/harness-pipeline-distribution-guide.md
grep -A 20 "19-A" docs/harness-pipeline-reference-guide-draft.md
```

The drift test ensures `docs/visual-contract-governance.md` §7 stays in lockstep with frozen-list counts in:
- `scripts/visual-live/assertions.js` (ASSERTIONS)
- `scripts/visual-live/a11y-rules.js` (A11Y_CUSTOM_RULES, A11Y_AXE_TAGS)
- `scripts/visual-live/button-catalog.js` (BUTTONS)

If a future PR adds a frozen-list entry but forgets the governance doc update, the test fails.
