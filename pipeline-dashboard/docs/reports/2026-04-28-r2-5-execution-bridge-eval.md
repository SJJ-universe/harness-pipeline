# R2.5 — Remote execution bridge evaluation

- **Date**: 2026-04-28
- **Round**: Phase D R2.5 (controlled execution bridge for remote hooks)
- **Scope**: hooks emitted by the remote runner now reach the local
  executor under an explicit feature flag, through an allowlist +
  sanitization + full-narrative audit chain. Read-only tools only;
  Bash / Write / Edit deferred to R3 per-call approval.
- **Author**: harness-pipeline-analysis maintainer + AI pair
- **Verdict**: **GO** for R3 multi-runner pool + Linux host. R2.5
  closes R2's "G4 partial" gap with G4 full PASS verified live.

## 0. Verdict at a glance

| Concern | R2 verdict | R2.5 verdict | Evidence |
| --- | :---: | :---: | --- |
| G4 hook ingress auth — auth/audit | PASS | PASS (preserved) | r2-monitor-probe.sh |
| G4 hook ingress auth — dispatch | partial | **PASS** | r2-5-bridge-probe.sh anchor 1 |
| Allowlist enforcement (Bash blocked) | n/a | **PASS** | r2-5-bridge-probe.sh anchor 2 |
| Audit-chain narrative (sanitized→dispatched) | n/a | **PASS** | r2-5-bridge-probe.sh anchor 3 |
| Bridge throughput counters (`hookStats`) | n/a | **PASS** | r2-5-bridge-probe.sh anchor 4 |
| Run visibility — runner-claimed run 200 | known-gap 404 | **PASS** | r2-5-bridge-probe.sh anchor 5 |

R2 closed the orchestrator-side trust boundary for remote runners
but stopped short of letting remote hooks drive the local executor
(report-only). R2.5 adds the controlled execution bridge with three
strong safeguards baked in:

1. **Feature flag — opt-in promotion path.**
   `ORCHESTRATOR_REMOTE_BRIDGE_MODE` env: `off` (default) → `report`
   (validation runs, no dispatch) → `dispatch` (full bridge). Existing
   R1/R2 deployments upgrade with no behavior change.
2. **Audit ledger with five verbs.** Every accepted hook produces 1
   to 4 entries: `runner_hook_routed` → `runner_hook_rejected | _sanitized`
   → `runner_hook_dispatched | _dispatch_error`. Operators can
   reconstruct exactly what the bridge did to every frame.
3. **Allowlist-only execution.** Five hooks in scope (`PreToolUse` /
   `PostToolUse` / `Stop` / `SubagentStart` / `SubagentStop`); three
   read-only tools allowed in the Pre/Post paths (Read / Grep / Glob).
   Bash / Write / Edit are explicitly out of scope. Anything else
   is rejected at the contract layer with a frozen-vocabulary
   `reason` field.

## 1. Reproduction

```bash
cd C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard

# 1. Operator secrets (NEVER committed; .env.r2 is .gitignored).
cp .env.r2.example .env.r2
# Edit .env.r2 — set ORCHESTRATOR_TOKEN + RUNNER_BOOTSTRAP_TOKEN to fresh
# 32-byte hex strings.

# 2. Bring up with bridge dispatch enabled (R2.5-c terminal mode).
./scripts/r2-down.sh --clean
ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch ./scripts/r2-up.sh

# 3. Run the live bridge probe.
./scripts/r2-5-bridge-probe.sh
# expected: 5/5 PASS — G4 dispatch leg verified live.

# 4. Inspect the audit chain narrative for one accepted hook.
MSYS_NO_PATHCONV=1 docker exec harness-orchestrator-r2 \
  sh -c 'cat /app/runs/rr-r2-eval-001/ledger.jsonl | grep -E "(routed|sanitized|dispatched)" | head -10'
# Expected sequence per accepted PreToolUse Read:
#   "type":"runner_hook_routed"
#   "type":"runner_hook_sanitized"
#   "type":"runner_hook_dispatched","method":"onPreTool"

# 5. Inspect dispatch counters.
MSYS_NO_PATHCONV=1 docker exec harness-orchestrator-r2 \
  node -e 'require("http").get("http://127.0.0.1:4201/api/server/info",
    {headers:{"x-harness-token":process.env.ORCHESTRATOR_TOKEN}},r=>{
      let b="";r.on("data",c=>b+=c);r.on("end",()=>console.log(JSON.parse(b).hookStats));
  })'
# Expected: { remoteHookDispatched: 1, remoteHookRejected: 1, ... }

# 6. Tear down.
./scripts/r2-down.sh --clean
```

