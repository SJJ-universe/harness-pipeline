# UI-P11 Responsive + Text Fit Assertions — Round Closeout

> **Slice**: UI-P11 (Phase D Round UI-P, 2026-05-04)
>
> **Round goal**: Promote UI-P10's evidence-only capture into automated pass/fail responsive + text-fit verdicts. 6 frozen rules × 16 cells = up to 96 assertions per run, with `cellsAllPassed` / `cellsWithFailures` / `cellsWithErrors` summary counts a CI gate (or operator) can chart over time.
>
> **Round verdict**: GO — assertion catalog (P11-a) + runner module (P11-b) + CLI entry + runbook (P11-c) + CI manual-dispatch workflow (P11-d) all landed and unit-green. Live browser execution is operator-runnable per the runbook; PR-gating deferred to a fused workflow after UI-P12 (a11y) lands.

---

## 1. What landed

### 1.1 P11-a — Assertion catalog (commit `4192670`)

| File | Role |
|---|---|
| `scripts/visual-live/assertions.js` | Frozen 6-rule catalog + `runAssertions(page, viewport, route)` aggregator |
| `tests/unit/visual-live.assertions.test.js` | 28 stub-page tests (catalog shape + per-rule happy/fail + appliesTo gating + runAssertions aggregation + browser-side helper shape) |

The 6 rules:
1. `no-horizontal-page-overflow` — page-level scroll fit
2. `header-buttons-text-fit` — `[data-region="header"] button` text not truncated
3. `header-buttons-min-tap-target` — WCAG 2.5.5 ≥ 44×44 px (mobile only)
4. `dual-terminals-fit-container` — `[data-region="dual-terminals"]` overflow + visibility
5. `monitor-grid-cards-no-overlap` — pairwise rect intersection check
6. `pipeline-rail-lane-labels-fit` — `[data-region="pipeline-rail"] [data-phase-slot="title"]` text fit

Constants exposed: `TOLERANCE_PX = 1` (sub-pixel rendering tolerance), `MIN_TAP_TARGET_PX = 44` (WCAG 2.5.5 Enhanced).

`appliesTo` gating: page-overflow always runs; tap-target only on `viewport.isMobile && route.id !== "legacy"`; product-shell rules skip the legacy route entirely (different markup, UI-P0 chose escape hatch over rewrite).

### 1.2 P11-b — Assertion runner (commit `4c38803`)

| File | Role |
|---|---|
| `scripts/visual-live/assert-runner.js` | `runAssertMatrix({base, ...})` orchestrator + `buildAssertManifest({...})` |
| `tests/unit/visual-live.assert-runner.test.js` | 10 stub-injection tests (manifest derivation, happy path, per-cell nav fault, assertion failure, screenshot-on-failure, input validation) |

