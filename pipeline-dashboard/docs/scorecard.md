# Harness Scorecard

## Current Score

**90/100** (Phase 2.5 multi-run isolation + Phase 3-S security re-implementation complete, S3-b deferred)

Trajectory: v3.1 hardening = 87 → Phase 2.5 multi-run + AC = 88 → Phase 3-S (S1/S2/S3-a) = **90**.

Target after follow-up rounds (server.js slimming + child observability + app.js decomposition): **92~93/100**. Container sandbox + remote-mode hardening required for **95+**.

## Rubric (rated against the project's own ambitions, not external multi-tenant readiness)

| Area | Points | v3.1 (Apr 16) | Now (Apr 27) | Change |
| --- | ---: | ---: | ---: | ---: |
| Pipeline orchestration and phase model | 15 | 13 | **14** | +1 (PipelineOrchestrator + per-run state) |
| State, artifacts, and quality gates | 15 | 13 | **14** | +1 (per-run PipelineState, memory caps, TDD Stage 2) |
| Dual-agent integration | 10 | 9 | **9** | — (SubRun model added but no rubric uplift) |
| Directive control and tool gating | 10 | 9 | **9** | — |
| Safety and security boundary | 15 | 13 | **14** | +1 (S1 WS guard / S2 sandbox / S3-a registry) |
| Observability and runtime proof | 10 | 8 | **9** | +1 (childRegistry + multi-run filter + env-check) |
| Testability and regression suite | 10 | 9 | **10** | +1 (570 unit + 156 integration) |
| Config, portability, onboarding | 5 | 4 | **5** | +1 (`.env.example`, `scripts/env-check.ps1`) |
| UI feedback loop | 5 | 4 | **5** | +1 (run tabs + AA-1/AA-2 filter, AC modules) |
| Maintainability and modularity | 5 | 5 | **5** | — (AC split nudged in the right direction) |

## Implemented since v3.1

### Phase 2.5 — multi-run isolation + AC split
- `PipelineOrchestrator` + `Map<runId, PipelineExecutor>` (Slice S)
- Per-run `PipelineState` and `checkpointStore` injection (Slices Y + Z) — default runId keeps the legacy `.harness/pipeline-checkpoint.json` path so single-run users need no migration
- Run-scoped DOM filter via `public/js/run-id-filter.js` (AA-1) and run-scoped replay with `eventReplayBuffer.snapshot({ runId, includeGlobal })` + WS `replay_request` handler (AA-2)
- `fileConflictDetector.clear(runId)` wired into `pipeline_complete` / `resetActive` / orchestrator `remove()` (AD)
- Hook-decision adapter scope audit + carve-out comments for UserPromptSubmit / Stop (AB)
- A0 default `HARNESS_MAX_RUNS=1` hot-fix during the round, rolled back to 3 after Y/Z/AA/AD landed
- AC: `public/js/horse-animation.js` and `public/js/formatters.js` extracted from `public/app.js` (2311 → 2129 lines)
- `scripts/env-check.ps1` for one-call cwd / git-state / meta-file diagnostics

### Phase 3-S — security re-implementation (3 active slices)
- **S1**: `verifyWsConnection` gate inside `wss.on("connection")` so the pipeline event WebSocket follows the same loopback / token / origin policy as the terminal WS. New `.env.example` documenting every `HARNESS_*` env var. `tests/unit/auth.test.js` (17 cases) locks the existing `src/security/auth.js` contract.
- **S2**: `pathSandbox.assertInsideRoot` Windows-only case-insensitive double-check; `validateCodexTrigger.triggerId` enforced to the `^[a-zA-Z0-9._-]+$` slug regex; `skill-registry.getSkillContent` migrated to `pathSandbox.resolveInsideRoot` (slug regex retained as the first defense layer).
- **S3-a**: `src/runtime/childRegistry.js` tracks every spawn; `claude-runner` / `codex-runner` register on spawn and unregister on close/error; `gracefulShutdown` now sends `SIGTERM`, waits 1s, then `SIGKILL`s holdouts before `process.exit(0)`.

## Operational facts

- Single canonical working tree: `C:\Users\SJ\harness-pipeline-analysis` @ `master`.
- workspace contents archived to `C:\Users\SJ\archive\workspace-2026-04-27\` (read-only reference). bundle + GitHub `backup/workspace-pre-cleanup-2026-04-27` branch are the second and third safety nets.
- Test counts: **570 unit / 156 integration** + legacy + smoke, all green.
- PowerShell `$PROFILE` permanently sets UTF-8 console encoding so Korean docs / `git log` render correctly.

## Remaining backlog (priority order)

### Next slice (small ops first, then meaningful work)
1. server.js slimming + child observability — extract WS auth/connection management, graceful shutdown, and childRegistry wiring into `src/server/*`; expose `activeChildren` snapshot on `/api/server/info` so S3-a's runtime safety becomes operationally visible.
2. `public/app.js` decomposition — peel `handleEvent` switch, terminal connection, server-control buttons, and replay/tab logic into `public/js/*` (next to the existing `event-dispatcher.js` and `api-client.js`).

### Held back on purpose
- **S3-b** (codex Windows `shell:true` → `cmd.exe /c` wrapper, Node 24 DEP0190 prep): defer until Node 24 lands in the actual runtime schedule — the spawn-behavior change has too wide a regression surface for premature rollout.
- **`pipeline-executor.js` major decomposition**: the most valuable refactor but also the most sensitive core; revisit after the security round's stability has settled.

### Long-horizon (not committed)
- Container sandbox for remote / team execution (`docs/container-sandbox.md`)
- `runGeneralPipeline()` to hook-driven execution
- Audit ledger signed append-only manifests

## What 90 means

A single user can run the harness locally with multi-run isolation that is now structurally correct (Phase 2.5), with hardened external-input boundaries (Phase 3-S), and with both the canonical and the archived workspace observable from a single 12-line PowerShell call. It is not yet a multi-tenant platform — the **container sandbox + remote-mode hardening** gap is the missing 5~10 points.
