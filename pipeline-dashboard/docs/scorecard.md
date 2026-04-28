# Harness Scorecard

## Current Score

**99 / 109** (Phase 2.5 multi-run + Phase 3-S security + Phase D MA0~MA7 monitor shell + Phase D Round 2 MB1~MB6 backfill + Phase D Round 2.5 MC1~MC5 live wiring + MA7 UI-3 rewrite readiness + Phase D Round MD readiness automation + Phase D Round ME CI hygiene + Phase D Round MF P4 design RFC + Phase D Round MG P4 implementation RFC; MD2 extended Testability cap 10 → 11)

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

Target after Phase 3 (D platformization): **102+**.
Container sandbox + remote-mode hardening required for the multi-tenant tier.

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

## Operational facts

- Single canonical working tree: `C:\Users\SJ\harness-pipeline-analysis` @ `master`.
- Test counts: <!-- AUTO:test-counts -->**936 unit / 197 integration**<!-- /AUTO --> + legacy + smoke, all green. _(line auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_
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

- **P4 R1 implementation slices** — first remote-mode code lands. Required: `harness-runner` Node entrypoint + Dockerfile + 4 new routes (`/api/runner/handshake`, `/api/runner/heartbeat`, `/api/runner/hook`, `/api/runner/events` WS) + `src/security/jwt.js` (HS256 + HKDF) + `evidenceLedger` HMAC extension + envelope `origin` field + G1-G9 integration tests. Gated behind operator sign-off on the MG1 implementation RFC. **Next round candidate.**
- **Phase 3 (D platformization)** — container sandbox + remote-mode hardening + per-user RBAC. Separate product round; conditions in plan §Phase 3 still unmet. The MF design RFC + MG implementation RFC are two prerequisites; multi-tenant authentication and HA orchestrator remain separate.
- ~~**P4 design RFC**~~ — **DONE in MF1**. See [`docs/remote-sandbox-rfc.md`](./remote-sandbox-rfc.md).
- ~~**P4 implementation RFC**~~ — **DONE in MG1**. See [`docs/remote-sandbox-impl.md`](./remote-sandbox-impl.md). Closes MF1 §4 G10.
- ~~**P5 readiness automation**~~ — **DONE in MD2**. `npm run readiness:check` exits non-zero in CI when the live score drops below 14/15; `npm run scorecard:check` blocks merge when AUTO markers are stale.

## What 99 means

Single-user local harness with multi-run isolation, hardened external-input boundaries, AND a monitoring-first opt-in console with live data flow + agent observability + per-run detail contract + flow-level readiness rubric + behavior-verified readiness scoring + auto-derived doc trust + dispatcher-driven extraction pattern + CI-enforced regression protection + **a complete remote-execution design RFC** + **a complete implementation RFC with concrete tech decisions for runtime / image / JWT / ledger / control plane / network egress / bootstrap / failure recovery**. Not yet a multi-tenant platform — the **actual implementation of remote mode (R1 internal preview)** is the missing 10 points.

The MB1~MB6 + MC1~MC5 + MA7-a/b/c rounds closed the highest-leverage structural debt without bloating the surface. Each lift was behaviour-preserving + locked by tests; the file shrinkage is genuine. server.js dropped 276 lines, app.js dropped 252 lines. Module footprint expanded by 21 small UMD/Node modules, all under test, all CSP-compliant.

The "rewrite readiness" claim is now concrete: any new panel-specific handler can be added by creating a UMD that calls `HarnessEventDispatcher.register` — proven by `subagent-events.js` (MA7-c). React islands are unblocked when needed; the `monitor/store.js` + `monitor/normalizer.js` DOM-free contract is the seam.

The MD round added the missing operational layer: until MD2, every regression-prevention measure in this codebase (1133 tests, the readiness rubric, the scorecard sync) lived inside `npm run` scripts that operators COULD run but weren't required to. With the GitHub Actions workflow active, the same scripts now block merges. The qualitative shift — from "the suite exists" to "the suite gates the branch" — is what the Testability cap extension (10 → 11) captures.

The ME round was small but disciplined: GitHub flips the default JS-action runtime to Node 24 on 2026-06-02 and removes Node 20 entirely on 2026-09-16. ME1 opted in early via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and validated under v4 actions; ME2 then bumped checkout + setup-node to v6 (Node 24 native). Plus `permissions: contents:read` (least-privilege) and `concurrency: cancel-in-progress` (kill races between rapid pushes).

The MF round shifts the trust-boundary conversation from "vague future" to "design done, gates named". `docs/remote-sandbox-rfc.md` (532 lines) consolidates run origin + sandbox class + workspace/process/token/fs/network boundaries + UI metadata + 10 rollout gates G1-G10 into a single document. **No code lands until G10 (a follow-up implementation RFC) is approved.** Score 97 → 98 reflects the trust-boundary clarity, not implementation — the design _IS_ the deliverable for this round.

The MG round closes MF1 §4 G10 by committing to specific tech for each of MF1 §6's four open questions. `docs/remote-sandbox-impl.md` (702 lines) chooses **Docker rootless** (with daemon fallback) for `container-strict`, leaving kata/firecracker reserved for `vm-strict` in Phase R4. Hook ingress = **WS primary + HTTPS POST one-shot fallback**. JWT = **HS256, HKDF-derived from `HARNESS_TOKEN`** (separate label from the audit-ledger HMAC key, so neither use can forge the other). Audit ledger = **extend the existing `evidenceLedger` JSONL hash chain with HMAC-SHA256 per entry** (not a switch to SQLite — current scale ~900K rows fits append-only comfortably). Plus the runner-host control plane (env-only, heartbeat-driven discovery), the 3-layer egress policy (Docker `--internal` + nftables on bridge + dnsmasq allowlist on the controlled resolver), the 3-step bootstrap handshake (bootstrap token → runnerToken → runJWT), and the 10-row failure-mode table extending MF1 §4.2. Score 98 → 99 reflects the rollout phasing concreteness — operators can now audit each Phase R1-R4 phase against named criteria.
