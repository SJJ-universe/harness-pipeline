# Remote Sandbox RFC

**Status**: Design-only. No code in this round.
**Round**: Phase D Round MF (Slice MF1 of MF1–MF2).
**Date**: 2026-04-27.
**Roadmap reference**: `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` §7 (Priority 4).
**Predecessor docs (kept, cross-linked, not duplicated)**:
`remote-mode-design.md`, `container-sandbox.md`, `harness-architecture.md`,
`security-model.md`.

This RFC consolidates the four P4 plan slices (A: boundary audit, B:
isolation model, C: monitor metadata, D: rollout gates) into a single
document so there is one place to read the complete remote-execution
design before any code lands.

---

## 0. Scope, non-goals, glossary

### In scope

A concrete, implementable description of:

1. What the local-first harness guarantees today and where each guarantee
   would break the moment a run originates outside the local machine.
2. The isolation model that closes those gaps — workspace, process,
   token, filesystem, network, and child-process boundaries.
3. The monitor / trace metadata that must exist on every event before
   any run can be tagged "remote" without confusing the operator.
4. The explicit gates that must each be GREEN before remote mode is
   exposed to a user.

### Non-goals (deliberately out of scope)

- **Multi-tenant SaaS authentication** — covered in plan §Phase 3 (D
  platformization), not here. This RFC stops at "single trusted operator
  who chose to run a workload remotely", i.e. the single-tenant remote
  execution case.
- **Container-vs-VM choice** — the isolation model leaves room for both.
  The implementation slice that follows this RFC will pick one.
- **Performance benchmarking** — out of scope. Functional correctness
  first; performance work after rollout gate G6.
- **Cross-region orchestration** — the orchestrator stays single-instance.
  Workload runs may be remote; the orchestrator stays local for now.
- **Custom container images** — initial rollout ships with a fixed image.
  User-supplied Dockerfiles are a follow-up RFC.

### Glossary

| Term | Meaning in this RFC |
|---|---|
| **Local-first** | The current default: server + executors + Codex/Claude all run on `127.0.0.1`. Loopback is the trust boundary. |
| **Run origin** | Where a `PipelineRun`'s _workload_ executes. One of: `local`, `container-local`, `container-remote`, `vm-remote`. The orchestrator stays local in all four. |
| **Sandbox class** | The isolation tier a run is wrapped in. One of: `none` (default for `run_origin=local`), `container-strict`, `vm-strict`. |
| **Trust boundary** | The line between code we control (the orchestrator + monitor + auth) and code we sandbox (the workload + Codex/Claude subprocesses). |
| **Workspace** | The mounted directory tree the workload can read and (in the writable subset) write. |
| **Workload** | A Codex critic, a Claude executor, a TDD-stage-2 verifier, or a subagent — anything that the orchestrator spawns to do real work. |
| **Operator** | The human running the harness. There is exactly one operator; multi-operator is platform-tier (Phase 3). |

---

## 1. Current-state boundary audit (P4-A)

### 1.1 What the harness guarantees TODAY

These are the load-bearing properties verified by the existing test
suite (936 unit / 197 integration / live readiness 15/15) and the
Phase 3-S security work:

| Property | Mechanism | Code anchor |
|---|---|---|
| Loopback default | `HARNESS_HOST=127.0.0.1` + `requireTrustedOrigin` rejects non-loopback unless `HARNESS_ALLOW_REMOTE=1` | `src/security/auth.js`, `server.js` WS upgrade gate |
| Token gate on state-changing HTTP | `x-harness-token` header required for POST/PUT/PATCH/DELETE; `crypto.timingSafeEqual` | `src/security/auth.js` |
| WS upgrade auth | `verifyWsConnection` covers `/terminal` AND pipeline events | `src/server/wsAuth.js` (Slice S1) |
| Path containment | `pathSandbox.resolveInsideRoot` runs realpath + symlink resolution + Windows case-double-check | `src/security/pathSandbox.js` (Slice S2) |
| Per-run state isolation | `Map<runId, PipelineExecutor>` each with own `PipelineState` + `checkpointStore` | `executor/pipeline-orchestrator.js` (Slice Y/Z) |
| Per-run replay isolation | `eventReplayBuffer.snapshot({runId, includeGlobal})` | `src/runtime/eventReplayBuffer.js` (Slice T + AA-2) |
| Child concurrency cap | `childSemaphore` (default max 2) | `src/runtime/childSemaphore.js` (Slice N) |
| Child lifecycle tracking | `childRegistry` register/unregister + `gracefulShutdown` SIGTERM→1s→SIGKILL | `src/runtime/childRegistry.js` (Slice S3-a) |
| Phase tool gating | `dangerGate.js` blocks destructive shell + Phase A non-read-only Bash | `src/policy/dangerGate.js` |
| File-conflict detection | `fileConflictDetector` per-run claim + clear on `pipeline_complete` | `src/runtime/fileConflictDetector.js` (Slice V + AD) |

