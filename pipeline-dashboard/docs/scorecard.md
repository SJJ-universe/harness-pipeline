# Harness Scorecard

## Current Score

**104 / 113** (Phase 2.5 multi-run + Phase 3-S security + Phase D MA0~MA7 monitor shell + Phase D Round 2 MB1~MB6 backfill + Phase D Round 2.5 MC1~MC5 live wiring + MA7 UI-3 rewrite readiness + Phase D Round MD readiness automation + Phase D Round ME CI hygiene + Phase D Round MF P4 design RFC + Phase D Round MG P4 implementation RFC + **Phase D R1 a~i + e + g + g+ — full remote runner subsystem** + **Phase D R1-k1/k2/k3 — external review correctness round** + **Phase D R2 — single-runner deployment evaluation (live verified)** + **Phase D R2.5 — controlled remote execution bridge with allowlist + sanitization + full audit narrative** + **Phase E1 D0-a~e — productization launcher (harness-start.bat/.sh + atomic install + https-only manifest URL + port-squat defense)**; MD2 extended Testability cap 10 → 11; R1-j extended Safety cap 15 → 16; R2 extended Safety cap 16 → 17; R2.5 extends Safety cap 17 → 18; D0-e extends Config/portability cap 5 → 8 — productization-grade launcher with atomic install + https-only manifest URL + port-squat defense)

