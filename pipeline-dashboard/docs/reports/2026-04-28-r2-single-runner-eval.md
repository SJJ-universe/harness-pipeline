# R2 — Single remote runner deployment evaluation

- **Date**: 2026-04-28
- **Round**: Phase D R2 (deployment evaluation; MF1 §4.1 gates G1-G9)
- **Scope**: orchestrator + a single `harness-runner` container brought up
  via Docker Compose on the operator's host. Verifying that the R1 design
  primitives (HKDF JWT, signed audit chain, runner registry, WS demux,
  remote child projection, env validation, namespace ownership) actually
  hold under real container plumbing — not just in-process integration
  tests.
- **Author**: harness-pipeline-analysis maintainer + AI pair
- **Verdict**: **GO** for continuing remote-mode work. Move to R2.5
  (controlled hook execution bridge) before R3 (multi-runner pool).

## 0. Verdict at a glance

| Gate | Title (MF1 §4.1) | Live verdict | Evidence anchor |
| --- | --- | :---: | --- |
| G1 | Workspace under load | **PASS** | `r2-lifecycle-probe.sh` 5/5 |
| G2 | Token model | **PASS** | `r2-eval.sh` 4/4 + audit chain |
| G3 | Network egress | **PASS** (layer 1) | `r2-probe-egress.sh` 6/6 |
| G4 | Hook ingress auth | **PASS** (partial) | `r2-monitor-probe.sh` anchor 4 |
| G5 | Monitor metadata round-trip | **PASS** | `r2-monitor-probe.sh` 4/4 |
| G6 | Readiness covers remote | **PASS** | live readiness 18/18 + Star 3 RTT |
| G7 | Graceful shutdown | **PASS** (R1 baseline) | `r2-lifecycle-probe.sh` cycles 4-5 |
| G8 | Audit ledger signed | **PASS** | every entry carries `sig` + `sigVer:1` |
| G9 | Docs in sync | **PASS** | scorecard:check + this report |

Every gate has a live evidence anchor on the operator's Docker Desktop
on Windows 11 (the harness-pipeline-analysis maintainer's machine).
No gate failed. Two scope carve-outs are documented in §3 and §6 —
they do not block GO; they shape the next round's scope.

## 1. Reproduction

```bash
cd C:/Users/SJ/harness-pipeline-analysis/pipeline-dashboard

# 1. Operator secrets (NEVER committed; .env.r2 is .gitignored)
cp .env.r2.example .env.r2
# edit .env.r2: set HARNESS_TOKEN and RUNNER_BOOTSTRAP_TOKEN to fresh
# 32-byte hex strings (e.g. via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

# 2. Bring up (non-strict — host port mapping works)
./scripts/r2-up.sh
# expected: orchestrator healthy, runner state running

# 3. Smoke (R2-2)
./scripts/r2-eval.sh
# expected: 4 pass / 0 fail

# 4. Monitor + auth round-trip (R2-3)
./scripts/r2-monitor-probe.sh
# expected: 4 pass / 0 fail

# 5. Lifecycle (R2-5)
./scripts/r2-lifecycle-probe.sh
# expected: 5 pass / 0 fail

# 6. Strict-mode egress (R2-4) — needs a re-up with the override
./scripts/r2-down.sh --clean
docker compose \
  -f docker-compose.r2-single-runner.yml \
  -f docker-compose.r2-strict.override.yml \
  up -d orchestrator runner probe
./scripts/r2-probe-egress.sh
# expected: 6 pass / 0 fail
# NOTE: strict mode breaks the host's 127.0.0.1:4201 mapping — see §6 below

# 7. Tear down
./scripts/r2-down.sh --clean
```

Total wall-clock for the full sequence on the maintainer's machine:
~3 minutes (most of it is image build cache + docker compose health
wait). Subsequent runs ~90s.

## 2. Per-gate detail

### G1 — Workspace under load

**Pass.** The runner container's `/work/out` mount is `tmpfs / rw / nosuid /
nodev / noexec / size=64MiB` (verified via `cat /proc/mounts` from inside
the runner). `/work/in` is intentionally absent in the default image —
operators who supply an input mount get it as `:ro`; operators who
forget see no writable scratch (see Bug 8 below in §5).

Sequential lifecycle test (3× `agent_started` / `agent_stopped` cycles
back-to-back) returns `bootstrap.activeChildren` filtered to remote
children to **0** at end. `childRegistry` does not leak across cycles,
which proves the R1-k1 namespace + ownership-verify fix holds under
sustained throughput within a single connection.

### G2 — Token model

**Pass.** End-to-end token flow over the Docker network on the
maintainer's host:

1. Operator writes `HARNESS_TOKEN` + `RUNNER_BOOTSTRAP_TOKEN` into
   `.env.r2`.
2. `r2-up.sh` mints a `HARNESS_RUN_JWT` from `HARNESS_TOKEN` via
   `src/security/jwt.js#issue` (HS256 over an HKDF-derived key).
3. Compose hands the JWT into the runner container as env.
4. Runner agent does the 3-step handshake — POST `/api/runner/handshake`
   with `Authorization: Bearer <bootstrap>`, gets a 32-byte runnerToken,
   POSTs heartbeats with `Bearer <runnerToken>`, opens the WS with
   `?runId=...&token=<runJWT>` URL params.
5. Orchestrator's audit chain records `runner_handshake_ok` (under
   runId="system") and `runner_ws_connected` (under the actual runId)
   with `sig` + `sigVer:1` HMAC-SHA256 fields on every entry.