The **trust boundary** today is "the host process": once a workload
runs, it inherits the operator's full filesystem, network, and process
permissions. This is acceptable because it _is_ the operator —
loopback restriction means no one else can spawn workloads.

### 1.2 What breaks under remote execution

The moment a run's `workload` is moved off the operator's machine, the
following implicit assumptions stop holding:

| Assumption (today) | What breaks remotely | Severity |
|---|---|---|
| Workload's filesystem is the operator's filesystem | Workload runs on a remote host; "open `package.json`" needs explicit context | **High** |
| Workload sees the operator's environment variables | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `HARNESS_TOKEN` are operator secrets — never ship them whole | **Critical** |
| Workload network = loopback + intentional API egress | Remote workload could reach internal services (cloud metadata, peer hosts) | **Critical** |
| Hook callbacks reach `127.0.0.1:4201` | Remote workload's localhost is NOT the dashboard | **High** |
| Pipeline state lives in `.harness/` next to the orchestrator | Remote workload writes locally; orchestrator can't see it | **High** |
| `pathSandbox.resolveInsideRoot` enforces the repo root | Repo root on the remote host is symbolic — operator's path checks don't transfer | **Medium** |
| `gracefulShutdown` SIGTERM reaches every spawn | SIGTERM doesn't cross the network; orphan workloads possible | **Medium** |
| `fileConflictDetector` claims are global | Two remote workloads on the same shared FS can corrupt each other | **Medium** |
| `childRegistry.snapshot()` shows every child | Remote children invisible until they emit events | **Medium** |
| Audit / evidence ledger lives next to the orchestrator | Remote tampering of ledger entries is undetectable without signature | **High** |

The audit conclusion: **every guarantee that depends on "the workload
runs in the operator's user account on the operator's machine" needs
either a replacement mechanism or an explicit "not supported in this
sandbox class" carve-out.** No silent degradation.

### 1.3 Trust-boundary diagrams

#### Today (`run_origin = local`, `sandbox_class = none`)

```
┌──────────── operator's machine ─────────────┐
│  ┌── orchestrator + monitor + auth ──┐      │
│  │  (server.js + Express + WS)       │      │
│  └─────────────┬─────────────────────┘      │
│                │ spawn (loopback)            │
│  ┌─────────────▼─────────────────────┐      │
│  │  workload (Codex / Claude / ...)  │      │
│  │  inherits operator env + fs       │      │
│  └───────────────────────────────────┘      │
│                                              │
└──────────────────────────────────────────────┘
       trust boundary = host machine
```

#### After this RFC (`run_origin = container-remote`, `sandbox_class = container-strict`)

```
┌──────────── operator's machine ─────────────┐
│  ┌── orchestrator + monitor + auth ──┐      │
│  │  (still local — never moves)      │      │
│  └─────────────┬─────────────────────┘      │
│                │ HTTPS + signed envelope     │
└────────────────┼─────────────────────────────┘
                 ▼
┌─────────── remote runner host ──────────────┐
│  ┌── per-run runtime ──┐                    │
│  │ ┌─ container ─────┐ │                    │
│  │ │  workload       │ │                    │
│  │ │  scoped fs      │ │  ← cap-net,        │
│  │ │  egress allowlist│ │    cap-fs, cap-pid │
│  │ └─────────────────┘ │                    │
│  └─────────────────────┘                    │
└──────────────────────────────────────────────┘
   trust boundary = container instance
```

