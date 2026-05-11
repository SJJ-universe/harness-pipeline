# Remote Hook Execution Bridge Contract

- **Slice**: Phase D R2.5-a
- **Date**: 2026-04-28
- **Status**: Locked for R2.5 (extend with explicit code review only)
- **Code anchor**: [`src/runtime/remoteHookBridgeContract.js`](../src/runtime/remoteHookBridgeContract.js)
- **Threat model**: the runner's WS frame is untrusted input. The JWT
  verdict's `runId` + `hostIdentity` are authoritative; the frame
  body's `runId` or `hostIdentity` MUST NEVER be honored.

## 0. What this document is

This is the wire-format contract between the orchestrator and a
`orchestrator-runner` container. It pins:

- which **hook events** the runner is allowed to send through to the
  local executor,
- the **payload shape** for each one,
- which **executor method** receives the dispatch,
- the **bridge mode taxonomy** (off / report / dispatch),
- the **audit-chain verbs** every remote hook traverses.

R2 verified the orchestrator-side primitives + a single-runner
deployment. R2.5 adds the actual execution bridge — but only for the
narrow allowlist below. Everything outside the allowlist is **rejected
explicitly**, never silently passed.

## 1. Allowed hooks

| Hook event | Allowed in R2.5 | Why or why not |
| --- | :---: | --- |
| `PreToolUse` | yes | Pre-tool gate is reversible (executor evaluates, may block; no side-effects). |
| `PostToolUse` | yes | Post-tool result is observation-only; no further executor action. |
| `Stop` | yes | End-of-turn marker; no payload-driven side-effects beyond state transition. |
| `SubagentStart` | yes | Lifecycle event; updates `subRuns` map only. |
| `SubagentStop` | yes | Lifecycle event; updates `subRuns` map only. |
| `SessionStart` | **no (R3)** | Session-level mutations are too broad for the first bridge round. |
| `SessionEnd` | **no (R3)** | Same. |
| `Notification` | **no** | Operator-targeted, never executor-bound. |
| `PreCompact` | **no (R3+)** | Compaction is sensitive to write-side hooks. |

Anything not in `ALLOWED_HOOKS` triggers `runner_hook_rejected` with
reason `hook_not_allowed` and never touches the executor.

## 2. Tool allowlist (for `PreToolUse` / `PostToolUse`)

| Tool | Allowed in R2.5 | Why or why not |
| --- | :---: | --- |
| `Read` | yes | Read-only; pathSandbox + dangerGate already validate paths. |
| `Grep` | yes | Read-only. |
| `Glob` | yes | Read-only. |
| `Bash` | **no (R3+)** | Write side-effects + arbitrary command execution. Per-call approval flow needed. |
| `Write` | **no (R3+)** | Write side-effect on filesystem. |
| `Edit` | **no (R3+)** | Write side-effect. |
| `WebFetch` / `WebSearch` | **no (R3+)** | External egress; would defeat the network containment story. |
| `Task` (subagent spawn) | **no** | The runner can announce subagent lifecycle via `SubagentStart`/`SubagentStop`; spawning itself is local-orchestrator-only. |

Anything not in `ALLOWED_TOOLS` for an allowed hook triggers
`runner_hook_rejected` with reason `tool_not_allowed`.

## 3. Payload schemas

Every hook has a small allowlist of `data` keys; everything else is
dropped during sanitization (defensive copy). Some hooks have keys
that are **required** — missing them triggers `runner_hook_rejected`
with reason `data_required_missing`.

### `PreToolUse`

```jsonc
{
  "type": "hook",
  "event": {
    "hook": "PreToolUse",
    "tool": "Read",                     // required, must be in ALLOWED_TOOLS
    "data": {                           // optional
      "file_path": "/work/in/foo.txt",  // optional
      "path": "...",                    // optional (Glob)
      "pattern": "...",                 // optional (Grep)
      "glob": "...",                    // optional
      "limit": 100,                     // optional
      "offset": 0,                      // optional
      "head_limit": 50,                 // optional
      "type": "rust",                   // optional (Grep --type)
      "output_mode": "content",         // optional (Grep)
      "session_id": "..."               // optional
    }
  }
}
```

