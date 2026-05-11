# Phase D R3 Rollout Plan

**Multi-runner pool + Linux host networking + per-call approval**

> Status: **R3-0 — design-only plan**. R3-a through R3-e are
> follow-up implementation slices.
> Entered: 2026-04-28 (post R2.5-f sign-off).
> Cross-refs: [MF1 §4 G1-G10](./remote-sandbox-rfc.md#4-rollout-gates-p4-d),
> [MG1 §6 control plane + §7 egress](./remote-sandbox-impl.md#6-runner-host-control-plane),
> [R2 eval §3 known gaps + §6 next-round](./reports/2026-04-28-r2-single-runner-eval.md#3-known-gaps-intentional-carve-outs-not-bugs),
> [R2.5 eval §6 known limitations + §10 sign-off](./reports/2026-04-28-r2-5-execution-bridge-eval.md#6-known-limitations-intentional).

R3 closes the gaps R2 + R2.5 deliberately left open. R2 verified
single-runner deployment under Docker Desktop with layer-1 egress
(`internal: true`); R2.5 lifted hook ingress from broadcast-only to
controlled execution under an opt-in feature flag and a 5-hook ×
3-read-only-tool allowlist. R3 broadens the deployment model from
one runner to a pool, exercises layers 2 + 3 of MG1 §7 on a real
Linux host, refines graceful shutdown semantics, and finally opens
write-side tools (Bash / Write / Edit) through a per-call approval
channel.

The five sub-rounds are sized so the highest-risk surface — opening
the bridge to write tools — is sequenced last. Isolation and pool
infrastructure must be solid before approval flow lands.

---

## 0. Scope, non-goals, prerequisites

### 0.1 In scope (R3 sub-rounds)

| Sub-round | Topic | Closes / extends |
|---|---|---|
| **R3-a** | Two-network topology — operator-facing bridge + runner-internal bridge | R2 eval §3 row "Strict mode breaks dashboard host port" |
| **R3-b** | Linux host egress enforcement — MG1 §7 L2 (nftables) + L3 (dnsmasq) | R2 eval §3 row "nftables + dnsmasq layers not exercised" |
| **R3-c** | Multi-runner pool — registry expansion + scheduling/claim semantics + monitor visibility | MG1 §6 control plane (env-only, heartbeat-driven); R2.5 eval §6 single-runner limitation |
| **R3-d** ✅ | Graceful shutdown polish — clean WS close 1000 from orchestrator (DONE 2026-04-29; see §1.4 callout) | R2 eval §3 row "WS close 1000 not used" |
| **R3-e** | Per-call approval flow — open Bash / Write / Edit through a separate decision channel | R2.5 eval §6 row "Tool allowlist explicitly excludes write-side tools" |

### 0.2 Non-goals (deferred to R4 or Phase 3)

- **vm-strict** (kata / firecracker) — the `sandbox_class: "vm-strict"`
  axis from MF1 §3 stays reserved for Phase R4. R3 stays on
  `container-strict`.
- **Multi-tenant orchestrator** — per-user RBAC, audit-retention by
  tenant, runner-pool per-tenant scheduling. Phase 3.
- **HA orchestrator** — orchestrator restart is still a manual op.
  Phase 3.
- **Cross-region replication** — orchestrator is single-instance.
  Phase 3.
- **Custom user Dockerfiles** — runner image stays fixed for R3.
  Phase 3.
- **GPU passthrough** — workloads do not need it for R3.
- **Image registry choice / push pipelines** — ops detail; the build
  scripts from R1-f are sufficient. Not gating.
- **External IdP integration** — orchestrator-self-signed JWT (MG1
  §4) holds for R3. Phase 3.
- **Write-side tool result return path** — synchronous return of
  executor output to the workload after approval. Considered in
  R3-e but may defer to R4 if UX adds too much latency.

### 0.3 Prerequisites (must be GREEN before any R3 sub-round starts)

1. R2 GO sign-off recorded — see
   [R2 eval §7](./reports/2026-04-28-r2-single-runner-eval.md#7-sign-off).
2. R2.5 GO sign-off recorded — see
   [R2.5 eval §10](./reports/2026-04-28-r2-5-execution-bridge-eval.md#10-sign-off).
3. CI gate active and stable (MD2). `npm run readiness:check` ≥ 17/18,
   `npm run scorecard:check` exit 0.
4. **Operator has Linux host available** for R3-b. R3-b CANNOT pass
   on Docker Desktop alone (see §3 Evidence taxonomy). If no Linux
   host is available R3-a / R3-c / R3-d / R3-e can still proceed, but
   the R3 verdict will record R3-b as **UNVERIFIED**.

---

## 1. Sub-round taxonomy

### 1.1 R3-a — Two-network topology

**Problem**: R2-4 demonstrated that flipping the runner network to
`internal: true` for strict-mode egress probes ALSO breaks the
host's `127.0.0.1:4201:4201` port mapping. Operators in strict mode
cannot reach the dashboard via `curl http://127.0.0.1:4201` — host
NAT is severed in both directions. R2-4 documented this as
intentional evidence; R3-a fixes it without losing isolation.

**Approach**: Connect the orchestrator container to TWO Docker
networks:
- `orchestrator-r2-operator` — non-internal bridge with the host port
  mapping. Operator-side traffic only. The runner is NOT attached.
- `orchestrator-r2-runner` — internal bridge (current `orchestrator-r2`).
  Runner attaches; orchestrator dual-homes; no host gateway.

**Touched files**:
- `docker-compose.r2-single-runner.yml` — operator-facing network
  added.
- `docker-compose.r2-strict.override.yml` — strict applies only to
  `orchestrator-r2-runner`, not `orchestrator-r2-operator`.
- `scripts/r2-up.{sh,ps1}` — no change (compose handles topology).
- `scripts/r2-eval.{sh,ps1}` — no change (still curls 127.0.0.1:4201
  through the operator bridge).
- `scripts/r2-probe-egress.{sh,ps1}` — re-run to confirm the runner
  bridge still 6/6 PASS.
- `tests/unit/r2-compose-lint.test.js` — extend to assert two
  networks declared, only one is `internal: true`, runner not
  attached to operator network.

**Evidence**: Windows Docker Desktop probe is sufficient. No Linux
host required.

### 1.2 R3-b — Linux host egress L2 + L3

**Problem**: MG1 §7 defines a 3-layer egress policy. R2-4 verified
layer 1 (`--internal` Docker bridge) only. Layers 2 (nftables on
the bridge interface) and 3 (dnsmasq controlled resolver at
`10.99.99.1`) require Linux host primitives that don't trivially
layer onto Docker Desktop's WSL2 backend (the WSL2 VM doesn't
expose the bridge interface to the host's nftables ruleset; dnsmasq
on a fixed IP requires bridge L2 to behave like a real Linux
bridge, not the WSL2 NAT'd one).

**Approach**: Stand up a real Linux host. Either:
- **Cloud VM** (e.g. Hetzner / DigitalOcean / Vultr — small instance,
  Ubuntu 22.04 or Debian 12).
- **Local KVM / QEMU / VirtualBox** running the same.

Apply MG1 §7.2 nftables rules on the bridge interface. Apply MG1
§7.3 dnsmasq config at 10.99.99.1 with allowlist. Re-run the
egress probes from R3-a's two-network compose with the L2 + L3
overlay active. New probe targets:
- DNS public (`dig www.google.com @10.99.99.1`) → NXDOMAIN
- DNS allowlisted host → ALLOW
- TCP 8443 to orchestrator IP → ALLOW
- TCP 8443 to non-orchestrator IP → DROP (nftables logged)
- UDP 53 to non-`10.99.99.1` resolver → DROP

**Touched files** (Linux host scripts; bash only — no PowerShell):
- `scripts/r3-b-host-bootstrap.sh` (NEW) — installs nftables +
  dnsmasq, applies the rule set from MG1 §7.2/§7.3, brings up the
  bridge.
- `scripts/r3-b-probe-l2-l3.sh` (NEW) — runs the 5 new egress
  targets above against an alpine sidecar inside the bridge.
- `scripts/r3-b-host-teardown.sh` (NEW) — flushes nftables ruleset,
  stops dnsmasq, removes bridge.
- `docs/reports/2026-04-28-r3-b-linux-host-eval.md` (NEW) — eval
  report with probe outputs, kernel + nft + dnsmasq versions, and
  go/no-go verdict.

**Evidence**: Linux host probe **REQUIRED**. CANNOT pass with
Docker Desktop output.

### 1.3 R3-c — Multi-runner pool

**Problem**: MG1 §6 designed a multi-runner control plane via the
`ORCHESTRATOR_REMOTE_RUNNERS=hostA:port,hostB:port` env. The R1-d
RunnerRegistry already supports multiple host registrations and
single-use bootstrap tokens (R1-d boost added sliding-TTL +
idempotent claim). What's missing: scheduling fairness, stale
runner cleanup verified end-to-end, monitor visibility per runner,
and run reassignment policy on host loss.

**Approach**: Extend the registry's selection logic to LEAST_LOADED
(MG1 §6.3 step 4) with FIFO tie-break on `lastSeen`. Add stale-runner
drop on `lastSeen` > 30s (MG1 §6.3 step 5) — verify live, not just
unit. Surface per-runner counts in `/api/server/info` and per-runner
groups in `/api/monitor/bootstrap`'s `runners[]`. UI badge from
MF1 §3.3 already exists; verify it shows the right host per child.

Run reassignment policy on host loss: **fail the run, do not
silently forward to another runner**. The operator must consciously
re-run on a different host. Silent forwarding is the wrong default
because the workload's `/work/out` and any partially-written
artifacts on the lost host are not migrated; the new run must
restart from `/work/in`. R4 may revisit this with workspace
replication.

**Touched files**:
- `src/runtime/runnerRegistry.js` — `selectRunnerForRun(runId)`
  least-loaded with FIFO tie-break + stale drop.
- `src/routes/runnerRoutes.js` — handshake collision detection
  (same hostIdentity + different bootstrap → 401 + audit entry
  `runner_handshake_collision`).
- `src/server/runnerWsHandler.js` — already emits
  `runner_ws_disconnected`; verify the registry reflects it.
- `src/routes/monitorRoutes.js` — `bootstrap.runners[]` populated
  with all healthy runners, not just selected.
- `src/routes/serverControlRoutes.js` — `activeChildren[]` already
  includes per-child `hostIdentity`; verify under multi-runner.
- `tests/integration/multi-runner-pool.test.js` (NEW) — 3 fake
  runner hosts, 6 simultaneous runs, fairness assertion.
- `tests/integration/runner-host-loss.test.js` (NEW) — kill runner-b
  mid-run, assert run marked failed, audit `runner_host_lost` entry.

**Evidence**: Either Docker Desktop (3-container compose with 3
runner replicas) or Linux host. Both OK.

### 1.4 R3-d — Graceful shutdown polish ✅ DONE (2026-04-29)

> **✅ STATUS: GENUINELY COMPLETE.** Implementation lives in `server.js:294-345` (gracefulShutdown function — walks `wss.clients`, sends `ws.close(1000, "orchestrator_shutdown")` to runner-bound connections marked `_isRunnerWs`, then SIGTERM via `childRegistry.killAll` + 1s grace + SIGKILL) + `src/runner/runnerAgent.js:131-143` (clean stop() emits close 1000 + state machine differentiates 1000 vs 1006 vs 1011/1008). Signal handlers wired at `server.js:1212-1213` (process.on SIGINT/SIGTERM → gracefulShutdown). Tests: `tests/integration/runner-shutdown.test.js` (9/9 green) cover both R3-G11 (clean close 1000) and R3-G12 (crash-vs-clean distinguishable). No separate `src/server/shutdown.js` file is needed — the architecture chose to keep it inside server.js. R3 closeout cap counts R3-d under "operational primitives, no rubric move" (per scorecard line 27 R3-c trajectory entry).

**Problem (historical)**: R1 doesn't distinguish "I'm going down cleanly" from
"I crashed". The runner correctly treats 1006/abnormal as transient
(reconnect with exponential backoff) but receives the same close
code on `kill -9 <orchestrator-pid>` and on `Ctrl+C`. A clean WS
close 1000 from the orchestrator on graceful shutdown would let
the runner exit fast without backoff churn.

**Approach**: Orchestrator's `shutdown.js` already handles SIGTERM;
extend it to walk every active `runnerWsHandler` connection and
send WS close 1000 with reason `orchestrator_shutdown` BEFORE
calling `server.close()`. RunnerAgent's WS state machine learns to
distinguish 1000 (clean → exit 0, no reconnect) from 1006/1011
(transient → backoff). Existing 1008 (policy violation) stays fatal.

**Touched files**:
- `src/server/shutdown.js` — gracefully close runner WS connections.
- `src/runner/runnerAgent.js` — WS close 1000 → STOPPED state, no
  reconnect schedule.
- `tests/unit/runnerAgent.shutdown.test.js` (NEW) — 1000 vs 1006
  vs 1011 path differentiation in the state machine.
- `tests/integration/orchestrator-graceful-shutdown.test.js` (NEW) —
  spin orchestrator + agent in-process; SIGTERM the orchestrator;
  assert agent receives 1000 + exits cleanly (no backoff).

**Evidence**: Either Docker Desktop probe (kill orchestrator
container with `docker stop` vs `docker kill`) or in-process
integration test. Both OK.

### 1.5 R3-e — Per-call approval flow

**Problem**: R2.5's allowlist explicitly excludes Bash, Write,
Edit, WebFetch, WebSearch, Task. Each is a write-side or
side-effecting surface where simple allowlist gating isn't safe.
Operators can't currently let a remote runner run "Edit one
file in this repo" because doing so would also let the runner
edit any other file the path sandbox allows.

**Approach**: Add a separate decision channel that surfaces each
PreToolUse for a write-side tool to the operator BEFORE the
sanitized hook reaches the executor. Approval is scoped to exact
`(tool, args-hash)` tuple — re-running the same tool with
different args requires a new approval. Default deny on timeout.
Audit chain emits new verbs:
`runner_hook_approval_requested` →
`runner_hook_approval_granted | _denied | _timeout`.

The dispatch path becomes:
```
runner WS → routeRemote → sanitize → bridgeMode != off
  → if hook+tool in WRITE_TOOLS_REQUIRING_APPROVAL:
      → emit approval_requested (broadcast to dashboard)
      → wait for approval (with ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS,
        default 30000ms)
      → if granted: dispatch to executor + emit approval_granted
      → if denied: emit approval_denied + dispatch_error rejected
      → if timeout: emit approval_timeout + dispatch_error timed_out
  → else (read tool from R2.5 allowlist): direct dispatch as today
```

**Defense in depth**: Approval is the FIRST line. The SECOND line
is the existing `dangerGate.js` path validation. Approving "Bash
echo hi" still blocks any path-traversal in the args; approving
"Write /etc/shadow" still hits the path sandbox. Operators are
approving the bridge crossing, not the file path.

**Touched files**:
- `src/runtime/remoteHookBridgeContract.js` — extend allowlist with
  WRITE_TOOLS_REQUIRING_APPROVAL = `["Bash", "Edit", "Write"]` (NOT
  ALLOWED_TOOLS — these gate through approval, not bypass).
  WebFetch / WebSearch / Task remain banned.
- `src/runtime/remoteHookSanitizer.js` — accept write-tool frames
  that pass write-tool sanitization (paths normalized, args
  validated for shell-injection patterns).
- `executor/hook-router.js` — new `_requestApproval(verdict)`
  method; promise-based, resolves on operator UI action or timer.
- `public/js/monitor/panels/approval-panel.js` (NEW) — UI panel
  for pending approvals.
- `public/js/monitor/store.js` — approval slice
  `state.pendingApprovals: Map<approvalId, request>`.
- `src/runtime/remoteHookBridgeContract.js` — extend AUDIT_VERBS
  with the 4 new approval verbs.
- `tests/unit/remoteHookBridgeContract.write-tools.test.js` (NEW).
- `tests/unit/remoteHookSanitizer.write-tools.test.js` (NEW).
- `tests/unit/hookRouter.approval.test.js` (NEW).
- `tests/integration/approval-flow.test.js` (NEW).
- `scripts/r3-e-approval-probe.{sh,ps1}` (NEW) — manual operator
  probe demonstrating UI flow.

**Evidence**: Live operator workflow REQUIRED (UX cannot be fully
automated). Plus integration tests for state-machine logic.

---

## 2. Acceptance gates (R3-G01 through R3-G15)

Each gate is verifiable by a probe script, an integration test, or
a manual operator workflow this plan names. R3 cannot ship until
all gates intended for the round are GREEN — UNVERIFIED gates are
documented in the round's eval report, not silently passed.

| Gate | Sub-round | Title | Verification | Evidence type |
|---|---|---|---|---|
| **R3-G01** | R3-a | Dashboard reachable with strict-runner active | `r2-eval.sh` succeeds against the strict-mode compose with operator bridge attached | Docker Desktop |
| **R3-G02** | R3-a | Strict bridge isolation preserved with two-network topology | `r2-probe-egress.sh` still 6/6 PASS (RFC1918 + cloud-metadata + DNS public still BLOCK; intra-runner bridge still ALLOW) | Docker Desktop |
| **R3-G03** | R3-b | L2 nftables enforces TCP 8443 to orchestrator only | `r3-b-probe-l2-l3.sh`: workload curls non-orchestrator IP:8443 → DROP with audit entry | **Linux host** |
| **R3-G04** | R3-b | L3 dnsmasq enforces DNS allowlist | `r3-b-probe-l2-l3.sh`: workload `dig www.google.com @10.99.99.1` → NXDOMAIN; `dig orchestrator @10.99.99.1` → ALLOW | **Linux host** |
| **R3-G05** | R3-b | L2 + L3 escape hatch (`ORCHESTRATOR_RUNNER_EGRESS_DEBUG=1`) auto-resets after 10 min | Linux host probe + integration test on countdown timer; ruleset reverts when timer expires | **Linux host** + in-process |
| **R3-G06** | R3-c | Multi-runner registration without host-id collision | 3 runner hosts handshake simultaneously; registry shows 3 distinct rows; `runner_handshake_collision` emitted on conflicting bootstrap reuse | Either |
| **R3-G07** | R3-c | Stale runner cleanup (lastSeen > 30s drop) | Stop runner-a, verify drop within 35s; `runner_host_lost` audit entry; re-handshake required to rejoin | Either |
| **R3-G08** | R3-c | Run assignment fairness (least-loaded) | 6 runs distributed across 3 idle runners → ≤2 per runner; no starvation under steady-state | Either |
| **R3-G09** | R3-c | Run reassignment policy on host loss is "fail the run" | Active run on runner-b; kill runner-b; orchestrator marks the run failed (NOT silent forward); `runner_host_lost` + `pipeline_failed` entries | Either |
| **R3-G10** | R3-c | Monitor visibility per runner | `bootstrap.runners[]` shows 3 entries; agent-tree groups children by `hostIdentity`; UI badge correct | Either |
| **R3-G11** | R3-d | Clean WS close 1000 on orchestrator shutdown | Probe: orchestrator graceful-shutdown sends 1000 → runner exits without backoff retry | Either |
| **R3-G12** | R3-d | Crash-vs-clean distinguishable in runner | Probe: orchestrator `kill -9` → runner sees 1006 + reconnect backoff; orchestrator graceful-shutdown → runner sees 1000 + clean exit | Either + in-process |
| **R3-G13** | R3-e | Per-call approval channel functional | Operator UI shows pending Bash/Write/Edit request; approve / deny / timeout each produce audit entries | Operator workflow |
| **R3-G14** | R3-e | Per-call approval default deny on timeout | Workload sends Bash hook with no operator action → 30s timeout → executor not called → `runner_hook_approval_timeout` + `runner_hook_dispatch_error` reason `approval_timeout` | In-process + operator |
| **R3-G15** | R3-e | Per-call approval per-tool granularity | Approve "Read /etc/passwd" does NOT also approve "Bash rm -rf /" — approval scoped to exact `(tool, args-hash)` tuple; second tool requires new approval | In-process + operator |

### 2.1 Gate dependencies

```
R3-G01, R3-G02 (R3-a)
  └→ R3-G03, R3-G04, R3-G05 (R3-b)  [REQUIRES Linux host]
        └→ R3-G06..G10 (R3-c)
              └→ R3-G11, R3-G12 (R3-d)
                    └→ R3-G13..G15 (R3-e)
```

A gate cannot pass if any gate it transitively depends on is
UNVERIFIED. Exception: R3-G06..G10 (R3-c) MAY proceed with R3-b
UNVERIFIED, in which case the R3 verdict explicitly records
"R3-b unverified — Linux host unavailable" and only `R3-G01-02 /
G06-15` count toward the round's PASS aggregate.

### 2.2 Existing MF1 G1-G10 status during R3

R3 does NOT regress any MF1 gate. Specifically:

- **G1 workspace** — R2 PASS + R2.5 PASS, must remain.
- **G2 token model** — R1-c + R2.5 PASS, must remain.
- **G3 egress** — R2 PASS at L1; R3-b promotes to L1+L2+L3.
- **G4 hook ingress** — R2.5 PASS, must remain.
- **G5 monitor metadata** — R2 PASS, must remain (extends with
  per-runner grouping in R3-c).
- **G6 readiness** — R1-i PASS at 18/18; R3 must not drop.
- **G7 graceful shutdown** — R2 partial PASS; R3-d completes.
- **G8 audit ledger** — R1-c PASS; R3 must not regress.
- **G9 docs in sync** — MD2 PASS; R3-0 (this) starts the round
  with docs already current.
- **G10 implementation RFC** — MG1 PASS; R3-0 + R3-a..e implement
  the design.

---

## 3. Evidence taxonomy

| Evidence type | Sufficient for | NOT sufficient for | Examples |
|---|---|---|---|
| **In-process integration test** | State-machine logic, contract conformance, sanitizer behavior | Runtime networking, container isolation, OS-level egress | R3-G05 timer logic, R3-G12 close-code differentiation, R3-G14 approval timeout |
| **Windows Docker Desktop probe** | Compose topology, container interaction, Docker bridge layer 1 | nftables on bridge (the WSL2 backend hides the bridge from the host nftables namespace), dnsmasq on a fixed IP at L2 | R3-G01, R3-G02, R3-G06..G12 |
| **Linux host probe** | Layer 2 nftables on bridge, layer 3 dnsmasq controlled resolver | UX flows | R3-G03, R3-G04, R3-G05 |
| **Operator workflow** | UX correctness, latency, "does this feel right when I'm using it" | State-machine logic (use integration tests for that) | R3-G13, partial G14, partial G15 |

### 3.1 Why R3-b CANNOT pass on Docker Desktop alone

Docker Desktop on Windows runs containers inside a WSL2 VM. The
Docker bridge that containers attach to lives inside that VM and is
NOT visible from the Windows host's perspective. nftables rules
applied on the WSL2 host CAN attach to the bridge interface, BUT:

1. The WSL2 NAT layer sits between the bridge and the Windows
   network. Some packets that would be DROPped by the bridge
   nftables rules are NAT-mangled BEFORE the rule fires; some are
   reordered. The "what should be blocked" semantics differ from a
   real Linux host.
2. dnsmasq at `10.99.99.1` requires the bridge to be a real Linux
   bridge (`brctl` / `ip link`). WSL2's bridge has different
   broadcast / multicast / ARP behavior — fixed-IP resolver setup
   that works on a Hetzner VM may behave subtly differently on
   Docker Desktop.
3. Some operator escape-hatch tests (R3-G05) need a guaranteed-real
   `nft` ruleset on a real bridge so the auto-reset can be
   observed end-to-end. Docker Desktop's transient WSL2 VM resets
   nftables rules on VM restart anyway, masking the bug class
   R3-G05 tries to catch.

R3-b verdict on Docker Desktop alone = **UNVERIFIED**. Not
"PASS with caveats" — the network primitives the test depends on
are not the ones a real deployment uses.

---

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|:---:|:---:|---|
| 1 | Operator does not have Linux host available | medium | high | R3-b cannot pass without one; document as UNVERIFIED in eval report rather than skipping. R3-c..e can still ship with partial verdict. |
| 2 | nftables version skew between distros (Debian 11 vs Ubuntu 22.04 vs Alpine) | medium | medium | Pin to nftables ≥ 1.0.0 (Debian 12+ / Ubuntu 22.04+); document as R3-b prereq in `r3-b-host-bootstrap.sh`. Refuse to start with older versions. |
| 3 | Operator-facing bridge introduces new attack surface | medium | high | R3-G02 mandates `r2-probe-egress.sh` re-runs 6/6 PASS — operator bridge MUST NOT inadvertently re-route runner egress. Compose lint test asserts runner is NOT attached to operator network. |
| 4 | Multi-runner host identity collision (two operators pick same hostIdentity) | low | medium | RunnerRegistry already supports it (R1-d). R3-c adds collision detection at handshake: same `hostIdentity` + different bootstrap token → 401 + `runner_handshake_collision` audit entry. The second handshake is rejected, not silently merged. |
| 5 | Run assignment unfairness (sticky to first runner) | medium | low | R3-G08 fairness test asserts distribution. Implementation: LEAST_LOADED with FIFO tie-break by `lastSeen`. |
| 6 | WS close 1000 vs 1006 distinguishability — runner false-positive on flaky network | low | medium | Test R3-G12 isolates the two paths. Documented runner behavior: 1000 → exit 0; 1006 → reconnect backoff. Only the orchestrator emits 1000; any 1000 on the wire IS authoritative. |
| 7 | Per-call approval UX latency makes the orchestrator unusable | high | medium | Approval timeout default 30s; configurable via `ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS`. Hook is `dispatch_error`'d with reason `approval_timeout` rather than blocking the runner. |
| 8 | Per-call approval scope leakage (approve "Bash echo hi" → workload uses approval to run "Bash rm -rf") | low | critical | Approval scoped to exact `(tool, args-hash)` tuple. The `args-hash` is `sha256(JSON.stringify(args))`. Workload sending the same tool with different args MUST request a new approval. Hash is in the audit chain. |
| 9 | Approval channel UI complexity (pending list, history, approval audit) | medium | low | Reuse existing dashboard panel patterns (run-summary card style + bottom-dock new tab). Don't expand UI shell beyond the current Mendel layout. |
| 10 | R3-e (per-call approval) opens write-tool surface — escapes container? | low | critical | Defense in depth: approval is FIRST line; existing `dangerGate.js` is SECOND line. Approved Bash with `rm -rf /` still blocks at danger gate. Approved Write to `/etc/shadow` still blocks at path sandbox. Operators approve the bridge crossing, not the file path. |
| 11 | R3-e write-tool sanitization regex too strict / too loose | medium | high | Sanitizer changes for write tools require a separate paranoid lint test set similar to R2.5-a's 20-test suite. Reject anything with shell metacharacters in `Bash` args; reject anything with `..` in `Edit` / `Write` paths (already caught by dangerGate but redundant defense). |
| 12 | Multi-runner stale-state bug — runner reconnects after registry drop | low | medium | Re-handshake required after 30s drop. `runner_handshake_after_drop` audit entry. RunnerAgent state machine already handles handshake-restart on heartbeat 401. |
| 13 | Tool-result return path adds round-trip latency | medium | medium | Defer to R4 if R3-e approval already adds enough latency. R3-e ships approval-only first; result return is optional. |

---

## 5. Dependencies + recommended order

### 5.1 Slice graph

```
R3-0 (this doc) — design-only
  └→ R3-a (two-network topology) — Windows Docker Desktop OK
        └→ R3-b (Linux host L2/L3) — REQUIRES Linux host
              └→ R3-c (multi-runner pool) — Either
                    └→ R3-d (graceful shutdown polish) — Either
                          └→ R3-e (per-call approval) — Operator workflow
```

### 5.2 Why this order

- **R3-a unblocks R3-b**: need two-network so the dashboard isn't
  broken when L2/L3 strict mode is on. Without R3-a, Linux host
  testing of L2/L3 has the same dashboard-unreachable artifact R2-4
  documented.
- **R3-b unblocks R3-c**: layer 2/3 enforcement should be stable
  before adding multiple runners. Debugging multi-runner egress
  while egress itself is unverified mixes two failure modes.
- **R3-c unblocks R3-d**: pool scheduling/claim semantics need to
  be stable before refining shutdown semantics. A graceful shutdown
  on multi-runner can mask claim-cleanup bugs if the pool itself is
  flaky.
- **R3-d unblocks R3-e**: approval flow timeouts need a stable
  shutdown path. A graceful shutdown in the middle of a pending
  approval should be well-defined (the approval is denied with
  reason `orchestrator_shutdown`), and that's only well-defined if
  the shutdown path itself is solid.
- **R3-e last**: opening write-side tools is the highest-risk
  surface. Isolation infrastructure (R3-a/b) and pool stability
  (R3-c/d) must be solid before. Per the user's directive:
  > "per-call approval은 매력적이지만 쓰기 도구를 여는 순간
  > 리스크가 커져서, R3의 격리/풀 기반이 먼저 깔리는 편이 더
  > 단단합니다."

### 5.3 Parallel-track candidates

Two of the sub-rounds CAN run in parallel if the operator has the
bandwidth:

- **R3-a + R3-c**: R3-a's compose change is independent of the
  registry/scheduling changes. They merge cleanly.
- **R3-d + R3-c**: R3-d's shutdown signaling layers on top of R3-c's
  pool changes; they merge cleanly because R3-d only adds a clean
  close path that R3-c's pool gracefully handles via existing
  reconnect logic.

R3-b CANNOT be parallel — it's the gating Linux host work. R3-e
CANNOT be parallel — write-tool surface needs all prior R3 work
green.

### 5.4 Round-end exit criteria

R3 is COMPLETE when:
1. R3-G01..G15 all GREEN, OR R3-G03..G05 explicitly UNVERIFIED with
   eval-report-recorded reason "Linux host unavailable" + all
   others GREEN.
2. R2 + R2.5 gates all stay GREEN — no regression.
3. CI gate (`readiness:check ≥ 17/18`, `scorecard:check`) green.
4. R3 closeout report written at
   `docs/reports/2026-04-28-r3-closeout-eval.md` (or whichever
   date the round closes) with per-gate verdict + bug list +
   operator notes.

---

## 6. Cross-references

| Source | What it provides | Where R3 uses it |
|---|---|---|
| [MF1 RFC §2 isolation model](./remote-sandbox-rfc.md#2-isolation-model-p4-b) | Workspace / process / token / FS / network / child-process boundaries | R3-a network split, R3-b egress, R3-c per-host workspaces |
| [MF1 RFC §3 monitor metadata](./remote-sandbox-rfc.md#3-monitor-metadata-p4-c) | `origin` envelope, badge taxonomy | R3-c per-runner badge in run-tree + agent-tree |
| [MF1 RFC §4.1 phased rollout](./remote-sandbox-rfc.md#41-phased-rollout) | Phase R1..R4 sequence, "no phase regresses prior gate" | R3 = MF1's Phase R3 (multi-runner) |
| [MG1 RFC §6 control plane](./remote-sandbox-impl.md#6-runner-host-control-plane) | env-only configuration, heartbeat-driven discovery, 3-tier token taxonomy, least-loaded selection | R3-c implements |
| [MG1 RFC §7 egress](./remote-sandbox-impl.md#7-network-egress) | 3-layer egress (L1 + L2 nftables + L3 dnsmasq), escape hatch | R3-b implements L2 + L3 (L1 in R2) |
| [MG1 RFC §8 bootstrap](./remote-sandbox-impl.md#8-bootstrap-sequence) | bootstrap → runnerToken → runJWT taxonomy | R3-c handshake collision detection extends |
| [MG1 RFC §9 failure modes](./remote-sandbox-impl.md#9-failure-modes-extends-mf1-42) | runner host crash, network partition, OOM, JWT expiry, etc. | R3-c, R3-d test these explicitly |
| [R2 eval §3 known gaps](./reports/2026-04-28-r2-single-runner-eval.md#3-known-gaps-intentional-carve-outs-not-bugs) | Strict bridge breaks dashboard host port; nftables/dnsmasq L2/L3 not exercised; WS 1000 not used | R3-a / R3-b / R3-d each close one |
| [R2 eval §6 next-round](./reports/2026-04-28-r2-single-runner-eval.md#6-recommendations-for-the-next-round) | "R3 must NOT precede R2.5" + "R3 = multi-runner + Linux host + write-tool approval" | R3-0 honors |
| [R2.5 eval §6 known limitations](./reports/2026-04-28-r2-5-execution-bridge-eval.md#6-known-limitations-intentional) | Bash/Write/Edit deferred to per-call approval; tool-result return path; single-runner; session lifecycle | R3-e + R3-c + (deferred R4) |

---

## 7. Status table

| Sub-round | State | Blocking prereq | Required evidence | Estimated commits | Eval report path |
|---|:---:|---|---|:---:|---|
| **R3-0** | **DONE (this doc)** | — | docs only | 1 | this file |
| **R3-a** | NOT STARTED | R3-0 | Docker Desktop | 1-2 | `docs/reports/<date>-r3-a-two-network.md` |
| **R3-b** | NOT STARTED | R3-a + Linux host | **Linux host** probes | 2-3 | `docs/reports/<date>-r3-b-linux-host-eval.md` |
| **R3-c** | NOT STARTED | R3-b strongly recommended | Either | 3-4 | `docs/reports/<date>-r3-c-multi-runner-pool.md` |
| **R3-d** | ✅ DONE 2026-04-29 | R3-c | server.js:294-345 + runnerAgent.js:131-143 + tests/integration/runner-shutdown.test.js (9/9) | 1-2 | inline in R3-c report (no separate shutdown.js needed) |
| **R3-e** | NOT STARTED | R3-d | Operator workflow | 4-6 | `docs/reports/<date>-r3-e-per-call-approval.md` |
| **R3 closeout** | NOT STARTED | All sub-rounds | aggregate | 1 | `docs/reports/<date>-r3-closeout-eval.md` |

Total estimate: ~12-18 commits across 5 sub-rounds + closeout.
Comparable to R2 (8 commits) + R2.5 (6 commits) = R3 is the
largest round but split into clean sub-round PRs.

---

## 8. Out of scope (deferred to R4 / Phase 3)

| Topic | Why deferred | Likely round |
|---|---|---|
| **vm-strict** (`sandbox_class: "vm-strict"`) — kata / firecracker | Needs different runtime; `container-strict` covers R3 use cases | **R4** |
| **Multi-tenant orchestrator** — per-user RBAC, tenant-scoped audit retention, runner-pool per tenant | Whole different security model; not just remote-mode | **Phase 3** |
| **HA orchestrator** — active-passive failover with shared audit ledger | Single-instance is fine for R3's deployment model | **Phase 3** |
| **Cross-region replication** | Single-instance | **Phase 3** |
| **Image registry choice / push pipeline** | Build scripts from R1-f sufficient; pipeline is ops detail | non-gating |
| **GPU passthrough** | Workloads don't need it | **R4+** if ever |
| **Custom user Dockerfiles per run** | Phase 3 platformization | **Phase 3** |
| **External IdP integration** (OIDC, SAML) | Single-operator MG1 §4 HS256 sufficient | **Phase 3** |
| **Tool-result return path** — sync return of executor output to workload after approval | Considered in R3-e but may defer if UX latency excessive | **R3-e or R4** |
| **Approval audit retention beyond ledger** | Ledger is append-only, R3-e is sufficient | non-gating |
| **Approval per-tool default policy by operator** (e.g. "always approve Bash if path is /tmp") | UX complexity; can layer on R3-e foundation later | **R4+** if demand exists |

---

## 9. Open questions (to settle as sub-rounds begin)

These are intentionally not decided in R3-0. Each sub-round PR
addresses the relevant question(s) at implementation time.

### 9.1 R3-a

**Q1**: Should the operator-facing network be a custom name
(`orchestrator-r2-operator`) or the default Docker bridge (no `internal`)?
- Custom name is more explicit, easier to lint.
- Default bridge is one fewer config knob.
- **Tentative**: custom name. Lock in R3-a PR.

**Q2**: Should the strict override apply to the runner network
only, or both? (i.e., does the operator network ALSO need
`--internal: true` for some other reason?)
- **Tentative**: runner network only. Operator bridge stays open
  to host. Lock in R3-a PR with R3-G01 verifying.

### 9.2 R3-b

**Q3**: Linux distribution recommendation in `r3-b-host-bootstrap.sh`?
- Ubuntu 22.04 LTS, Debian 12, or distribution-agnostic with
  version-checked guards.
- **Tentative**: distribution-agnostic with `nft --version` check
  (≥ 1.0.0) + `dnsmasq --version` check (≥ 2.85). Lock in R3-b PR.

**Q4**: How is the orchestrator IP resolved on the Linux host
(needed for nftables `tcp dport 8443 ip daddr <orchestrator-ip>`)?
- Via DNS lookup at startup → IP cached.
- Via explicit env `ORCHESTRATOR_ORCHESTRATOR_IP`.
- **Tentative**: explicit env. Avoids DNS-cache invalidation if
  the orchestrator IP changes mid-run. Lock in R3-b PR.

**Q5**: Does the escape-hatch timer (`ORCHESTRATOR_RUNNER_EGRESS_DEBUG=1`,
10-minute auto-reset) reset to the FULL ruleset or to "default
deny"?
- Full ruleset: previous L2 + L3 rules restored exactly.
- Default deny: no rules, all egress dropped, requires explicit
  re-enable.
- **Tentative**: full ruleset. The escape hatch is for debugging
  egress; resetting to "everything blocked" defeats the purpose
  of the timer auto-reset. Lock in R3-b PR.

### 9.3 R3-c

**Q6**: When two operators independently pick the same `hostIdentity`,
does the second handshake ALSO emit a warning to the first runner?
- Yes (full transparency): the first runner sees `runner_handshake_collision_attempted`
  in its audit channel.
- No (silent reject of second only): keep collision detection
  one-sided.
- **Tentative**: silent reject (the first runner doesn't need to
  know; the operator who set up the second runner sees the 401).
  Lock in R3-c PR.

**Q7**: Run reassignment policy on host loss — fail or reassign?
- **Plan §1.3 says fail** because workspace state on the lost host
  doesn't migrate. R3-G09 verifies.
- **Open**: should `ORCHESTRATOR_REMOTE_FALLBACK=1` (MG1 §9 "Runner
  host crashed" remediation) override this behavior?
- **Tentative**: fail by default; `ORCHESTRATOR_REMOTE_FALLBACK=1`
  re-runs locally with restart-from-`/work/in`. Lock in R3-c PR.

### 9.4 R3-d ✅ RESOLVED (2026-04-29)

**Q8**: Does the orchestrator wait for runner WS close ack before
exiting, or fire-and-forget?
- **DECIDED**: fire-and-forget with 1s grace. server.js:294-345 sends
  close 1000 to all `_isRunnerWs` connections, then SIGTERM via
  childRegistry, then a setTimeout(1000) before SIGKILL + process.exit(0).
  No ACK wait — each runner's runnerAgent.js handles 1000 vs 1006
  client-side and exits accordingly. Audit chain captures the close
  emission via the existing graceful shutdown audit verbs.

### 9.5 R3-e

**Q9**: UI placement of the approval panel?
- Bottom-dock new tab (consistent with R2.5 dock pattern).
- Right-rail above agent-tree.
- Floating modal (highest visibility, but blocks workflow).
- **Tentative**: bottom-dock new tab + right-rail badge counter.
  Lock in R3-e PR.

**Q10**: Approval timeout default value?
- 30s — fast enough to keep workflow moving, slow enough for the
  operator to read the request.
- 60s — more forgiving but runs the risk of accumulating
  pending approvals.
- **Tentative**: 30s. Configurable via
  `ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS`. Lock in R3-e PR.

**Q11**: Approval scope granularity — exact args-hash, or
fuzzy-match patterns?
- Exact `(tool, sha256(JSON.stringify(args)))` — strictest, most
  pedantic for users (re-run with single character change requires
  new approval).
- Fuzzy with operator-defined patterns (e.g., "any Bash starting
  with `git status`")
- **Tentative**: exact for R3-e. Fuzzy is R4+ if requested.
  Lock in R3-e PR.

**Q12**: Tool-result return path — included in R3-e or deferred?
- Include: workload sees `Read` result, `Bash` stdout, etc.
  Requires a return-channel design.
- Defer: workload's hook fires, executor runs, but result is not
  echoed back. Workload assumes success (or failure visible via
  next hook).
- **Tentative**: defer to R4. R3-e ships approval-only first.
  Document in eval report. Lock in R3-e PR.

---

## 10. Operator notes

### 10.1 R3 cannot be done in one push

Each sub-round is one PR. CI must stay green between sub-rounds.
Estimate ~12-18 commits total.

### 10.2 R3-b absolutely requires a Linux host

If unavailable, the gate explicitly remains UNVERIFIED, and the
scorecard records a partial R3 verdict. This is the honest read:
nftables rules on a real Linux bridge are NOT what Docker Desktop
provides, and pretending otherwise makes the security boundary
unverifiable.

### 10.3 R3-e UX testing requires the operator

You can automate the state-machine logic. You can't automate "does
the approval modal feel right when I'm using it" or "is 30s the
right timeout in practice". Plan for ~30 minutes of operator
workflow testing per UX iteration before R3-e closes.

### 10.4 Score impact estimate (subject to actual round results)

R3-0 (this doc) is design-only — **no rubric move**. Expected score
trajectory through R3:

| Sub-round | Expected delta | Why |
|---|:---:|---|
| R3-0 | 103/112 → 103/112 | Design dividend, no rubric move |
| R3-a | 103/112 → 103/112 | Operational fix; no cap movement |
| R3-b | 103/112 → 104/112 (+1 to Safety, within cap if extended to 19) OR 103/112 if cap not extended | Linux host L2/L3 verified would be a qualitatively new property |
| R3-c | depends on R3-b | Pool semantics |
| R3-d ✅ | 103/112 (no cap movement) | DONE 2026-04-29 — graceful shutdown wired in server.js:294-345 + runnerAgent.js:131-143; tests/integration/runner-shutdown.test.js 9/9 green; counted as operational primitives under R3-c trajectory entry |
| R3-e | depends on UX results | Write-tool surface opening |

Conservative estimate: end of R3 = **104-106/112**. Aggressive: 107.
Final number lands at R3 closeout, not R3-0.

### 10.5 R3-0 commits / file changes

R3-0 is design-only:
- `docs/r3-rollout-plan.md` (this file, NEW).
- `docs/scorecard.md` — backlog updated, trajectory entry added.
- `~/.claude/plans/swift-waddling-hanrahan.md` — Part N added.
- `npm run scorecard:sync` — refreshes auto-derived markers (no
  count changes expected).
- No code touched. No tests added or removed. CI must stay green.

---

## 11. Sources

- MF1 RFC: [`docs/remote-sandbox-rfc.md`](./remote-sandbox-rfc.md)
- MG1 RFC: [`docs/remote-sandbox-impl.md`](./remote-sandbox-impl.md)
- R2 eval report: [`docs/reports/2026-04-28-r2-single-runner-eval.md`](./reports/2026-04-28-r2-single-runner-eval.md)
- R2.5 eval report: [`docs/reports/2026-04-28-r2-5-execution-bridge-eval.md`](./reports/2026-04-28-r2-5-execution-bridge-eval.md)
- Plan file (`~/.claude/plans/swift-waddling-hanrahan.md`) — Part L
  (R2), Part M (R2.5), Part N (R3, added by R3-0).
- nftables documentation:
  https://wiki.nftables.org/wiki-nftables/index.php/Main_Page
- dnsmasq man page: `dnsmasq(8)`
- WebSocket close codes: RFC 6455 §7.4.

---

## 12. Sign-off

R3-0 is **DRAFT — pending operator sign-off**. With sign-off, R3-a
becomes the next round candidate. Without sign-off, this plan
remains the system-of-record but no implementation slices begin.

R3-0 plan author: Phase D R3 round, 2026-04-28.

R3-0 plan reviewer: pending.

R3-0 sign-off date: pending.