Manifest schema `harness-visual-assert/v1` (intentionally distinct from capture's `harness-visual-live/v1` so future round can fuse them safely). Adds `rulesetVersion` + `rulesetIds` so manifests can be re-checked against newer rule versions.

`screenshotFailedCells` option saves a debug PNG (`<route>__<viewport>__failed.png`) only for cells with assertion failures — best-effort, screenshot-write failure NEVER aborts the run.

Per-cell fault model matches capture.js: navigation timeout / selector miss → `{failed: true, failureReason}` recorded, loop continues to next cell. Operators want to see WHICH subset broke.

### 1.3 P11-c — CLI entry + runbook + this closeout

| File | Role |
|---|---|
| `scripts/visual-assert-live.js` | CLI entry exporting `parseArgs` / `defaultOutDir` / `main` |
| `package.json` `visual:assert-live` script | Standard operator command |
| `docs/runbooks/visual-assert-live.md` | 10-section operator guide |
| `tests/unit/visual-assert-live.cli.test.js` | 10 tests on parseArgs + defaultOutDir + label sanitization |
| `docs/reports/2026-05-04-ui-p11-assert-eval.md` | This file |

CLI exit codes match `visual-capture-live.js`: 0 PASS / 1 FAIL / 2 CONFIG.

Per-cell + per-rule progress output prints failed-rule details inline so the operator doesn't need to open `manifest.json` for first-pass triage.

### 1.4 P11-d — CI manual-dispatch workflow

| File | Role |
|---|---|
| `.github/workflows/visual-assert-live.yml` | `workflow_dispatch` trigger only (matches UI-P10-d policy) |
| `tests/unit/visual-assert-live.workflow.test.js` | 9 shape-contract tests pinning trigger / inputs / step sequence / artifact upload |

Same design contract as UI-P10-d: NO push/pull_request triggers. PR-gating deferred to a fused workflow once UI-P12 (a11y) provides the regression-blocking signal that justifies chromium download cost on every PR.

---

## 2. Verification

### 2.1 Test counts (pre-round → post-round)

| Suite | Pre P11 | Post P11 | Δ |
|---|---:|---:|---:|
| Unit | 2520 | 2577 | +57 (28 P11-a + 10 P11-b + 10 P11-c + 9 P11-d) |
| Integration | 197 | 197 | 0 |
| Smoke | 48 | 48 | 0 |
| Live readiness | 18/18 | 18/18 | 0 |

### 2.2 Live assertion evidence

Operator-runnable per `docs/runbooks/visual-assert-live.md` §2.

The first live run on the developer machine producing this round will land in `docs/reports/2026-05-04-ui-p11-assert/` once `npm run visual:install-browsers` completes. The structural infrastructure is verified independently via the unit tests (57 stub-driven tests cover happy + fail + edge paths).

### 2.3 Backwards-compat invariants preserved

- UI-P9 visual contract gate — still runs on every push, still fails CI on structural drift
- UI-P10 capture-live — unaffected; assertion-runner is a separate code path
- UI-P10 viewports/routes contract — REUSED unchanged; UI-P11 doesn't redefine them
- All other CI gates from `ci.yml` — untouched

---

## 3. Score impact

| Stage | Score |
|---|:---:|
| Entry (UI-P10 closed) | 119/125 |
| +P11-a (catalog) | 119/125 (foundation, no rubric move) |
| +P11-b (runner) | 119/125 (foundation, no rubric move) |
| +P11-c (CLI + runbook) | 119/125 |
| +P11-d (CI manual-dispatch) | **119/125** (operator infrastructure, no rubric move) |

UI-P11 adds **automated regression detection** for responsive + text-fit issues, but the cap movement (UI feedback loop +1 → 9, fully filled at 9/9 already) landed in UI-P9 visual contract gate. UI-P11 is an operational layer on top of UI-P10/P11 visual infrastructure; the qualitative shift to "automated assertion-driven UI verification" was already captured.

Cap movement candidate moves to UI-P12 (Public-sector readiness +1 via a11y as user roadmap noted).

---

## 4. Round artifacts

| Path | Type |
|---|---|
| `scripts/visual-live/assertions.js` | source — 6-rule frozen catalog |
| `scripts/visual-live/assert-runner.js` | source — playwright-core matrix runner |
| `scripts/visual-assert-live.js` | source — CLI entry |
| `tests/unit/visual-live.assertions.test.js` | test (28) |
| `tests/unit/visual-live.assert-runner.test.js` | test (10) |
| `tests/unit/visual-assert-live.cli.test.js` | test (10) |
| `tests/unit/visual-assert-live.workflow.test.js` | test (9) |
| `docs/runbooks/visual-assert-live.md` | docs — operator runbook |
| `docs/reports/2026-05-04-ui-p11-assert-eval.md` | docs — this closeout |
| `.github/workflows/visual-assert-live.yml` | CI — manual-dispatch workflow |
| `package.json` | dependency — `visual:assert-live` script added |

---

## 5. Known limitations + follow-ups

### 5.1 UI-P11 round itself
- Assertion catalog is 6 rules — pragmatic minimum. Future rounds can extend (e.g., contrast ratio per WCAG 1.4.3, focus indicator visibility, animation duration limits). Each addition is a frozen-list change that merits its own discussion.
- Browser-side measurements are CSS pixel based — not validating computed font-size minimums (could be added).
- No baseline-style comparison (e.g., "this run vs last run") — manifests are independent point-in-time snapshots. Operator/CI compares manually if desired.
- Tap-target rule fires only on mobile viewports — desktop hover/precision exempt is documented but could surface in a future "kiosk mode" deployment.

### 5.2 Out-of-scope (later rounds)
- UI-P12 Accessibility — axe-core integration on the same chromium harness; cap-movement candidate
- UI-P13 Dead Button — click-and-verify on the same server-boot infra
- UI-Doc-Gov — visual contract governance (when to refresh visual:check baseline, what to look for in PR diff for assertion manifests) — partially in this runbook §7, full doc lands later
- UI-FirstRun — first-run no-profile UX polish

---

## 6. Sign-off

- ✅ All 4 sub-slices (P11-a/b/c/d) land in this round
- ✅ 57 new unit tests, 0 regression
- ✅ Operator runbook covers first-time setup → standard usage → catalog reference → troubleshooting → commit policy → CI integration
- ✅ CI freshness gates from UI-P9 + workflow shape contract from UI-P10-d stay green
- ✅ Score 119/125 unchanged (foundation work; UI-P12 a11y is the cap-movement round)

**Next round candidate**: UI-P12 (Accessibility) — uses the same chromium harness pattern + axe-core integration. Cap-movement candidate per user roadmap.

---

## 7. Reproduction

```bash
cd pipeline-dashboard

# One-time setup (shared with UI-P10)
npm run visual:install-browsers

# Standard assertion run (16 cells × 6 rules)
npm run visual:assert-live

# Debug failed cells with PNG snapshots
node scripts/visual-assert-live.js --screenshot-failures --label "debug"

# CI manual dispatch
# GitHub UI → Actions → "UI-P11 Live Browser Visual Assertions" → Run workflow
```

Verify exit semantics:
```bash
npm run visual:assert-live; echo "exit: $?"
# 0  → all 16 cells pass all applicable assertions
# 1  → at least one assertion failed (manifest still written)
# 2  → CONFIG (browsers missing, port collision, server boot fail)
```
