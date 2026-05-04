# UI-P13 Dead Button / Action Integrity — Round Closeout

> **Slice**: UI-P13 (Phase D Round UI-P, 2026-05-04)
>
> **Round goal**: Catch "looks clickable but does nothing" UX failures before deployment. 13 product-shell buttons × 4 routes = 52 button-checks per run, with static (accessible name + disabled-with-reason) and dynamic (click → DOM mutation OR network request, no console.error) layered verification.
>
> **Round verdict**: GO — button catalog (P13-a) + runner module (P13-b) + CLI entry + runbook (P13-c) + CI manual-dispatch workflow (P13-d) all landed and unit-green.

---

## 1. What landed

### 1.1 P13-a — Button catalog (commit `7ce70e7`)

| File | Role |
|---|---|
| `scripts/visual-live/button-catalog.js` | Frozen registry of 13 buttons + summarizeButtonResult verdict aggregator + browser-side `_evalStaticButtonState` |
| `tests/unit/visual-live.button-catalog.test.js` | 23 stub-page tests |

**13 buttons** broken down:
- Header: 8 (mode×2 + locale×2 + pro-actions×3 + shutdown)
- Dual-terminal action row: 5 (start + send-codex + followup-codex + hand-back + archive)

Click-safety policy:
- `clickSafe: true` (7 buttons) — actually clicked + activity captured
- `clickSafe: false` (6 buttons) — STATIC-only check (provider spawn / server kill / state mutation are dangerous in CI)

Verdict status vocabulary (10 distinct):
- Pass: applies-to-false / skipped / disabled-with-reason / static-ok-not-clicked / click-fired-activity
- Fail: no-accessible-name / disabled-without-reason / click-failed / click-console-error / **click-no-activity** (the dead-button signature)

Activity thresholds (frozen):
- MIN_DOM_MUTATIONS = 1
- MIN_NETWORK_REQUESTS = 1
- FAILS_ON_CONSOLE_ERROR = true

### 1.2 P13-b — Button runner (commit `fa5df24`)

| File | Role |
|---|---|
| `scripts/visual-live/button-runner.js` | `runButtonMatrix({base, ...})` orchestrator + `runButtonsForCell(page, viewport, route)` per-page evaluator + `buildButtonManifest({...})` |
| `tests/unit/visual-live.button-runner.test.js` | 14 stub-injection tests |

**Per-cell flow**:
1. Navigate (waitUntil domcontentloaded → waitForSelector → 250ms post-paint)
2. For each button in catalog:
   - If `!appliesTo(viewport, route)` → skip
   - STATIC: `page.evaluate(_evalStaticButtonState, selector)`
   - If `clickSafe + visible + enabled`:
     a. `page.evaluate(_setupActivityObserver)` — MutationObserver + console.error wrapper
     b. `page.on("request", ...)` listener
     c. `page.click(selector, {timeout: 1500})`
     d. `waitForTimeout(400)` — let activity settle
     e. `page.evaluate(_readActivity)` returns `{mutations, errors}`
   - `summarizeButtonResult(static, click)` → final verdict