Both ledger types are surfaced to the operator via `r2-eval.sh`. The
HKDF domain separation (info=`"runner-jwt"` vs info=`"audit-ledger"`)
means the WS verifier and the ledger HMAC use independent 32-byte keys
derived from the same IKM, so leaking one cannot forge the other.

### G3 — Network egress (layer 1 only)

**Pass for layer 1 (Docker `--internal` bridge).** With the strict
override active, the alpine probe sidecar — sitting on the same
internal-only bridge as the runner — sees:

| Target | Verdict | wget stderr |
| --- | :---: | --- |
| `169.254.169.254` (cloud-metadata) | BLOCK | `Network unreachable` |
| `10.0.0.1` (RFC1918) | BLOCK | `Network unreachable` |
| `172.16.0.1` (RFC1918) | BLOCK | `Network unreachable` |
| `192.168.1.1` (RFC1918) | BLOCK | `Network unreachable` |
| `www.google.com` (public via DNS) | BLOCK | `bad address` (no DNS) |
| `orchestrator:4201/api/health` (intra-bridge) | ALLOW | 200 OK |

This is **layer 1 only** of MG1 §7's three-layer egress policy. Layers
2 (nftables on the bridge) and 3 (dnsmasq controlled resolver) are not
exercised here — they're R3 follow-up work. For R2's "single remote
runner preview" scope, layer 1 is the right depth: Docker's
`internal: true` already gives you the cloud-metadata + RFC1918 +
public-DNS containment story for free.

**Trade-off**: `internal: true` also breaks the host's
`127.0.0.1:4201:4201` port mapping, because internal bridges refuse
NAT in both directions. The dashboard becomes unreachable from the
host while strict is on. Operators who need both at once will want
the two-network topology described in §6.

### G4 — Hook ingress auth

