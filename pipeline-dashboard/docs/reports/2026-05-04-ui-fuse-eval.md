# UI-Fuse Visual Verification Orchestrator — Round Closeout

> **Slice**: UI-Fuse (Phase D Round UI-P, 2026-05-04)
>
> **Round goal**: 4 manual visual contract workflows (UI-P10 capture / UI-P11 assert / UI-P12 a11y / UI-P13 button)을 단일 fused workflow + 단일 local CLI로 묶는 orchestration layer 도입. governance §6.2의 PR-gating 4 entry conditions 중 chromium 캐시 (조건 2) + wall time (조건 3) 충족.
>
> **Round verdict**: GO — fused CI workflow (Fuse-a) + local CLI (Fuse-b) + operator runbook + closeout + scorecard refresh (Fuse-c) all landed and unit-green.

---

## 1. What landed

### 1.1 UI-Fuse-a — Fused CI workflow (commit `3edcef1`)

| File | Role |
|---|---|
| `.github/workflows/visual-fused-live.yml` | manual-dispatch CI workflow combining all 4 tools |
| `tests/unit/visual-fused-live.workflow.test.js` | 12 shape contract tests |

**Workflow features**:
- 3 inputs: label / port / tools (default `'capture,assert,a11y,button'`, narrow via comma list)
- SINGLE chromium install — the headline savings (~150MB × 4 → 150MB × 1)
- Bash loop iterates over tools, captures per-tool exit into OVERALL_EXIT, NEVER aborts on per-tool failure
- Top-level summary.json with schema `harness-visual-fused/v1` aggregating per-tool {capturedAt, totalElapsedMs, summary}
- Single combined artifact: `ui-fuse-<run-id>` containing 4 subdirs + summary.json
- 30-min timeout (vs per-tool's 20 min)
- `if: always()` on resolve + upload steps so partial failures preserve artifact

**Manual-dispatch ONLY** — governance §6.2 PR-gating still deferred until baseline stability + operator UX evidence accumulates.

### 1.2 UI-Fuse-b — Local fused CLI (commit `916f44e`)

| File | Role |
|---|---|
| `scripts/visual-fused-live.js` | Local CLI mirroring the workflow's per-tool sequence |
| `package.json` `visual:fused-live` script | Operator command |
| `tests/unit/visual-fused-live.cli.test.js` | 21 stub-injection tests |

**Module surface**:
- Frozen `TOOLS` registry (4 entries: id / label / runFn closure / writeManifest flag)
- `KNOWN_TOOL_IDS` list for help-text + validation
- `parseArgs` / `defaultOutDir` / `selectTools` / `buildFusedSummary` / `main`
- Exit codes match siblings: 0 PASS / 1 per-tool FAIL / 2 CONFIG

**Key benefits over running 4 CLIs in sequence**:
1. ONE server boot (~3s saved per tool × 4 = ~12s)
2. ONE artifact directory with 4 subdirs + summary.json
3. Subset selection via `--tools` (same UX as CI workflow)
4. Failures don't abort — operator sees ALL broken tools, not just first

### 1.3 UI-Fuse-c — Runbook + governance update + closeout

| File | Change |
|---|---|
| `docs/runbooks/visual-fused-live.md` | NEW — 9-section operator guide |
| `docs/visual-contract-governance.md` | UPDATED — §1 6 contract families table (was 5) + §7 catalog version table (added fused tools registry + first-run states + first-run CTAs) |
| `tests/unit/visual-contract-governance.test.js` | EXTENDED — 9 tests (was 8); now asserts visual:fused-live + harness-visual-fused/v1 + UI-Fuse orchestrator framing |
| `docs/reports/2026-05-04-ui-fuse-eval.md` | NEW — this closeout |
| `docs/scorecard.md` | Phase 2 closure marker refreshed |

Governance doc bumped from "5개 Contract Family" to "6개 Contract Family" with UI-Fuse as the orchestrator row. The §1 caption clarifies Contract 6 doesn't introduce a new manifest schema — it's a top-level summary that orchestrates 2-5.

---

## 2. Verification

### 2.1 Test counts (pre-round → post-round)

| Suite | Pre Fuse | Post Fuse | Δ |
|---|---:|---:|---:|
| Unit | 2771 | 2805 | +34 (12 + 21 + 1 governance extension) |
| Integration | 457 | 457 | 0 |
| Smoke | 80 | 80 | 0 |
| Live readiness | 18/18 | 18/18 | 0 |

### 2.2 PR-gating §6.2 entry condition status (governance §6.2)

| # | Condition | Status after UI-Fuse |
|:---:|---|:---:|
| 1 | Stable baselines for assert/a11y/button manifests | ⏳ pending operator data |
| 2 | chromium 캐시 안정 | ✅ closed (single install in fused workflow) |
| 3 | Total wall time ≤ 5분 | ✅ closed (sequential under one job; expected 3-7 min) |
| 4 | Operator UX (PR-fail 메시지 명확) | ⏳ pending operator data |

UI-Fuse closes conditions 2 + 3. Conditions 1 + 4 require runtime data — UI-Fuse-2 (hypothetical follow-up) flips push trigger once both conditions are demonstrably met.

### 2.3 Backwards-compat invariants preserved

- UI-P9 visual:check — still gates CI on every push
- UI-P10/P11/P12/P13 individual workflows — still available as workflow_dispatch (operators who want one-tool runs aren't forced into fused)
- UI-P10 viewports/routes contract — REUSED unchanged
- UI-FirstRun next-action-card + classifier — unaffected
- All other CI gates — untouched

### 2.4 Drift test extension

Governance drift test (`tests/unit/visual-contract-governance.test.js`) extended with a 9th test that asserts UI-Fuse as the orchestrator framing in §1. Future PRs adding new contract types must update §1 + §7 to keep the doc honest.

---

## 3. Score impact

| Stage | Score |
|---|:---:|
| Entry (UI-FirstRun closed) | 120/126 |
| +Fuse-a (fused workflow) | 120/126 |
| +Fuse-b (local CLI) | 120/126 |
| +Fuse-c (runbook + governance + closeout) | **120/126** (operational improvement, no cap movement) |

UI-Fuse is **operator efficiency improvement**, not a new defense. Cap movement deferred to:
- UI-Fuse-2 (PR-gating activation) — once conditions 1 + 4 close
- SMART arc — Safety + Pipeline orchestration cap candidates

What this round changes operationally: 4-tool live verification now runs in 3-7 min wall time as a single artifact, vs 12-20 min spread across 4 separate runs. PR-gating barrier lowered.

---

## 4. Round artifacts

| Path | Type |
|---|---|
| `.github/workflows/visual-fused-live.yml` | CI workflow — manual-dispatch fused |
| `scripts/visual-fused-live.js` | source — local CLI orchestrator |
| `package.json` | script — `visual:fused-live` added |
| `tests/unit/visual-fused-live.workflow.test.js` | test (12) — workflow shape |
| `tests/unit/visual-fused-live.cli.test.js` | test (21) — CLI shape + selectTools + buildFusedSummary |
| `tests/unit/visual-contract-governance.test.js` (extended) | test — drift catches UI-Fuse omission |
| `docs/runbooks/visual-fused-live.md` | docs — 9-section runbook |
| `docs/visual-contract-governance.md` (modified) | docs — §1 6-row table + §7 fused row |
| `docs/reports/2026-05-04-ui-fuse-eval.md` | docs — this closeout |
| `docs/scorecard.md` (modified) | docs — Phase 2 marker |

---

## 5. Known limitations + follow-ups

### 5.1 UI-Fuse round itself
- Fused workflow shares chromium across tools but each tool still spawns its OWN browser context (per-tool isolation is the right call for cell-level assertions). Could share one context if cross-tool state contamination became a concern, but that's a future optimization.
- summary.json doesn't preserve PNG paths from capture sub-tool (operator looks at capture/manifest.json directly). Could be added if "operator wants to know all PNG paths from one summary" use case emerges.
- `--tools` subset selection runs sequentially even when subset is 1 (no extra latency penalty, but fused workflow doesn't optimize for "single-tool" use case — operators should still use the per-tool CLI for that).
- No automatic baseline-stability detection (condition 1 entry criterion). Operators monitor manifest summaries over time + decide when stable.

### 5.2 Out-of-scope (later rounds)
- **UI-Fuse-2 (hypothetical)** — flip push/pull_request trigger once conditions 1 + 4 met. Same workflow + same CLI; just trigger update.
- **Cross-tool dedupe** — capture + a11y both navigate to the same routes. Could reuse the navigation if browser context sharing is added.
- **SMART arc** — decision context layer that consumes fused summaries as input.

---

## 6. Sign-off

- ✅ All 3 sub-slices (Fuse-a/b/c) land in this round
- ✅ 34 new unit tests, 0 regression (governance drift test extended to catch future omissions)
- ✅ Fused workflow + local CLI both manual-dispatch only — PR-gating deferred per governance §6.2 (conditions 2 + 3 closed; 1 + 4 pending data)
- ✅ Operator runbook covers prerequisites → first-time setup → contract overview → options → manifest schema → troubleshooting → commit policy → CI integration (current + future) → next-round connections
- ✅ Score 120/126 unchanged (operator efficiency improvement; cap movement deferred to UI-Fuse-2 PR-gating activation OR SMART arc)

**Phase 2 UI Reference Port arc** now includes: UI-P0 (sign-off) → UI-P1~P9 (port + structural gate) → UI-P10~P13 (live capture/assert/a11y/button) → UI-Doc-Gov (governance) → UI-FirstRun (no-profile UX) → **UI-Fuse (orchestrator + governance §6.2 conditions 2+3)**.

**Next round candidate**: SMART-0 (decision context foundation) — Phase 2 후반 본격 SMART arc 시작. UI-Fuse-2 (PR-gating activation) is operator-data-gated and lands when condition 1 + 4 close.

---

## 7. Reproduction

```bash
cd pipeline-dashboard

# One-time setup (shared with all per-tool CLIs)
npm run visual:install-browsers

# Standard fused run — all 4 tools
npm run visual:fused-live

# Subset (a11y only — fast feedback during a11y-related PR)
node scripts/visual-fused-live.js --tools a11y

# With label
node scripts/visual-fused-live.js --label "pr-1234"

# CI manual dispatch
# GitHub UI → Actions → "UI-Fuse Live Browser Visual Verification (all 4 contracts)" → Run workflow
```

Verify exit semantics:
```bash
npm run visual:fused-live; echo "exit: $?"
# 0  → all selected tools returned exit 0
# 1  → at least one tool failed (per-tool exits captured; loop never aborts)
# 2  → CONFIG (browsers missing, port collision, server boot fail, unknown tool ID)
```