Wall-clock from `r2-up` to `r2-5-bridge-probe` PASS: ~25s on the
maintainer's Docker Desktop. The bridge probe itself runs in ~3s.

## 2. Per-anchor detail

### Anchor 1 — `runner_hook_dispatched` with `method=onPreTool`

The runner sends `{hook: PreToolUse, tool: Read, data: {file_path, limit}}`.
The orchestrator sanitizer (R2.5-b) accepts it; the dispatcher
(R2.5-c) resolves the executor via `orchestrator.getOrCreateRun(verdict.runId)`
(creating a pipeline run if one doesn't exist, see Anchor 5);
binds `tool="Read"` + `_data={file_path, limit}` per the
`EXECUTOR_DISPATCH.PreToolUse.args` contract; awaits
`executor.onPreTool("Read", {file_path, limit})`. The executor
returns `{}` (inactive pipeline; no danger-gate decision). The
audit chain entry lands with `method:"onPreTool"`, proving the
contract binding correctly resolves the executor method.

### Anchor 2 — `runner_hook_rejected` with `reason=tool_not_allowed`

The runner sends a second frame: `{hook: PreToolUse, tool: Bash,
data: {command: "rm -rf /"}}`. The sanitizer (R2.5-b) checks
`tool=Bash` against `ALLOWED_TOOLS = ["Read", "Grep", "Glob"]`,
fails, returns `{ok:false, reason:"tool_not_allowed"}`. The audit
entry persists the frozen-vocabulary reason; no executor method is
called (verified by the `runner_hook_dispatched` count remaining
at 1 after both frames — see Anchor 4).

### Anchor 3 — `runner_hook_sanitized` (dispatch precondition)

Per the bridge contract, `runner_hook_sanitized` MUST appear before
`runner_hook_dispatched`. Both verbs being present together (and
specifically not after `runner_hook_rejected`) proves R2.5-c emits
the full narrative rather than collapsing the verbs. Operators
reading the audit chain see "sanitization happened, then dispatch
happened" rather than just "dispatch happened" — which matters
when something downstream throws and we need to know how far the
frame got.

### Anchor 4 — `HookRouter.stats.remoteHookDispatched ≥ 1`

`/api/server/info` (R2.5-e exposes `hookStats` via
`createServerControlRoutes`) returns:

```json
"hookStats": {
  "total": 2,
  "byEvent": { "PreToolUse": 2 },
  "remoteHooks": 2,
  "remoteHookSanitized": 1,
  "remoteHookRejected": 1,
  "remoteHookDispatched": 1,
  "remoteHookDispatchError": 0
}
```

Two hooks ingressed; one was sanitized + dispatched; one was
rejected. The counters mirror the audit chain's narrative without
requiring the operator to grep JSONL. Throwing-handler guard:
`/api/server/info` defaults `hookStats` to `{}` if `getStats()`
itself raises — preserving the never-break-info-endpoint invariant.

### Anchor 5 — `/api/monitor/runs/<verdict.runId>` returns 200

Pre-R2.5: 404 (R2 closeout report's known-gap §3). Post-R2.5,
ANY of the following make the route succeed for a runner-claimed
runId:

- **Path A (R2.5-c)**: `bridgeMode=dispatch` with at least one
  accepted hook → `_resolveExecutorByRunId(runId)` calls
  `orchestrator.getOrCreateRun(runId)` → the orchestrator gains a
  pipeline run for that runId → the route's existing
  `pipelineOrchestrator.get(runId)` lookup succeeds.
- **Path B (R2.5-d)**: any bridge mode (including `off` / `report`)
  → on WS connect, `runnerWsHandler` calls
  `runnerRegistry.markRunActive({runId, hostIdentity})` → the
  route's fallback `runnerProvider.getActiveRunMeta(runId)` returns
  `{hostIdentity, since}` → the route returns 200 with a
  "runner-claimed" placeholder shape (status, origin synthesized,
  children filtered to this runId).

Path B works even when no hook has been dispatched yet — operators
can correlate runner activity with run-detail responses immediately
on connect, not only after the first PreToolUse.

## 3. Bridge contract — what the runner is allowed to do

Frozen at R2.5-a, locked by 20 lint tests. Code anchor:
`src/runtime/remoteHookBridgeContract.js`. Operator-facing:
[`docs/remote-hook-bridge-contract.md`](../remote-hook-bridge-contract.md).

| Allowed hook | Allowed tools | Required `data` keys | Executor method |
| --- | --- | --- | --- |
| `PreToolUse` | Read / Grep / Glob | — | `executor.onPreTool(tool, _data)` |
| `PostToolUse` | Read / Grep / Glob (response capped 4096B) | — | `executor.onPostTool(tool, response, _data)` |
| `Stop` | — | — | `executor.onStop(_data)` |
| `SubagentStart` | — | `agent_id` | `executor.onSubagentStart(_data)` |
| `SubagentStop` | — | `agent_id` | `executor.onSubagentStop(_data)` |

Hooks NOT in scope for R2.5 (rejected with `hook_not_allowed`):
`SessionStart`, `SessionEnd`, `Notification`, `PreCompact`. Tools
NOT in scope (rejected with `tool_not_allowed`): `Bash`, `Write`,
`Edit`, `WebFetch`, `WebSearch`, `Task`. R3 will design a per-call
approval flow before opening any of them.

## 4. Audit-chain verb taxonomy

| Verb | Fires when | Carries |
| --- | --- | --- |
| `runner_hook_routed` | every accepted frame (broadcast happened — R1-k2 backward compat) | `hostIdentity, hook, tool` |
| `runner_hook_rejected` | sanitization failed | `+ reason` (frozen vocabulary) |
| `runner_hook_sanitized` | sanitization passed; dispatch about to fire | (same shape as routed) |
| `runner_hook_dispatched` | executor method returned | `+ method` |
| `runner_hook_dispatch_error` | executor method threw | `+ method, error` |
| `runner_hook_route_error` | the WS handler itself caught an exception (NOT a contract reject) | `+ error` |

For one ACCEPTED + DISPATCHED hook the chain has 3 entries (routed
→ sanitized → dispatched). For one REJECTED hook it has 2 entries
(routed → rejected). For one ROUTING-FAILURE the handler emits
`runner_hook_route_error` instead.

`runner_hook_routed` was kept (not renamed) for backward compat
with R2's monitor probe + lint tests + every operator runbook that
greps for it.

## 5. Bridge mode promotion path

Recommended operational sequence:

1. **Default `off`** — Existing R1/R2 deployment. Sanitization
   doesn't run; broadcast-only behavior preserved. No risk; no new
   capability.
2. **Promote to `report`** — Sanitization runs; audit chain emits
   `runner_hook_routed → runner_hook_rejected | _sanitized`. No
   dispatch. Operators run for 24-48h, grep
   `runner_hook_rejected` for unexpected reasons (likely
   `tool_not_allowed` if the runner sends Bash; `data_required_missing`
   for malformed Subagent frames; etc.). If the rejected pattern
   matches the operator's expectation, promote.
3. **Promote to `dispatch`** — Sanitized hooks reach the executor.
   The audit chain gains `runner_hook_dispatched | _dispatch_error`
   verbs. Operators monitor `hookStats.remoteHookDispatchError` for
   downstream failures.

Demotion is safe — the bridge has no persistent state of its own.
Setting `ORCHESTRATOR_REMOTE_BRIDGE_MODE=off` in env + restart =
immediate rollback to broadcast-only.

## 6. Known limitations (intentional)

- **Read-only execution only.** Bash / Write / Edit will need a
  per-call approval flow. Not in scope for R2.5; tracked as R3
  follow-up. Operators wanting to run a remote agent that mutates
  files keep doing it directly (no bridge); the dashboard sees the
  hooks but the executor stays untouched.
- **Fire-and-forget dispatch.** The executor's return value isn't
  propagated back to the runner. R3 may add a return path so the
  runner can short-circuit a tool call based on the orchestrator's
  verdict (e.g., "your `Read` was blocked by danger-gate, abort").
- **Single-runner host.** R2.5 was evaluated on R2's single-runner
  topology. Multi-runner pool needs the network topology fixes
  R2-4's strict mode highlighted (host-port reachability when
  `internal: true` is on).
- **Session lifecycle hooks deferred.** `SessionStart` / `SessionEnd`
  semantics overlap with the runner's own connection lifecycle
  (`runner_ws_connected` / `runner_ws_disconnected`). The
  duplication needs an authoritative reconciler before allowing
  remote runners to drive them.

## 7. Bugs found and fixed during R2.5

R2.5 surfaced one design hole in the run-detail route that R2
documented as a known-gap. The fix landed in R2.5-d via two
independent paths (orchestrator auto-create + runner-registry
fallback), so the gap is closed in all three bridge modes.

| # | Bug / gap | Fix slice | Notes |
| ---: | --- | :---: | --- |
| 1 | `/api/monitor/runs/<verdict.runId>` 404 for runner-claimed runs that are not pipeline runs | R2.5-d | Runner registry now tracks active WS connections by runId; monitor route falls back to that on null pipeline run, returning a "runner-claimed" placeholder shape with origin synthesized from the runner's metadata. |

R2.5 introduced no other latent bugs that the test suite couldn't
catch at unit-test time. The R2-style "you only find them at first
docker compose up" pattern did NOT recur — the contract module +
sanitizer's pure-function shape made the unit tests genuinely
predictive.

## 8. Operator notes

- **Always tear-down + re-up when changing `ORCHESTRATOR_REMOTE_BRIDGE_MODE`.**
  The orchestrator reads the env once at boot via
  `resolveBridgeMode(process.env)` and stores it in the
  HookRouter. Hot-promotion isn't supported in R2.5 (the
  `setBridgeMode()` method exists for tests but isn't wired to
  any HTTP endpoint).