Allowed `data` keys: `file_path`, `path`, `pattern`, `glob`, `limit`,
`offset`, `head_limit`, `type`, `output_mode`, `session_id`.

Required `data` keys: none.

### `PostToolUse`

Same allowed keys as `PreToolUse`. Adds:

- `event.response` (optional object) — the result payload from the
  remote tool execution. **Capped at 4096 bytes** during
  sanitization; oversized responses trigger `response_oversize`.

### `Stop`

```jsonc
{
  "type": "hook",
  "event": {
    "hook": "Stop",
    "data": { "session_id": "..." }
  }
}
```

Allowed `data` keys: `session_id`. No `tool` field. No required keys.

### `SubagentStart`

```jsonc
{
  "type": "hook",
  "event": {
    "hook": "SubagentStart",
    "data": {
      "agent_id": "...",         // REQUIRED
      "parent_id": "...",        // optional
      "agent_type": "claude",    // optional
      "session_id": "..."        // optional
    }
  }
}
```

Allowed `data` keys: `agent_id`, `parent_id`, `agent_type`,
`session_id`. **`agent_id` is required.**

### `SubagentStop`

```jsonc
{
  "type": "hook",
  "event": {
    "hook": "SubagentStop",
    "data": {
      "agent_id": "...",         // REQUIRED
      "session_id": "..."        // optional
    }
  }
}
```

Allowed `data` keys: `agent_id`, `session_id`. **`agent_id` is required.**

## 4. Executor dispatch mapping

When `ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch`, the sanitized payload is
forwarded to the local executor's matching method:

| Hook | Executor method | Bound argument list (positional) |
| --- | --- | --- |
| `PreToolUse` | `executor.onPreTool(tool, input)` | `(tool, sanitizedData)` |
| `PostToolUse` | `executor.onPostTool(tool, response, input)` | `(tool, sanitizedResponse, sanitizedData)` |
| `Stop` | `executor.onStop(payload)` | `(sanitizedData)` |
| `SubagentStart` | `executor.onSubagentStart(payload)` | `(sanitizedData)` |
| `SubagentStop` | `executor.onSubagentStop(payload)` | `(sanitizedData)` |

The dispatch is `await`ed; the executor's return value (if any) is
not propagated back to the runner — runner hooks are fire-and-forget
under R2.5. R3 may add a return-value channel for tool-result
dispatch.

The executor selection follows the existing
`hookRouter._resolveExecutor(payload)` flow:

1. The orchestrator's `getOrCreateRun(verdictRunId)` is called with
   the **JWT verdict's `runId`**, not anything from the frame body.
2. If a matching pipeline run exists, its executor is the dispatch
   target.
3. If no matching run exists AND the orchestrator has headroom, a
   new pipeline run is lazily created. (R2.5-d uses this to make
   runner-claimed runs first-class in `/api/monitor/runs/:runId`.)
4. If neither orchestrator nor executor is wired, the bridge logs
   `runner_hook_dispatch_error` with `reason: "no_executor"` and
   continues — broadcast still happens.

## 5. Bridge mode taxonomy

`ORCHESTRATOR_REMOTE_BRIDGE_MODE` env value (parsed by `resolveBridgeMode`):

| Mode | Validation | Audit verbs emitted | Dispatch |
| --- | :---: | --- | :---: |
| `off` (default) | no | `runner_hook_routed` only (R1 behavior) | no |
| `report` | yes | `runner_hook_routed` + `runner_hook_rejected` OR `runner_hook_sanitized` | no |
| `dispatch` | yes | `runner_hook_routed` + `runner_hook_rejected` OR (`runner_hook_sanitized` + `runner_hook_dispatched` OR `runner_hook_dispatch_error`) | yes |

Operators promoting from "off" to "dispatch" should run a `report`
window first; the audit chain shows exactly what would have
dispatched without changing system behavior. The default is `off` so
upgrading to R2.5 introduces no behavior change for existing
deployments — the bridge is opt-in.

## 6. Audit chain verbs (terminal table)

