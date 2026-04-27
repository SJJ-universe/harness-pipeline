# Harness Architecture

## Runtime Shape

The dashboard is a local-first harness. `server.js` still owns process bootstrapping and WebSocket wiring, but post-Phase-2.5 / Phase-3-S the pipeline domain runs through an orchestrator over a per-run executor map, and security/lifecycle layers each live in their own module.

| Layer | Owner module | Responsibility |
|---|---|---|
| Process entry | `server.js` | listen host, route mounting, WS upgrade gate, graceful shutdown |
| Pipeline domain | `executor/pipeline-orchestrator.js` + `executor/pipeline-executor.js` | `Map<runId, PipelineExecutor>` with per-run state + checkpoint |
| Hook routing | `executor/hook-router.js` | session_id / agent_id → runId; SubRun lifecycle |
| Runners | `executor/codex-runner.js`, `executor/claude-runner.js` | spawn + concurrency gate + lifecycle registry |
| Security | `src/security/auth.js`, `src/security/pathSandbox.js`, `src/security/requestSchemas.js` | token + origin + path + schema |
| Runtime services | `src/runtime/{childSemaphore,childRegistry,eventReplayBuffer,fileConflictDetector,contextUsage,evidenceLedger,replay,runRegistry}.js` | concurrency, lifecycle, replay, conflicts, telemetry |
| Policy | `src/policy/dangerGate.js` + `policies/default-policy.json` | phase allowlists, danger-command blocklist |
| Routes | `src/routes/*.js` | thin Express routers per domain |
| Front | `public/app.js` + `public/js/*` (UMD modules) | dashboard, run tabs, run-id filter, horse, formatters |

## Multi-run model (Phase 2.5)

`PipelineOrchestrator` owns a `Map<runId, PipelineExecutor>` with `maxConcurrent = HARNESS_MAX_RUNS` (default 3, set 1 for legacy single-active behaviour). Every executor receives:

- its own `PipelineState` instance — findings / metrics / phase metadata cannot bleed across runs
- its own `checkpointStore` — runId `"default"` keeps the legacy `.harness/pipeline-checkpoint.json` path (zero migration); other runIds use `.harness/runs/{runId}/checkpoint.json`
- a shared `fileConflictDetector` — `recordEdit` from `hook-router`, `clear(runId)` from `_complete` / `resetActive` / orchestrator `remove`
- a shared `childSemaphore` (concurrency gate) and `childRegistry` (lifecycle tracking)
- a `broadcast` wrapper that auto-tags every event with `data.runId`

The hook router resolves an incoming payload to a runId (`session_id` → `agent_id` → `"default"`) and delegates to `orchestrator.getOrCreateRun(runId)`. The dashboard's `HarnessRunTabBar` surfaces every observed runId; `HarnessRunIdFilter` drops events whose runId differs from the focused tab; the WS `replay_request({ runId, includeGlobal })` round-trip re-hydrates a tab without re-firing past global events.

## Security layer (Phase 3-S)

- **Loopback default** — `HARNESS_HOST=127.0.0.1`. `HARNESS_ALLOW_REMOTE=1` opens the door but `requireTrustedOrigin` still rejects non-loopback remote addresses unless explicitly enabled.
- **Token gate** — `HARNESS_TOKEN` (env or `.harness/local-token`, mode 0o600). State-changing HTTP methods plus non-loopback WebSocket upgrades require it; loopback bypasses for frictionless local dev.
- **WS upgrade auth** — `verifyWsConnection` in `server.js` covers BOTH `/terminal` and pipeline event WebSockets, applying the same loopback / token / origin policy.
- **Path sandbox** — `pathSandbox.resolveInsideRoot` runs realpath + symlink resolution + Windows-only case-insensitive containment double-check. Used by `/api/context/*`, `getSkillContent`, and the per-run checkpoint paths.
- **Schema slug enforcement** — `validateCodexTrigger.triggerId` matches `^[a-zA-Z0-9._-]+$` so the value cannot become a path-traversal payload when interpolated into `codex-trigger-${triggerId}-${ts}.md`.
- **Danger gate** — destructive shell patterns + dangerous agent permission flags + repo-root escapes + Phase A non-read-only Bash all blocked before tool execution.

## Child-process lifecycle (Phase 2.5 N + Phase 3-S S3-a)

- `childSemaphore` (max `HARNESS_CHILD_MAX`, default 2) gates concurrent Codex/Claude spawns. Acquire/release/timeout broadcasts as `child_queue_depth`.
- `childRegistry` registers each spawn (`child_registered` broadcast) and unregisters on `close`/`error` (`child_unregistered`). `gracefulShutdown` sends `SIGTERM` to every active child, waits 1s, then `SIGKILL`s holdouts before `process.exit(0)`. No more orphaned 120s+ Codex critique processes.

## Phase Policy

The default template starts with Phase A as read-only discovery. Phase A allows `Read`, `Glob`, `Grep`, `Agent`, and `TodoWrite`; arbitrary `Bash` is denied except a small read-only prefix list. Dangerous commands (recursive delete, hard reset, checkout overwrite, dangerous agent permission flags, repo-root escapes) are blocked before tool execution by the danger gate.

## Hook Flow

Claude hook commands call `hooks/harness-hook.js`, which posts to `/api/hook` with the `x-harness-token` header and the configured `HARNESS_HOST` / `HARNESS_PORT`. `HookRouter` records stats, optionally samples payloads under `HARNESS_SAMPLE_HOOKS=1`, extracts context usage, and delegates phase events to the orchestrator-resolved `PipelineExecutor`. SubagentStart/Stop hooks open a `SubRun` inside the active run for per-agent tool / metric tracking.

`SessionWatcher` starts only when the server starts listening and stops when the server closes — prevents tests and imported modules from leaking watcher intervals.

## Evidence

`RunRegistry` writes `runs/<runId>/manifest.json` for agent runs (run id, kind, start/completion times, input hash, policy decision, event list, exit code, output hashes). `evidenceLedger` is a tamper-evident JSONL hash chain. Together they form the foundation for replay mode (`src/runtime/replay.js`) and the planned audit-ledger work.

## Operational diagnostics

Run `pwsh -File scripts/env-check.ps1` for a single-call snapshot: cwd, every known working tree's branch / HEAD / local-vs-remote SHA / fetch refspec / untracked count / sync verdict, plus the six canonical meta-file locations (repo `CLAUDE.md`, repo `.claude/`, workspace `CLAUDE.md`, user plans dir, current Phase plan, user `MEMORY.md`). Read-only — never fetches, pulls, commits, or pushes.