**Pass (partial).** R2-3's monitor probe injects a `hook` frame from
inside the runner container using the existing runJWT, and observes
the orchestrator's audit chain pick up a `runner_hook_routed` entry
(R1-k2's forensic anchor) with `hostIdentity` + `hook` + `tool`
captured but `event.data` deliberately omitted (R1-k2 sensitivity
contract).

**Partial** because R1's WS hook handler is **report-only** by design
— the orchestrator broadcasts a `runner_hook` event and bumps stats
counters, but it does NOT call into the local pipeline executor's
`onPreTool` / `onPostTool` paths. Wiring remote hooks to the local
executor with allowlist + tool-arg validation is explicitly R2.5
scope (the user named it "R2.5 remote execution bridge"). For R2
we lock the auth + audit-chain leg of G4; the dispatch leg is the
next round's deliverable.

### G5 — Monitor metadata round-trip

**Pass.** `r2-monitor-probe.sh` 4/4:

1. `/api/monitor/bootstrap.runners[]` contains
   `{hostIdentity:"runner-r2-001", sandboxClass:"container-strict",
    health:"healthy", activeRuns:0, lastSeen:...}` once the runner
   has handshaked.
2. `/api/monitor/bootstrap.activeChildren[]` gains a
   `{remote:true, id:"r2-monitor-probe-agent",
    runId:"rr-r2-eval-001", hostIdentity:"runner-r2-001",
    agentType:"claude"}` entry while the in-runner WS probe holds
   the agent_started lifecycle open. The entry vanishes when the
   probe disconnects (auto-cleanup), confirming R1-g+ scoped
   cleanup is intact.
3. `/api/monitor/runs/default.origin` exposes the full envelope
   shape: `{runOrigin:"local", sandboxClass:"none",
    hostIdentity:"local", isolationStatus:"healthy"}`. The contract
   that R1-a + R1-h established holds in real responses, not just
   in unit tests.
4. Audit chain has `runner_hook_routed` entries with R1-k2's
   omit-event.data invariant honored.

### G6 — Readiness covers remote

**Pass.** `npm run readiness:check` is **18/18** in live mode (server-
spawned), with the `remote-isolation` 6th category (R1-i) all green:

```
remote-isolation     ★★★  (3/3)
  + HARNESS_REMOTE_MODE default = off (fail-closed, behavior verified)
  + HKDF JWT + ledger keys derive with domain separation (behavior verified)
  + live runner agent → orchestrator round-trip projects remote child
    + ledger chain verifies (behavior verified)
```

R1-g+'s Star 3 (live runner-agent → orchestrator round-trip)
continues to verify in CI, and the same RTT is now demonstrated
under real Docker network conditions via R2-3.

### G7 — Graceful shutdown

**Pass for the R1 baseline.** Stopping the orchestrator container
produces:

- WS close code 1006 (abnormal close) on the runner side
- runner enters reconnect backoff (R1-e-3 exponential + full jitter)
- runner state in `docker inspect` remains `running` throughout
- orchestrator restart → runner reconnects automatically; on the
  reconnect the runnerToken has expired so the heartbeat returns
  HTTP 401, and the runner re-handshakes (R1-e-3 §heartbeat 401 path)

The R2-5 probe explicitly observes the
`heartbeat HTTP 401 → handshake ok` chain, which is non-trivial
evidence — that recovery path was previously only covered by unit
tests with mocked fetch.

For R3 we will want the orchestrator to send a clean WS close 1000
on shutdown and the runner to interpret 1000 as a fatal stop (rather
than reconnect against a wall). For R1 / R2, the "reconnect on any
non-fatal close" baseline is the documented behavior.

### G8 — Audit ledger signed

**Pass.** Every entry written under `/app/runs/<runId>/ledger.jsonl`
in the orchestrator container carries `sig` + `sigVer:1` after R1-c
+ R1-h wired the HMAC signing key. `verifyChain(runId)` returns
`{valid: true}` on the post-eval chain. The signing key
(info=`"audit-ledger"`) is HKDF-distinct from the JWT key
(info=`"runner-jwt"`); operators who pin the audit chain to long-term
storage cannot have it tampered without holding the IKM.

### G9 — Docs in sync

**Pass.** `npm run scorecard:check` exits 0. Test counts
(<!-- AUTO:test-counts -->**1133 unit / 249 integration**<!-- /AUTO -->),
readiness score (<!-- AUTO:readiness-total -->**18 / 18**<!-- /AUTO -->),
and the per-category readiness breakdown all auto-derived from running
test suites + `node scripts/readiness-report.js`. After R2-0's
double-read stabilization, the marker drift pattern that recurred 4×
through the R1 round has not reappeared.

## 3. Known gaps (intentional carve-outs, not bugs)

These were observed during R2 but are out of scope for R2. They are
documented here so the next round (R2.5) inherits clear context.

| Gap | Why we left it | Where it goes |
| --- | --- | --- |
| `/api/monitor/runs/<runner-claimed-runId>` returns 404 | R1's runner is transport-only — runner-claimed runs (`_runAssignments` in `RunnerRegistry`) are NOT pipeline runs (`PipelineOrchestrator.runs`). The two state stores are intentionally separate. | R2.5: when the execution bridge wires runner hook frames to a local pipeline run, we'll need to mirror runner-claimed runs into the pipeline orchestrator's run list. |
| Remote hooks are broadcast-only, not executed | R1-g § "Hook routing is report-only" — running remote hook events through `onPreTool` / `onPostTool` etc. is the trust-boundary expansion that R2.5 handles. | R2.5 design spec is the priority follow-up; should specify the allowlist + tool-arg validation layer. |
| Strict mode breaks dashboard host port | `internal: true` refuses host-port NAT in both directions. | R3: two-network topology (operator-facing bridge + runner-facing internal bridge), or sidecar reverse-proxy on the host network. |
| nftables + dnsmasq layers (MG1 §7 L2 + L3) not exercised | R2 verified Docker `--internal` (L1) only. L2 (nftables on bridge) and L3 (dnsmasq controlled resolver) require Linux-host primitives that don't trivially layer on Docker Desktop's WSL2 backend. | R3: stand up a Linux runner host (cloud VM or local KVM) and re-run R2-4 with the full 3-layer stack. |
| WS close 1000 (clean) not used by orchestrator on shutdown | R1 doesn't distinguish "I'm going down cleanly" from "I crashed." Runner correctly treats 1006/abnormal as transient (reconnect backoff) but a clean 1000 would let the runner exit fast. | R3 graceful-shutdown polish. |

## 4. Bugs found and fixed during R2

R2 surfaced eight latent bugs in the eval harness + orchestrator
plumbing that the integration-test suites alone could not catch. Each
was fixed in the slice that uncovered it. They are listed here so the
R2.5 author has a clear record of "what failed when we first ran it
for real":

| # | Bug | Fix slice | Commit context |
| ---: | --- | :---: | --- |
| 1 | `Dockerfile.runner` did not COPY `src/runner/runnerAgent.js` | R2-2 | runner crashed on first require |
| 2 | `Dockerfile.orchestrator` did not COPY `skill-registry.js` | R2-2 | orchestrator boot failed on `require("./skill-registry")` |
| 3 | `Dockerfile.orchestrator` placed `server.js` at `/app/server.js`; `REPO_ROOT = path.resolve(__dirname,"..")` resolved to `/`, so `runsDir = "/runs"` was unwritable. Fix: WORKDIR `/app/dashboard`. | R2-2 | EvidenceLedger silently swallowed EACCES; audit chain stayed empty |
| 4 | `HARNESS_ALLOW_REMOTE` compare is `=== "1"`, not `=== "true"` | R2-2 | orchestrator bound to 127.0.0.1 inside the container; runner on the same Docker network hit "connection refused" |
| 5 | Project-wide `.dockerignore` (tuned for runner image) excluded orchestrator code paths. Fix: `Dockerfile.orchestrator.dockerignore`. | R2-2 | orchestrator build failed at `COPY executor/`, `COPY public/`, `COPY src/` |
| 6 | `r2-down.sh` failed when `.env.r2` was deleted (compose still validates `${VAR:?msg}` on `down`) | R2-2 | tear-down stuck operators in dirty state |
| 7 | `r2-eval.sh` hit MSYS / Git-Bash path conversion (`/app/runs/...` -> `C:/Program Files/Git/app/runs/...`) | R2-2 | ledger anchors reported MISSING despite being present |
| 8 | `Dockerfile.runner` pre-created `/work/in` and chowned it to harness — making it a writable default scratch directory | R2-5 | G1 evidence broke; fix: drop `/work/in` from the image, let the operator's mount be the only path |

Net effect: 23 lint tests now lock the harness shape (was 13 before
R2). Future authors changing any of these surfaces get a fast-fail
signal at unit-test time.

## 5. Operator notes

These are useful when the harness hits an unexpected state.

- **Always `--clean` between runs that change `.env.r2`**. Compose
  caches the env values into the running containers; if you change
  HARNESS_TOKEN without `down --clean`, the new token won't propagate
  and the runner will get HTTP 401 against the old runnerToken.
- **The runJWT minted by `r2-up.sh` has a 1-hour lifetime** (set in
  the script via `runDurationMs: 3600000`). For longer-lived test
  sessions, re-run `r2-up.sh` to get a fresh JWT. Operator-side
  bumps to runDurationMs go in the script, not the env file (the
  env doesn't have a knob today).
- **`docker logs harness-runner-r2`** prints the agent's state
  transitions. Look for `handshake ok`, `ws open`, `ws hello received`
  for the happy path; `handshake failed`, `heartbeat HTTP 401`, or
  `ws close code=1008` for fatal credential issues.
- **Audit chain inspection**:
  ```bash
  MSYS_NO_PATHCONV=1 docker exec harness-orchestrator-r2 \
    sh -c 'cat /app/runs/*/ledger.jsonl | head -20'
  ```
  Each entry's `sig` + `sigVer:1` confirms the HMAC. To verify the
  chain explicitly:
  ```bash
  docker exec harness-orchestrator-r2 node -e '
    const { EvidenceLedger } = require("./src/runtime/evidenceLedger");
    const path = require("path");
    const { setupRemoteRunner } = require("./src/server/remoteRunnerSetup");
    const setup = setupRemoteRunner({ env: process.env });
    const l = new EvidenceLedger({ rootDir: "/app/runs", signingKey: setup.ledgerKey });
    console.log(l.verifyChain(process.env.HARNESS_RUN_ID));
  '
  ```
- **Strict-mode dashboard access**: while
  `docker-compose.r2-strict.override.yml` is active, the host loopback
  `127.0.0.1:4201` does NOT work. Operator dashboard access goes
  through `docker exec`:
  ```bash
  MSYS_NO_PATHCONV=1 docker exec harness-orchestrator-r2 \
    node -e 'require("http").get("http://127.0.0.1:4201/api/server/info",r=>{let b=""; r.on("data",c=>b+=c); r.on("end",()=>console.log(b));})'
  ```

## 6. Recommendations for the next round

Based on the R2 evidence, the recommended sequencing for R2.5+ is:

1. **R2.5 — Remote execution bridge**. Move remote hooks from
   broadcast-only to controlled dispatch: an allowlist of accepted
   hook names + per-tool argument validation + the wiring from
   `routeRemote` into a sanitized subset of the local executor's
   on{Pre,Post,Stop,SubagentStart,SubagentStop}Tool paths. This
   closes the rest of G4 and unlocks the actual "remote runner runs
   user code" story. **Highest priority. Recommended next round.**
2. **R3 — Multi-runner pool + Linux host**. Two-network topology so
   the dashboard stays reachable while strict mode is on. Linux host
   so MG1 §7 L2 (nftables) and L3 (dnsmasq) can be exercised. WS close
   1000 used by the orchestrator on graceful shutdown. R2-4 re-run
   with the full 3-layer egress stack.
3. **vm-strict** (kata / firecracker). After R3 multi-runner is solid,
   consider vm-strict for the highest-isolation use cases. Not on the
   critical path for the operator's current product roadmap.

R3 should NOT precede R2.5. The user's plan is explicit:
> "R2가 통과하면 바로 R2.5 remote execution bridge로 가는 게 맞습니다."
> ("After R2 passes, going straight to R2.5 remote execution bridge is the
> right call. Until that lands, do not jump to R3 multi-runner.")

## 7. Sign-off

Phase D R2 — single remote runner deployment evaluation — is
**complete**. All MF1 §4.1 gates relevant to single-runner preview
have a live evidence anchor on the operator's machine, captured by
repeatable `scripts/r2-*.sh` probes, with corresponding `*.ps1`
PowerShell counterparts. The R1-a through R1-k1/k2/k3 design IS
deployable; the bug list in §4 represents harness-side rough edges,
not architectural problems.

**Verdict**: GO for R2.5 remote execution bridge.