The orchestrator NEVER moves. Only the _workload_ does. This keeps the
monitor + readiness gates + audit ledger anchored to a single trusted
location while letting the work itself execute under stricter limits.

---

## 2. Isolation model (P4-B)

Each subsection answers: "what does isolation mean for this dimension,
and what is the minimum to achieve it?"

### 2.1 Workspace isolation

**Property**: A workload sees a per-run, per-phase scoped filesystem.
It can read its declared inputs and write only into its declared output
slot.

**Mechanism**:

- **Inputs** — orchestrator stages a read-only bind mount at
  `/work/in` containing the file set the run declared (the existing
  `pathSandbox.resolveInsideRoot` guards what enters this set).
- **Outputs** — a writable tmpfs bind mount at `/work/out` capped at
  256 MiB by default. Orchestrator pulls the diff after each phase
  via `getRunOutputs(runId, phase)`.
- **Source-of-truth** — the orchestrator's `.harness/runs/{runId}/`
  remains the canonical artifact store. The container's `/work/out`
  is ephemeral; merge happens on phase boundary.

**What this fixes from §1.2**: rows 1, 4, 5, 7.

### 2.2 Process isolation

**Property**: A workload cannot reach processes outside its own PID
namespace, cannot fork past a hard limit, cannot read other workloads'
memory.

**Mechanism**:

- One container per run. PID namespace = container PID 1 is the
  workload entrypoint.
- `--pids-limit=64` (Codex critique max observed: 12; headroom for
  child Bash spawns).
- `--ulimit nofile=512:512` (well above the 64 fd we observe in
  steady state).
- No `--privileged`. No `CAP_SYS_ADMIN`. No `--security-opt
  seccomp=unconfined`. The default seccomp profile blocks the
  long-tail of escape syscalls.

**What this fixes from §1.2**: rows 8, 9.

### 2.3 Token + auth model

**Property**: Operator's secrets never leave the operator's machine.
Each remote workload gets a short-lived, scope-limited credential.

**Mechanism**:

- Operator secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) stay
  in the orchestrator's process env. The orchestrator forwards
  Codex/Claude API calls itself when the workload requests them — the
  remote workload talks to the orchestrator, NOT to the API directly.
  This is the inverse of today's model and it's intentional: it keeps
  rate-limit accounting + cost telemetry centralized.
- `HARNESS_TOKEN` is replaced for remote runs by a per-run JWT issued
  by the orchestrator at run start. Lifetime = run duration + 60s
  grace. Audience = `runner-{runId}`. Includes `runId` claim so a
  stolen token can only act on its own run.
- The `/api/hook` ingress on the orchestrator validates the JWT before
  routing the hook into `HookRouter`.

**What this fixes from §1.2**: rows 2, 4 (hook callbacks now use the
JWT-authenticated path), partially row 10 (signed envelope for ledger
ingestion).

### 2.4 Filesystem boundary

**Property**: A workload's view of the filesystem is a strict subset
of `/work/in` ∪ `/work/out` ∪ `/tmp` (per-container tmpfs). Nothing
else.

**Mechanism**:

- No host bind mounts other than `/work/in` and `/work/out`. The
  container's image is the rest of the FS.
- `/tmp` is tmpfs sized at 64 MiB with `noexec,nosuid,nodev`.
- `pathSandbox.resolveInsideRoot` runs INSIDE the container against
  `/work` as the root — same code, smaller root.
- Operator's `.harness/` directory is NEVER mounted. The orchestrator
  is the only writer to that location.

**What this fixes from §1.2**: rows 1, 5, 6.

### 2.5 Network boundary

**Property**: A workload reaches only (a) the orchestrator's hook
ingress and (b) an explicit egress allowlist. No localhost. No
metadata. No peer hosts.

**Mechanism**:

- Default egress allowlist = orchestrator host only. The workload
  fetches Codex/Claude API responses _through_ the orchestrator (see
  §2.3).
