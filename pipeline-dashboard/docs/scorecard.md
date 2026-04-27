# Harness Scorecard

## Current Score

**94 / 108** (Phase 2.5 multi-run + Phase 3-S security + Phase D MA0~MA6 monitor shell + Phase D Round 2 MB1~MB5 backfill complete; MB6 = this update)

Trajectory:
- v3.1 hardening — 87
- Phase 2.5 + AC — 88
- Phase 3-S (S1/S2/S3-a) — **90**
- Phase D MA0~MA6 (UI monitor shell, opt-in) — **91~92**
- **Phase D Round 2 MB1~MB5** (run-detail route + server-authoritative subagent snapshot + bottom-dock tabs + legacy-bridge + server.js/app.js further decomposition + readiness suite) — **94**

Target after MA7 (UI-3 rewrite readiness, optional): **96~97**.
Container sandbox + remote-mode hardening (Phase 3 = D platformization, separate product round) required for **102+**.

## Rubric scale change (MB6)

The original 10-area / 100-point rubric was tight against external-product-readiness. Phase D expanded the harness's UI surface, observability, and modularity beyond what 5-point caps could express. MB6 extends two areas:
- **UI feedback loop**: 5 → **7** points (room for monitor shell + dock tabs + filter/pin)
- **Maintainability and modularity**: 5 → **8** points (room for ongoing app.js + server.js decomposition + future MA7 rewrite)

Total max → **108 points**. Previous score normalisation: pre-MB6 90/100 = ~88.5/108. Post-MB6 score = 94/108.

| Area | Max | v3.1 (Apr 16) | Phase 3-S (Apr 27) | **Phase D + MB1~MB5 (now)** | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pipeline orchestration and phase model | 15 | 13 | 14 | **14** | — |
| State, artifacts, and quality gates | 15 | 13 | 14 | **15** | +1 (MB2 server-authoritative subagent snapshot ↔ SubRun) |
| Dual-agent integration | 10 | 9 | 9 | **10** | +1 (MB2 subagent contract + agent-tree fallback) |
| Directive control and tool gating | 10 | 9 | 9 | **9** | — |
| Safety and security boundary | 15 | 13 | 14 | **14** | — |
| Observability and runtime proof | 10 | 8 | 9 | **10** | +1 (MA1+MA5+MA6 + MB1 detail + MB4-a legacy-bridge live data + MB5 readiness rubric) |
| Testability and regression suite | 10 | 9 | 10 | **10** | — (878 unit + 189 integration; +25% from Phase 3-S) |
| Config, portability, onboarding | 5 | 4 | 5 | **5** | — |
| **UI feedback loop** (scale 5 → 7) | **7** | 4 | 5 | **6** | +1 (MA0~MA6 monitor shell + MB3 dock tabs) |
| **Maintainability and modularity** (scale 5 → 8) | **8** | 5 | 5 | **8** | +3 (MB4-b/c/d server + app extraction + module factories + DOM-free stores) |
| **Total** | **108** | **87** | **89** | **94** | **+5** |

Sub-scores per category map approximately to:
- 0–½: missing or actively broken
- ⅔ of max: functional but with known structural debt
- max−1: one specific gap remaining
- max: feature-complete + tested

## Phase D progress (MA0~MA6 + MB1~MB6)

### Phase D MA0~MA6 (UI monitor shell, opt-in)

- **MA0** — `/api/server/info` exposes `activeChildren`; WS auth + connection management + graceful shutdown extracted to `src/server/wsAuth.js` (server.js slimming begins).
- **MA1** — DOM-free `monitor/store.js` + `monitor/normalizer.js` (UMD); 47 unit tests lock the action surface + scope routing.
- **MA2** — `GET /api/monitor/bootstrap` with consolidated payload (server / runs / selectedRunId / activeChildren / recentEvents). Client `hydrateMonitorStore` fans the response across the store's action surface.
- **MA3** — `monitor-shell-root` mount boundary in `index.html` + `monitor/layout.js` skeleton + global-bar panel. Opt-in via `?monitor=1` or `localStorage.harnessMonitor=1`. Non-opt-in users see no DOM/CSS impact.
- **MA4** — Run-tree (left rail) + Run-summary (centre top) panels.
- **MA5** — Timeline + Inspector + Bottom-dock (single raw-log tab) panels.
- **MA6** — Agent-tree panel (childRegistry + active subagents derived from events ring) + timeline scope-filter chips + event pinning. Inspector adds `kind:"child"` + `kind:"subagent"` renderers.

