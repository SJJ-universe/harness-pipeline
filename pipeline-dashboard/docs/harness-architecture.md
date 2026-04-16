# Harness Architecture

## Runtime Shape

The dashboard is a local-first harness. `server.js` still owns process bootstrapping, WebSocket wiring, and legacy route compatibility, while new first-class modules own security, policy, and evidence:

- `src/security/*`: token auth, origin checks, request schema validation, path sandboxing
- `src/policy/*`: phase allowlists and danger gate decisions
- `src/runtime/*`: runtime version proof, run manifests, context usage alarms
- `executor/*`: hook routing, phase executor, Claude/Codex runners

## Phase Policy

The default template starts with Phase A as read-only discovery. Phase A allows `Read`, `Glob`, `Grep`, `Agent`, and `TodoWrite`; it does not allow arbitrary `Bash`.

Dangerous commands are blocked before tool execution. Examples include recursive delete, hard reset, checkout overwrite, dangerous agent permission flags, and commands that escape the repo root.

## Hook Flow

Claude hook commands call `hooks/harness-hook.js`, which posts to `/api/hook` with `x-harness-token`. `HookRouter` records stats, optionally samples payloads, extracts context usage, and delegates phase events to `PipelineExecutor`.

`SessionWatcher` starts only when the server starts listening and stops when the server closes. This prevents tests and imported modules from leaking watcher intervals.

## Evidence

`RunRegistry` writes `runs/<runId>/manifest.json` for agent runs. Manifests include:

- run id and kind
- start/completion time
- input hash
- policy decision
- event list
- exit code and output hashes

This is the first layer of the evidence ledger needed for replay mode.