- Block 169.254.169.254 (cloud metadata). Block 10.0.0.0/8,
  172.16.0.0/12, 192.168.0.0/16 (RFC1918) by default — opt out per
  deployment.
- The runner host's firewall (or iptables / nftables / network
  policy depending on infra) enforces this; the container's view of
  the network stack is irrelevant if the host blocks the egress.

**What this fixes from §1.2**: row 3.

### 2.6 Child-process isolation

**Property**: Codex/Claude critique processes spawned BY a remote
workload are visible to the orchestrator's `childRegistry` and
participate in `gracefulShutdown`.

**Mechanism**:

- The orchestrator never spawns "Codex on the remote host" directly.
  Codex critiques are still spawned by the orchestrator locally; the
  remote workload only emits the _output it would have produced_ via
  the hook channel. This means the remote sandbox class does NOT need
  to re-implement the child registry; it just needs to never spawn
  long-running children itself (workload phases are bounded by their
  declared timeout).
- For the cases where a workload genuinely must spawn a subprocess
  (rare), the container's PID 1 is `tini`-equivalent and the
  orchestrator polls `GET /runner/{runId}/processes` for visibility
  on a 5s cadence.

**What this fixes from §1.2**: rows 8, 9.

### 2.7 The `sandbox_class` taxonomy

| Class | Description | Run-origin compatibility |
|---|---|---|
| `none` | Today's behavior. No isolation; workload runs as the operator. | `local` only |
| `container-strict` | All of §2.1 through §2.6 enforced. Default for remote. | `container-local`, `container-remote` |
| `vm-strict` | `container-strict` plus a hardware-virt boundary (firecracker / kata / kvm). | `vm-remote` |

Future classes (NOT in this RFC):
- `container-permissive` — allows host network / wider mounts. **No
  use case currently justifies this**; deliberately not specified to
  prevent it from becoming the default.

---

## 3. Monitor metadata for remote (P4-C)

### 3.1 Reserved envelope fields

The monitor envelope (`HarnessMonitorNormalizer.normalize` output)
gains the following OPTIONAL fields. Local-mode runs must continue to
omit them — every existing assertion on envelope shape stays intact
(MA1 + MB1 + MD1 contract stability).

```js
// public/js/monitor/normalizer.js — RFC envelope (proposed)
{
  // existing canonical fields (unchanged):
  type, runId, ts, scope, summary, payload,

  // NEW (optional, present only when sandbox_class !== "none"):
  origin: {
    runOrigin: "local" | "container-local" | "container-remote" | "vm-remote",
    sandboxClass: "none" | "container-strict" | "vm-strict",
    hostIdentity: string,    // opaque label, e.g. "runner-pool-a/3"
    isolationStatus: "healthy" | "degraded" | "lost",
    // additional sub-fields permitted but undocumented = ignored
  }
}
```

The `origin` object lives at envelope top-level (not inside `payload`)
so renderers can route on it without parsing payload. The
`hostIdentity` is opaque — the operator sees a label, not a hostname.

### 3.2 Server contract additions

Two endpoints extend (additive — Phase D MD's contract-stability gate
must pass):

#### `/api/monitor/bootstrap` (additive field)

```js
{
  // existing fields …
  runners: [
    { hostIdentity: "runner-pool-a/3", sandboxClass: "container-strict",
      health: "healthy", activeRuns: 2, lastSeen: <ISO ts> },
    // …
  ]
}
```