**Single viewport**: UI-P13 runs on desktop-1366 only (vs UI-P10/P11/P12's 4×4 = 16). Rationale: button wiring is route-mode dependent, NOT viewport-dependent. UI-P11 already gates per-viewport CSS visibility. 4 routes × 13 buttons × 4 viewports × click+wait = ~3 minutes for marginal value.

**Manifest schema** `harness-visual-button/v1` (distinct from capture/assert/a11y v1's). Snapshots `catalogVersion + catalogIds` so manifests stay interpretable when buttons are added/removed.

### 1.3 P13-c — CLI entry + runbook + this closeout

| File | Role |
|---|---|
| `scripts/visual-button-live.js` | CLI entry exporting parseArgs / defaultOutDir / main |
| `package.json` `visual:button-live` script | Operator command |
| `docs/runbooks/visual-button-live.md` | 10-section operator guide |
| `tests/unit/visual-button-live.cli.test.js` | 10 CLI tests |
| `docs/reports/2026-05-04-ui-p13-buttons-eval.md` | This file |

CLI exit codes match capture/assert/a11y entries: 0 PASS / 1 FAIL / 2 CONFIG.

Per-cell + per-button progress prints failed buttons inline (status + reason + first 2 console errors) so operator triages without opening manifest.json.

### 1.4 P13-d — CI manual-dispatch workflow

Trigger: `workflow_dispatch` ONLY (matches UI-P10-d / UI-P11-d / UI-P12-d). PR-gating deferred to fused workflow once stable baseline established (separate round).

---

## 2. Verification

### 2.1 Test counts (pre-round → post-round)

| Suite | Pre P13 | Post P13 | Δ |
|---|---:|---:|---:|
| Unit | 2638 | 2695 | +57 (23 P13-a + 14 P13-b + 10 P13-c + 9 P13-d) |
| Integration | 457 | 457 | 0 |
| Smoke | 80 | 80 | 0 |
| Live readiness | 18/18 | 18/18 | 0 |

### 2.2 Live button evidence

Operator-runnable per `docs/runbooks/visual-button-live.md` §2.

The first live run on the developer machine producing this round will land in `docs/reports/2026-05-04-ui-p13-buttons/` once chromium is installed. Structural infrastructure is verified independently via 57 stub-driven tests covering every catalog entry + verdict path.

### 2.3 Backwards-compat invariants preserved

- UI-P9 visual contract gate — still runs every push
- UI-P10 capture-live + UI-P11 assert-live + UI-P12 a11y-live — unaffected; UI-P13 is a separate code path
- UI-P10 routes/viewports contract — REUSED unchanged
- All other CI gates — untouched

---

## 3. Score impact

| Stage | Score |
|---|:---:|
| Entry (UI-P12 closed) | 120/126 |
| +P13-a (catalog) | 120/126 |
| +P13-b (runner) | 120/126 |
| +P13-c (CLI + runbook) | 120/126 |
| +P13-d (CI manual-dispatch) | **120/126** (UX integrity, no cap movement) |

UI-P13 catches a class of UX bug (dead buttons) that would severely damage deployment trust, but doesn't move a cap because:
- Public-sector readiness cap (just hit 6/6 in UI-P12) is fully filled
- UI feedback loop cap (9/9 since UI-P9 visual contract) is fully filled
- Button integrity is enforcement *of existing UI commitments*, not a new property

This is correct per the user's roadmap pre-decision: UI-P11/P13 are operator-trust foundation; UI-P12 was the cap-movement trigger via accessibility.

---

## 4. Round artifacts

| Path | Type |
|---|---|
| `scripts/visual-live/button-catalog.js` | source — frozen catalog |
| `scripts/visual-live/button-runner.js` | source — chromium matrix runner |
| `scripts/visual-button-live.js` | source — CLI entry |
| `tests/unit/visual-live.button-catalog.test.js` | test (23) |
| `tests/unit/visual-live.button-runner.test.js` | test (14) |
| `tests/unit/visual-button-live.cli.test.js` | test (10) |
| `tests/unit/visual-button-live.workflow.test.js` | test (9) |
| `docs/runbooks/visual-button-live.md` | docs — 10-section runbook |
| `docs/reports/2026-05-04-ui-p13-buttons-eval.md` | docs — this closeout |
| `.github/workflows/visual-button-live.yml` | CI — manual-dispatch workflow |
| `package.json` | dependency — `visual:button-live` script added |

---

## 5. Known limitations + follow-ups

### 5.1 UI-P13 round itself
- Single viewport (desktop-1366) — touch-only mobile buttons not covered. Future round can add `viewports` knob.
- `clickSafe: false` buttons get STATIC-only check. Their click semantics are verified by UI-H7-f / LV (live-verify-review-relay) rounds with separate evidence trails.
- "Activity" definition is intentionally permissive (any DOM mutation OR any network request). Future tightening: per-button expected activity match (e.g., "clicking Settings opens modal X with id Y").
- No focus-management verification (does click leave focus where users expect?). Could add to UI-P12 a11y catalog.

### 5.2 Out-of-scope (later rounds)
- UI-Doc-Gov — visual contract governance for all 4 manifest types (capture/assert/a11y/button)
- UI-FirstRun — first-run no-profile UX polish + welcome overlay buttons
- Fused workflow — single PR-gating workflow combining capture + assert + a11y + button
- Per-state button verification — verify buttons work after specific app state changes (e.g., "send-codex enables after start fires")

---

## 6. Sign-off

- ✅ All 4 sub-slices (P13-a/b/c/d) land in this round
- ✅ 57 new unit tests, 0 regression
- ✅ Operator runbook covers prerequisites → first-time setup → catalog reference → options → manifest schema → troubleshooting (including the dead-button case) → commit policy → CI integration → next-round connections
- ✅ CI freshness gates from UI-P9 + workflow shape contracts from UI-P10-d / P11-d / P12-d stay green
- ✅ Score 120/126 unchanged (UX integrity foundation; cap movement was UI-P12)

**Next round candidate**: UI-Doc-Gov — visual contract governance documentation. Define when to refresh visual:check baseline, what to look for in PR diff for assertion/a11y/button manifests, why not refresh-only. Distribution + reference guides reflect the new manifest types.

---

## 7. Reproduction

```bash
cd pipeline-dashboard

# One-time setup (shared with UI-P10/P11/P12)
npm run visual:install-browsers

# Standard button integrity check
npm run visual:button-live

# With label
node scripts/visual-button-live.js --label "regression-2026-05-04"

# CI manual dispatch
# GitHub UI → Actions → "UI-P13 Live Browser Button Integrity" → Run workflow
```

Verify exit semantics:
```bash
npm run visual:button-live; echo "exit: $?"
# 0  → all 13 buttons across 4 routes pass static + click-activity
# 1  → at least one button failed (manifest still written)
# 2  → CONFIG (browsers missing, port collision, server boot fail)
```