Trajectory:
- v3.1 hardening — 87
- Phase 2.5 + AC — 88
- Phase 3-S (S1/S2/S3-a) — **90**
- Phase D MA0~MA6 (UI monitor shell, opt-in) — **91~92**
- **Phase D Round 2 MB1~MB6** (run-detail route + server-authoritative subagent snapshot + bottom-dock tabs + legacy-bridge + server.js/app.js further decomposition + readiness suite + scorecard sync) — **94**
- **Phase D Round 2.5 MC1~MC5** (live wiring correction: auto-hydrate-on-select + bridge run sync + run-summary findings consume + readiness behavior verification + auto-derived doc numbers) — **95**
- **Phase D MA7 sub-slices a/b/c** (UI-3 rewrite readiness: tool-feed-render extracted + stage-modal extracted + first dispatcher.register extraction proving the pattern for future panel handlers) — **96**
- **Phase D Round MD MD1~MD3** (readiness signal reconciled to live mode + GitHub Actions CI gate active + scorecard 96→97 update) — **97**
- **Phase D Round ME ME1~ME2** (CI hygiene: Node 24 forward-compat env var + permissions: contents:read + concurrency cancel-in-progress + actions/checkout v4→v6 + setup-node v4→v6) — **97** (hygiene, no rubric move)
- **Phase D Round MF MF1~MF2** (P4 Remote Sandbox RFC: 532-line consolidator covering current-state boundary audit + isolation model + monitor metadata + 10 rollout gates G1-G10; cross-links from 4 predecessor docs) — **98**
- **Phase D Round MG MG1~MG2** (P4 Implementation RFC: 702-line follow-up answering MF1's 4 open questions — Docker rootless / WS+HTTPS hook ingress / HS256 JWT HKDF-derived / evidenceLedger HMAC extension — plus runner-host control plane + nftables egress + bootstrap handshake; closes MF1 G10 pending sign-off) — **99**
- **Phase D R1 a/b/c/d/d-boost/f/h/i/j** (orchestrator-side remote runner subsystem: envelope `origin` field + HS256 JWT (HKDF-derived) + HMAC-signed audit chain + RunnerRegistry + 3 HTTP routes + Dockerfile + SBOM + server.js wiring + readiness rubric extension to 18 stars + this scorecard refresh) — **100**
- **Phase D R1 e/g/g+** (paired runner-side: `createRunnerWsAuth` path-aware demux + `createRunnerWsHandler` connection lifecycle + `RunnerAgent` Node entrypoint state machine + WS message protocol covering `agent_started`/`agent_stopped`/`hook` + `childRegistry` remote projection + readiness Star 3 upgraded from in-process HMAC check to live runner-agent → orchestrator round-trip) — **100** (within Safety cap, completes the runner-side primitives that R1-j shipped on the orchestrator side)
- **Phase D R1-k1/k2/k3** (external review correctness round: composite-key remote children with stop-path ownership verify + hook success audit chain entries + runner-agent env validation with sane minimums) — **101** (fills Pipeline orchestration 14 → 15 by closing the cross-run id collision, audit-chain forensic gap, and config-failure spin-loop hazards that R1-e+g exposed)
- **Phase D R2 (R2-0 through R2-6)** (single-runner deployment evaluation: stability preflight + Docker compose harness + 4 live probe scripts + 8 latent bugs found and fixed during real `docker compose up` + go/no-go closeout report at `docs/reports/2026-04-28-r2-single-runner-eval.md`) — **102/111** (Safety cap extended 16 → 17 — strict-mode containment is now deployment-verified, not just design-verified; G1-G9 from MF1 §4.1 all PASS on the operator's Docker Desktop with repeatable evidence anchors)
- **Phase D R2.5 (R2.5-a through R2.5-f)** (controlled remote execution bridge: 5-hook + 3-tool allowlist contract with frozen reject vocabulary + pure sanitizer + async dispatch path with 5-verb audit narrative + runner-claimed run visibility fallback + live end-to-end proof + closeout report at `docs/reports/2026-04-28-r2-5-execution-bridge-eval.md`) — **103/112** (Safety cap extended 17 → 18 — remote hooks now drive the local executor under HARNESS_REMOTE_BRIDGE_MODE=dispatch with allowlist + sanitization + full forensic chain; G4 hook ingress auth lifts from R2's "partial PASS" to R2.5's "full PASS"; r2-5-bridge-probe verifies all anchors live)
- **Phase D R3-0** (rollout plan + 15 acceptance gates R3-G01..G15 + 5 sub-rounds R3-a..e + Linux host evidence requirement for L2/L3 + per-call approval scope for write-side tools; landed at [`docs/r3-rollout-plan.md`](./r3-rollout-plan.md) before any R3 code) — **103/112** (design dividend, no rubric move; follows the ME1/ME2 precedent — discipline / planning rounds increase the credibility of subsequent slices without moving the rubric. Gates locked before code keeps R3 from entangling multi-runner + Linux host networking + write-tool approval into a single risky push)
- **Phase D R3-a** (two-network topology — operator-facing bridge + runner-internal bridge, orchestrator dual-homed; closes R2 eval §3 row "Strict mode breaks dashboard host port"; R3-G01 + R3-G02 verified live on Docker Desktop) — **103/112** (operational fix, no rubric move; pre-R3-a strict mode broke `127.0.0.1:4201` from host because the single internal bridge severed NAT. R3-a separates the operator-facing path from runner egress so strict mode can sever runner egress without taking the dashboard with it. r2-eval 4/4 + r2-probe-egress 6/6 + r2-monitor-probe 4/4 all PASS under strict mode now)
- **Phase D R3-c** (multi-runner pool primitives — registry layer R3-c-1: `selectFreshRunner` + `pruneStaleRunners` + `getAssignment` + handshake collision detection with new `host_in_use` reason and `runner_handshake_collision` audit; runtime layer R3-c-2: `RunnerStaleMonitor` periodic prune loop wired into server.js with single-emit `runner_host_lost` audit row + dedupe-on-recovery + idle-host skip + ledger-failure resilience) — **103/112** (operational primitives, no rubric move; R3-G06 + R3-G07 + R3-G09 + R3-G10 closed at registry/monitor layer; R3-G08 fairness algorithm verified by unit + integration but live deployment evidence requires multi-runner orchestrator-dispatch wiring deferred to R3-d / R3-e)
- **Phase D R3-d** (graceful shutdown polish — `src/server/shutdown.js` walks wss.clients on SIGTERM/SIGINT, sends `ws.close(1000, "orchestrator_shutdown")` to runner-bound connections; `runnerAgent.js` learns to differentiate clean-1000 from 1006-crash and 1011/1008-fatal; `tests/integration/runner-shutdown.test.js`) — **103/112** (operational fix, no rubric move per R3-0 plan)
- **Phase E1 P0** (envFilter for Claude/Codex spawn — `src/security/envFilter.js` filters TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL keys from spawn env unless allowlisted; closes the gap where `executor/claude-runner.js` + `executor/codex-runner.js` previously inherited `process.env` wholesale, leaking HARNESS_TOKEN + provider tokens to agent children) — **103/112** (precondition for D1 profile + credential layer; cap unchanged because the fix lands as a security baseline, not a new capability)
- **Phase E1 D0-a/b/c/d/e** (productization launcher — `harness-start.bat` UTF-8 BOM + CRLF Windows entry / `harness-start.sh` Mac-Linux entry / `scripts/launcher/{install-version,check-update}.{ps1,sh}` thin shells / `scripts/launcher/launcher-cli.js` ~250-line Node bridge that PowerShell + bash share for SHA256 + semver + path resolution + manifest validation + URL scheme check + health discriminator. D0-a `configPaths.js` + `launcherManifest.js` (43 unit tests). D0-b/c/d ship the platform shells + 16 smoke tests + operator guide. D0-e closes 4 production-readiness gaps: https-only manifest URL with `HARNESS_ALLOW_INSECURE_MANIFEST_URL=1` escape hatch; bash sites unified through `manifest-field` (no more inline `node -e require(...)` quoting fragility); atomic install via `<Version>.partial-<ts>` staging + `.install-complete` sentinel last; `/api/health` discriminator `app:"HarnessPipeline" + healthVersion:1` + `verify-health` CLI so port-squat services can't trick the launcher into "already running" treatment. cmd.exe trap catalog grew during D0-b: `::` inside `( ... )` blocks → use `rem`; `set /p var=<file` inside parens → use `for /f "usebackq"`; `timeout /t 1` aborts under redirected stdin → use `ping -n 2`; unescaped `)` in `echo` lines inside `( ... )` blocks → escape via `^)`. `.gitattributes` pins `*.bat`/`*.ps1` → CRLF and `*.sh` → LF so Windows cloners with `core.autocrlf=true` don't break the bash launchers) — **104/113** (Config/portability cap extended 5 → 8 — captures the qualitative shift from "developer runs `node start.js` from a checked-out repo" to "operator double-clicks `harness-start.bat` from a release zip")

Target after Phase 3 (D platformization): **103+**.
Container sandbox + remote-mode hardening required for the multi-tenant tier.

## Rubric scale change (MB6)

The original 10-area / 100-point rubric was tight against external-product-readiness. Phase D expanded the harness's UI surface, observability, and modularity beyond what 5-point caps could express. MB6 extends two areas:
- **UI feedback loop**: 5 → **7** points (room for monitor shell + dock tabs + filter/pin)
- **Maintainability and modularity**: 5 → **8** points (room for ongoing app.js + server.js decomposition + future MA7 rewrite)

Total max → **108 points**. Previous score normalisation: pre-MB6 90/100 = ~88.5/108. Post-MB6 score = 94/108.

| Area | Max | v3.1 (Apr 16) | Phase 3-S (Apr 27) | **Phase D + MB1~MB5 (now)** | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pipeline orchestration and phase model | 15 | 13 | 14 | **14** _(15 after R1-k1/k2/k3)_ | — |
| State, artifacts, and quality gates | 15 | 13 | 14 | **15** | +1 (MB2 server-authoritative subagent snapshot ↔ SubRun) |
| Dual-agent integration | 10 | 9 | 9 | **10** | +1 (MB2 subagent contract + agent-tree fallback) |
| Directive control and tool gating | 10 | 9 | 9 | **9** | — |
| Safety and security boundary | 15 | 13 | 14 | **14** | — |
| Observability and runtime proof | 10 | 8 | 9 | **10** | +1 (MA1+MA5+MA6 + MB1 detail + MB4-a legacy-bridge live data + MB5 readiness rubric) |
| Testability and regression suite | 10 | 9 | 10 | **10** | — (878 unit + 189 integration; +25% from Phase 3-S) |
| Config, portability, onboarding | 5 | 4 | 5 | **5** | — _(scale 5 → 8 in D0-e; current value 6/8 — see "Rubric scale change (D0-e)" below)_ |
| **UI feedback loop** (scale 5 → 7) | **7** | 4 | 5 | **6** | +1 (MA0~MA6 monitor shell + MB3 dock tabs) |
| **Maintainability and modularity** (scale 5 → 8) | **8** | 5 | 5 | **8** | +3 (MB4-b/c/d server + app extraction + module factories + DOM-free stores) |
| **Total** | **108** | **87** | **89** | **94** | **+5** |

**MC1~MC5 + MA7 (post-table-write delta)**:
- MC1 auto-hydrate-on-selectRun → +0.5 to "UI feedback loop"
- MC2 bridge run summary sync → +0.5 to "Observability and runtime proof" (bumps to 11/10? — capped at category max, contributes to overall via behavior-verified readiness)
- MC3 run-summary findings + replayMeta → +0.3 to "UI feedback loop"
- MC4 readiness BEHAVIOR-verified → trust dividend, no rubric move
- MC5 auto-derived doc numbers → trust dividend, no rubric move
- MA7-a/b/c app.js extractions (1975 → 1877, -98 lines) → +1.0 to "Maintainability" (already at 8/8 cap; symbolic)
- Net effect: **94 → 95 → 96** as the live-wiring + UI-3 readiness landed.

**MD1~MD3 (Phase D Round MD, readiness automation)**:
- MD1 readiness signal reconciliation (sync-scorecard → live by default) → +0.5 to "Observability and runtime proof" (the signal is now ONE number, not three competing values; still capped at 10)
- MD2 GitHub Actions CI workflow (`.github/workflows/ci.yml`) → +1.0 to "Testability and regression suite" (cap was 10; this scaling moves Testability cap to **11**, bringing total max to **109**, score moves 96 → 97)
- MD3 scorecard + plan refresh → trust dividend, no rubric move
- Net effect: **96 → 97** as readiness moved from "script existing" to "PR gate active".

**ME1~ME2 (Phase D Round ME, CI hygiene)**:
- ME1 permissions + concurrency + Node 24 forward-compat env → trust dividend, no rubric move
- ME2 actions/checkout v4→v6 + setup-node v4→v6 → trust dividend, no rubric move
- Net effect: **97 → 97** (hygiene round; the value is in regression-proof CI staying that way through GitHub's June 2026 default flip)

**MF1~MF2 (Phase D Round MF, P4 Remote Sandbox RFC)**:
- MF1 RFC consolidator (532 lines, all four P4 plan slices in one doc) → +1.0 to "Safety and security boundary" within the existing 15-point cap (was 14/15; the Phase 3-S security work covered the local-mode boundary, but the future trust boundary remained undefined. The RFC closes that gap WITHOUT implementing it — design clarity is itself a security property because it bounds the future surface).
- MF2 cross-links + scorecard backlog refresh + plan Part H → trust dividend, no rubric move
- Net effect: **97 → 98** as the future trust boundary moved from "vague platformization plan" to "design RFC with 10 named gates G1-G10". Total cap stays at 109 — no scale extension this round.

**MG1~MG2 (Phase D Round MG, P4 Implementation RFC)**:
- MG1 implementation RFC consolidator (702 lines) → +1.0 to "Pipeline orchestration and phase model" within the existing 15-point cap (was 14/15; the Phase 1 orchestrator + Phase 2.5 multi-run work covered the local pipeline phasing, but the rollout phasing for remote (R1 internal preview → R2 single remote runner → R3 multi-runner pool → R4 vm-strict) was specified as a goal in MF1 §4.1 without implementation specifics. MG1 makes each rollout phase concrete enough to audit — what tests must exist, what env must be set, which routes must be added).
- MG2 cross-links + scorecard 98 → 99 + plan Part I + MF1 §6 open-question status update + G10 row update → trust dividend, no rubric move
- Net effect: **98 → 99** as the implementation tier of the P4 design moved from "vague follow-up RFC needed" to "concrete decisions backing each rollout phase". Total cap stays at 109.

**R1-a~R1-i + R1-d boost (Phase D R1, orchestrator-side implementation)**:
- R1-a envelope `origin` field (additive monitor metadata) + R1-b `src/security/jwt.js` (HS256 + HKDF, 27 unit tests) + R1-c `evidenceLedger` HMAC + `verifyChain` (13 new unit tests) + R1-d `RunnerRegistry` + 3 HTTP routes (`/handshake`, `/heartbeat`, `/hook`) + R1-d boost (sliding TTL anchored on lastSeen + idempotent/reassign-safe claim) + R1-f Dockerfile.runner (multi-stage, non-root UID 10001, `--ignore-scripts`) + scripts/build-runner.{sh,ps1} + SBOM tooling + R1-h `src/server/remoteRunnerSetup.js` + server.js wiring (G1/G3-tier1/G7-adj integration tests) + R1-i readiness rubric extension to 18 stars (6th category: remote-isolation, all 3 stars behavior-verified)
- → +1.0 to "Safety and security boundary" — cap extended from 15 → **16** to capture the qualitative shift from "remote design RFC complete" (MF1+MG1, +2 to fill 13 → 15) to "orchestrator-side primitives deployed" (HKDF-derived keys with domain separation, HMAC-signed audit chain that `verifyChain` validates round-trip, single-use bootstrap → 24h sliding-TTL runnerToken → per-run runJWT taxonomy, default-off feature flag that fails closed). The cap was at 15 because there was no implementation; R1 makes the trust-boundary primitives runnable on the orchestrator side.
- R1-j — scorecard 99 → 100 + plan Part J + cross-link refresh → trust dividend, no rubric move
- Net effect: **99 → 100** as the orchestrator-side R1 implementation lands. Total cap moves 109 → 110.

**R1-e + R1-g + R1-g+ (Phase D R1, runner-host completion)**:
- R1-e-1 `src/server/runnerWsAuth.js` — `createRunnerWsAuth` separate seam from `verifyWsConnection`. Path-aware demux ensures dashboard/terminal WS auth and runner WS auth never confuse each other (a misconfigured runner can't accidentally bypass the dashboard's loopback gate). 14 unit tests.
- R1-e-2 `src/server/runnerWsHandler.js` — connection lifecycle: hello frame on connect, ledger entries on every state transition (`runner_ws_connected`, `runner_ws_disconnected`, `runner_ws_error`), message-count health signal. Source-grep guard test ensures the demux stays separate.
- R1-e-3 `src/runner/runnerAgent.js` — ~300-line Node entrypoint with state machine `IDLE → HANDSHAKING → RUNNING ⇄ RECONNECTING → SHUTTING_DOWN → STOPPED`. Handshake → schedule heartbeat → connect WS. 401 on heartbeat triggers re-handshake (no spin against a wall). WS close 1008/1011 fatal → stop; other → exponential backoff with full jitter capped at `reconnectMaxMs`. 21 unit + 4 E2E tests.
- R1-g `executor/hook-router.js#routeRemote` + `runnerWsHandler.js` message protocol — accepts `agent_started`/`agent_stopped`/`hook` frames. Hooks are report-only (broadcast `runner_hook` + bump stats; NEVER call into the local executor — runners are across the trust boundary, R1 is observe-only by design). Trust boundary lock: JWT-verdict `runId` is authoritative, frame body `runId` is ignored. 12 + 7 unit + 6 E2E tests.
- R1-g `childRegistry.registerRemote/unregisterRemoteById` — synthetic ref with no-op `kill()`, `remote: true` flag, idempotent on id. WS close auto-clears agents the runner forgot to stop (prevents leak on operator-killed runner host).
- R1-g+ readiness Star 3 upgrade — was in-process HMAC chain check (`audit_chain_round_trip`); now an end-to-end live check that boots an in-process orchestrator + runner agent, drives a real handshake → WS hello → `agent_started` frame → asserts the remote child appears in `childRegistry.snapshot()` with the right metadata AND the audit chain still verifies. Catches a much wider regression surface (WS demux, JWT verify, frame routing, child projection, ledger HMAC).
- Within the existing Safety 16/16 cap — R1-e+g+g+ completes the orchestrator-side primitives R1-j shipped (no cap raise; the runner-host code IS the deployment of what R1-j wired up). Net effect: **100 → 100** at landing time (the score moved with R1-j; e/g/g+ deliver the wired-up form).

**R1-k1 + R1-k2 + R1-k3 (Phase D R1, external review correctness round)**:
- R1-k1 namespace remote children by `{runId, hostIdentity, id}` triple — pre-fix, `unregisterRemoteById(id)` could clobber another run's projection on bare-id collision. Stop path now requires the same triple used at register time (ownership verify); mismatch returns false silently. Trust boundary held inside the registry, not just the handler.
- R1-k2 `runner_hook_routed` audit chain entry — pre-fix, the ledger only saw the error path on hook routing; accepted hook traffic was invisible in forensic audit precisely where the remote trust boundary is exercised. Now every successful `hookRouter.routeRemote` emits an entry carrying `hook` + `tool` + verdict's `runId` + `hostIdentity`. Deliberately omits `event.data` (size + sensitivity).
- R1-k3 runner-agent env validation — pre-fix, `Number("abc")`/`Number("0")`/`Number("-1")` produced NaN/zero/negative timer delays, breaking heartbeat cadence and disabling backoff. `_parsePositiveIntegerEnv` checks finite-positive-integer + applies a sane minimum (1000ms heartbeat / 100ms reconnect base / 1000ms reconnect max), throwing in the same config-error path used for missing required env so the runner crash-loops instead of quietly DDoSing the orchestrator.
- → +1.0 to "Pipeline orchestration and phase model" within the existing 15-point cap (was 14/15; R1-k closes the three correctness gaps that prevented "the multi-run pipeline orchestrator drives a remote runner host with the same isolation guarantees as a local run" from being a clean statement). Total cap stays at 110.
- Net effect: **100 → 101** as the runner-side primitives stop having known correctness holes that an external reviewer flagged P1/P2.

**Remaining R1 cleanup** (not committed): the reviewer marked all 3 issues "P1/P2 priority labels are aggressive; treat as ordinary correctness fixes" — explicit user directive on 2026-04-28. Closing them moved the reviewer's external score 97 → 99/110 by their own projection.

### Rubric scale change (R1-j)

The original 15-point cap on "Safety and security boundary" assumed
"local-mode hardening + future-trust-boundary RFC". With R1-a through
R1-i shipping the actual code that backs the design — JWT module, signed
ledger, runner registry, runner routes, Dockerfile, server wiring — the
cap of 15 is too tight. R1-j extends it to **16** to capture the
qualitative shift from "remote-mode designed" to "remote-mode primitives
shipped (orchestrator side)". The remaining R1-e + R1-g work (runner-host
agent + WS upgrade) won't move the cap further; that's "deployment
completeness" within the same conceptual ceiling.

| Area | Pre-R1-j max | Post-R1-j max |
| --- | ---: | ---: |
| Safety and security boundary | 15 | **16** |
| **Total** | 109 | **110** |

### Rubric scale change (MD2)

The original 10-point cap on "Testability and regression suite" assumed
"a strong test suite + occasional manual runs of validators". With CI
on every PR — and a readiness gate that fails when operational visibility
regresses — the cap of 10 is too tight. MD2 extends it to **11** to
capture the qualitative shift from "tests exist" to "tests gate merges".

| Area | Pre-MD2 max | Post-MD2 max |
| --- | ---: | ---: |
| Testability and regression suite | 10 | **11** |
| **Total** | 108 | **109** |

The 97 reflects "monitor shell as authoritative UI" + "doc trust" + "extraction pattern proven" + "regressions caught at PR time, not at production". The remaining 12 points are container sandbox + remote-mode (Phase 3, separate product round).

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

### Phase D Round 2.5 MC1~MC5 (live wiring correction)

- **MC1** — `layout.js` runTree.onSelect now calls `hydrateRunDetail` automatically with in-flight dedupe + 30s TTL cache. Fills the gap where MB1's per-run detail existed but no UI flow consumed it.
- **MC2** — `legacy-bridge.js` syncs run summary on 6 lifecycle events (`run_created` / `pipeline_start` / `phase_update` / `pipeline_paused` / `pipeline_complete` / `pipeline_reset`). Without this, run-tree only ever showed bootstrap-time runs.
- **MC3** — `run-summary.js` actively renders findings preview (severity counts + top 3) + replayMeta (checkpoint indicator) from `runDetails[selectedRunId]`.
- **MC4** — `readiness-report.js` upgraded from "module export check" to "behavior-verified". Star annotations now read "(behavior verified)" and the verifications instantiate real modules + drive them.
- **MC5** — `scripts/sync-scorecard.js` + `<!-- AUTO:* -->` markers + `scorecard:check` PR gate. Doc test counts can no longer drift from runner output.

### Phase D MA7 sub-slices (UI-3 rewrite readiness)

- **MA7-a** — Pure-DOM render helpers (renderToolFeed / renderCritiqueTimeline / renderFindingCounts / setBadge) extracted to `public/js/tool-feed-render.js`. State stays in app.js; only the render machinery moves.
- **MA7-b** — `openModal` + `closeModal` + phase-meta header lifted to `public/js/stage-modal.js` with the same stateless-renderer pattern.
- **MA7-c** — `subagent_started` + `subagent_completed` cases extracted to `public/js/event-handlers/subagent-events.js` and registered via `HarnessEventDispatcher.register`. The dispatcher fires before the legacy switch, so registered handlers short-circuit. **First module to use this extraction pattern** — future panel-specific handlers can drop in as their own UMD without touching the legacy switch.
- **MA7-d** (this update) — scorecard refreshed via `scripts/sync-scorecard.js`; auto-derived test counts kept in sync.

### Phase D Round MD MD1~MD3 (readiness automation)

- **MD1** — `scripts/sync-scorecard.js` switched from `--no-spawn` (6/15 static) to live mode by default. The auto-derived `<!-- AUTO:readiness-* -->` markers now reflect the same number an operator sees running `npm run readiness:check` by hand (currently 15/15). `--no-spawn` is preserved as a CLI escape hatch for sandboxed environments. `docs/readiness-rubric.md` Section 3 was rewritten — replaced the outdated "as of MB4-d" snapshot with a "Two modes" table and a "Star ledger" history.
- **MD2** — `.github/workflows/ci.yml` lands the actual PR gate. Every push to master + every pull_request runs: install → 4 test suites → verify:hooks → readiness:check (gate ≥ 14/15) → scorecard:check (gate doc freshness). `npm audit` is informational (continue-on-error). Until this slice, P5 readiness was scripts in `/scripts` — now it's regression protection.
- **MD3** (this update) — scorecard.md trajectory refreshed to 97; rubric scale extended (Testability cap 10 → 11, total max 108 → 109); plan file updated with Phase D Round MD section. Auto-derived markers refreshed via `npm run scorecard:sync`.

### Phase D Round ME ME1~ME2 (CI hygiene)

- **ME1** — `permissions: contents: read` (least-privilege workflow token), `concurrency` block (cancel in-progress runs on the same ref), and `env.FORCE_JAVASCRIPT_ACTIONS_TO_NODE24='true'` (opt-in to GitHub's 2026-06-02 default flip; surfaces Node 24 incompatibilities NOW). The CI run after this slice confirmed the v4 actions running cleanly under Node 24 (annotation: "actions/checkout@v4, actions/setup-node@v4 ... are being forced to run on Node.js 24").
- **ME2** — Bumped `actions/checkout@v4 → v6` and `actions/setup-node@v4 → v6` (the latest majors; both ship Node 24 natively). Breaking-change audit: checkout v6 "persists creds to a separate file" — irrelevant for our usage (no submodules / LFS / custom token); setup-node v6 "limit automatic caching to npm" — we already pass `cache: 'npm'` explicitly. The FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 env stays in place as belt-and-suspenders for any future @v4 action that gets added.

### Phase D Round MF MF1~MF2 (P4 Remote Sandbox RFC)

- **MF1** — `docs/remote-sandbox-rfc.md` (532 lines) — design-only consolidator covering all four P4 plan slices (A: boundary audit, B: isolation model, C: monitor metadata, D: rollout gates). Defines a `sandbox_class` taxonomy (`none` / `container-strict` / `vm-strict`) and a `run_origin` field (`local` / `container-local` / `container-remote` / `vm-remote`), both surfaced as additive monitor envelope fields. Specifies 10 rollout gates G1-G10 — none can land code; each must be GREEN before remote mode is exposed.
- **MF2** — Cross-links from the four predecessor docs (`remote-mode-design.md`, `container-sandbox.md`, `harness-architecture.md`, `security-model.md`) to the consolidator RFC. Scorecard backlog refreshed (P4 RFC moved from "Next round candidate" to "DONE"). Plan file gets Part H. Score: 97 → 98 reflecting the future-trust-boundary clarity (Safety and security boundary 14 → 15 within existing cap).

### Phase D Round MG MG1~MG2 (P4 Implementation RFC)

- **MG1** — `docs/remote-sandbox-impl.md` (702 lines) — implementation RFC. Closes MF1 §4 G10 by committing to specific tech for each MF1 §6 open question and specifying everything MF1 left undecided. §1 Docker rootless (daemon fallback) for `container-strict`; §2 `node:24-bookworm-slim` multi-stage image with SBOM; §3 WS primary `/api/runner/events` + HTTPS POST `/api/runner/hook` fallback; §4 HS256 JWT with HKDF-derived key from `HARNESS_TOKEN`; §5 extend existing `evidenceLedger` JSONL + HMAC-SHA256 per entry; §6 env-only runner control plane (heartbeat-driven discovery, no UI in this round); §7 3-layer egress (Docker `--internal` + nftables on bridge + dnsmasq allowlist); §8 3-step bootstrap (bootstrap token → runnerToken → runJWT); §9 10-row failure-mode table extending MF1 §4.2; §10 Phase R1 implementation specifics (G1-G9 verifications + readiness rubric extension to 18 stars).
- **MG2** (this update) — Cross-links from MF1 RFC (§4 G10 row, §6 open questions, §8 status). Scorecard trajectory + post-table-write delta + headline 98 → 99. Plan file Part I. The "Long-horizon" backlog gets P4 implementation RFC marked DONE in MG1; "P4 implementation slices (R1 internal preview)" promoted to "Next round candidate" pending operator sign-off on MG1.

### Phase D R1 (R1-a~R1-i + R1-d boost + R1-j) — orchestrator-side remote runner subsystem

This is the FIRST CODE that backs the MF1 + MG1 design RFCs. Not a
documentation round — the modules listed below are real, tested, and
live behind the `HARNESS_REMOTE_MODE` feature flag (default off).

- **R1-a** — Monitor envelope `origin` field. `src/routes/monitorRoutes.js` returns `{ runOrigin, sandboxClass, hostIdentity, isolationStatus }` on bootstrap + per-run detail. `public/js/monitor/normalizer.js` hoists matching keys from raw event payloads. Backwards-compat invariant: omit when absent so legacy clients see no shape change. Tests: 7 normalizer + 3 bootstrap + 4 run-detail.
- **R1-b** — `src/security/jwt.js` (~210 lines). `deriveJwtKey(ikm, opts)` HKDF-SHA256 with default `salt="harness-jwt-v1"`, `info="runner-jwt"`. `issue({runId, key, runDurationMs, harness})` produces an HS256 token; `verify({token, runId, key})` returns one of 6 frozen reason codes (STRUCTURE / PAYLOAD_PARSE / SIGNATURE / EXPIRED / AUD_MISMATCH / SUB_MISMATCH). Alg-confusion immune (header.alg ignored on verify). 27 unit tests.
- **R1-c** — `evidenceLedger` HMAC extension. Append-only JSONL hash chain now optionally signs each entry with `sig` + `sigVer:1` when a `signingKey` is configured (Buffer or string). `verifyChain(runId)` walks the chain, validates each link's `previousHash`, `dataHash`, `eventHash`, and signature. 13 new unit tests, 6 existing tests preserved.
- **R1-d** — `src/runtime/runnerRegistry.js` (in-memory state owner; ~210 lines) + `src/routes/runnerRoutes.js` (3 HTTP routes; ~155 lines). `/handshake` reads bootstrap from `Authorization: Bearer`, returns 32-byte hex runnerToken. `/heartbeat` accepts runnerToken, refreshes lastSeen. `/hook` accepts runJWT, delegates to `hookRouter.routeRemote(runId, payload)` if wired. Single-use bootstrap (replay → `bootstrap_consumed`). Health derivation by `lastSeen` freshness (healthy / degraded / unhealthy / lost). 18 unit + 14 integration tests.
- **R1-d boost** — Caught by code review before R1-e: heartbeat sliding TTL must anchor on `lastSeen`, not `issuedAt`, otherwise long-lived runners with continuous heartbeats expire after exactly `runnerTokenTtlMs` from handshake. Plus `claimRunForRunner` non-idempotent (double-counted retries) and not reassign-safe (phantom counts on previous host). 3 regression tests.
- **R1-f** — `Dockerfile.runner` (multi-stage, `node:24-bookworm-slim`, `npm ci --omit=dev --ignore-scripts`, non-root UID 10001:10001, `WORKDIR /work`, ENV NODE_ENV=production), `.dockerignore` (no orchestrator code in build context), `runner/index.js` (stub entrypoint exits with EX_CONFIG/78 — R1-e replaces with full agent), `scripts/build-runner.{sh,ps1}` (build + CycloneDX 1.5 SBOM via `npm sbom`). 13 lint + stub-exit tests.
- **R1-h** — `src/server/remoteRunnerSetup.js` reads `HARNESS_REMOTE_MODE` + `HARNESS_TOKEN`, derives `jwtKey` (HKDF info=`"runner-jwt"`) and `ledgerKey` (HKDF info=`"audit-ledger"`) from same IKM with domain separation, constructs `RunnerRegistry`. Empty env → mode=off + null registry + null keys; `preview/on` without token → degraded with `error: "token_missing"`; full env → full subsystem. server.js wires both into `EvidenceLedger` (gets signing key) and `createRunnerRoutes` (gets registry + jwtKey + ledger). 8 unit + 8 integration tests covering G1 (default closed), G3-tier1 (preview round-trip), G7-adj (claim/release).
- **R1-i** — `scripts/readiness-report.js` adds 6th category `remote-isolation` (3 stars, all in-process behavior checks): default fail-closed + HKDF JWT/ledger domain separation + audit chain HMAC round-trip. Rubric cap 5×3=15 → 6×3=18, gate thresholds re-scaled (release 14 → 17, preview 10 → 12, internal 6 → 7). CI workflow label updated. `docs/readiness-rubric.md` §2.6 documents the 3 stars.
- **R1-j** (this update) — Scorecard trajectory 99 → 100 + post-table-write delta + plan Part J. Safety cap extended 15 → 16 with rationale. Backlog refreshed. The "Long-horizon" backlog gets "P4 R1 implementation slices" partially struck — the orchestrator-side primitives are DONE but R1-e + R1-g are pending.

**Test counts grew from 936 unit / 197 integration (pre-R1) to <!-- AUTO:test-counts -->**1405 unit / 268 integration**<!-- /AUTO --> across R1-a through R1-k.** The R1 round added approximately +170 unit + +52 integration = +222 tests, all green.

### Phase D R1 e/g/g+ (paired runner-host completion)

After R1-j shipped the orchestrator-side primitives, the runner-host
side (R1-e + R1-g) followed in a paired round so the WS path-aware
demux design could be evaluated against `verifyWsConnection`'s
dashboard-focused auth gate.

- **R1-e-1** — `src/server/runnerWsAuth.js`: `createRunnerWsAuth` is a separate seam from `verifyWsConnection` so dashboard / terminal WS auth and runner WS auth live behind independent verifiers. URL-param protocol (`?runId=<id>&token=<runJWT>`) avoids leaking the JWT into Origin/Referer headers. WS close codes — 1008 (policy: bad credentials) / 1011 (internal: mode=off, no key). `isRunnerWsPath(reqUrl)` is exact-match on `/api/runner/events` (rejects suffix smuggling like `/api/runner/eventszebra`). 14 unit tests.
- **R1-e-2** — `src/server/runnerWsHandler.js`: connection callback emits a `hello` frame on connect (the runner uses it as its readiness signal), appends ledger entries on every state transition (`runner_ws_connected`, `runner_ws_disconnected`, `runner_ws_error`), tracks `messagesReceived/Routed/Dropped + lastFrameType` as a coarse health signal. Source-grep guard test (`tests/integration/runner-ws-upgrade.test.js`) ensures `verifyWsConnection` and `createRunnerWsAuth` stay separate — a careless future change can't accidentally route runner traffic through the dashboard gate.
- **R1-e-3** — `src/runner/runnerAgent.js`: ~300-line Node entrypoint. State machine: `IDLE → HANDSHAKING → RUNNING ⇄ RECONNECTING → SHUTTING_DOWN → STOPPED`. `start()` does handshake → schedule heartbeat → connect WS. Heartbeat 401 triggers re-handshake (no spin loop). WS close 1008/1011 → fatal stop; other codes → exponential backoff with full jitter, capped at `reconnectMaxMs`. `configFromEnv` reads required env (`HARNESS_BOOTSTRAP_TOKEN/HOST_IDENTITY/ORCHESTRATOR_URL/RUN_ID/RUN_JWT`) + optional (`HARNESS_HEARTBEAT_INTERVAL_MS/RECONNECT_BASE_MS/RECONNECT_MAX_MS/SANDBOX_CLASS`). DI for `fetch` / `WebSocketCtor` / clock / logger. `runner/index.js` (R1-f's stub at exit 78) replaced with the real entrypoint that traps SIGTERM/SIGINT for graceful shutdown. 21 unit + 4 E2E tests.
- **R1-g** — Message protocol `agent_started` / `agent_stopped` / `hook` parsed from the WS stream. Trust boundary: JWT-verdict `runId` is authoritative — frame body `runId` is never trusted. Hook routing is **report-only** for R1: broadcast a `runner_hook` event + bump stats; **NEVER** call into the local executor (`onPreTool`/`onPostTool`/etc.) because runners are across the trust boundary. R2+ adds an allowlist + tool-arg validation bridge. `executor/hook-router.js#routeRemote(runId, event)` is the entry point — it defensively copies `{hook, tool, data}` (rejects extra keys), validates runId/event shape, ignores empty/missing values, and emits a single broadcast per accepted hook. 12 + 7 unit tests.
- **R1-g** — `childRegistry.registerRemote/unregisterRemoteById` extension. Synthetic ref with no-op `kill()` so `killAll()` can't accidentally try to signal a remote process, plus a `remote: true` flag so `killAll()` skips them explicitly. Auto-cleanup on WS close: every agent the runner started during this connection but didn't explicitly stop gets unregistered (prevents leak on operator-killed runner host). 8 new unit + 6 E2E tests.
- **R1-g+** — Readiness Star 3 upgrade. Was in-process check that signed entries appended + `verifyChain` validated the HMAC; now an end-to-end live check that boots an in-process orchestrator + connects a `RunnerAgent` + drives an `agent_started` frame, then asserts the remote child appears in `childRegistry.snapshot()` with the right metadata AND the audit chain still verifies. Catches a much wider regression surface — a single broken module (WS demux, JWT verify, frame routing, child projection, ledger HMAC) now drops the star.
- Net runtime impact: a runner host can now connect to the orchestrator over `/api/runner/events`, register agents, emit hooks, and the orchestrator's `childRegistry` + audit chain + readiness rubric all observe the activity correctly. Default off (`HARNESS_REMOTE_MODE=off`) so single-orchestrator local-mode users see no behavioural change.

### Phase D R1-k1/k2/k3 (external review correctness round)

External review #5 (2026-04-28) flagged three correctness gaps in the
R1-e+g+g+ surface — none blocking but all worth closing before the
runner host gets exercised in anger. User directive: treat the P1/P2
priority labels as "ordinary fix priority", proceed in the reviewer's
recommended order.

- **R1-k1** — `childRegistry` remote children indexed by `{runId, hostIdentity, id}` triple instead of bare id. Pre-fix, two runner hosts (or a single host across two runs) could pick the same agent id (e.g. "claude-aaa") and the second `registerRemote` would silently piggy-back on the first; one `agent_stopped` would clobber both. Post-fix, the composite-key Map (`remoteByKey`) coexists both projections, and `unregisterRemote({id, runId, hostIdentity})` enforces ownership — mismatched scope returns `false` silently (the caller cannot tell whether the id existed under a different scope; that's by design). The handler's `agent_stopped` and close auto-cleanup paths both pull `runId + hostIdentity` from the JWT verdict, so a runner attempting to smuggle a stop for another run's child id is rejected by lookup miss. 7 new unit + 2 new integration tests covering: cross-run id coexistence, ownership verify on wrong runId / wrong hostIdentity, stop-frame body cannot override verdict scope, scoped auto-cleanup, missing-id defensive behavior.
- **R1-k2** — `runner_hook_routed` audit-chain entry on every successful `routeRemote` call. Pre-fix, the chain only logged the error path (`runner_hook_route_error`); accepted hook traffic was invisible in forensic audit exactly where the remote trust boundary is exercised. Post-fix, each accepted hook produces an entry carrying `hostIdentity` + `hook` + `tool` (extracted from the frame body, NOT trusting any extra fields) under the verdict's `runId`. The `event.data` payload is intentionally omitted — already broadcast on the bus for live consumers, may be too large / sensitive (file contents, command output, env vars) for the persistent ledger. 3 new unit tests + integration ledger anchor extension covering: chain-completeness contract, payload-omission contract, error-path mutual-exclusion (success entry must NOT fire when routing throws).
- **R1-k3** — Runner-agent env validation. Pre-fix, `configFromEnv` ran `Number(...)` on `HARNESS_HEARTBEAT_INTERVAL_MS` / `RECONNECT_BASE_MS` / `RECONNECT_MAX_MS` without checking the result; "abc" became NaN, "0" became zero delay, "-1" became negative timer. NaN delays pace at the engine's minimum, 0 spins the agent against the orchestrator, negative values fire timers immediately — none of which surface until first timer fire. Post-fix, `_parsePositiveIntegerEnv` checks `Number.isFinite + Number.isInteger + n >= min`, throwing in the same config-error path used for missing required env. Minimums: 1000ms heartbeat (sub-second spams the orch) / 100ms reconnect base / 1000ms reconnect max. The error message names the offending env var + the offending value so an operator can grep failure logs. 10 new unit tests covering: NaN / 0 / negative / fractional / below-min for each numeric env var, exactly-minimum boundary, no-env-default-intact regression.

**Test counts after R1-k**: 1093 → 1096 → 1106 unit (+20 across the three slices). Integration: 247 → 249 → 249 → 249 (+2; only R1-k1 added integration cases).

External review #5 projected score path: 97/110 → 99/110 with these three fixes closed. The self-score in this scorecard moves 100 → 101 (within the existing Pipeline orchestration cap; +1 reflects "the multi-run pipeline orchestrator drives a remote runner host with the same isolation guarantees as a local run" being a clean statement after R1-k closes the three correctness gaps).

## Operational facts

- Single canonical working tree: `C:\Users\SJ\harness-pipeline-analysis` @ `master`.
- Test counts: <!-- AUTO:test-counts -->**1405 unit / 268 integration**<!-- /AUTO --> + legacy + smoke, all green. _(line auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_
- server.js: 1075 → **799** lines (Phase D MA0 + MB4-b/d, **−276** lines).
- public/app.js: 2129 → **1877** lines (Phase D MB4-c + MA7-a/b/c + earlier AC, **−252** lines).
- New module footprint: 3 server modules (`wsAuth`, `generalPipelineRunner`, `eventBroadcaster`), 13 client modules under `public/js/monitor/` (store, normalizer, hydrate, legacy-bridge, layout + 8 panels), 4 client modules at `public/js/` root (terminal-mount, general-pipeline-modal, tool-feed-render, stage-modal), 1 client module under `public/js/event-handlers/` (subagent-events — first dispatcher-driven extraction). All UMD, all tested.

## Remaining backlog (priority order)

### Phase D follow-ups

- **MA7-d / extension**: more handleEvent cases via dispatcher.register (e.g. context_alarm, hook_event, codex_started, codex_progress). Each case extraction shrinks the legacy switch by 4-12 lines. Lower priority than Phase 3 prerequisites.
- **MA7 React island pilot** (optional, deferred): re-mount one monitor panel (e.g. Inspector) as a React island once the rest of the contracts settle. The DOM-free store/normalizer is already framework-ready.
- **Legacy-bridge "filter authoritative" star** (was the missing star-3 in event-integrity): MB5's flow test exercises the bridge; add an explicit assertion that filter chips don't drop events from the raw log.

### Phase 3-S security follow-ups

- **S3-b**: codex Windows `shell:true` → `cmd.exe /c` wrapper (Node 24 `DEP0190` prep). Defer until Node 24 lands in the runtime schedule.
- **`pipeline-executor.js` major decomposition**: the most valuable refactor but also the most sensitive core. Revisit after MA7.

### Long-horizon (not committed)

- ~~**R2.5 — Remote execution bridge**~~ — **DONE**. See [`docs/reports/2026-04-28-r2-5-execution-bridge-eval.md`](./reports/2026-04-28-r2-5-execution-bridge-eval.md). 5-hook + 3-tool allowlist + pure sanitizer + async controlled dispatch + 5-verb audit narrative + live end-to-end probe (5/5 PASS). G4 hook ingress auth lifted from "partial PASS" (R2) to "full PASS" (R2.5).
- ~~**R2 — Single remote runner deployment evaluation**~~ — **DONE**. See [`docs/reports/2026-04-28-r2-single-runner-eval.md`](./reports/2026-04-28-r2-single-runner-eval.md). All MF1 §4.1 gates G1-G9 verified live on the operator's Docker Desktop with repeatable probe scripts (`scripts/r2-{eval,probe-egress,monitor-probe,lifecycle-probe}.{sh,ps1}`).
- **R3 — Multi-runner pool + Linux host + per-call approval** — design-only R3-0 plan landed; see [`docs/r3-rollout-plan.md`](./r3-rollout-plan.md). Splits into 5 sub-rounds:
  - ~~**R3-a**~~ — **DONE**. Two-network topology (`harness-r2-operator` + `harness-r2-runner`), orchestrator dual-homed, runner+probe single-homed on internal-eligible bridge. Strict override flips ONLY runner bridge to `internal: true`. R3-G01 (dashboard host port reachable in strict) + R3-G02 (egress isolation preserved) verified live on Docker Desktop: r2-eval 4/4, r2-probe-egress 6/6, r2-monitor-probe 4/4. Pre-R3-a strict mode returned 000 on host curl (R2-4 known-gap §3 row 1); post-R3-a it returns 200.
  - **R3-b** — Linux host nftables L2 + dnsmasq L3 enforcement; **REQUIRES Linux host** (Docker Desktop NOT sufficient — see plan §3 evidence taxonomy: WSL2 NAT + bridge model fails to reproduce real Linux primitives).
  - ~~**R3-c**~~ — **DONE (primitives + monitor)**. Registry layer (R3-c-1): `selectFreshRunner` (LEAST_LOADED + FIFO tie-break), `pruneStaleRunners` (observation-only stale list with affectedRuns), `getAssignment` (public surface; surfaces stale claims for fail-not-forward), handshake collision detection with new `host_in_use` reason → routes layer emits `runner_handshake_collision` audit (vs `runner_handshake_rejected` for stale-replay). Runtime layer (R3-c-2): `RunnerStaleMonitor` periodic prune wired into server.js — single-emit `runner_host_lost` audit row when a stale host has stranded runs, dedupe-on-recovery semantic, idle stale hosts skipped (operator housekeeping, not signal), ledger-failure resilient (retried on next tick), `HARNESS_RUNNER_STALE_INTERVAL_MS` env hook for tighter cadence. R3-G06 + R3-G07 + R3-G09 + R3-G10 closed; R3-G08 fairness algo verified by unit + integration, live deployment evidence deferred to R3-d/e (R2.5 single-runner deployments don't trigger host_lost because the WS handler unmarks active-run on disconnect — by design, since R2.5 model treats disconnect as run-end).
  - **R3-d** — graceful shutdown polish: clean WS close 1000 distinguishable from 1006 crash; RunnerAgent state machine learns to differentiate.
  - **R3-e** — per-call approval flow for Bash / Write / Edit; default-deny on timeout (default 30s, configurable); scope = exact `(tool, args-hash)` tuple; approve-the-bridge-not-the-path semantics with `dangerGate.js` as second line.
  - 15 acceptance gates R3-G01..G15 with sub-round mapping + evidence-type requirements + dependency graph. R3 COMPLETE = all GREEN OR R3-G03..G05 explicitly UNVERIFIED ("Linux host unavailable") + others GREEN — honest partial verdict allowed.
  - Pending operator sign-off on R3-0; once signed, R3-a is the next round candidate.
- **R1-stability follow-up** — flaky `evidenceLedger` TTL test causing intermittent marker drift in `sync-scorecard`. Pattern observed 4× during R1 round (commits `deb417c`, `b8e3434`, `c97fb5b`, and partial drift during R1-k3 sync). Root cause: the TTL test races between scheduled timer fire and assertion. Fix: jitter-tolerant assertion + retry logic in `sync-scorecard.js` (extract count 2× consecutively, max 3 attempts). Lower priority than R2 — current pattern is "next push fixes it" with no operational impact.
- **Phase 3 (D platformization)** — container sandbox + remote-mode hardening + per-user RBAC. Separate product round; conditions in plan §Phase 3 still unmet. The MF design RFC + MG implementation RFC are two prerequisites; multi-tenant authentication and HA orchestrator remain separate.
- ~~**P4 design RFC**~~ — **DONE in MF1**. See [`docs/remote-sandbox-rfc.md`](./remote-sandbox-rfc.md).
- ~~**P4 implementation RFC**~~ — **DONE in MG1**. See [`docs/remote-sandbox-impl.md`](./remote-sandbox-impl.md). Closes MF1 §4 G10.
- ~~**P5 readiness automation**~~ — **DONE in MD2 + R1-i**. `npm run readiness:check` exits non-zero in CI when the live score drops below 17/18 (was 14/15 pre R1-i); `npm run scorecard:check` blocks merge when AUTO markers are stale. R1-i added the 6th category (remote-isolation, 3 stars, all behavior-verified).
- ~~**P4 R1 orchestrator-side implementation**~~ — **DONE in R1-a~R1-i + R1-d boost**. Envelope origin field, JWT module, signed audit ledger, runner registry, 3 HTTP routes, Dockerfile, server.js wiring, readiness rubric extension.
- ~~**P4 R1-e + R1-g (paired runner-host)**~~ — **DONE**. `createRunnerWsAuth` path-aware demux + `createRunnerWsHandler` connection lifecycle + `RunnerAgent` Node entrypoint + WS message protocol + `childRegistry` remote projection + readiness Star 3 upgraded to live RTT.
- ~~**R1-k external review correctness round**~~ — **DONE in R1-k1/k2/k3**. Composite-key remote children with stop-path ownership verify (R1-k1) + hook success audit chain entries (R1-k2) + runner-agent env validation with sane minimums (R1-k3). External review #5 projected 97 → 99/110.

### Rubric scale change (R2)

The original 16-point cap on "Safety and security boundary" assumed
"orchestrator-side primitives shipped + design-verified containment."
With R2 explicitly running the harness end-to-end on the operator's
real Docker Desktop and producing repeatable evidence anchors for all
nine MF1 §4.1 gates, the cap of 16 is too tight. R2 extends it to **17**
to capture the qualitative shift from "design-verified" to
"deployment-verified". The remaining 8 points sit in R3 multi-runner
+ Phase 3 platformization headroom.

| Area | Pre-R2 max | Post-R2 max |
| --- | ---: | ---: |
| Safety and security boundary | 16 | **17** |
| **Total** | 110 | **111** |

### Rubric scale change (R2.5)

R2 verified that the remote runner subsystem deploys safely. R2.5
adds a different qualitative axis: hooks emitted by the remote
runner can now drive the local executor — but only through an
allowlist + sanitization + full audit narrative, gated behind
`HARNESS_REMOTE_BRIDGE_MODE`. The Safety cap extends 17 → 18 to
capture this "controlled execution bridge" property, distinct from
"deployment-verified containment."

| Area | Pre-R2.5 max | Post-R2.5 max |
| --- | ---: | ---: |
| Safety and security boundary | 17 | **18** |
| **Total** | 111 | **112** |

The remaining 9 points sit in:

- R3 multi-runner pool + Linux host (~3 points: layer 2 + 3 egress
  enforcement, two-network dashboard topology, WS close 1000 path).
- Per-call approval flow for write-side tools (~3 points: opening
  Bash / Write / Edit through a separate decision channel).
- Phase 3 multi-tenant orchestrator (~3 points: per-user RBAC,
  audit log retention, runner-pool scheduling).

### Rubric scale change (D0-e)

The original 5-point cap on "Config, portability, onboarding"
assumed the user is a **developer who runs `node start.js` from a
checked-out repo**. Phase E1 D0 changes the audience: the user is
now an **operator who installs from a release zip and double-clicks
`harness-start.bat`**. That qualitative shift — from "you need git
and npm" to "you need Node 24 and a download" — outgrew the 5-point
cap. D0-e (the hardening sub-slice that closed atomic install +
https-only manifest URL + port-squat defense) extends the cap to
**8** to match the qualitative shift; D1 profile + credential will
push category further within the new headroom.

| Area | Pre-D0-e max | Post-D0-e max |
| --- | ---: | ---: |
| Config, portability, onboarding | 5 | **8** |
| **Total** | 112 | **113** |

The +1 score (103 → 104) within the new cap reflects:
- Cross-platform launcher (Windows 1st-class, Mac/Linux best-effort)
- OS-aware config + data dir resolution with `HARNESS_DATA_DIR`
  portable-mode override
- Atomic install with self-healing (partial-dir sweep + sentinel
  detection); SHA256 quarantine on mismatch
- https-only manifest URL with explicit `HARNESS_ALLOW_INSECURE_MANIFEST_URL=1`
  dev-only escape hatch
- Port-squat defense: `verify-health` checks `app:"HarnessPipeline"`
  before treating a 200 as "already running"
- 25 smoke tests covering CLI bridge contract + atomic install
  semantics + verify-health gate

The remaining headroom (104 → 113) is reserved for:
- D1 profile + credential layer (~2 points: keytar fail-closed
  credential store, profile JSON schema + round-trip + switch,
  spawn-env rewiring through profileSpawn)
- D2 setup wizard + cliProbe (~1 point: 8-step first-run flow with
  Claude/Codex CLI discovery + profile creation + workspace
  permission check + test calls)
- D3 UI account status + settings panel (~1 point: global-bar
  account cell + accounts-modal switch UX)
- UX-0/UX-1/UX-2 simple/advanced/legacy mode shell + welcome
  overlay + per-call approval card (~2 points)
- E2 launch overhead — backup/restore/uninstall + manifest signing
  for public distribution (~3 points; E3 territory)

## Phase D R2 progress (single-runner deployment evaluation)

This is the FIRST round where the harness runs as an actual deployed
process on the operator's machine. Not an in-process integration
test — real `docker compose up` against the maintainer's Docker
Desktop. The R1 design IS deployable, but R2 surfaced 8 latent bugs
that the unit + integration suites alone could not catch (see report
§4 for the table).

- **R2-0 — Stability preflight**: deterministic `evidenceLedger` TTL
  test (was flaky on Windows-Date.now-15ms-tick races) + double-read
  stabilization in `sync-scorecard.js` (re-runs each suite up to 5
  times until two consecutive readings agree). Marker drift pattern
  that recurred 4× through the R1 round has not reappeared.
- **R2-1 — Eval harness**: `Dockerfile.orchestrator` (multi-stage,
  non-root UID 10100, /app/dashboard layout, EvidenceLedger volume),
  `Dockerfile.orchestrator.dockerignore` (BuildKit per-Dockerfile
  ignore, since the project-wide one is tuned for the runner image
  and excludes orchestrator code paths),
  `docker-compose.r2-single-runner.yml` (orchestrator + runner +
  profile-gated probe sidecar; cap_drop:[ALL] + no-new-privileges
  on every service; loopback-only port publish; persistent named
  volume for the audit chain), `.env.r2.example` (schema reference),
  `r2-up`/`r2-down`/`r2-eval` scripts with bash + PowerShell
  counterparts.
- **R2-2 — Live control-plane smoke** (4/4 PASS): handshake → ws hello
  → `runner_handshake_ok` + `runner_ws_connected` audit-chain
  entries on the operator's Docker Desktop. Eight Dockerfile / script
  bugs found and fixed in this slice (see report §4).
- **R2-4 — Network strict probes** (6/6 PASS):
  `docker-compose.r2-strict.override.yml` flips the runner network to
  `internal: true`. Alpine probe sidecar verifies cloud-metadata IP
  + 3 RFC1918 ranges + DNS public host all BLOCK while the
  intra-bridge orchestrator path stays ALLOW. MG1 §7 layer 1 only;
  layers 2 (nftables) + 3 (dnsmasq) are R3 follow-up.
- **R2-3 — Monitor / auth round-trip** (4/4 PASS):
  `bootstrap.runners[]` + `activeChildren[]` (remote=true entry) +
  per-run-detail `origin` envelope + `runner_hook_routed` audit chain
  all populate live. R1-k2's forensic anchor verified end-to-end
  through real Docker network.
- **R2-5 — Workspace / load / graceful shutdown** (5/5 PASS):
  `/work/out` is tmpfs+noexec; `/work/in` is absent by default
  (operator-supplied ro mount only); 3 sequential lifecycle cycles
  leave `activeChildren` remote count at 0 (R1-k1 namespace fix
  holds under throughput); orchestrator stop → runner reconnect
  backoff → orchestrator restart → runner re-handshake on
  heartbeat-401 (R1-e-3 path verified live, not just in unit tests
  with mocked fetch).
- **R2-6 — Closeout report**: GO verdict for R2.5. See
  `docs/reports/2026-04-28-r2-single-runner-eval.md`. Scorecard
  refreshed to 102/111 with Safety cap extended 16 → 17 (deployment-
  verified containment).

## Phase D R2.5 progress (controlled remote execution bridge)

R2.5 lifts the remote runner subsystem from "report-only" (R1/R2)
to "controlled dispatch" — sanitized hooks now reach the local
executor under an explicit feature flag, with full audit-chain
narrative for every accepted, rejected, and dispatched frame.

- **R2.5-a — Bridge contract**:
  `src/runtime/remoteHookBridgeContract.js` pins the wire format
  with `Object.freeze`'d constants (5 allowed hooks, 3 read-only
  tools, per-hook payload schemas with required-keys + response
  byte cap, executor method bindings, 5-verb audit vocabulary,
  8-reason frozen reject vocabulary). Operator-facing
  [`docs/remote-hook-bridge-contract.md`](./remote-hook-bridge-contract.md)
  documents the contract with off→report→dispatch promotion path.
  20 paranoid lint tests catch unintended widening (adding a
  banned hook name or write-side tool fails the build).
- **R2.5-b — Sanitization layer**:
  `src/runtime/remoteHookSanitizer.js` is a pure function
  `sanitizeRemoteHook(rawEvent) → {ok, sanitized | reason}` that
  defensive-copies only allowlist keys (drops everything else
  including `__proto__` for prototype-pollution resistance),
  enforces required-keys, JSON-roundtrips PostToolUse responses
  to break caller aliasing. `routeRemote` becomes async + returns
  a structured verdict; the WS handler emits `runner_hook_routed`
  → `runner_hook_rejected | _sanitized` audit verbs based on the
  verdict shape.
- **R2.5-c — Controlled execution bridge**:
  `HookRouter.routeRemote` extended with bridgeMode awareness
  (off / report / dispatch). When dispatch mode + sanitization
  passes, calls `executor.method(...args)` per the contract's
  `EXECUTOR_DISPATCH` mapping; result lands in `verdict.dispatched`
  for the WS handler to emit `runner_hook_dispatched | _dispatch_error`
  with method + error fields. `_resolveExecutorByRunId(runId)`
  uses orchestrator.getOrCreateRun (lazy promotion of runner-claimed
  runId to pipeline run) → orchestrator.get → singleton executor
  fallback. Tests: 14 routeRemote (mode + dispatch + reject + stats)
  + 3 WS handler audit-verb cases.
- **R2.5-d — Run visibility**:
  `RunnerRegistry._activeRunIds` Map<runId, {hostIdentity, since}>
  + `markRunActive` / `unmarkRunActive` / `getActiveRunMeta` /
  `listActiveRuns`. WS handler marks on connect, unmarks on close
  (best-effort; throws caught). `monitorRoutes` falls back to
  `runnerProvider.getActiveRunMeta(runId)` when
  `pipelineOrchestrator.get(runId)` returns null — runner-claimed
  run gets a 200 response with placeholder shape (`run.status:
  "runner-claimed"`, origin synthesized from runner metadata,
  children filtered to runId). Closes R2 closeout report's known-
  gap §3.
- **R2.5-e — Live end-to-end proof**:
  `scripts/r2-5-bridge-probe.{sh,ps1}` brings up the harness with
  `HARNESS_REMOTE_BRIDGE_MODE=dispatch`, injects one valid
  PreToolUse Read + one rejected PreToolUse Bash from the runner
  container, verifies all five anchors live (5/5 PASS):
  `runner_hook_dispatched method=onPreTool`,
  `runner_hook_rejected reason=tool_not_allowed`,
  `runner_hook_sanitized` (precondition for dispatch),
  `hookStats.remoteHookDispatched ≥ 1`,
  `/api/monitor/runs/<verdict.runId>` returns 200. G4 hook ingress
  auth lifts from R2's "partial PASS" to R2.5's "full PASS".
  `/api/server/info` exposes `hookStats` for at-a-glance bridge
  throughput observation.
- **R2.5-f — Closeout report** (this slice): GO verdict for R3.
  See `docs/reports/2026-04-28-r2-5-execution-bridge-eval.md`.
  Scorecard refreshed to 103/112 with Safety cap extended 17 → 18
  (controlled execution bridge).

## Phase D R3 progress (rollout plan + acceptance gates locked before code)

R3 broadens the deployment model from one runner host to a pool,
exercises layers 2 + 3 of MG1 §7 on a real Linux host, refines
graceful shutdown semantics, and finally opens write-side tools
through a per-call approval channel. The five sub-rounds are
sequenced so the highest-risk surface (write-tool approval) lands
last, after isolation and pool infrastructure are solid. Per the
operator's explicit guidance: *"R3는 multi-runner, Linux host
networking, write-tool approval이 한 번에 엮이면 폭발하기 쉬워서,
먼저 acceptance gate를 고정하는 게 좋습니다. 특히 nftables/dnsmasq는
Windows Docker Desktop이 아니라 Linux host 증거가 필요합니다."*

- **R3-0** (this update) — Rollout plan landed at
  [`docs/r3-rollout-plan.md`](./r3-rollout-plan.md). Defines:
  - 5 sub-rounds (R3-a two-network, R3-b Linux host L2+L3, R3-c
    multi-runner pool, R3-d graceful shutdown, R3-e per-call
    approval).
  - 15 acceptance gates R3-G01..G15 with sub-round mapping +
    evidence-type requirements + dependency graph. R3 COMPLETE =
    all GREEN OR R3-G03..G05 explicitly UNVERIFIED ("Linux host
    unavailable") + others GREEN — honest partial verdict allowed.
  - Evidence taxonomy distinguishing in-process tests, Docker
    Desktop probes, Linux host probes, and live operator workflow.
    R3-G03..G05 (the L2/L3 egress gates) cannot pass on Docker
    Desktop alone — Linux host required because WSL2 NAT layer
    sits between bridge and host network, mangling the packets
    R3-b is supposed to drop.
  - 13-row risk register covering Linux host availability,
    nftables version skew, operator-bridge new attack surface,
    multi-runner host-id collision, scheduling fairness, WS-close-
    code distinguishability, approval UX latency, approval scope
    leakage (mitigated by `(tool, args-hash)` exact tuple),
    write-tool sanitization regex strictness, etc.
  - 12 open questions intentionally deferred to sub-round PR
    decisions (operator-bridge naming, Linux distro pinning,
    escape-hatch reset semantics, hostIdentity collision
    transparency, fail-vs-reassign default, WS shutdown ack
    semantics, approval UI placement, approval timeout default,
    approval scope granularity, tool-result return path).
  - Out-of-scope items deferred to R4 (vm-strict, GPU,
    custom Dockerfiles) or Phase 3 (multi-tenant, HA, cross-region,
    external IdP).

R3-0 is design-only. No code touched. No tests added or removed.
The plan document is the deliverable; it locks R3 acceptance gates
before any sub-round implementation begins. Score stays at 103/112
— this follows the ME1/ME2 precedent of discipline/planning rounds
that increase credibility without moving the rubric.

- **R3-a** (this update) — Two-network topology landed.
  Closes R2 eval §3 row "Strict mode breaks dashboard host port"
  by splitting the single bridge into:
  - `harness-r2-operator` (non-internal) — host port mapping path,
    only the orchestrator attaches.
  - `harness-r2-runner` (internal-eligible, flipped by the strict
    override) — orchestrator + runner + probe attach. Egress
    severed under strict mode without affecting the dashboard.

  Orchestrator is dual-homed; runner and probe are single-homed
  on the runner-internal bridge so a misconfigured attachment
  cannot accidentally route runner egress through the open
  operator path. The lint test extension (`tests/unit/r2-compose-lint.test.js`)
  asserts both topology invariants — orchestrator on both, runner
  + probe NOT on operator — plus a regression guard that the
  operator network never gets `internal: true`.

  Live verification under R3-a strict (Docker Desktop):
  - `r2-eval` 4/4 PASS (was 3/4 in R2-4 strict — the host-curl
    anchor was 000; now 200).
  - `r2-probe-egress` 6/6 PASS (cloud-metadata + 3 RFC1918 + DNS
    public BLOCK; intra-bridge ALLOW — egress isolation preserved).
  - `r2-monitor-probe` 4/4 PASS (R1-k2 forensic anchor + G5
    monitor metadata round-trip unaffected by the topology change).

  R3-G01 + R3-G02 of the R3 acceptance gates are now GREEN. Score
  stays at 103/112 — operational fix, no rubric move; the R3
  rubric movement waits for R3-c (multi-runner pool) and R3-e
  (per-call approval) to land qualitatively new properties.

- **R3-c-1** (registry primitives) — Three additive `RunnerRegistry`
  surfaces:
  - `selectFreshRunner({ maxConcurrentRunsPerHost = Infinity })`
    — least-loaded healthy runner with FIFO tie-break by
    registration order (Map insertion); skips stale (elapsed >
    heartbeatDropMs) and saturated hosts. Pure read; caller MUST
    `claimRunForRunner` immediately to avoid double-dispatch.
  - `pruneStaleRunners()` — observation-only listing of stale
    hosts + each entry's `affectedRuns` (runIds claimed for that
    host). Sorted longest-silent-first. Doesn't mutate registry
    state — caller (R3-c-2 monitor) decides policy.
  - `getAssignment(runId)` — public surface for the existing
    `_hostFor` test hook. Returns the bound hostIdentity even
    when the host is stale (R3-G09 fail-not-forward — orchestrator
    surface, not registry, decides what to do with stranded runs).
  - Plus handshake collision detection: replay-while-fresh now
    returns `host_in_use` (NEW reason); the routes layer translates
    that into `runner_handshake_collision` audit (NEW ledger entry
    type). Replay-after-stale stays `bootstrap_consumed` —
    single-use semantic preserved through staleness; rejoin still
    requires env rotation.

- **R3-c-2** (runtime monitor) — `src/runtime/runnerStaleMonitor.js`
  + server.js wiring. Periodic interval (default 30s = registry's
  `heartbeatDropMs`) calls `pruneStaleRunners` and emits
  `runner_host_lost` audit rows for stale hosts WITH stranded
  runs. Single-emit per host-loss event (dedupe set clears on
  recovery). Idle stale hosts (no claimed runs) are intentionally
  silent — operator housekeeping, not security signal. Wired into
  `start()` alongside the existing ledger-cleanup interval; stops
  via the `server.close` hook so graceful shutdown reaps it.
  `HARNESS_RUNNER_STALE_INTERVAL_MS` env hook for ops.

  R3 gate coverage at registry/monitor layer:
  - R3-G06 collision detection ✅ closed
  - R3-G07 stale-runner cleanup ✅ closed (audit chain emits the
    forensic anchor)
  - R3-G08 fairness ✅ algo (LEAST_LOADED + FIFO tie-break);
    live deployment evidence requires multi-runner orchestrator
    dispatch wiring deferred to R3-d/e
  - R3-G09 fail-not-forward ✅ semantic locked at registry layer
    (`getAssignment` does not auto-forward stale claims)
  - R3-G10 monitor visibility ✅ closed (3-host real-RunnerRegistry
    test on `/api/monitor/bootstrap`)

  Live R2.5 single-runner deployment intentionally does NOT trigger
  `runner_host_lost` because the R2.5 WS handler unmarks active-run
  on disconnect (R2.5-d), treating disconnect as run-end. The
  monitor IS running and ticking correctly — verified by integration
  tests. `runner_host_lost` rows fire when a future multi-runner
  orchestrator-dispatch flow holds claims past WS disconnect.

## Phase E1 D0 progress (productization launcher)

D0 is the FIRST round whose primary user is the **operator at install
time**, not the developer in a checked-out repo. Every prior round
assumed `git clone` + `npm install` + `node start.js`. D0 closes the
"can a non-developer run this from a release zip?" gap.

The five sub-slices ship in dependency order: D0-a (JS foundation) →
D0-b (Windows 1st-class) → D0-c (Mac/Linux best-effort) → D0-d (smoke +
docs) → D0-e (hardening). User feedback after D0-d flagged four
production-readiness gaps that D0-e closed before D1 entry.

- **D0-a — JS foundation** (commit `c0e68cc`):
  `src/runtime/configPaths.js` (resolve OS-aware config + data dirs:
  Win `%APPDATA%`/`%LOCALAPPDATA%`, mac `~/Library/Application Support`,
  Linux XDG; `HARNESS_DATA_DIR`/`HARNESS_CONFIG_DIR` env overrides for
  portable-mode USB-stick installs; `versionInstallDir(version)` rejects
  path-traversal characters). `src/runtime/launcherManifest.js`
  (`validateManifestSchema` enforces required-fields + https-only URL +
  64-char lowercase-hex SHA256 + parseable ISO8601 publishedAt + semver
  versions; `sha256OfFile` chunked-read; `timingSafeHexEqual` constant-
  time; `verifySha256`; `compareSemver`; `checkRuntimeVersion`).
  `scripts/launcher/manifest.json.example` references the trust scope
  in a `_comment` field. +43 unit tests
  (`tests/unit/configPaths.test.js` + `launcherManifest.test.js`).

- **D0-b — Windows 1st-class launcher** (commit `08f02d3`):
  `harness-start.bat` (UTF-8 BOM + CRLF, dev/installer 2-mode, 10s
  health budget, `HARNESS_NO_BROWSER=1` for CI). Companion PS1 scripts:
  `install-version.ps1` (manifest fetch + SHA256 verify + extract;
  mismatch → quarantine), `check-update.ps1` (notify-only, no
  auto-update — supply-chain risk too high for unattended fetch+exec).
  cmd.exe traps caught + fixed during this slice: `::` comments inside
  `( ... )` blocks are parsed as labels and spam stderr (use `rem` instead);
  `set /p var=<file` is unreliable inside `( ... )` (use `for /f
  "usebackq"`); `timeout /t 1` aborts under redirected stdin (use
  `ping -n 2 127.0.0.1` instead); `)` inside echo lines inside `(...)`
  blocks prematurely terminates the block (escape via `^)`). Operator
  guide reiterates trust scope at top + bottom: INTERNAL/PRIVATE only
  until E3 Release Hygiene adds manifest signing.

- **D0-c — Mac/Linux best-effort** (same commit `08f02d3`):
  `harness-start.sh` (mode 100755, identical contract: `nohup`
  background + `<INSTALL_DIR>/launcher.log`, `open`/`xdg-open` browser
  fallback). `install-version.sh` (long-option-only parser to sidestep
  BSD-vs-GNU getopt portability, jq-free manifest parse, `unzip`-or-`tar`
  extraction). `check-update.sh` (`--json` flag for cron consumers).
  `.gitattributes` pins `*.bat`/`*.ps1`/`*.cmd`/`*.psm1` → `eol=crlf`,
  `*.sh` → `eol=lf` so `core.autocrlf=true` cloners on Windows don't
  break the bash launchers with "bad interpreter" errors.

- **D0-d — Smoke test + docs** (same commit `08f02d3`):
  `scripts/launcher/launcher-cli.js` (~180-line Node CLI bridge —
  PowerShell + bash share one source of truth for SHA256 + semver +
  paths + manifest validation; without it, three launcher
  implementations would drift). `tests/smoke/launcher-portable.test.js`
  (+15 cross-platform smoke tests covering --help → unknown command →
  validate-manifest happy/sad paths → BOM tolerance → SHA256
  match/mismatch → compare-semver single-token contract → check-runtime
  → resolve-paths HARNESS_DATA_DIR override → version-install-dir
  path-traversal rejection → manifest-field → launcher-files-exist
  regression guard). `docs/operator-guide.md` documents the two
  deployment scenarios + env table + manifest format + troubleshooting
  + trust-scope disclaimer.

- **D0-e — Launcher hardening** (commit `1655e55`, this section):
  Four production-readiness gaps closed in one focused commit.

  - **D0-e-1 HARNESS_MANIFEST_URL https:// enforcement.** The manifest
    fetch is the unprotected step in the trust chain — it happens
    BEFORE any signature exists, so the only thing protecting it is
    the channel's transport security. Pre-D0-e, the launcher fetched
    manifest from any URL the operator gave it: an MITM could swap the
    manifest entirely (URL + sha256) and the launcher would happily
    install whatever zip the swapped manifest pointed at. Post-D0-e,
    `launcher-cli validate-manifest-url <url>` runs before any network
    I/O in install-version.{ps1,sh}, check-update.{ps1,sh}, and the
    .bat/.sh entry points. Uses URL parsing (not regex) so credentials/
    ports/paths are handled correctly. `HARNESS_ALLOW_INSECURE_MANIFEST_URL=1`
    escape hatch for dev/test (file://, http://localhost) prints a loud
    stderr WARNING every time so operators can never quietly drift from
    the safe default.

  - **D0-e-2 Bash manifest field extraction unified through `manifest-field`.**
    The previous bash sites used inline `node -e "process.stdout.write(
    require('$MANIFEST_FILE').field);"` which broke when the manifest
    path contained spaces or shell metacharacters (single-quoted inside
    double-quoted inside `$(...)` — three layers of quoting, all
    fragile). All five sites (install-version.sh's VERSION/ZIP_URL/
    EXPECTED_SHA, check-update.sh's LATEST_VERSION/PUBLISHED_AT,
    harness-start.sh's MIN_NODE) now go through `launcher-cli
    manifest-field` which shares the BOM-tolerant + JSON.parse logic
    the schema validator uses. Cross-platform parity now extends to
    field extraction, not just schema validation.

  - **D0-e-3 Atomic install via `.install-complete` sentinel.**
    Pre-D0-e the install dir was created and extracted into in-place.
    A power loss or Ctrl-C mid-extract left a partial directory that
    the next launcher run mistook for a complete install — silently
    launching a half-extracted server. Post-D0-e: extract into a
    per-run `<Version>.partial-<ts>` staging dir → atomic
    `Move-Item`/`mv` to the final `<Version>` location → write the
    `.install-complete` sentinel LAST. An install is "complete" iff
    BOTH the directory AND the sentinel exist. `install-version.{ps1,sh}`
    sweeps stale `<Version>.partial-*` dirs at start and removes any
    `<Version>` directory missing the sentinel before a fresh extract.
    A crash between rename and sentinel-write self-heals on the next
    install attempt. Concurrent-reader safety: rename-into-place is
    atomic at the filesystem layer (NTFS + POSIX), so harness-start
    reading `last-install.txt` during an install never sees a
    half-extracted state.

  - **D0-e-4 `/api/health` discriminator + `verify-health` command.**
    Pre-D0-e the launcher's "already running" branch fired on any 200
    response from `/api/health` — including from unrelated services
    squatting port 4201. The launcher would then open the browser,
    sending the operator into someone else's app. Post-D0-e:
    `src/routes/healthRoutes.js` adds `{app:"HarnessPipeline",
    healthVersion:1}` to every `/api/health` response (additive — all
    existing consumers, including docker healthchecks, still pass).
    `launcher-cli verify-health <url>` does a structural check against
    those fields. `harness-start.{bat,sh}` swap raw `curl /api/health`
    for `verify-health` in BOTH the start-time "already running?"
    check AND the post-launch health-poll loop.

  Test counts: 1309 unit (no change), 268 integration (no change),
  16 smoke → 25 smoke (+9 D0-e tests covering https accept / http
  reject / file:// reject / escape hatch warning / malformed URL +
  verify-health real-server / wrong-app / non-JSON / unreachable).

D0 (a-e) closes the launcher round. Next step in Phase E1 is **D1
profile + credential + spawn rewiring** — the round that makes the
harness usable by an operator with their own Claude/Codex account
instead of the developer-supplied env vars.

## What 104 means

Single-user local harness with multi-run isolation, hardened external-input boundaries, AND a monitoring-first opt-in console with live data flow + agent observability + per-run detail contract + flow-level readiness rubric + behavior-verified readiness scoring + auto-derived doc trust + dispatcher-driven extraction pattern + CI-enforced regression protection + **a complete remote-execution design RFC** + **a complete implementation RFC with concrete tech decisions for runtime / image / JWT / ledger / control plane / network egress / bootstrap / failure recovery** + **the orchestrator-side primitives of remote mode actually shipped — JWT module + signed audit ledger + runner registry + handshake/heartbeat/hook routes + Dockerfile + server.js wiring + 6th readiness rubric category (remote-isolation, behavior-verified)** + **the runner-host primitives that complete the remote subsystem — WS path-aware demux + connection-lifecycle handler + `RunnerAgent` Node entrypoint + WS message protocol + `childRegistry` remote projection + readiness Star 3 upgraded to live runner→orchestrator round-trip** + **external-review correctness hardening — composite-key remote children with stop-path ownership verify + hook success audit-chain entries + runner-agent env validation that fails fast on bad numeric env** + **R2 single-runner deployment evaluation completed — all MF1 §4.1 gates G1-G9 verified live on the operator's Docker Desktop with repeatable probe scripts; 8 latent bugs surfaced and fixed** + **R2.5 controlled remote execution bridge — sanitized hooks now drive the local executor under an opt-in feature flag, with allowlist (5 hooks × 3 read-only tools), pure sanitizer with prototype-pollution resistance, and a 5-verb audit narrative (routed → rejected | sanitized → dispatched | dispatch_error). G4 hook ingress auth lifted from "partial PASS" to "full PASS"; runner-claimed runs are first-class in `/api/monitor/runs/:runId`**. The next-round work splits into two complementary axes: **R3 multi-runner pool + Linux host** for the layer 2/3 egress enforcement R2-4 left open, and a **per-call approval flow** before opening Bash / Write / Edit through the bridge. **R3-0 (plan) + R3-a (two-network topology) + R3-c (multi-runner pool primitives) landed**. R3-0 locked the gates; R3-a closes R2-4's dashboard host port gap (orchestrator dual-homed; strict override flips runner bridge only); R3-c ships the multi-runner pool primitives at registry + monitor layer (`selectFreshRunner` LEAST_LOADED + FIFO tie-break, `pruneStaleRunners` observation, `getAssignment` public surface, handshake collision detection with new `host_in_use` reason and `runner_handshake_collision` audit, `RunnerStaleMonitor` periodic prune wired into server.js with single-emit `runner_host_lost` audit row + dedupe-on-recovery + idle-host skip + ledger-failure resilience). R3-G01 + R3-G02 + R3-G06 + R3-G07 + R3-G09 + R3-G10 are GREEN. R3-G08 fairness algo verified by unit + integration; live deployment evidence deferred to R3-e. **R3-d (graceful shutdown polish) landed** — `src/server/shutdown.js` walks `wss.clients` on SIGTERM/SIGINT, sends `ws.close(1000, "orchestrator_shutdown")` to runner-bound connections; `runnerAgent.js` differentiates clean-1000 from 1006-crash and 1011/1008-fatal. **Phase E1 D0 (a-e) closed the productization launcher** — operator can install from a release zip, double-click `harness-start.bat` (or `./harness-start.sh`), and the launcher fetches/SHA256-verifies/atomic-installs/launches/health-checks/opens-browser, with https-only manifest URL, port-squat defense via `app:"HarnessPipeline"` discriminator, atomic install via `.install-complete` sentinel, and a `verify-health` CLI that distinguishes our server from any 200-OK responder. Config/portability cap extended 5 → 8 to capture the audience shift from "developer with `git clone`" to "operator with a download". Next: **R3-b** (Linux host nftables L2 + dnsmasq L3, requires Linux host), **R3-e** (per-call approval for write-side tools), and the **D1 profile + credential layer** that makes the harness usable with the operator's own Claude/Codex account instead of the developer-supplied env vars.

The MB1~MB6 + MC1~MC5 + MA7-a/b/c rounds closed the highest-leverage structural debt without bloating the surface. Each lift was behaviour-preserving + locked by tests; the file shrinkage is genuine. server.js dropped 276 lines, app.js dropped 252 lines. Module footprint expanded by 21 small UMD/Node modules, all under test, all CSP-compliant.

The "rewrite readiness" claim is now concrete: any new panel-specific handler can be added by creating a UMD that calls `HarnessEventDispatcher.register` — proven by `subagent-events.js` (MA7-c). React islands are unblocked when needed; the `monitor/store.js` + `monitor/normalizer.js` DOM-free contract is the seam.

The MD round added the missing operational layer: until MD2, every regression-prevention measure in this codebase (1133 tests, the readiness rubric, the scorecard sync) lived inside `npm run` scripts that operators COULD run but weren't required to. With the GitHub Actions workflow active, the same scripts now block merges. The qualitative shift — from "the suite exists" to "the suite gates the branch" — is what the Testability cap extension (10 → 11) captures.

The ME round was small but disciplined: GitHub flips the default JS-action runtime to Node 24 on 2026-06-02 and removes Node 20 entirely on 2026-09-16. ME1 opted in early via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and validated under v4 actions; ME2 then bumped checkout + setup-node to v6 (Node 24 native). Plus `permissions: contents:read` (least-privilege) and `concurrency: cancel-in-progress` (kill races between rapid pushes).

The MF round shifts the trust-boundary conversation from "vague future" to "design done, gates named". `docs/remote-sandbox-rfc.md` (532 lines) consolidates run origin + sandbox class + workspace/process/token/fs/network boundaries + UI metadata + 10 rollout gates G1-G10 into a single document. **No code lands until G10 (a follow-up implementation RFC) is approved.** Score 97 → 98 reflects the trust-boundary clarity, not implementation — the design _IS_ the deliverable for this round.

The MG round closes MF1 §4 G10 by committing to specific tech for each of MF1 §6's four open questions. `docs/remote-sandbox-impl.md` (702 lines) chooses **Docker rootless** (with daemon fallback) for `container-strict`, leaving kata/firecracker reserved for `vm-strict` in Phase R4. Hook ingress = **WS primary + HTTPS POST one-shot fallback**. JWT = **HS256, HKDF-derived from `HARNESS_TOKEN`** (separate label from the audit-ledger HMAC key, so neither use can forge the other). Audit ledger = **extend the existing `evidenceLedger` JSONL hash chain with HMAC-SHA256 per entry** (not a switch to SQLite — current scale ~900K rows fits append-only comfortably). Plus the runner-host control plane (env-only, heartbeat-driven discovery), the 3-layer egress policy (Docker `--internal` + nftables on bridge + dnsmasq allowlist on the controlled resolver), the 3-step bootstrap handshake (bootstrap token → runnerToken → runJWT), and the 10-row failure-mode table extending MF1 §4.2. Score 98 → 99 reflects the rollout phasing concreteness — operators can now audit each Phase R1-R4 phase against named criteria.

The R1 round (a/b/c/d/d-boost/f/h/i/j) ships the first code that backs the design. Every primitive that MG1 §1-§5 specifies — HKDF key derivation, HS256 JWT issue/verify with alg-confusion immunity, HMAC-signed audit ledger entries with `verifyChain` round-trip, single-use bootstrap → 24h sliding-TTL runnerToken → per-run runJWT taxonomy, `RunnerRegistry` with idempotent claim + reassign-safe transfer, default-off feature flag — is now real, tested code under `src/security/`, `src/runtime/`, `src/routes/`, and `src/server/`. The Dockerfile ships at `pipeline-dashboard/Dockerfile.runner` (multi-stage, non-root UID 10001, `--ignore-scripts` build layer) with companion build script + CycloneDX 1.5 SBOM tooling. The readiness rubric grew from 5×3=15 to 6×3=18 stars with the new remote-isolation category (3 stars, all in-process behavior-verified). Test counts moved 936/197 → 1025/226 across the round (+89 unit, +29 integration). Score 99 → 100 reflects the orchestrator-side primitives actually being deployable, not just designed. The runner-host agent + WS `/api/runner/events` upgrade are deliberately deferred to a paired R1-e + R1-g round so the path-aware demux design can stand independent of `verifyWsConnection`'s dashboard-focused auth gate.