When no remote runners are configured, `runners` is `[]` (not omitted
— that's stronger contract stability).

#### `/api/monitor/runs/:runId` (additive field)

```js
{
  // existing fields …
  origin: { runOrigin, sandboxClass, hostIdentity, isolationStatus }
}
```

Local runs return `{ runOrigin: "local", sandboxClass: "none",
hostIdentity: "local", isolationStatus: "healthy" }`. This makes the
field non-optional at the API level even though it's optional in the
event envelope — the client always knows the shape.

### 3.3 UI surface

#### Run-tree (left rail)

- Each run row gets a small badge after the runId:
  - `■` for `sandboxClass: "container-strict"` (filled square).
  - `▣` for `sandboxClass: "vm-strict"` (square-in-square).
  - No badge for `sandboxClass: "none"` (today's behavior — visual
    consistency with current users).
- Hovering shows `runOrigin` + `hostIdentity`.

#### Run-summary (centre top)

- Adds an "Origin" line: `Origin: container-remote · runner-pool-a/3 · healthy`.
- When `isolationStatus === "lost"` the line goes red and the run row
  in the left rail gets a `!` marker.

#### Agent-tree (right rail, when remote)

- Each subagent / child entry shows the same badge shape as its parent
  run. Remote workloads cannot spawn children of a different sandbox
  class, so this is a 1:1 inheritance.

#### Bottom-dock raw log

- Filter chip: "remote" / "local" toggles which runs' events render in
  the dock. Defaults to showing both.

### 3.4 Backwards-compat invariants

These must remain true through the entire monitor metadata extension:

1. A local run's bootstrap/run-detail response is byte-identical to
   today (after JSON normalization), except `origin` is added at the
   top level with the default values from §3.2.
2. The MA1 envelope canonical-shape assertion (`event.type` /
   `event.scope` / `event.runId`) is untouched — `origin` is purely
   additive.
3. `monitor-readiness.test.js` opt-in flow continues to pass with
   `runners: []` and `origin: <local-defaults>`.
4. CSP enforce mode does not change — no new external script sources.

---

## 4. Rollout gates (P4-D)

Remote mode does NOT toggle on until **every** gate below is GREEN.
Each gate is verifiable by an existing readiness check, an existing
test, or a check this RFC names that gets added later.

| Gate | What proves it | Owner today |
|---|---|---|
| **G1. Workspace mount works under load** | Integration test: 100 sequential runs against a stub container, no `/work/in` corruption, no `/work/out` leak across runs | TODO (added in implementation slice) |
| **G2. Token model proven** | Per-run JWT issuance + revocation tested; expired-token rejected with 401 + audit log entry | TODO |
| **G3. Network egress allowlist enforced** | Test: remote workload attempts (a) `169.254.169.254`, (b) RFC1918 peer, (c) `localhost` — all blocked at runner host. Expected: 3 audit-log entries with `egress_blocked` event | TODO |
| **G4. Hook ingress authenticated** | Existing `verifyWsConnection` extended to `runner_hook` channel; integration test rejects invalid JWT | Extends existing S1 |
| **G5. Monitor metadata round-trips** | `monitor-runs-detail.test.js` extended: `origin` field present + correct shape for both local + remote runs | Extends existing MB1 test |
| **G6. Readiness rubric covers remote** | New rubric category "remote isolation" added to `docs/readiness-rubric.md`. 0/3 stars until G1-G5 pass; 3/3 once remote mode is exposed. CI gate (Phase D MD2) blocks merge if rubric drops below 14/15 | Extends MD2 + MD1 |
| **G7. Graceful shutdown reaches remote children** | Test: kill orchestrator → remote runner observes orphan signal within 5s → cleans its own children | TODO |
| **G8. Audit ledger signed** | Hash-chained ledger (existing `evidenceLedger`) extended with HMAC signature over each entry; integration test confirms tampering detected | Extends existing |
| **G9. Documentation in sync** | `harness-architecture.md` + `security-model.md` + this RFC reference each other. `scorecard:check` (MD2) passes | Extends MD2 |
| **G10. Implementation RFC approved** | A second RFC ("Remote Sandbox Implementation") with concrete container image, runtime choice (docker / podman / kata / firecracker), and infra prereqs is approved before code starts | TODO — not this round |

### 4.1 Phased rollout

Once gates G1–G10 are GREEN:

1. **Phase R1 — internal preview**. `HARNESS_REMOTE_MODE=preview`
   exposes container-local only. Operator runs against a runner on the
   same machine; no actual network involved. Validates the isolation
   model in a controlled environment.
2. **Phase R2 — single remote runner**. `HARNESS_REMOTE_MODE=on` plus
   a single configured runner host. Operator can now assign a run to
   the remote runner via dashboard UI.
3. **Phase R3 — multi-runner**. Pool of runners. Run assignment moves
   into the orchestrator (least-loaded host).
4. **Phase R4 — VM class**. `sandbox_class: "vm-strict"` becomes
   selectable for runs that need stronger isolation.

Phases R1–R4 are independent commits; each is its own PR; each must
pass the readiness gate at exit time. **No phase regresses the
previous phase's gate.**

### 4.2 Failure modes + rollback

| Failure | Detection | Rollback |
|---|---|---|
| Runner host unreachable mid-run | Heartbeat timeout (10s) → `isolationStatus = "lost"` | Run marked failed; operator can replay locally |
| Egress allowlist accidentally too permissive | Audit log shows `egress_blocked` rate drop or missing | `HARNESS_REMOTE_MODE=preview` (downgrade), investigate |
| Monitor metadata desync (envelope missing `origin`) | `scorecard:check` fails | Same — block merge until envelope shape restored |
| Hook ingress accepts invalid JWT | Test G4 fails | Block deploy; the JWT bug is treated as a P0 |
| Workload escapes container | Audit log shows host process emitting workload-tagged events | Kill the runner host; treat as a security incident |

---

## 5. What this RFC explicitly does NOT cover

- **Per-user RBAC** — there is one operator. Multi-user is Phase 3.
- **Custom Dockerfiles** — initial rollout ships with one fixed image.
- **GPU access** — out of scope; rare for this harness's workloads.
- **Cross-region replication** — orchestrator stays single-instance.
- **High-availability orchestrator** — orchestrator restart is still
  a manual operation; HA is Phase 3.
- **A control plane for runner hosts** — operators configure runners
  via env. A management UI for the runner pool is a follow-up.
- **Performance benchmarking** — out of scope until G6 + R1 complete.
- **Build/push pipelines for the runner image** — covered by the
  implementation RFC, not this one.

---

## 6. Open questions (to be answered in the implementation RFC)

1. **Runtime choice**: docker, podman, kata, firecracker, or all of
   the above? Trade-offs:
   - docker: easiest, widest support, weakest isolation.
   - podman: rootless, no daemon, similar isolation to docker.
   - kata / firecracker: VM-grade isolation, slower startup.
   - This RFC's `sandbox_class` taxonomy already accommodates all of
     these; the implementation RFC picks one for R1.
2. **Hook ingress channel**: WS-only (today) or HTTPS POST + WS
   for replay? Remote workloads might benefit from HTTPS for the
   one-shot hook events.
3. **JWT issuer**: orchestrator-self-signed or external (operator's
   IdP)? Self-signed is simpler for single-tenant; external opens the
   door to Phase 3.
4. **Audit ledger storage**: append-only file (today) or SQLite? The
   signing extension (G8) is independent of storage choice.

These are deliberately not answered here — this RFC defines the
contract; the implementation RFC commits to specific tech.

---

## 7. Sources

- `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` §7
  (Priority 4) — the original P4 brief.
- `docs/remote-mode-design.md` — current remote-mode threat model.
- `docs/container-sandbox.md` — runner isolation requirements.
- `docs/harness-architecture.md` — current architecture overview.
- `docs/security-model.md` — Phase 3-S security boundary.
- Plan file (`~/.claude/plans/swift-waddling-hanrahan.md`) Part C
  §Phase 3 — long-horizon platformization conditions.
- OWASP ASVS, Twelve-Factor App, Firecracker design docs — referenced
  for isolation patterns; this RFC doesn't depend on any single one.

---

## 8. Status of the four P4 plan slices (post-MF1)

| Slice | Goal | Status after MF1 |
|---|---|:---:|
| P4-A: Current-state boundary audit | §1 | **DONE** |
| P4-B: Isolation model | §2 | **DONE** |
| P4-C: Monitor metadata | §3 | **DONE** |
| P4-D: Rollout gates | §4 | **DONE** |

All four design slices are now consolidated. The next step is the
**implementation RFC** (separate document) which picks the runtime,
the JWT issuer, the audit-ledger storage, and the runner-host control
plane. That RFC is NOT scheduled for this round — the explicit gate
G10 above blocks any code from landing first.

The MF round closes with this document plus cross-links from the
existing predecessor docs (Slice MF2).