Every accepted hook frame produces 1 to 4 entries in the audit
chain, in this order:

```
runner_hook_routed                     ← always (R1-k2 forensic anchor)
  └─ if mode != "off":
       ├─ runner_hook_rejected         ← terminal, validation failed
       └─ runner_hook_sanitized        ← validation passed
            └─ if mode == "dispatch":
                 ├─ runner_hook_dispatched         ← terminal, executor returned
                 └─ runner_hook_dispatch_error     ← terminal, executor threw
```

All entries carry the JWT verdict's `runId` + `hostIdentity` and the
hook's `hook` name. The `runner_hook_rejected` entry includes a
`reason` field from `REJECT_REASONS`. The `runner_hook_dispatched` /
`_dispatch_error` entries include the executor `method` name. None
of these entries ever include the full `event.data` payload — that's
in the broadcast event for live consumers; the audit chain stays
small + searchable.

## 7. Reject reasons (frozen vocabulary)

The validator is allowed to return only these reasons. Tests pin
the set so a future contributor adding a new path either reuses an
existing reason or extends `REJECT_REASONS`:

| Reason | Meaning |
| --- | --- |
| `hook_not_allowed` | `event.hook` not in `ALLOWED_HOOKS` |
| `hook_missing` | `event.hook` not a non-empty string |
| `tool_required_missing` | `PreToolUse`/`PostToolUse` without `event.tool` |
| `tool_not_allowed` | `event.tool` not in `ALLOWED_TOOLS` |
| `data_required_missing` | One of `dataKeysRequired` is absent in `event.data` |
| `data_invalid_type` | `event.data` is not an object |
| `response_oversize` | `PostToolUse` response exceeds `responseMaxBytes` |
| `frame_malformed` | Top-level frame shape is wrong (e.g. missing `event`) |

## 8. Out of scope (R3+ work)

- **Per-call approval for write tools** — Bash / Write / Edit need a
  flow where the orchestrator can prompt the operator (or a policy
  engine) before dispatching. Possibly a `/api/runner/approval`
  channel.
- **Tool-result return path** — runner hooks are fire-and-forget under
  R2.5. R3 may add an `executor → runner` reply path so the runner
  can short-circuit a tool call based on the orchestrator's verdict.
- **Session-level hooks** — `SessionStart` / `SessionEnd` need a
  separate design pass; their semantics overlap with the runner's
  own connection lifecycle (`runner_ws_connected` /
  `runner_ws_disconnected`) and the duplicated state needs an
  authoritative reconciler.
- **`PreCompact` semantics** — coordinating compaction across local
  and remote agents needs a leader-election story.

## 9. Operator notes

- The bridge is **off by default**. Existing R1/R2 deployments
  upgrade to R2.5 with no behavior change.
- Promotion path: `off` → `report` (24-48 hours of observation, look
  at `runner_hook_rejected` reasons in `/app/runs/<runId>/ledger.jsonl`)
  → `dispatch`.
- Rolling back from `dispatch` to `off` is safe — the bridge has no
  persistent state of its own; it's a translation layer.
- The audit chain is the source of truth. If a hook seems to have
  been dropped, look for the matching `runner_hook_rejected`
  entry; the reason field will explain.

## 10. Sources

- [`src/runtime/remoteHookBridgeContract.js`](../src/runtime/remoteHookBridgeContract.js)
  — code-side contract.
- [`tests/unit/remoteHookBridgeContract.test.js`](../tests/unit/remoteHookBridgeContract.test.js)
  — lint locking the contract shape.
- [`docs/superpowers/specs/2026-04-27-five-priority-roadmap.md`](./superpowers/specs/2026-04-27-five-priority-roadmap.md)
  P3-D — partial design pre-cursor.
- [`docs/remote-sandbox-rfc.md`](./remote-sandbox-rfc.md) §3 + §4 —
  trust boundary and rollout gates context.
- [`docs/reports/2026-04-28-r2-single-runner-eval.md`](./reports/2026-04-28-r2-single-runner-eval.md)
  §3 known-gap "Remote hooks are broadcast-only, not executed" — the
  exact gap R2.5 closes.