- **The audit chain is the source of truth.** If a hook seems to
  have been silently dropped, the answer is in
  `/app/runs/<runId>/ledger.jsonl`:
  - missing entirely → broadcast / route paths failed; check
    `runner_hook_route_error`.
  - `runner_hook_routed` only → bridge mode is `off`.
  - `runner_hook_routed` + `runner_hook_rejected` → contract layer
    refused the frame; `reason` field names which gate fired.
  - `runner_hook_routed` + `runner_hook_sanitized` only → bridge
    mode is `report`.
  - `runner_hook_routed` + `runner_hook_sanitized` + `runner_hook_dispatched`
    → full happy path; the executor returned without throwing.
  - `runner_hook_routed` + `runner_hook_sanitized` + `runner_hook_dispatch_error`
    → executor threw; `error` field captures the message.
- **Bridge throughput at a glance.**
  `curl -H "x-harness-token: $ORCHESTRATOR_TOKEN" http://127.0.0.1:4201/api/server/info`
  returns `hookStats` with the full counter set: `total`, `byEvent`,
  `remoteHooks`, `remoteHookSanitized`, `remoteHookRejected`,
  `remoteHookDispatched`, `remoteHookDispatchError`.
- **Stress test for production-readiness.** Run the bridge probe
  in a loop:
  ```bash
  for i in {1..20}; do ./scripts/r2-5-bridge-probe.sh; done
  ```
  Expected: 100% pass rate. Any flakiness here is a bug in the
  bridge — file an issue with the audit chain attached.