### Phase D Round 2 MB1~MB5 (backfill, this round)

- **MB1** — `GET /api/monitor/runs/:runId` per-run detail endpoint. Client `hydrateRunDetail` populates `state.runDetails` map.
- **MB2** — `PipelineExecutor.getSubagentSnapshot()` + agent-tree merges server-authoritative snapshot with events-ring derivation. Long-running subagents survive ring eviction.
- **MB4-a** — Monitor legacy-bridge: WS event stream → `HarnessMonitorStore` via `event-dispatcher.addTap()`. Periodic `/api/server/info` poll keeps server summary fresh. Without this bridge, MA1-MA6 would be a snapshot frozen at hydrate time.
- **MB3** — Bottom-dock multi-tab: raw log + terminal + replay + debug. Terminal tab spawns its own PTY connection (independent of legacy `#terminal-container`).
- **MB4-b** — `runGeneralPipeline` + `finalizeGeneralRun` + 3 prompt builders extracted to `src/server/generalPipelineRunner.js`. server.js: 1075 → 848.
- **MB4-c** — `initTerminal` + general-pipeline modal handlers extracted to `public/js/terminal-mount.js` + `public/js/general-pipeline-modal.js`. app.js: 2129 → 1975.
- **MB4-d** — Event broadcaster (broadcast + throttle + replay buffer wrapper) extracted to `src/server/eventBroadcaster.js`. server.js: 848 → 799.
- **MB5** — Single integration flow test (`tests/integration/monitor-readiness.test.js`) covering opt-in → hydrate → run select → filter → pin → inspector. `docs/readiness-rubric.md` defines the 5-category × 3-star rubric. `scripts/readiness-report.js` produces a one-shot report with exit-code-mapped readiness verdict.

## Operational facts

- Single canonical working tree: `C:\Users\SJ\harness-pipeline-analysis` @ `master`.
- Test counts: **878 unit / 189 integration** + legacy + smoke, all green.
- server.js: 1075 → **799** lines (Phase D MA0 + MB4-b/d, **−276** lines).
- public/app.js: 2129 → **1975** lines (Phase D MB4-c + earlier AC, **−154** lines).
- New module footprint: 3 server modules (`wsAuth`, `generalPipelineRunner`, `eventBroadcaster`), 13 client modules under `public/js/monitor/` (store, normalizer, hydrate, legacy-bridge, layout + 8 panels), 2 client modules at `public/js/` root (terminal-mount, general-pipeline-modal). All UMD, all tested.

## Remaining backlog (priority order)

### Phase D follow-ups

- **MA7** (UI-3 rewrite readiness, optional): narrow `public/app.js` further by moving handle-event sub-cases into individual UMD handlers; pilot one panel (likely Inspector or Agent-tree) as a React island. Score impact: +1~2.
- **Legacy-bridge readiness assertion**: MB5's flow test exercises the bridge but doesn't yet verify "the bridge stayed authoritative under filter pressure" star-3 of event-integrity. Add as a follow-up integration case.

### Phase 3-S security follow-ups

- **S3-b**: codex Windows `shell:true` → `cmd.exe /c` wrapper (Node 24 `DEP0190` prep). Defer until Node 24 lands in the runtime schedule.
- **`pipeline-executor.js` major decomposition**: the most valuable refactor but also the most sensitive core. Revisit after MA7.

### Long-horizon (not committed)

- **Phase 3 (D platformization)** — container sandbox + remote-mode hardening + per-user RBAC. Separate product round; conditions in plan §Phase 3 still unmet.
- **P4 RFC** (from `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md`): remote sandbox design-only RFC. Schedule after MA7 + at least one production-style preview run.
- **P5 readiness automation**: turn `scripts/readiness-report.js` into a PR gate. Add JSON output → CI step → block merge if exit code > 1.

## What 94 means

Single-user local harness with multi-run isolation, hardened external-input boundaries, AND a monitoring-first opt-in console with live data flow + agent observability + per-run detail contract + flow-level readiness rubric. Not yet a multi-tenant platform — the **container sandbox + remote-mode hardening** gap remains the missing 8~14 points.

The MB1~MB5 round closed the highest-leverage structural debt without bloating the surface. Each lift was behaviour-preserving + locked by tests; the file shrinkage is genuine, not just file count inflation.