## 9. Sources

- [`docs/remote-hook-bridge-contract.md`](../remote-hook-bridge-contract.md)
  — wire contract.
- [`src/runtime/remoteHookBridgeContract.js`](../../src/runtime/remoteHookBridgeContract.js)
  — frozen constants.
- [`src/runtime/remoteHookSanitizer.js`](../../src/runtime/remoteHookSanitizer.js)
  — pure validator.
- [`docs/reports/2026-04-28-r2-single-runner-eval.md`](./2026-04-28-r2-single-runner-eval.md)
  §3 — the R2 closeout that named the gaps R2.5 closes.
- [`docs/remote-sandbox-impl.md`](../remote-sandbox-impl.md) §3 —
  hook ingress channel design (MG1) the R2.5 bridge implements.

## 10. Sign-off

Phase D R2.5 — controlled execution bridge — is **complete**. The
R2.5-a contract, R2.5-b sanitizer, R2.5-c dispatch wiring, R2.5-d
run-visibility fallback, and R2.5-e live proof all landed with
unit + integration + live evidence. R1's "trust boundary documented"
→ R2's "trust boundary deployed" → R2.5's "trust boundary lets
selected reads through with full audit narrative."

**Verdict**: GO for R3 multi-runner pool + Linux host nftables/dnsmasq
follow-up.
