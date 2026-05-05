# Harness Scorecard

## Current Score

**120 / 126** (Phase 2.5 multi-run + Phase 3-S security + Phase D MA0~MA7 monitor shell + Phase D Round 2 MB1~MB6 backfill + Phase D Round 2.5 MC1~MC5 live wiring + MA7 UI-3 rewrite readiness + Phase D Round MD readiness automation + Phase D Round ME CI hygiene + Phase D Round MF P4 design RFC + Phase D Round MG P4 implementation RFC + **Phase D R1 a~i + e + g + g+ — full remote runner subsystem** + **Phase D R1-k1/k2/k3 — external review correctness round** + **Phase D R2 — single-runner deployment evaluation (live verified)** + **Phase D R2.5 — controlled remote execution bridge with allowlist + sanitization + full audit narrative** + **Phase E1 D0-a~e — productization launcher (harness-start.bat/.sh + atomic install + https-only manifest URL + port-squat defense)** + **Phase E1 D1-a~g — profile + credential + spawn rewiring + public-sector policy baseline + audit sanitizer** + **Phase E1.5 GOV-SB-0 — sandbox-only execution + local_executor_blocked audit emission** + **Phase E1.5 GOV-PII-0 — KR-focused inline PII gate with public-sector block / standard warn** + **Phase E1.5 D2-a~d — first-run setup wizard with cliProbe + 3-tier providerProbe + 5-endpoint setupRoutes + interactive Node wizard with standard / public-sector dual tracks** + **Phase E1.5 D3-a~d — UI account-status surface: server-info account block + monitor-store accountStatus slice + global-bar 4 new cells + settings-accounts modal with test/switch/delete** + **Phase E1.5 GOV-PII-1-a/b — deep file-import scan: piiScanner depth selector + 사업자등록번호 (BRN with check digit) + 한국 운전면허 + 한국 여권 + /api/security/scan endpoint + pii_file_scan_blocked / pii_file_scan_warn audit verbs** + **Phase D R3-e + GOV-APPROVAL-0 + UX-2-a/b/c — per-call operator approval for write-tool dispatch with PII-aware approval card: ApprovalManager state machine + /api/approvals routes + hook-router gate + 4 new audit verbs (runner_hook_approval_requested/granted/denied/timeout) + write-tool sanitizer extension + piiScanner integration on args + monitor-store pendingApprovals slice + legacy-bridge sync + approval-card panel + layout integration** + **Phase D Round UI-H (UI-H0~H6) — SJ Harness Dashboard mockup integration: design-token layer (`harness-shell.css` with --hsh-* custom properties + reduced-motion + public-sector visual overrides) + simple/advanced/legacy shell mode foundation (URL > localStorage > envDefault > "simple" priority + mode-toggle pill panel) + Harness Track panel (galloping-horse pipeline visual tied to actual run phase via pure horse-state-machine, NEVER fakes progress) + Dual Agent Console (read-only Claude+Codex stream view, no PTY/stdin) + ReviewSessionManager state machine + 5-endpoint /api/review-sessions API for Claude→Codex→Claude relay + security-status card (surfaces GOV-SB-0/PII-0/PII-1/APPROVAL stack at-a-glance) + Simple shell with 4 operator-friendly cards (지금 AI가 하는 일 / 승인 필요 / 최근 결과 / 연결 상태)** + **Phase D Round UI-H7 (UI-H7-a~e) — Review Relay End-to-End: store reviewSessions slice with 8 actions + reviewStreams capped at 500 chunks/side + legacy-bridge consumes 7 review-session WS broadcast types + 7-method HTTP client (`createSession/sendToCodex/followUp/handBackToClaude/archiveSession/getSession/listSessions`) with structured error mapping + dual-agent-console action row with 5 state-aware buttons (start / send-codex / followup-codex / hand-back / archive) + posture-aware UI gating (publicSector + !allowLocalExecutor hides hand-back + shows posture badge + maps server 409 to operator-friendly Korean message via `_formatReviewError`) + claude-runner / codex-runner accept `reviewSessionId` opts hint piping stdout chunks into `manager.recordCodexChunk` / `recordClaudeChunk` + emit `recordCritiqueReceived` (with severityCounts derived from `_extractFindings`) / `recordClaudeReceived` on successful close + new POST `/api/review-sessions/:id/archive` route (idempotent on already-archived)**; MD2 extended Testability cap 10 → 11; R1-j extended Safety cap 15 → 16; R2 extended Safety cap 16 → 17; R2.5 extends Safety cap 17 → 18; **R3-e + GOV-APPROVAL-0 extends Safety cap 18 → 19 — write-tool dispatch (Bash/Edit/Write) is now gated behind operator approval with PII-aware decision context, distinct audit-verb prefix from sanitization-time rejections, and fail-closed defaults**; D0-e extends Config/portability cap 5 → 8; D1-g extends Config/portability cap 8 → 10; **D2 fills Config/portability cap 9 → 10 — operator double-clicks `harness-start.bat`, the wizard discovers Claude/Codex CLIs, builds an agency-managed or personal profile, and sets it active**; **D3 fills UI feedback loop cap 6 → 7 — operator sees posture / profile / bridge / remote at-a-glance in the global bar AND manages profiles via the settings modal (test Claude / test Codex / switch / delete) without leaving the dashboard**; **UI-H extends UI feedback loop cap 7 → 8 — operator-friendly simple shell + Harness Track + Dual Agent Console + Claude↔Codex review relay all live, with public-sector posture flowing through every panel**; **UI-H4 fills Pipeline orchestration cap +1 (last-mile of operator-driven multi-agent workflow API)**; **UI-H7 extends Dual-agent integration cap 10 → 11 — review relay shifts from "two AI streams that the operator can observe" to "two AI streams that the operator drives via 5 typed actions (start session / send to Codex / follow up / hand back / archive), with chunks routed back into the right session via runner-side reviewSessionId hints, and a posture-aware Korean error layer when the policy refuses a hand-back"**; **LV (Live Verification Round) extends Dual-agent integration cap 11 → 12 — operator click → server dispatcher → real codex.cmd binary engagement → audit chain captures dispatch_started + 3045ms real-binary execution + dispatch_failed (graceful) is now LIVE-verified, not just stub-verified. The chain works end-to-end with the operator's installed Codex/Claude CLIs**; **E1.5 Public-sector readiness cap 4 → 5 — GOV-SB-0 + GOV-PII-0 + GOV-PII-1 + GOV-AUDIT-0 + GOV-RELEASE-0 (Ed25519 manifest signing module + sign-manifest CLI + verify-manifest-signature launcher hook + offline trust-store verification); cap fully filled at 5/5** + **Phase 2 UI-P5..P9 (UI Reference Port closeout) — operator now navigates the reference HTML's full-screen 5-region layout (Header 52px / HarnessTrack 92px / PipelineRail 320|380px / MonitorGrid / DualTerminals 280px) at /, with: live store wiring for every panel (UI-P5), Review Relay action row + live Codex/Claude stream chunks override the UI-P4 mock (UI-P6), KO/EN locale toggle that wires `HarnessI18n.setLang` + `?mode=advanced → pro` deprecated-alias coercion + 46 mirrored `prod.*` i18n keys (UI-P7), legacy-view dismissible deprecation banner with `localStorage["harness:legacy-banner-dismissed"]` persistence + CTA pointing back to / (UI-P8), and CI-runnable visual contract gate that diffs `tests/visual/baseline-product-shell.json` against current state every push: extract.js (HTML/CSS/panel shape extractors) + capture.js (single-source-of-truth snapshot builder) + 479-line baseline JSON + tests/unit/visual.contract.test.js (10 tests) + scripts/visual-baseline-update.js (operator escape hatch + `--check` staleness gate) + npm `visual:check` / `visual:update` scripts + ci.yml visual-contract-freshness step alongside scorecard:check (UI-P9). The legacy view stays available indefinitely (operator escape hatch with no EOL) at /?mode=legacy. UI-P9 extends UI feedback loop cap 8 → 9 — visual regression discipline is qualitatively new in the harness rubric: the structural snapshot fails CI loudly when ANY documented surface (mount ID, design token, panel slot, CSS class, script load order, legacy banner CSS classes) drifts away from the committed baseline. Operator escape hatch (`npm run visual:update`) keeps the gate ergonomic; the JSON diff lands in the same PR as the code change for line-friendly review.**)

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
- **Phase D R3-d** (graceful shutdown polish — `server.js:294-345` `gracefulShutdown` walks `wss.clients` on SIGTERM/SIGINT, sends `ws.close(1000, "orchestrator_shutdown")` to runner-bound connections marked `_isRunnerWs`, then `childRegistry.killAll("SIGTERM")` + 1s grace + `SIGKILL`; signal handlers wired at `server.js:1212-1213` (process.on SIGINT/SIGTERM); `src/runner/runnerAgent.js:131-143` `stop()` emits clean close 1000 + state machine differentiates 1000 vs 1006 vs 1011/1008; `tests/integration/runner-shutdown.test.js` 9/9 green) — **103/112** (operational fix, no rubric move per R3-0 plan; **no separate `src/server/shutdown.js` file** — architecture chose to keep it inside `server.js`)
- **Phase E1 P0** (envFilter for Claude/Codex spawn — `src/security/envFilter.js` filters TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL keys from spawn env unless allowlisted; closes the gap where `executor/claude-runner.js` + `executor/codex-runner.js` previously inherited `process.env` wholesale, leaking HARNESS_TOKEN + provider tokens to agent children) — **103/112** (precondition for D1 profile + credential layer; cap unchanged because the fix lands as a security baseline, not a new capability)
- **Phase E1 D1-a/b/c/d/e/f/g + D1-gov-1..5** (profile + credential + spawn rewiring + public-sector policy baseline + EvidenceLedger sanitizer — `src/security/credentialStore.js` (fail-closed by default, keytar OS-keychain or HARNESS_ALLOW_PLAINTEXT_SECRETS=1 dev escape, `credential_set/_deleted/_plaintext_fallback/_backend_unavailable` audit verbs, profileId+key sanitation), `src/runtime/profileStore.js` (atomic temp+rename writes, schema-version mismatch loud-fail, BOM tolerance, `profile_created/_updated/_deleted/_switched` audit, agency-layer fields when public-sector), `src/runtime/profileSpawn.js` (4-layer env composition: P0 base → profile lookup → credential injection → telemetry env, refuse partial-credential spawn), `src/policy/deploymentProfile.js` + `src/policy/publicSectorPolicy.js` (HARNESS_DEPLOYMENT_PROFILE resolver — public-sector flips every fail-closed flag together; validateProfileForPublicSector + assertLocalExecutorAllowed), runner integration in claude-runner.js + codex-runner.js (async IIFE wraps `_tryExec` body so `await buildSpawnEnv` fits between `dangerGate` and `spawn()`; defense-in-depth `assertLocalExecutorAllowed` from runner itself + inside profileSpawn; emits `profile_spawn_env_built`), `src/routes/profileRoutes.js` (CRUD + active-run-gated /switch returning 409 + `profile_switch_blocked` audit + secret KEY-only listing/setting/deleting + public-sector violation → 400 with structured details), `src/security/auditSanitizer.js` (recursive secret-name redaction with SAFE_KEY_NAMES allowlist, prototype-pollution skip, cycle protection, depth limit; threaded through EvidenceLedger.append BEFORE hashing so chain + signature cover the sanitized form), server.js wires the full stack including `evidenceLedger` with `sanitizer: sanitizeAuditData` and `createProfileRoutes` with `isActiveRun: () => childRegistry.snapshot().length > 0`. End-to-end live verified: `harness-start.bat` boots → `GET /api/profiles` returns `{profiles:[], activeProfileId:null}`) — **105/115** (Config/portability cap extended 8 → 10 — captures the shift from "operator double-clicks the launcher" to "operator runs Claude/Codex with their own agency account through profile + credential management"; +137 unit, +26 integration tests)
- **Phase E1.5 GOV-SB-0** (sandbox-only execution at runtime — `src/policy/publicSectorPolicy.js` adds `assertSandboxWorkspaceRequired(profile, deploymentProfile)` as a SECOND spawn-time gate so a profile with `workspaceMode != "sandbox"` can never launch under public-sector posture even if it landed via a legacy file format / hand-edit / mid-process posture flip; `POLICY_BLOCK_CODES` frozen Set of {`PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED`, `PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED`} that the runner audit-emitter consults; `src/runtime/profileSpawn.js` calls the new gate immediately after `profileStore.get()` so a profile lookup that succeeds under standard mode still gets policy-checked under public-sector before any credentials inject; `executor/claude-runner.js` + `executor/codex-runner.js` emit a stable `local_executor_blocked` audit row carrying `{runner, reason, profileId, policyMode}` whenever an `err.code` lands in `POLICY_BLOCK_CODES` — D1-f sanitizer is a defense-in-depth backstop on the audit data shape; +9 unit + 6 integration tests, all green) — **106/116** (Public-sector readiness cap 3, score 1 — sandbox-only enforcement is now live-verified at three layers: profileStore upsert validation (D1-gov-2), profileSpawn re-check (GOV-SB-0), and runner-level defense-in-depth with stable audit emission (GOV-SB-0). The cap leaves 2 stars for GOV-PII-0 (next slice) + later GOV-PII-1 deep-scan / GOV-AUDIT-0 evidence export)
- **Phase E1.5 GOV-PII-0** (inline KR-focused PII gate before provider dispatch — `src/security/piiScanner.js` (333-line fast detector: 주민등록번호 with check-digit + birth-date + gender-code validation, Korean mobile/landline phone, email, credit card with Luhn; PATTERNS frozen registry; samples ALREADY redacted at the scanner level so audit chain never carries raw PII; 4KB scan completes in <1ms, spec ceiling 50ms) + `src/security/piiGate.js` (159-line pure decision function — `enforcePiiGate(text, {deploymentProfile, source})` returns `{ok, blocked, scan, reason, auditVerb, auditData}`; public-sector → `pii_scan_blocked` row + spawn refused; standard → `pii_scan_warn` row + spawn proceeds; fail-closed on either `requirePiiScanBeforeProviderDispatch=true` OR `scannerFailurePolicy="block"` signal) + runner integration in claude-runner.js + codex-runner.js (gate fires inline immediately after `buildSpawnEnv` and before `spawn()`; verdict's auditVerb decides which row fires; on block resolves with `code: "PII_SCAN_BLOCKED"` and unwinds runRegistry start). +49 unit + 6 integration tests, all green; counts 1455 → 1504 unit / 300 → 306 integration. Live-verified end-to-end via `gov-pii-block.test.js`: standard mode + KRN prompt → spawn proceeds + `pii_scan_warn` audit, public-sector + KRN prompt → spawn refused + audit) — **107/118** (Public-sector readiness 1 → 2; remaining 1 star reserved for GOV-PII-1 deep-scan when an attachment lands on disk; `pii_scan_blocked` is now the second public-sector audit verb on the deny path, joining `local_executor_blocked` from GOV-SB-0)
- **Phase E1.5 D2-a/b/c/d** (first-run setup wizard — `src/runtime/cliProbe.js` cross-platform `where`/`which` with strict CLI-name allowlist + shell:false baseline + 5s default timeout; `src/runtime/providerProbe.js` 3-tier probe (installed → authenticated → canRun) with public-sector defense-in-depth refusal, frozen ERROR_CODES + PROBE_MODES + TIER_TIMEOUT_MS + RUNNER_CONFIG (claude/codex), version + accountLabel parsers, fail-closed `RATE_LIMITED` detection on tier 3; `src/routes/setupRoutes.js` 5-endpoint HTTP API (`POST /api/setup/{probe-node, probe-cli, probe-provider, probe-workspace, finalize}`) with tier-3-requires-consent gate, profileId 404, profileStore-not-wired 503, public-sector violation 400 with `details[]`, active-run 409 + `setup_finalize_blocked` audit; `scripts/setup-wizard.js` 608-line interactive Node wizard with **standard track** (8 steps: Node/Claude CLI/Codex CLI/profile/workspace/optional auth tests/finalize) and **public-sector track** (skips local CLI discovery; collects agency-managed accountType + sandbox workspaceMode + dataClassification + egressPolicyId; REQUIRES three operator acknowledgments — sandbox runner configured / PII scanner active / trusted internal release — before finalize); `scripts/setup-wizard.{ps1,sh}` thin wrappers (35-40 lines each) that resolve sibling .js + Node sanity check + arg pass-through. End-to-end verified via stub fetch + stub prompt across both tracks. +52 unit / +24 integration / +17 smoke tests, all green) — **108/118** (Config/portability cap 9 → 10 fully filled — D0-e was 6/8, D1-g lifted cap to 10 with 9/10 score, D2 closes the last point with the operator-facing wizard. Public-sector readiness stays 2/3 — the wizard's public-sector track collects fields and acknowledgments but doesn't yet probe sandbox-runner connectivity or perform deep-scan; those live behind future GOV-* slices)
- **Phase E1.5 D3-a/b/c/d** (UI account-status surface — server contract + store slice + global bar + operator modal threaded into one round. `src/routes/serverControlRoutes.js` (D3-a) extends `/api/server/info` with 4 ADDITIVE blocks: `profile {activeId, activeLabel, count, credentialBackend}` + `deployment {mode, publicSector, allowLocalExecutor, allowPlaintextSecrets, requireSandboxWorkspace, requirePiiScan}` + `bridge {mode}` + `remote {mode, activeRunnerCount}`. Stable-shape contract — every block is ALWAYS present even when its dep is missing; defensive try/catch around every dep means an observability path can NEVER break the info endpoint. `public/js/monitor/store.js` (D3-b) adds `accountStatus` slice with partial-friendly `setAccountStatus({profile, deployment, bridge, remote})` — missing sub-blocks preserve last-known-good (a partial poll response from a future server change can't wipe state). Defensive shallow copies in snapshot prevent mutation reaching back into store state. `public/js/monitor/legacy-bridge.js` (D3-b) refresh() maps the four blocks to ONE setAccountStatus call per poll (single re-render), only fires when at least one D3 block is present (legacy server response doesn't clobber state). `public/js/monitor/panels/global-bar.js` (D3-c) adds 4 cells: `profile` (active label + "+N" suffix or "(setup)" + warn tone), `posture` (standard / public-sector with ERROR tone for public-sector + flag summary tooltip), `bridge` (off/report/dispatch with WARN tone for dispatch), `remote` (off/preview/on with active runner count + WARN when count > 0; singular/plural noun in tooltip). `public/js/monitor/panels/settings-accounts.js` (D3-d, 370 lines) is the operator-facing modal that lets the operator manage profiles: list all profiles with active marker, Test Claude / Test Codex per profile via `/api/setup/probe-provider mode=tier1+2` (no token spend, result cached panel-local), Switch profile (POST `/api/profiles/:id/switch` with 409 active-run toast), Delete profile (DELETE with `window.confirm()` guard so accidental click can't wipe a profile), PUBLIC_SECTOR_BLOCKED test result → operator-readable toast routing to "use sandbox runner". `public/js/monitor/layout.js` (D3-d) mounts the settings panel into a hidden region; global-bar Settings button toggles `is-hidden` so the test result cache + in-flight fetches survive close. `public/index.html` adds the panel script before layout.js (CSP-safe external src). +52 unit + 18 integration tests, all green) — **109/118** (UI feedback loop cap 6 → 7 fully filled — operator now sees posture / profile / bridge / remote at-a-glance AND manages profiles without leaving the dashboard. End-to-end verified via stub fetch + JSDOM-style DOM stubs; account-status flows from server-info → store slice → global-bar cells AND through the settings modal's per-profile actions. Public-sector readiness stays 2/3 — D3 exposes existing posture state but doesn't add a defense layer)
- **Phase E1.5 GOV-RELEASE-0 (Ed25519 manifest signing + offline trust-store verification)** (Closes the deferral GOV-AUDIT-0 closeout report flagged: "public-key signature — HMAC is symmetric — GOV-RELEASE-0 next round layers manifest signing." `src/security/manifestSigner.js` (NEW, ~245 LOC) provides Ed25519 detached signature over canonical-encoded manifest projection. Frozen `COVERAGE_FIELDS = [version, publishedAt, url, sha256, minNodeVersion, publicSectorOnly]`. `signManifest({manifest, privateKeyPem, keyId})` → signature object `{alg:"Ed25519", keyId, value, coverage, signedAt}`. `verifyManifestSignature({manifest, trustStore})` → `{ok, keyId, keyLabel, coverage}` with 7-branch error vocabulary (missing_signature / unknown_alg / unknown_key_id / signature_mismatch / no_trusted_keys / coverage_mismatch / invalid_input). `loadTrustStore(parsed)` validates schema (`harness-release-trust/v1`) + each key shape. `generateKeyPair()` produces Ed25519 PKCS8/SPKI keypair with deterministic 16-hex `keyId` = sha256(publicKey)[0..16]. `_stableStringify` (recursive sorted-key JSON) makes hash + signature deterministic across publisher OSes. `scripts/sign-manifest.js` (NEW, ~190 LOC) is the operator-side CLI with three subcommands: `genkey [--out <dir>]` writes private.pem + public.json (single-key trust store fragment) + keypair.json (archive). `sign --manifest <path> --private-key <pem> --key-id <id>` reads manifest + private key, writes manifest with `signature` field added. `verify --manifest <path> --trust-store <json>` does offline verification (exit 0 PASS / 1 FAIL / 2 CONFIG). `scripts/launcher/launcher-cli.js` extended with `verify-manifest-signature <path> [--trust-store <path>]` command (env fallback `HARNESS_TRUST_STORE`); the launcher PS1/sh integration is deferred to a follow-up slice (E3) but the bridge already works for operator scripting. +17 unit + 9 smoke tests, all green. Round-trip: genkey → sign → verify → tampered → FAIL. Coverage-mismatch detection via trustStore.requireCoverage. Signature determinism verified across encoding-equivalent manifests (Ed25519 is deterministic given identical input + key). Total counts 2213 → 2230 unit (+17) / 445 integration unchanged / 57 → 66 smoke (+9). Out of scope: actual launcher-script (PS1/sh) signature gate before extract — module is ready, integration is a small follow-up; key rotation/revocation policy (operator-managed via trust store updates); HSM integration; PKI/X.509/cosign-keyless (out-of-band public key distribution is fine for the agency-to-agency use case)) — **118 / 124** (Public-sector readiness cap extended 4 → 5 — five live-verified defense layers (GOV-SB-0 sandbox + GOV-PII-0 inline + GOV-PII-1 deep + GOV-AUDIT-0 sealed evidence + GOV-RELEASE-0 signed distribution). Distribution security is qualitatively new: GOV-AUDIT-0's HMAC seal is symmetric (good for operator self-verify), GOV-RELEASE-0's Ed25519 signature is asymmetric (good for cross-org trust). The publisher's private key never leaves their box; recipients verify with the trust-store fragment. Cap fully filled at 5/5)
- **Phase E1.5 GOV-AUDIT-0 (auditor evidence export + offline verifier)** (Closes the deferral GOV-PII-1 and R2.5 closeout reports both flagged: a public-sector operator handing audit evidence to an external auditor needs a tamper-evident format the auditor can verify offline, without trusting the orchestrator. `src/runtime/auditorBundle.js` (NEW, ~290 LOC) builds sealed JSON bundles via `buildByRun` (one runId) or `buildByWindow` (across all runs with ledger.jsonl, filtered by entry.at). Schema `harness-auditor-bundle/v1` with frozen COVERAGE_FIELDS. `_stableStringify` (recursive sorted-key JSON) makes `entriesHash` + `chainHash` deterministic across reorderings of object keys. HMAC-SHA256 seal over canonical projection of {schema, exportedAt, mode, scope, deployment, entriesHash, chainHash, totalEntries, limit}; `seal.alg === "none"` when sealKey not wired (chain hashes alone keep the bundle internally consistent). `verifyBundle(bundle, sealKey)` performs offline verification with 6 tamper-detection branches (entries_hash_mismatch / chain_hash_mismatch / chain_invalid / key_required / seal_mismatch / unknown_schema). `evidenceLedger.listRuns` (NEW) enumerates runIds with ledger.jsonl, sorted, skips empty subdirs. `src/routes/auditRoutes.js` extended with POST `/api/audit/runs/:runId/export` + POST `/api/audit/export` (window with windowFromAt/windowToAt body fields, 8KB JSON body limit, frozen AUDIT_ERROR_CODES gains `invalid_window` + `bundle_failed` distinguished for operator UI). server.js wires `sealKey: _remoteRunner.ledgerKey` (HKDF info="audit-ledger" — same trust root the ledger HMAC already uses). `scripts/verify-auditor-bundle.js` (NEW, ~120 LOC) is the operator-facing offline CLI: `node scripts/verify-auditor-bundle.js <bundle.json>` with `--key <hex>` | `HARNESS_AUDIT_KEY` env for sealed bundles. Exit codes 0:PASS / 1:FAIL / 2:CONFIG. Auto-unwraps `{ok,bundle}` response shape so operators can save the API response directly. +40 unit + 9 smoke tests, all green. Total counts 2182 → 2213 unit (+31) / 445 integration unchanged / 48 → 57 smoke (+9). Out of scope: zip/tar archive (JSON-only by design), public-key signature (HMAC is symmetric — GOV-RELEASE-0 next round layers manifest signing), date-range UI button (endpoints exist for operator/auditor scripts; future ergonomic add)) — **117 / 123** (Public-sector readiness cap extended 3 → 4 — three live-verified defense layers (GOV-SB-0, GOV-PII-0, GOV-PII-1) get a fourth layer that closes the auditor-trust gap: external party can verify "this is what the harness audited" without trusting the orchestrator process or having shell access. Distinct seal vocabulary (alg / coverage / value) from R1-c ledger HMAC keeps grep contracts clean. Cap fully filled at 4/4)
- **Phase D Round UI-H9 (recent-results drill-down)** (Closes the second deferred operator path UI-H Round listed: "recent results card click → unified viewer". `src/routes/auditRoutes.js` (NEW, ~165 LOC) exposes the evidence ledger read API: `GET /api/audit/runs/:runId` returns entries (capped 256, `?limit=N` query param) + verifyChain result + truncation flag; `GET /api/audit/runs/:runId/verify` is the lighter green/red probe. Frozen `AUDIT_ERROR_CODES` vocabulary (invalid_run_id / not_found / ledger_unavailable). Read-only — no write surface, no export bundle (GOV-AUDIT-0 layers export on top of this same endpoint family). `public/js/monitor/panels/run-viewer.js` (NEW, ~270-line UMD modal panel) renders four sections for one runId: 실행 (run + detail), 리뷰 세션 (filtered by runId), 승인 (pending only, filtered by runId), 감사 로그 (live audit fetch). Lazy scaffold (no DOM until first open), live store subscription only while open, audit fetch with 4 branches (200/404/HTTP-error/network-error), destroy removes overlay + makes future open no-op. recent-results-card gains `onSelectRun` callback; each row becomes role="button"+tabindex when wired so click + Enter/Space fires the callback. simple-shell forwards onSelectRun to recentResults. layout.js mounts the run-viewer in the simple-mode region and hands runId from simple-shell → runViewerHandle.open(runId). +35 unit tests (15 audit-routes + 20 run-viewer covering all four data planes, audit fetch branches, recent-results keyboard wiring, modal lifecycle), all green. Total counts 2147 → 2182 unit (+35) / 445 integration unchanged / 48 smoke unchanged) — **116 / 122** (no rubric move — UI-H9 is operator UX completeness; operator can now drill from "최근 결과" card into a unified per-run view without needing the advanced shell. The audit read API also unlocks GOV-AUDIT-0's auditor-bundle export in the next round)
- **Phase D Round UI-H8 (first-visit welcome/setup overlay)** (Closes the deferral UI-H Round listed as out-of-scope: "welcome overlay for first-run operator with no profile". Adds `public/js/monitor/panels/welcome-overlay.js` (~250-line UMD panel) that classifies `accountStatus.profile` into three states — `ready` (activeId set → banner hidden), `first-visit` (count===0 + no active → "환영합니다 — 시작하기 전에 프로필이 필요합니다" with two CTAs `[설정 마법사로 시작]` / `[개인 프로필 빠른 생성]` + dismiss `×`), `no-active` (count > 0 + no active → "활성 프로필이 없습니다" with single `[계정 설정 열기]` CTA). Dismissal persists session-scoped via `localStorage[harness:welcomeDismissed]` but a profile becoming active wins regardless — "ready" state is authoritative. `simple-shell.js` mounts the overlay above the 4-card grid (separate `ss-welcome-mount` cell) and propagates the new callbacks: `onOpenSetupWizard` opens the settings modal + dispatches `harness:openSetupWizard` CustomEvent so settings-accounts can scroll-to / focus its 프로필 추가 form; `onCreatePersonal` POSTs `/api/profiles {id:"personal", label:"Personal"}` → POSTs `/api/profiles/personal/switch` → calls `bridgeHandle.refresh()` so the overlay re-classifies as "ready" without waiting the 5s polling tick. `simple-shell._resolvePanel` gains a `null globalName` short-circuit so test harnesses that don't inject a panel explicitly don't accidentally pick up a globalThis-leaked welcome-overlay from other suites; `node --test`'s per-file process isolation handles the rest. CSS variants (`wo-banner` / `wo-first-visit` / `wo-no-active` / `wo-hidden`) re-use the harness-shell `--hsh-*` design tokens for posture-aware coloring. +18 unit tests covering all three classifications + dismissal round-trip + storage persistence + simple-shell integration. Total counts 2129 → 2147 unit (+18) / 445 integration unchanged / 48 smoke unchanged) — **116 / 122** (no rubric move — UI-H8 is operator UX completeness for the first-run path; existing UI-H simple-shell rendering fired correctly with `(설정 필요)` placeholders before, but the path from "I just installed this" to "I have a working profile" was unguided. The cap-movement trigger would be either ① an acceptance-gate run measuring "operator goes from harness-start.bat double-click to first successful Claude critique in ≤ 5 minutes" or ② a separate operator-UX-flow rubric. Neither is in scope this round)
- **Phase D Round LV (Live Verification — LV-1..LV-5)** (Real-binary engagement of the review relay chain — closes the cap-movement criterion the user laid out: "단순 테스트 추가가 아니라 '제품의 핵심 주장 live verified'라서 점수 이동 명분이 충분합니다." LV-1 ships `tests/smoke/review-relay-end-to-end.test.js` (6-case CI smoke) with **streaming stub runners** that mimic real Codex/Claude behavior — chunks emitted at 3ms intervals, `[critical]/[high]/[medium]/[low]` severity tags exercised through `_extractFindings`, severityCounts derived correctly. LV-2 ships `scripts/live-verify-review-relay.{js,ps1,sh}` — a 430-line Node probe + platform shells that walk the operator through health → server-info → create → send-codex → poll-critique-received → follow-up → hand-back-claude → poll-claude-received → archive against a running harness server with real binaries. Color-coded progress, JSON evidence emission, public-sector probe variant, exit code semantic (0:PASS / 1:FAIL / 2:CONFIG). LV-3 ships `docs/runbooks/live-verify-review-relay.md` — operator runbook covering pre-requisites, standard-mode full-chain probe, public-sector posture probe, failure-mode probe, troubleshooting, and CI-smoke alternative. LV-4 ships `docs/reports/2026-04-30-review-relay-live-verification.md` — round closeout report capturing **the killer evidence**: a probe run executed against a live harness server with the real codex.cmd binary at `C:\\Users\\SJ\\AppData\\Roaming\\npm\\codex.cmd` produced an audit chain that records `review_session_dispatch_started` at t=3ms followed by `review_session_dispatch_failed` at t=3045ms — the 3045ms gap IS the real-binary execution time. Concrete proof that the dispatcher fires the real binary, the binary actually runs, and graceful failure capture works. Real-binary critique completion + Claude hand-back are operator-runnable follow-ups documented in the runbook. +6 smoke tests, all green. Total counts unchanged for unit/integration; smoke 42 → 48 (+6)) — **116 / 122** (Dual-agent integration cap extended 11 → 12 — qualitatively new evidence: the harness wiring chain works not just under stubs (UI-H7-f) but with the operator's REAL codex.cmd binary engaged from the dispatcher. The 3045ms audit row is the proof. Cap fully filled at 12/12)

- **Phase D Round UI-H7-f** (Review Relay Server-Side Spawn Wiring — closes the LAST deferred piece UI-H7 left open: when the operator clicks "Send to Codex" the route now actually spawns codex-runner.exec(prompt, {reviewSessionId}) instead of just transitioning manager state. Same for "Hand back to Claude" + "Follow up Codex". `src/runtime/reviewSpawnDispatcher.js` (NEW, 366-line module) is the coordination seam between routes (state machine + posture gate) and runners (chunk pipeline). Three dispatch verbs: `dispatchCodex(sessionId, {instruction})`, `dispatchClaude(sessionId, {instruction, includeCritique})`, `dispatchFollowUpCodex(sessionId, {question})` with shared `_dispatchInternal` that does pre-flight gates (session exists / not archived / runner wired / not already in-flight / posture defense-in-depth for Claude only) → audit `review_session_dispatch_started` → kick `runner.exec(prompt, {reviewSessionId})` fire-and-forget → on settle: clear in-flight Map + audit `review_session_dispatch_completed` (ok:true) or `review_session_dispatch_failed` (ok:false or threw) or `review_session_dispatch_blocked` (in-flight collision OR posture refusal). Per-session `Map<sessionId, {actionType, startedAt, runner}>` for in-flight tracking with `getInFlight(sessionId)` / `isInFlight(sessionId)` / `snapshot()` / `size()` accessors. 4 frozen audit verbs `review_session_dispatch_*` distinct from R3-e/R2.5 `runner_hook_*` family + manager `review_session_*` lifecycle family — forensic auditor's grep stays bounded. Frozen `DISPATCH_ERROR_CODES` (dispatch_invalid_input/_session_not_found/_session_invalid_state/_already_in_flight/_local_executor_disabled/_runner_unavailable) maps directly to HTTP status via new `_emitDispatchError` route helper that includes the post-transition session snapshot in the response so operator UI never loses state visibility on dispatch failure. Three prompt builders (`_buildCodexPrompt` / `_buildClaudePrompt` / `_buildCodexFollowUpPrompt`) that include session label + sessionId + instruction + (Claude) latest critique summary from session history + severity-tag instruction telling Codex to use `[critical]/[high]/[medium]/[low]` so `_extractFindings` regex (codex-runner.js) attributes severityCounts back to the session via UI-H7-d's `recordCritiqueReceived` path. Routes (`src/routes/reviewSessionRoutes.js`) wire the dispatcher: send-codex / hand-back-claude become `async`, call manager.{sendCodex, handBackClaude} first (state transition), then dispatcher.{dispatchCodex, dispatchClaude} (spawn kick-off). When `reviewSpawnDispatcher` dep is null (legacy callers, integration tests without runners) the routes still 200 with `dispatched:false`. server.js wires the dispatcher between runner construction and route mount: `_reviewSpawnDispatcher = new ReviewSpawnDispatcher({reviewSessionManager: _reviewSessionManager, codexRunner, claudeRunner, auditFn: evidenceLedger.append("system", ...), deploymentProfile: _deploymentProfile})`. **Live proof gap acknowledged**: this round ships fake-runner integration tests (12 cases — round-trip with fake runner piping chunks → manager → broadcast confirms the seam works end-to-end). Real codex/claude live smoke is deferred to a follow-up live verification round. +26 unit + 12 integration tests, all green. Total counts 2103 → 2129 unit (+26) / 433 → 445 integration (+12)) — **115/121** (no rubric move per user guidance — "남은 배선 닫기"라서 처음에는 115/121 유지가 맞고, 실제 클릭 → Codex 실행 → stream 귀속 → Claude hand-back까지 live proof가 나오면 그때 116/122 정도의 근거가 생깁니다. The seam is now complete and verified by fake-runner integration tests; the cap extension trigger is real-runner live verification)

- **Phase D Round UI-H7 (UI-H7-a~e)** (Review Relay End-to-End — closes the deferral chain UI-H4 created when it landed `ReviewSessionManager` + 5-endpoint API but no UI driver and no runner integration. UI-H7-a: store gains `reviewSessions: Map<sessionId, partial>` + `selectedReviewSessionId` + `reviewStreams: Map<sessionId, {codex,claude,lastSeq,critiqueSummary,claudeSummary}>` with 6 actions (`upsertReviewSession`, `removeReviewSession`, `selectReviewSession`, `appendReviewChunk`, `setReviewSessionsList`, `clearReviewSessions`) + `DEFAULT_MAX_REVIEW_CHUNKS=500` per side. legacy-bridge `_syncReviewSessionFromEvent` consumes 7 review-session WS broadcast types (review_session_created, codex_stream_chunk, claude_stream_chunk, critique_received, handoff_to_claude_requested, handoff_to_claude_completed, review_session_archived) and routes them into the new slice — chunks NEVER pollute the events ring. UI-H7-b: `public/js/monitor/review-session-client.js` (313-line UMD module) exposes 7 methods with structured `_structuredError` mapping (network_error, session_not_found, invalid_state, public_sector_local_executor_disabled, review_session_invalid_input, etc.) + optional `store` injection that auto-writes via `upsertReviewSession` / `setReviewSessionsList`. UI-H7-c: dual-agent-console grows a footer-replacement `dac-action-row` with `dac-session-indicator` + 5 buttons (`data-action-id`: start / send-codex / followup-codex / hand-back / archive) + state-aware enable/disable per `session.state` (no session→only start; created→send-codex; awaiting_critique→follow-up + archive; critique_received→hand-back + follow-up + archive; archived→all disabled) + `dac-posture-badge` ("🛡 공공기관 모드 — 로컬 Claude 실행 차단") rendered when `accountStatus.deployment.publicSector && !allowLocalExecutor` + new POST `/api/review-sessions/:id/archive` route (idempotent + emits `review_session_archived` audit verb once). UI-H7-d: ClaudeRunner + CodexRunner accept `reviewSessionManager` constructor opt + `reviewSessionId` exec opts; on stdout chunk → `manager.recordClaudeChunk` / `recordCodexChunk` (pure passthrough wrapped in defensive try/catch); on close (success only) → `recordClaudeReceived` (with text-trimmed summary) / `recordCritiqueReceived` (with summary AND `severityCounts` derived from `_extractFindings` via the new module-level `_severityCountsFromFindings(findings)` helper that maps {critical/high/medium/low/note} counts). server.js hoists the manager construction upstream of runner construction so both runners hold a reference. UI-H7-e: layout.js `_formatReviewError(err)` maps 12 error codes to operator-friendly Korean messages (`public_sector_local_executor_disabled` → "🛡 공공기관 모드: 로컬 Claude 실행이 차단되어 있습니다. 샌드박스 runner를 사용하거나 Codex 비평까지만 진행하세요.", `network_error` → "네트워크 오류로 요청을 보내지 못했습니다. 연결 상태를 확인하세요.", `session_not_found` → "세션을 찾을 수 없습니다.", etc.) + dual-agent-console wires `onError(err) → showError(_formatReviewError(err), "reviewSession")`. End-to-end posture chain verified live in `tests/integration/review-relay-posture.test.js` (publicSector + !allowLocalExecutor blocks hand-back-claude AND follow-up target=claude with 409 code `public_sector_local_executor_disabled`; codex follow-ups always allowed; archive always allowed). +123 unit tests (45 store, 27 client, 22 action-row, 14 runner, 17 error-format) + 11 integration tests (4 archive route, 7 posture chain) across 5 commits. Total counts 1980 → 2103 unit (+123) / 422 → 433 integration (+11), all green) — **115/121** (Dual-agent integration cap extended 10 → 11 — the harness shifts from "two AI streams that the operator can observe" to "two AI streams that the operator drives via 5 typed actions, with chunks routed back into the right session via runner-side hints, and a posture-aware Korean error layer when the policy refuses a hand-back"; the deferred work UI-H4 listed as out-of-scope ("actual claude-runner/codex-runner integration that emits review-relay stream chunks via manager.recordCodexChunk/recordClaudeChunk; review-relay panel UI with structured-action input row") is now closed)

- **Phase D Round UI-H (UI-H0~H6)** (SJ Harness Dashboard mockup integration — operator-friendly simple-mode shell + Harness Track + Dual Agent Console + Claude→Codex→Claude review relay + public-sector visual mode + 4-card simple dashboard. Reference mockup at `Downloads/web page/sj-harness-dashboard/` was design-only; production stays on the existing UMD-pattern panel architecture (NO React/Babel/CDN/Google Fonts adopted per UI Plan §"채택하지 않을 것"). UI-H0 ships `public/css/harness-shell.css` with `--hsh-*` design tokens (color/typography/density/motion) + reduced-motion overrides via `@media (prefers-reduced-motion)` AND `[data-posture="public-sector"]` attribute. UI-H1 ships shell-mode foundation: `public/js/monitor/mode.js` resolves URL ?mode= > localStorage > envDefault (HARNESS_MONITOR_MODE) > "simple"; `public/js/monitor/panels/mode-toggle.js` is the 3-button pill (일반사용자/전문사용자/레거시); layout.js branches on mode: legacy short-circuits before any DOM mutation, simple mounts cards via UI-H6 orchestrator, advanced preserves the existing 9-panel layout. UI-H2 ships `public/js/monitor/horse-state-machine.js` (pure function `(phase, approvalPending, verifyResult, reducedMotion) → {laneIdx, displayState, gate}` with 7 canonical lanes Plan/Critique/Revise/Re-check/Execute/Verify/Done + alias support) + `public/js/monitor/panels/harness-track.js` (galloping-horse panel that NEVER fakes progress — unknown phase → 대기 중 placeholder; approval/verify gates fire `rearing` state with `◈ HARNESS · {GATE}` callout). UI-H3 ships `public/js/monitor/event-filters.js` (5 pure helpers: filterEventsByScope/Runner/Label, tailEvents, envelopeToLine) + `public/js/monitor/panels/dual-agent-console.js` (read-only stream split: Claude on left + Codex on right, with Verifier/Audit tabs disabled in this slice; negative pin in tests: NO <input>/<textarea>/contenteditable — operator input flows via UI-H4 review relay, NOT raw stdin). UI-H4 ships `src/runtime/reviewSessionManager.js` (in-memory state machine with 6 lifecycle states + 7 audit verbs `review_session_*` + 7 broadcast types claude_stream_chunk/codex_stream_chunk/critique_received/handoff_to_claude_*) + `src/routes/reviewSessionRoutes.js` (5 HTTP endpoints under /api/review-sessions/* with public-sector posture refusing local-Bash hand-back-claude + follow-up target=claude with 409 + structured error code, codex follow-ups always allowed). UI-H5 ships `public/js/monitor/panels/security-status-card.js` (surfaces posture / sandbox / PII / approval-pending in a single card mounted in BOTH simple and advanced modes) + layout.js writes `data-posture` on `<html>` so harness-shell.css's reduced-motion overrides fire globally. UI-H6 ships `public/js/monitor/shells/simple-shell.js` (orchestrator) + 4 operator-friendly cards: now-doing / pending-approvals (deep-links to approval-card region via scrollIntoView) / recent-results (last 3 completed runs sorted desc by completedAt with verify dot) / connection-status (profile + bridge + remote pills with action button to open settings modal). +198 unit + 22 integration tests across 7 commits. Total counts 1782 → 1980 unit / 377 → 422 integration, all green. Layout test count from 31 → 47 (UI-H1 12 + UI-H6 1 updated)) — **114/120** (UI feedback loop cap extended 7 → 8 — operator-friendly simple-shell + harness-track + dual-console + review-relay + security-status all live; Pipeline orchestration cap +1 — operator-driven Claude↔Codex review session is qualitatively new orchestration pattern; Public-sector readiness stays 3/3 — UI-H5 surfaces existing 3 GOV layers but doesn't add a 4th. The mockup integration goal — "operator opens ?mode=simple and sees a usable dashboard at first paint" — is met. Out of scope, deferred to later rounds: actual claude-runner/codex-runner integration that emits review-relay stream chunks via manager.recordCodexChunk/recordClaudeChunk; review-relay panel UI with structured-action input row; welcome overlay for first-run operator with no profile)

- **Phase D R3-e + GOV-APPROVAL-0 + UX-2-a/b/c** (per-call operator approval for write-tool dispatch with PII-aware decision context — closes the last unguarded boundary in the remote-hook bridge: write tools (Bash/Edit/Write) sanitize successfully but pause for an operator decision before any executor method is invoked. R3-e-a adds `WRITE_TOOLS_REQUIRING_APPROVAL` + `APPROVAL_AUDIT_VERBS` + `APPROVAL_RESOLUTIONS` constants to `remoteHookBridgeContract.js` (DISJOINT from `ALLOWED_TOOLS` so the R2.5 read-only invariant holds verbatim) + helpers `isWriteToolRequiringApproval` / `getWriteToolDataKeys`. R3-e-b ships `src/runtime/approvalManager.js` (380-line state machine — `request({hook,tool,args,runId,hostIdentity,piiContext}) -> Promise<{approvalId, resolution, deciderId, decidedAt}>`, sha256 args hash for R3-G15 exact-tuple gating, per-tool argsSummary truncated to 80 chars, scheduled TTL timeout (default 30000ms via `HARNESS_REMOTE_APPROVAL_TIMEOUT_MS`), `grant` / `deny` / `cancel` / `cancelByRunId` / `cancelByHostIdentity` lifecycle, audit verb emission per resolution, broadcastFn for WS dashboard sync, defensive against throwing audit/broadcast callbacks). R3-e-c wires `src/routes/approvalRoutes.js` (`GET /api/approvals/pending` + `POST /api/approvals/:id/{grant,deny}` with `{deciderId,reason}` body + 503 fail-fast when manager missing + 404 unknown_or_resolved + 32kb body limit + state-changing endpoints token-gated). R3-e-d extends `remoteHookSanitizer` to accept `WRITE_TOOLS_REQUIRING_APPROVAL` (sanitized payload carries `requiresApproval: bool`) + extends `PAYLOAD_SCHEMAS.PreToolUse/PostToolUse.dataKeys` with write-tool args (`command`/`description`/`old_string`/`new_string`/`replace_all`/`content`) + adds `_dispatchSanitized` approval gate to `executor/hook-router.js` (write tools round-trip through manager BEFORE any executor method invokes; granted → dispatched, denied/timeout/cancelled/unavailable → dispatched.error with corresponding code; new stats counters `remoteHookApprovalRequested/Granted/Denied/Timeout/Cancelled/Unavailable`). GOV-APPROVAL-0 layer adds piiScanner.scanForPii (depth: "deep") on args BEFORE manager.request — operator card surfaces detected `findingTypes` (krn / phone / email / business_reg / driver_license_kr / passport_kr / credit / phone_kr_landline) at decision time; defensive try/catch wraps scanner so a fault never causes fail-open or crashes the gate. `src/policy/publicSectorPolicy.js` adds `requiresWriteToolApproval(deploymentProfile)` + `assertWriteToolApprovalAvailable(deploymentProfile, manager)` + `PUBLIC_SECTOR_APPROVAL_MANAGER_REQUIRED` policy code (frozen Set extended 2 → 3 codes); HookRouter constructor now fails loud at boot when public-sector posture mandates approval but no manager is wired. UX-2-a adds `pendingApprovals: Map<approvalId, request>` slice to `public/js/monitor/store.js` with `upsertApproval` / `resolveApproval` / `clearApprovals` actions + sorted-by-requestedAt snapshot + defensive deep-copy of args / piiContext.findingTypes / piiContext.samples (per-type arrays); `public/js/monitor/legacy-bridge.js` adds `_syncApprovalFromEvent` precedence-checked BEFORE `pushEvent` so approval events stay in their own slice (no duplicate UI). UX-2-b ships `public/js/monitor/panels/approval-card.js` (230-line operator-facing panel — tool glyph + truncated argsSummary + PII badge + meta line + Allow/Deny buttons that POST to /api/approvals/:id/{grant,deny} with deciderId + 4s toast TTL + busy guard + 404 → "Already resolved" toast + 401 → "Auth required" toast + network error → "Failed" toast + destroy() unsubscribes + clears DOM) + 125 lines of CSS (.ac-card / .ac-pii-badge / .ac-btn-allow / .ac-btn-deny). UX-2-c integrates the panel into `public/js/monitor/layout.js` (`.approval-card-region` between global-bar and shell-body, role="region" + aria-label="Pending approvals", panel mount in try/catch so panel-init fault doesn't break the rest of the layout, destroy ordering: approvalHandle BEFORE settingsHandle BEFORE bridgeHandle) + `public/index.html` script tag for CSP-safe external src. +101 unit + 10 integration tests across 6 commits, all green) — **111/119** (Safety cap extended 18 → 19 — operator-decision gate is qualitatively new in the harness security model: no other defense fires at runtime requiring an operator decision; everything else is automated policy. Public-sector readiness stays 3/3 — the PII-aware approval extends the existing 3-layer GOV defense stack rather than adding a 4th layer. Distinct `runner_hook_approval_*` verb prefix from R2.5's `runner_hook_*` family means a forensic auditor's grep for `runner_hook_rejected` keeps returning only sanitization-time rejections, while approval lifecycle lands in its own grep window. Counts 1648 → 1795 unit (+147) / 367 → 377 integration (+10))

- **Phase E1.5 GOV-PII-1-a/b** (deep file-import PII scan — `src/security/piiScanner.js` extended with depth selector (`opts.depth: "inline" | "deep"`, default "inline" for GOV-PII-0 backwards compat) + 3 KR-focused deep patterns: 사업자등록번호 with full check-digit validation per Korean tax authority spec (10 digits, weights [1,3,7,1,3,7,1,3,5] + floor((d8*5)/10) step), 한국 운전면허번호 (12 digit format-only match), 한국 여권번호 (M/S + 8 digits with anchored lookarounds). PATTERNS registry now 8 entries (5 inline + 3 deep), all frozen. INLINE_PATTERN_TYPES + DEEP_PATTERN_TYPES exported as frozen wire-format locks. `src/routes/securityRoutes.js` (NEW, 196 lines) with one endpoint: `POST /api/security/scan` accepts `{ content, filename?, source?, depth? }` body, emits `pii_file_scan_blocked` (public-sector posture) or `pii_file_scan_warn` (standard) with already-redacted samples in the audit data — clean scans emit NO audit row (audit chain stays quiet). Default depth is "deep" for the file-import context (operator opts INTO the deeper set when calling /api/security/scan). 1MB content cap via express.json + route guard. Posture decision mirrors GOV-PII-0 piiGate fail-closed semantics: ANY signal (requirePiiScanBeforeProviderDispatch=true OR scannerFailurePolicy="block") triggers block. server.js wires evidenceLedger + boot-resolved deploymentProfile. End-to-end verified via 25 unit + 19 integration tests, all green. BRN samples are pre-redacted at the scanner level — audit chain never carries raw PII) — **110/118** (Public-sector readiness cap 2 → 3 fully filled — three live-verified defense layers stack: GOV-SB-0 enforces sandbox-only execution with audit emission, GOV-PII-0 gates the inline pre-dispatch path, GOV-PII-1 catches PII when an attachment lands on disk via the explicit /api/security/scan endpoint. The new `pii_file_scan_*` verb prefix lets auditors distinguish inline-prompt detections from file-content detections without re-parsing the audit chain. Operator UX: D3 settings modal already wires "Test Claude / Test Codex" — a future GOV-* slice can extend the modal with "Scan File" using this same endpoint)
- **Phase E1 D0-a/b/c/d/e** (productization launcher — `harness-start.bat` UTF-8 BOM + CRLF Windows entry / `harness-start.sh` Mac-Linux entry / `scripts/launcher/{install-version,check-update}.{ps1,sh}` thin shells / `scripts/launcher/launcher-cli.js` ~250-line Node bridge that PowerShell + bash share for SHA256 + semver + path resolution + manifest validation + URL scheme check + health discriminator. D0-a `configPaths.js` + `launcherManifest.js` (43 unit tests). D0-b/c/d ship the platform shells + 16 smoke tests + operator guide. D0-e closes 4 production-readiness gaps: https-only manifest URL with `HARNESS_ALLOW_INSECURE_MANIFEST_URL=1` escape hatch; bash sites unified through `manifest-field` (no more inline `node -e require(...)` quoting fragility); atomic install via `<Version>.partial-<ts>` staging + `.install-complete` sentinel last; `/api/health` discriminator `app:"HarnessPipeline" + healthVersion:1` + `verify-health` CLI so port-squat services can't trick the launcher into "already running" treatment. cmd.exe trap catalog grew during D0-b: `::` inside `( ... )` blocks → use `rem`; `set /p var=<file` inside parens → use `for /f "usebackq"`; `timeout /t 1` aborts under redirected stdin → use `ping -n 2`; unescaped `)` in `echo` lines inside `( ... )` blocks → escape via `^)`. `.gitattributes` pins `*.bat`/`*.ps1` → CRLF and `*.sh` → LF so Windows cloners with `core.autocrlf=true` don't break the bash launchers) — **104/113** (Config/portability cap extended 5 → 8 — captures the qualitative shift from "developer runs `node start.js` from a checked-out repo" to "operator double-clicks `harness-start.bat` from a release zip")

**━━━ Phase 1 closed at 118/124 (2026-04-30) ━━━**
**━━━ Phase 2 UI Reference Port closed at 119/125 (2026-04-30) ━━━**
**━━━ UI-P10 / UI-P11 / UI-P12 closed at 120/126 (2026-05-04, +1 Public-sector via a11y) ━━━**
UI-P10 Live Browser Visual Verification (capture-live: 4 routes × 4 viewports = 16 screenshots) + UI-P11 Responsive + Text Fit (assert-live: 6 frozen rules × 16 cells, page-overflow / header-text-fit / tap-target / dual-terminals-fit / monitor-grid-no-overlap / pipeline-rail-labels-fit) + UI-P12 Accessibility (a11y-live: axe-core WCAG 2.0/2.1 A+AA + 2 custom rules `lang-matches-locale` + `skip-link-focus-visible`). All three round playwright-core based + manual-dispatch CI workflows only (NOT PR push — chromium ~150MB cost). UI-P12 extends Public-sector readiness cap 5 → 6 — accessibility is procurement-blocking for ko 행안부 / US Section 508 / EU EN 301 549. Cap fully filled at 6/6.
**━━━ UI-P13 + UI-Doc-Gov closed at 120/126 (2026-05-04) ━━━**
UI-P13 Dead Button / Action Integrity (button-live: 13 buttons × 4 routes × 1 desktop viewport, click-safety policy + DOM mutation / network request / console.error capture, "click-no-activity" verdict catches dead-handler buttons) + UI-Doc-Gov visual contract governance master doc (`docs/visual-contract-governance.md` 391 lines, 9 sections: contract families table / per-contract governance / 5 anti-patterns / decision tree / CI policy / fused-workflow entry conditions / catalog version table) + 8 drift tests locking governance doc to actual frozen-list source state + cross-links from `harness-pipeline-distribution-guide.md` §16-A and `harness-pipeline-reference-guide-draft.md` §19-A. UX integrity foundation + documentation completeness, no cap movement (cap fully filled at UI-P12). **Visual contract family closed at 5 manifest schemas**: `tests/visual/baseline-product-shell.json` (UI-P9) + `harness-visual-{live,assert,a11y,button}/v1` (UI-P10/P11/P12/P13).
**━━━ UI-FirstRun closed at 120/126 (2026-05-04) — Phase 2 UI Reference Port arc CLOSED ━━━**
UI-FirstRun "지금 해야 할 일" card (`firstRunClassifier` UMD with 6 frozen states: no-profile / no-active-profile / public-sector-incomplete / provider-missing / provider-not-authenticated / ready + 9 frozen CTAs + STATE_CTAS priority registry; `next-action-card` panel reading store accountStatus + providerStatus slice; `setProviderStatus` store action mirroring D3 settings-accounts probe-provider verdicts so the panel drops out of "untested" verdict; simple-shell mounts the card BETWEEN welcome-overlay banner and 4-card grid with onFirstRunCta primary dispatcher + 4 fallback handlers (onOpenSetupWizard / onOpenSettings / onTestProvider / onAuthProvider); 24 firstRun.* i18n keys with placeholder substitution {count}/{runners}; index.legacy.html script tags loaded BEFORE simple-shell.js). Closes the "도구를 처음 켠 사람이 무엇을 해야 하는지 바로 아는가" gate. UX completeness foundation, no cap movement (cap fully filled at UI-P12). **Phase 2 UI Reference Port arc fully closed**: UI-P0 sign-off → UI-P1~P9 port + structural gate → UI-P10~P13 live capture/assert/a11y/button → UI-Doc-Gov governance → UI-FirstRun no-profile UX. Next-round candidates: UI-Fuse (fused PR-gating workflow per governance §6.2 conditions) or SMART arc (decision context / recommendations / hard gates).
**━━━ UI-Fuse closed at 120/126 (2026-05-04) — Visual contract orchestration ━━━**
UI-Fuse fused visual verification orchestrator (`visual-fused-live.yml` manual-dispatch workflow + `scripts/visual-fused-live.js` local CLI: ALL 4 contracts under ONE server boot + ONE chromium install; bash loop iterates over `tools` input with `|| OVERALL_EXIT=$?` capture so per-tool failures don't abort; top-level `summary.json` schema `harness-visual-fused/v1` aggregating per-tool {schema, capturedAt, totalElapsedMs, summary}; single combined artifact `ui-fuse-<run-id>` with 4 subdirs + summary; 30-min timeout vs per-tool 20-min; `if: always()` on resolve + upload steps so partial failures still preserve artifact; --tools subset selection for fast iteration; same exit code semantics as siblings 0/1/2). Governance doc updated: §1 6 contract families table (was 5) + §7 catalog versions adds fused tools registry + first-run states + first-run CTAs. Drift test extended: 9 tests (was 8) — new test asserts UI-Fuse orchestrator framing. **PR-gating §6.2 entry conditions**: condition 2 (chromium 캐시 안정) + condition 3 (wall time ≤5분) closed by UI-Fuse — single install + sequential under one job ≈ 3-7 min vs ~12-20 min for 4 separate runs. Conditions 1 (baseline stability) + 4 (operator UX) still need runtime data; PR push trigger deferred to UI-Fuse-2 hypothetical follow-up. Operator efficiency improvement, no cap movement.
**━━━ SMART-0 closed at 120/126 (2026-05-04) — Phase 2 SMART arc foundation ━━━**
SMART-0 Decision Context Foundation — Phase 2 SMART arc 본격 시작점. 모든 후속 SMART 라운드 (SMART-1 추천 카드 / SMART-2 hard gates / SMART-3 expert presets / SMART-4 redacted run memory / SMART-5 institutional policy packs) 가 입력으로 사용할 단일 의사결정 컨텍스트. (1) `src/runtime/decisionContext.js` 순수 동기 모듈 — 7 어댑터 (approvalManager / reviewSessionManager / runRegistry / deploymentProfile / evidenceLedger / profileStore / remoteRunner) → 동결 스냅샷 (8 booleans: hasPii / approvalPending / codexReviewMissing / auditExportReady / publicSector / hasActiveProfile / needsHumanDecision / remoteRunnerActive + 5 counts + posture + sources). 어댑터별 try/catch — 한 어댑터 throw 해도 sources.<id>.errored로 마킹되며 다른 어댑터 출력 보존. (2) `GET /api/decision-context` 라우트 — `x-harness-has-pii: 1` 헤더 → hasPii=true; runRegistry.list/listAll, runnerRegistry.snapshot/list, evidenceLedger.count/size 다중 fallback shim. server.js 마운트는 기존 싱글톤 재사용 (새 상태 할당 0). (3) `store.js` decisionContext 슬라이스 + setDecisionContext 액션 (스키마 체크 + 방어적 shallow-copy + 중복-null no-publish). `legacy-bridge.js` refreshDecisionContext + 5초 인터벌 폴링 + 독립 에러 카운터 — /api/server/info 폴링과 분리되어 한 엔드포인트 실패가 다른 것을 깨지 않음. fakeFetch 헬퍼 확장 (.calls() / .findCall(url)). (4) closeout 보고서. **needsHumanDecision** aggregator는 approvalPending OR codexReviewMissing OR (publicSector && hasPii) OR !hasActiveProfile (fail-safe; 표준 모드 + PII 단독은 경고이지 차단 아님 — GOV-PII-0 의미와 일치). 모든 7 어댑터 OPTIONAL — 부분 배포 안전. Foundation infrastructure, no cap movement; SMART-2 (hard gates) + SMART-5 (policy packs)가 cap movement 후보.
**━━━ SMART-1 closed at 120/126 (2026-05-04) — Phase 2 SMART arc first consumer ━━━**
SMART-1 Recommendation Cards — Phase 2 SMART arc 첫 decisionContext 소비자. SMART-0 의 8 booleans + 5 counts + posture를 입력으로 받아 simple shell에 prioritized recommendation cards 렌더링. (1) `public/js/runtime/recommendationEngine.js` UMD 순수 모듈 — 7 frozen rules (5 base: complete-profile-setup / resolve-pending-approvals / request-codex-review / monitor-active-runs / export-audit-evidence + 2 public-sector: public-sector-pii-block / public-sector-evidence-trail) × 4-tier severity (critical / high / medium / info). recommendFromContext(ctx, {dismissedIds: Set}) → SEVERITY_ORDER로 정렬된 list (ties는 rule index로 stable). 각 rule에 i18n key + Korean fallback + {placeholder} interpolation 지원. null ctx → empty list (graceful degrade). (2) `store.js` dismissedRecommendations Set 슬라이스 + 3 액션 (dismissRecommendation / undoDismissRecommendation / clearDismissedRecommendations). idempotent dismiss (no notify-churn on duplicate). UI-state-only — 서버는 dismiss 상태 모름. (3) `recommendations-card.js` UMD 패널 (~270 LOC) — `<section data-card="recommendations">` 마운트, decisionContext + dismissedRecommendations 구독, engine.recommendFromContext 호출, 각 row에 severity dot + title + body + Primary CTA + Dismiss button. data-state="empty|populated" + data-top-severity + data-rec-count CSS hooks. CTA → onCta(ctaActionId, {ruleId, meta}) callback; Dismiss → store.dismissRecommendation(id). (4) `simple-shell.js` `.ss-recs-mount` 컨테이너 (next-action-card와 4-card grid 사이) + onSmartCta primary dispatcher + 4 fallback handlers (open-setup-wizard → onOpenSetupWizard / scroll-to-approval-card → onApprovalsClick / 4 SMART-1-specific → onOpenSettings safe fallback). (5) i18n KO/EN parity 31 keys × 2 locales. (6) index.legacy.html script tags BEFORE simple-shell.js (recommendationEngine.js + recommendations-card.js). (7) Visual baseline 추가 (intentional, additive 2 scripts). (8) closeout 보고서. **End-to-end loop closed**: legacy-bridge polling → store.setDecisionContext → recs-card subscribe → engine.recommendFromContext → operator's eyes → click Dismiss → store.dismissRecommendation → re-render filters out. 71 unit tests (31 engine + 11 store + 19 panel + 10 shell) green. First SMART consumer; cap movement은 SMART-2 hard gates / SMART-5 policy packs로 deferred.
**━━━ SMART-3 closed at 120/126 (2026-05-05) — Phase 2 SMART arc expert review presets ━━━**
SMART-3 Expert Review Presets — Phase 2 SMART arc 두 번째 라운드. 운영자가 자유 입력 대신 6가지 frozen 전문가 관점 중 하나를 골라 Codex 비평 / Claude hand-back 의 system prompt + severity-tag 지침이 함께 전송됨. plan §S §S-rounds v2의 SMART-2 앞 (SMART-1 → **SMART-3** → SMART-2) 순서대로 진행 — hard gate 켜기 전에 안정화된 expert preset surface가 필요.

**━━━ SMART-2 closed at 120/126 (2026-05-05) — Phase 2 SMART arc policy-backed hard gates ━━━**
SMART-2 Policy-backed Quality Gates — Phase 2 SMART arc 세 번째 라운드 (plan §S §S-rounds v2 순서: SMART-0 → SMART-1 → SMART-3 → **SMART-2** → SMART-4 → SMART-5; hard gate를 안정화된 preset/recommendation surface 위에 layering). plan의 7 sub-slices를 3개 (S2-a/b/c)로 압축 — 4 gate 함수 + 동결 vocabulary + GATE_MODES + audit verbs를 새 단일 모듈 `src/policy/policyGates.js` 에 통합 (`publicSectorPolicy.js` 확장 X — 두 모듈은 다른 contract; publicSectorPolicy는 throw-and-runner-emits 패턴, policyGates는 verdict-returning + mode-aware + 단일 audit vocabulary). (1) `src/policy/policyGates.js` (~430 LOC) — 동결 vocabulary (SCHEMA `harness-policy-gate/v1` + GATE_MODES{HARD/WARN} + GATE_NAMES 4종 + GATE_REASONS 6종 + AUDIT_VERBS{policy_gate_blocked/policy_gate_warn}). resolveGateMode(env): HARNESS_HARD_GATES=1/true/hard → HARD; default → WARN (안전한 graduated rollout). 공공기관 posture는 hard mode를 자동 함의하지 X — operator가 posture (HARNESS_DEPLOYMENT_PROFILE) + 엄격성 (HARNESS_HARD_GATES)을 독립 switch로 조정. 4 gate 함수 모두 frozen verdict `{ok, blocked, mode, gate, reason, message, audit:{verb,data}|null}` 반환: **gatePiiBlock** (piiScanner 통과 → 공공기관+hard+PII 검출 → BLOCK; 공공기관+warn → ok+warn audit; 표준 → ok+warn audit observability; scanner-throw 공공기관+hard 시 fail-closed; circular args → ok+warn 절대 block X), **gateReleaseSigned** (공공기관 + !manifestSigned + hard → BLOCK; warn → ok+warn; 표준 → NOT_APPLICABLE), **gateEvidenceExportReady** (공공기관 + !ctx.auditExportReady + hard → BLOCK; null context + 공공기관+hard → fail-closed), **gateCompletionAllowed** (post-state soft gate; needsHumanDecision + 공공기관+hard → BLOCK; 표준 절대 hard-block X). runGateChain(gates) — 첫 blocked verdict에서 short-circuit; gate throw → blocked + pii_scanner_failed + policy_gate_blocked audit; malformed entries silently skipped. (2) `src/routes/reviewSessionRoutes.js` 확장 — policyGates import + 새 `_runPreStateGates({text, source, deploymentProfile, auditFn, sessionId})` helper (gatePiiBlock 호출 + audit emit) + 새 `_emitGateBlockedResponse(res, verdict, context)` helper (HTTP 409 + frozen response shape `{error: "policy_gate_blocked", gate, reason, mode, message, sessionId, findings:{findingTypes,findingCount,samples}}`). createReviewSessionRoutes 새 optional `auditFn` dep 수용. 3개 dispatch route (send-codex / follow-up / hand-back-claude) 모두 manager.transition BEFORE gatePiiBlock 호출 — source labels "send_codex_instruction" / "follow_up_question" / "hand_back_instruction"; auditFn try/catch defensive (throwing audit가 route 깨지 X). (3) `server.js` createReviewSessionRoutes mount이 `auditFn: evidenceLedger.append.bind(evidenceLedger)` 전달 — policy gate audits가 dispatcher verbs와 같은 evidence ledger chain에 안착. (4) closeout 보고서. **State-immutability 불변식** (plan §S 핵심): hard block 시 manager.state UNCHANGED + runner NOT invoked + dispatcher 절대 cascade 안 함 — 통합 테스트가 명시적으로 anchor. **Audit single-emit 불변식**: hard block 시 정확히 1개 policy_gate_blocked audit (review_session_dispatch_failed cascade 0). 48 unit (policyGates.test.js — frozen vocab + resolveGateMode 8 variants + gatePiiBlock 11 시나리오 + gateReleaseSigned 5 + gateEvidenceExportReady 5 + gateCompletionAllowed 5 + verdict immutability + runGateChain 6) + 13 integration (review-session-routes-policy-gates.test.js — standard mode no-PII / standard PII warn audit / 공공기관 warn 기본 PII warn + state advances / 공공기관 HARD PII → 409 + state UNCHANGED + runner not invoked + single audit / 공공기관 HARD clean → 200 / follow-up + hand-back-claude 모두 검증 / empty/missing instruction NOT_APPLICABLE / WITHOUT auditFn dep gate still works / throwing auditFn route still 200 / preset validation S3-c가 policy gate BEFORE 짧로 short-circuits) all green. **Cap movement decision**: 120/126 유지 — plan §S §S-score-trajectory가 +1 Safety cap 후보로 명시했으나 (1) SMART-2는 enforcement layering이지 새 safety property 아님, (2) 실제 운영 deployment에 HARNESS_HARD_GATES=1 + ledger samples 출현 후가 더 설득력, (3) plan §S Risk register가 "정상 작업 막힘"을 warn-default 채택 사유로 명시 — live deployment evidence 전 cap 이동은 시기상조. SMART-4/5가 gate chain을 enforcement-증명할 더 자연스러운 cap movement 근거 제공. Hook-router wiring + pipeline-executor post-state wiring + live verify probe 모두 deferred (모듈은 준비; wire는 후속 라운드). (1) `src/runtime/presetLibrary.js` — frozen 6 preset registry (accuracy / security / privacy / performance / release / public-sector-audit). 각 entry = `{presetId, defaultLabel, defaultDescription, codexSystemPrompt, claudeSystemPrompt, severityTagInstruction}`. SCHEMA `harness-review-preset/v1` + 4KB system prompt cap + 1KB severity-tag cap. presetId kebab-case 검증 + freeze-at-load — authoring 실수가 require()-time에 잡힘. listPresets() (서버측 — full prompts), listPresetSummaries() (UI dropdown — id+label+desc only, 시스템 프롬프트 누출 0). (2) `src/runtime/reviewSpawnDispatcher.js` 확장 — dispatchCodex / dispatchClaude / dispatchFollowUpCodex 모두 optional `req.presetId` 인자. _dispatchInternal threads presetId through inFlight Map 항목 + 4 audit verbs (started/completed/failed/blocked) + dispatch ack `.presetId` field. _buildCodexPrompt / _buildClaudePrompt / _buildCodexFollowUpPrompt 머지: `[Preset: <Label>]\n<systemPrompt>\n──────────────\nSession: ...\nFocus: <instruction>\n<plan>\n<severityTagInstruction>`. presetId=null → 레거시 shape 보존 (백워드 compat 100%). 모르는 presetId → DISPATCH_INVALID_INPUT (defense-in-depth — 라우트는 primary validator). (3) `src/routes/reviewSessionRoutes.js` 확장 — 새 `GET /api/review-presets` 라우트 (UI dropdown discovery; 시스템 프롬프트 본문 절대 포함 안 함). 3개 dispatch 라우트 (send-codex / follow-up / hand-back-claude) 모두 optional `body.preset` (shorthand string OR `{presetId}` 객체). 검증은 manager 상태 변환 BEFORE 발생 — 잘못된 preset → 400 + state 머신 unchanged + runner 호출 0 + audit clean. 알 수 없는 presetId → `invalid_preset` (with knownPresetIds[]); 잘못된 shape → `invalid_input`. (4) `public/js/monitor/review-session-client.js` 확장 — 새 `listPresets()` 메서드 (8 methods total) + sendToCodex/followUp/handBackToClaude 모두 opts.preset → body.preset 통과. 빈 / 비-string preset 자동 무시. (5) `public/js/monitor/panels/dual-agent-console.js` 확장 — i18n option + _t helper + 새 _renderPresetDropdown(): 4 states (loading 플레이스홀더 / ready 1+6 옵션 / missing 소프트-페일 / no-client `hidden` attribute). 마운트 시 _fetchPresetsOnce 비동기 트리거 (Promise.resolve().then 다음 microtask) — 실패하면 액션 버튼은 여전히 free-form fallback으로 동작. selectedPresetId state + change 핸들러 → render 재호출 + 툴팁이 description으로 swap. _onSendToCodex/_onFollowUp/_onHandBackToClaude 모두 selectedPresetId → client opts.preset 통과 (null → 자동 omit). (6) i18n KO/EN parity 17 keys × 2 locales (5 chrome + 6 × 2 preset label/description). (7) `tests/unit/monitor.review-session-client.test.js` extended (8 methods 검증). (8) closeout 보고서. **End-to-end SMART-3 chain**: operator picks "보안" → dropdown change → selectedPresetId="security" → click Send to Codex → client.sendToCodex(s, {preset:"security"}) → POST body.preset="security" → routes _resolvePresetId → dispatcher.dispatchCodex({...presetId:"security"}) → _buildCodexPrompt prepends [Preset: Security]\n<security codex prompt>\n + replaces severity instruction → audit chain `review_session_dispatch_started` data.presetId="security" → Codex critique arrives in security frame. 61 new unit (22 lib + 15 dispatcher + 16 UI + 8 client) + 20 new integration (routes). Total 3002/486/80 all green. Operator surface complete; cap movement deferred to SMART-2 (hard gates) per plan §S §S-score-trajectory.
**━━━ I18N-DOC-1 closed at 120/126 (2026-05-05) — i18n contract documentation (closes contracts-undocumented gap) ━━━**
I18N-DOC-1 — 2026-05-05 ninth follow-up slice. The 3 i18n test files (coverage / placeholder-parity / translation-quality) enforce contracts but the contracts themselves weren't documented. New committers learned rules by hitting failing tests. **docs/i18n-conventions.md** ships human-readable companion to test contracts (~9 sections + 3000+ bytes): §1 Key naming (dot-namespace + camelCase + reserved suffixes .title/.body/.cta/.aria/.eng) / §2 Adding a new key (workflow: both ko + en in same commit) / §3 Placeholders (regex /\\{(\\w+)\\}/g + parity rule + casing rule + forbidden patterns) / §4 Translation quality (4 sub-rules: §4.1 right script + §4.2 differential + §4.3 ko === en carve-out with 5 legitimate cases + §4.4 forbidden content) / §5 Sanity thresholds (≥ 200 keys + < 20% identical + ≤ 10 symbols-only) / §6 Test runner workflow + §7 Adding new locales 5-step procedure + §8 Common pitfalls 6-row table + §9 References. **23 structure tests** in tests/unit/docs.i18n-conventions.test.js: H1 + slice tag + 9 section presence + 3 test-file references + locale-file references + key contract content + §3 regex + §4 4 sub-rules + ko===en carve-out + §5 3 thresholds + §7 5-step list + §8 6-row table + cross-coherence (slice tags between doc and test files match). 3590 → 3613 unit (+23) / 553 integration / 90 smoke. **End-to-end behavior change**: pre-I18N-DOC-1 new committer adds i18n key, test fails with structured message, learns rule from test failure. Post-I18N-DOC-1 reads i18n-conventions.md first, adds key correctly, tests pass, learns from doc. **Cap movement decision**: 120/126 유지 — docs-only round; same rubric position as 8 prior follow-up rounds. **Deferred**: i18n key namespace conventions enforcement / pluralization quality / multi-locale (ja/zh) implementation. 사용자 권고 다음 라운드 후보: **POL-UI-2** / **Operator runs harness-start.bat in production for ≥1 week** / **External reviewer engagement** / **Pixel-diff visual testing** / **Multi-summary aggregation tool**.

**━━━ POL-DIFF-1 closed at 120/126 (2026-05-05) — Pack-info-card alt-card diff toggle (read-only rule comparison) ━━━**
POL-DIFF-1 — 2026-05-05 eighth follow-up slice after the 5-priority roadmap closed. Alt-cards in pack-info-card (POL-UI-1) now have a Compare button that expands a 3-column rule diff. Read-only preview of "what would change if I switched packs" — fills the gap between POL-UI-1's 3-badge summary and POL-UI-2's actual runtime switch (still deferred). Builds on POL-UI-1 + sets up POL-UI-2 (operators understand what switching would do BEFORE actually switching). 2 sub-slices (POL-DIFF-1-a/b). (1) **POL-DIFF-1-a** `public/js/monitor/panels/pack-info-card.js` additive only: **DIFFABLE_RULE_FIELDS** frozen array (10 boolean + 1 string = 11 fields covering every pack rule attribute) + **diffPacks(packA, packB)** helper returns `{changed: number, rows: [{field, fromValue, toValue, isChanged}]}` (tolerates missing fields treats as null; exported for tests) + **per alt-card diff toggle button** (only mounted when diff.changed > 0 — silent for identical-rule packs) + **3-column diff table** (rule / current / target with changed rows sorted first, unchanged rows for context) + click toggles aria-expanded + data-diff-state attribute + label switches between "Compare (N differ)" and "Hide comparison (N differ)". 5 i18n keys per locale (parity). CSS additive: outline-button toggle + bordered diff panel + 3-col grid + changed-row emphasis (orange-tinted target value matching --hsh-orange) + mobile @media stacks to 1-col. 16 tests in tests/unit/monitor.pack-info-card.diff.test.js: diffPacks helper (7 tests covering exports + 4 diff scenarios + missing-field tolerance + value preservation + scannerFailurePolicy string handling) + UI integration (9 tests covering toggle mount + aria-expanded + click expand/collapse round-trip + data-diff-state + 1 header + 11 body rows + changed-rows-sorted-first + no-toggle-when-identical + i18n {count} substitution). (2) **POL-DIFF-1-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-POL-DIFF-1 operator sees 3 quick badges per alt-card; to see what would change must read JSON or scorecard manually. Post-POL-DIFF-1 click "Compare (N differ)" → 3-col table shows every changed rule with from→to highlighting. Operator can preview "what would switching to public-sector do?" without restart, without runtime mutation, without leaving dashboard. 3574 → 3590 unit (+16) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — read-only feature; same rubric position as 7 prior follow-up rounds (UI/Maintainability quality-of-life touch); builds on POL-UI-1 + sets up POL-UI-2. **Backwards compat 100%**: tests-only + UI additive. **Read-only**: NO runtime state mutation; diff is purely a preview; operator still has to set HARNESS_DEPLOYMENT_PROFILE + restart server to actually switch packs (POL-UI-2 territory). **Deferred**: POL-UI-2 actual runtime switch (still risky still deferred) / per-pack policy preview (extended diff context) / multi-pack side-by-side compare. 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (still deferred — high blast radius) / **Operator runs harness-start.bat in production for ≥1 week** / **External reviewer engagement** / **Pixel-diff visual testing** / **Multi-summary aggregation tool**.

**━━━ I18N-PARITY-2 closed at 120/126 (2026-05-05) — Translation-quality gate (Hangul/Latin content checks) ━━━**
I18N-PARITY-2 — 2026-05-05 seventh follow-up slice after the 5-priority roadmap closed. Extends I18N-PARITY-1's placeholder-consistency gate with content-quality checks. Translation-loss class had two known sub-classes: (1) {placeholder} drift — closed by I18N-PARITY-1; (2) **forgotten translations** — ko table accidentally has en value (or vice versa) — closed by **this round**. Real-world drift scenario: ko["x"] = "안녕" + en["x"] = "Hello" → bug copies en into ko → ko["x"] = "Hello" + en["x"] = "Hello" → existing tests pass (key sets match, both non-empty, placeholders match, 80% threshold ok) → Korean operators see "Hello" everywhere instead of "안녕"; bug invisible. 2 sub-slices (I18N-PARITY-2-a/b). (1) **I18N-PARITY-2-a** `tests/unit/i18n.translation-quality.test.js` (new, ~290 lines, tests-only addition zero runtime risk). 11 tests across 3 categories: **HEADLINE RULES** — (1) every translated ko has Hangul (rule: if ko[K] !== en[K], ko[K] must contain Hangul; carve-out: ko === en tolerates proper nouns / product terms / URLs / schema strings) / (2) every translated en has Latin (inverse — catches en overwritten with ko) / (3) differential: when ko !== en, hangulRatio(ko) MUST be strictly > hangulRatio(en) — catches subtler "both have Hangul but ko isn't more Korean" cases (real translation makes ratios diverge naturally). **DEFENSIVE** — (4) no TODO/FIXME/XXX/TBD/TKTK markers (catches translator placeholders escaping production) / (5) no HTML tags (plain-text invariant; UI does escaping) / (6) ko symbols-only ≤ 10 keys cap (misuse of i18n keys as symbol storage). **ANCHORS** — (7-10) hangulRatio / latinRatio / HANGUL_RE / LATIN_RE behavior tests (helpers themselves don't drift). **SANITY** — (11) differential rule rejects synthetic "ko less Korean than en" bug. **At authoring time 0 violations across all 3 headline rules + 221+ keys** — confirms existing translation table is healthy AND establishes baseline for future additions. **ko === en carve-out** legitimate cases: pure English proper nouns ("English"/"Simple"/"Pro"/"Standard"/"Codex READY") + Korean product terms in both locales ("일반사용자"/"전문사용자") + URLs (docs.anthropic.com / github.com/openai/codex) + schema strings ("JSON (schema: src/templates/...)"). (2) **I18N-PARITY-2-b** closeout 보고서 + scorecard 마커 (이 라운드). **Harness now has THREE complementary i18n gates**: (1) i18n.coverage.test.js (Slice I, v5: key set parity + non-empty values) + (2) i18n.placeholder-parity.test.js (I18N-PARITY-1: placeholder set parity + suspicious-brace + casing + sanity thresholds) + (3) i18n.translation-quality.test.js (this round: Hangul/Latin content + differential ratio + TODO/HTML defensive). 3563 → 3574 unit (+11) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — I18N-PARITY-2 ships tests-only gate NOT cap-worthy event; same rubric position as prior 6 follow-up rounds (Testability/Maintainability quality-of-life touch). **5 decisions worth re-reading** (documented in closeout): the "if ko === en" carve-out (10 keys legitimately identical across locales — proper nouns + product terms + URLs + schema strings; forcing every key to differ would require curated exception list — fragile + maintenance burden; differential check handles remaining cases naturally) / strict `>` not `>=` in differential test (equal Hangul ratios with different values suspicious — real translations make ratios diverge) / HANGUL_RE limited to precomposed syllable block 가–힣 (don't need Jamo ㄱ–ㅎ — translation values use composed syllables; isolated Jamo would be separate rarer signal) / LATIN_RE strict ASCII (don't include Latin-1 punctuation or extended Latin — harness en values vanilla ASCII; tightens to catch "en got mojibaked into UTF-8 garbage" as side effect) / TODO marker list explicit (TODO/FIXME/XXX/TBD/TKTK — common translator placeholders; explicit list prevents \\bWIP\\b legitimate work-in-progress from being flagged). **Deferred / out-of-scope**: translation-quality across multiple locales (today only ko + en) / pluralization quality (i18n doesn't use ICU plural forms today) / profanity / inappropriate content detection (out-of-scope linguistic) / tone consistency (formal vs casual speech levels — hard to mechanically detect). 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (runtime mutation high blast radius) / **Operator runs harness-start.bat in production for ≥1 week** / **External reviewer engagement** (apparatus fully ready) / **Pixel-diff visual testing** / **Multi-summary aggregation tool**.

**━━━ I18N-PARITY-1 closed at 120/126 (2026-05-05) — i18n placeholder consistency gate (closes silent-translation-loss class) ━━━**
I18N-PARITY-1 — 2026-05-05 sixth follow-up slice after the 5-priority roadmap (RR0/SMART-LV/POL/FP/EXR) closed. Closes a silent-translation-loss regression class that the existing i18n.coverage.test.js (Slice I, v5) couldn't catch. Across the 5 prior follow-up rounds many i18n keys were added (POL-c +23, SMART-3 +17, POL-UI-1 +10, SMART-1-BASELINE +3 per locale, etc.). Existing gate verified ko/en key-set parity + non-empty values, but NOT that templated `{placeholder}` names matched across locales. **Real-world drift scenario**: ko["x"] = "하드 게이트: {mode}" + en["x"] = "Hard gates: {m}" (typo) → existing tests pass (key sets match, both non-empty); at runtime HarnessI18n.t("x", { mode: "hard" }) substitutes correctly in ko ("하드 게이트: hard") but leaves literal `{m}` in en ("Hard gates: {m}"). Operators on English see broken UI; operators on Korean see correct UI; committer none the wiser; CI green. 2 sub-slices (I18N-PARITY-1-a/b). (1) **I18N-PARITY-1-a** `tests/unit/i18n.placeholder-parity.test.js` (new, 290 lines, tests-only addition zero runtime risk). 9 tests: **(1) per-key placeholder set parity** (the headline check — for every key, placeholder set extracted from ko's value MUST equal placeholder set extracted from en's value; drifts collected across ALL 221+ keys before failing in one-shot fail message so committer fixing 5 silent drifts doesn't have to re-run test 5 times) / **(2) "looks like placeholder but isn't" detection** (catches translator typos like `{ mode }` space-padded / `{tool-name}` hyphenated / `{}` empty — patterns that look like placeholders but don't match runtime regex /\\{(\\w+)\\}/g) / **(3) mixed-case anomalies across locales** (ko `{mode}` vs en `{Mode}` — case-sensitive substitution would silently leave `{Mode}` literal when caller passes `{ mode: "hard" }`) / **(4) sanity ≥ 80% translated** (some keys legitimately ko === en for proper nouns like "Codex CLI" / schema strings; > 20% identical → likely English-only block synced into ko by accident) / **(5) no leading/trailing whitespace** (panels concat with explicit separators — edge whitespace in localized values almost always typo) / **(6) anchor: extractPlaceholders matches HarnessI18n.t regex** (belt-and-suspenders if runtime regex changes) / **(7) anchor: findSuspiciousBraces detects typos but not valid placeholders** (regression test for helper itself) / **(8) total key count ≥ 200** (block-deletion canary — existing i18n.coverage gates at ≥ 40 v5 floor; tightens floor in light of accumulated surface, was 221 keys at authoring time) / **(9) round-trip — every {placeholder} can be substituted by name** (substituting all named placeholders leaves no remaining `{word}` patterns; verifies runtime regex + value + params triple internally consistent — catches case-sensitivity bugs static parity misses). (2) **I18N-PARITY-1-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-I18N-PARITY-1 committer adds typo'd placeholder → existing tests pass → UI silently broken for one locale → invisible until operator reports broken UI. Post-I18N-PARITY-1 same scenario → fail fast with structured one-shot message listing every drift with both locales' placeholder sets + missing names per locale. Committer fixes en, re-runs, passes. 3554 → 3563 unit (+9) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — I18N-PARITY-1 ships tests-only gate NOT cap-worthy event. Does not add new safety boundary (Safety cap unchanged) / does not extend public-sector readiness (POL-UI-1 + FP-a/b remain relevant evidence) / does not extend reviewer hand-off (EXR-a/b/c/d remain relevant) / genuinely Testability/Maintainability quality-of-life touch — same rubric position as prior 5 follow-up rounds. What this slice DOES contribute: 9 new tests close real regression class (silent translation loss); existing 221+ i18n keys all pass — confirms existing translation table healthy AND establishes baseline for future additions; harness now has TWO complementary i18n gates (i18n.coverage.test.js v5: key set parity + non-empty values + i18n.placeholder-parity.test.js this round: placeholder set parity + suspicious-brace detection + casing parity + sanity thresholds). The honest score remains 120/126. **5 decisions worth re-reading** (documented in closeout): one-shot fail message not fail-fast (collects every drift across 221+ keys before failing — fail-fast forces re-run per fix; cost still <1ms) / anchor tests for both helpers (extractPlaceholders + findSuspiciousBraces each have dedicated test pinning expected output — guards against silent helper drift if regex changes) / 80% translation threshold not per-key (proper nouns + schema strings legitimately ko===en — strict per-key would have many false positives; 80% catches block-sync mistakes) / 200-key floor not 40 (existing gates at ≥ 40 v5 original; today 221+ keys; ≥ 200 block-deletion canary tightens floor without brittle exact-count) / round-trip test not just static parity (test #9 actually substitutes stub values + verifies no {word} patterns remain — catches case-sensitivity bugs static parity misses where regex right but parameter shape isn't, e.g. {mode} accidentally typed {Mode} everywhere). **Deferred / out-of-scope**: stricter casing convention (currently allows both {mode} and {count} mixed; future round could enforce snake_case OR camelCase consistently — cosmetic policy decision) / translation-quality detection (beyond mechanical parity — future test could check ko values contain Hangul + en values predominantly Latin) / pluralization parity (i18n keys don't use ICU plural forms today; if added later parity would need new logic) / i18n key namespace conventions (keys dot-namespaced "smart.rec.systemReady.title" but no test verifies namespace consistent within feature — future round could enforce sibling .title/.body/.cta triples) / multi-locale support (today only ko + en; future ja or zh would need 3+ locale comparison). 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry — meaningful blast radius runtime mutation) / **Operator runs harness-start.bat in production for ≥1 week** (FP-a + 5 follow-up rounds + I18N-PARITY-1 now combine to smoother experience) / **External reviewer engagement** (apparatus fully ready — EXR-a/b/c/d all shipped) / **Pixel-diff visual testing** (Playwright/Puppeteer baseline) / **CSS-2** (most candidates already styled) / **Multi-summary aggregation tool** (speculative until multiple summaries exist) / **Translation-quality detection** (Hangul-in-ko / Latin-in-en mechanical checks).

**━━━ EXR-d closed at 120/126 (2026-05-05) — Reviewer-facing summary template (closes EXR pipeline) ━━━**
EXR-d — 2026-05-05 fifth follow-up slice after the 5-priority roadmap (RR0/SMART-LV/POL/FP/EXR) closed. Closes the EXR pipeline by shipping the reviewer-facing summary template that EXR-c explicitly deferred. Pre-EXR-d external reviewers walked EXR-a bundle + EXR-b matrix → marked PASS/DOUBT/FAIL per row → had to write summary in unstructured form. Each reviewer invented their own format; cap-movement gate had no canonical input. Post-EXR-d reviewers copy summary-template.md to docs/reports/<date>-external-review-summary.md → fill 5 REQUIRED + 4 OPTIONAL sections → committed summary is canonical artifact cap-movement gate consumes. 2 sub-slices (EXR-d-a/b). (1) **EXR-d-a** `docs/external-review/summary-template.md` — 9-section template (~370 lines) closing the loop EXR-a → EXR-b → **EXR-d** → cap-movement recommendation. **§0 Header (REQUIRED)**: review id + reviewer + bundle sha256 (recompute don't trust self-report — canary against bundle tampering) + bundle verdict at capture (4 tiers OK/DEGRADED/INCIDENT/CONFIG matching EXR-a) + matrix path + time invested. **§1 Verdict (REQUIRED)**: 3 overall tiers (`PASS` / `PASS-WITH-CONCERNS` / `FAIL`) + 3 cap-movement tiers (`MOVE` / `DEFER` / `BLOCK`) — decoupled axes (real combinations like PASS+DEFER = "regression-free but evidence incomplete" / PASS-WITH-CONCERNS+DEFER = "advance work but not cap"). Each tier with prose semantics. Headlined by 4-6 sentence executive summary for busy committer. **§2 Sampling strategy (REQUIRED)**: 4 enumerated strategies (random / focused / risk-weighted / time-boxed) + coverage stats (total rows / sampled / coverage %) + categories fully-sampled vs untouched + rationale. **§3 Per-category aggregation (REQUIRED)**: 8 subsections MIRRORING EXR-b matrix categories EXACTLY by name (not similar-to / not subset-of — tests pin this down). Each captures PASS/DOUBT/FAIL/(not-sampled) counts + cap-relevance (Public-sector readiness / Testability / Dual-agent integration / Error resilience / Safety + UI / Safety + Observability) + reviewer notes. **§4 Findings (REQUIRED if DOUBT/FAIL)**: per-finding template (severity 4 tiers + category + matrix row + code anchor + observation + remediation + blocks-cap-movement flag). Explicit PASS fallback statement "No findings. All sampled rows verified." — forces positive declaration not silent skip. **§5 Comparison against prior bundle (OPTIONAL)**: multi-cycle trend table (score / rounds added / findings carried forward / closed). **§6 Recommended cap movements (REQUIRED if §1=MOVE)**: per-cap justification with current → recommended-new + counter-argument. For DEFER/BLOCK: future-cap-candidate template with what-would-unblock. **§7 Operator-actionable next steps (OPTIONAL)**: non-blocking quality-of-life suggestions. **§8 Privacy & retention statement (REQUIRED)**: 4 markdown CHECKBOXES (forces active confirmation not skim-pastable prose) — no real customer/credential/operator/machine-id names + reviewer signature line + external-share toggle (yes/no/yes-with-redaction). **Appendix**: 3-row cap-movement justification table tying Public-sector readiness +1 / Testability +1 / Safety +1 to proof requirements + closeout citations (FIELD-PILOT-0 + EXTERNAL-REVIEW-0 + SMART-LV-0). Explicit "DON'T invent new cap definitions — caps codified in scorecard.md" guard rail. **Required vs optional sections marked with HTML comments** (`<!-- REQUIRED -->` / `<!-- OPTIONAL -->`) — machine-readable + human-readable + structure tests verify the markers. **EXR-b matrix cross-link**: `docs/external-review/claim-evidence-matrix.md` step 4 ("Write the summary report") now links to summary-template.md + cites canonical committed-instance path + lists 5 REQUIRED sections inline (canary against drift). 32 EXR-d-a tests in `tests/unit/external-review-summary.test.js` covering file-level invariants / pipeline cross-reference / 9 section presence / REQUIRED/OPTIONAL HTML-comment markers / 3 verdict tiers + 3 cap-movement tiers / §3 8 categories matching EXR-b matrix EXACTLY / §4 findings template + PASS fallback / appendix 3 priority cap movements + closeout citations + DON'T-invent guidance / §2 4 sampling strategies + coverage stats / §0 bundle sha256 + recompute reminder + 4 verdict tiers / §8 privacy 4 markdown checkboxes + signature + external-share toggle / path discovery + canonical committed-instance path. + 1 cross-coherence test in tests/unit/external-review-matrix.test.js verifying matrix's "Write the summary report" step links to EXR-d template + canonical instance path + 5 REQUIRED sections listed inline (canary against drift). (2) **EXR-d-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-EXR-d external reviewer marks rows in matrix → must write summary in unstructured form → cap-movement gate has no canonical input → committers can't tell what shape of evidence is expected. Post-EXR-d reviewer copies template → fills required sections → committed summary is canonical artifact gate consumes → multi-cycle reviews can §5 diff against prior summaries for trend detection. 3521 → 3554 unit (+33 = 32 EXR-d-a + 1 matrix cross-link) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — EXR-d ships apparatus that ENABLES one specific cap movement (Testability +1 — see appendix) but does NOT move the cap itself. Honest gate for Testability +1 was always: (1) EXR-a bundle exporter shipped ✓ / (2) EXR-b matrix structural tests shipped ✓ / (3) round-trajectory parser shipped ✓ / (4) verifiable sha256 chain shipped ✓ / (5) **reviewer summary template shipped ✓ (this round)** / (6) **external reviewer fills template + commits real summary** ← still operator-time / reviewer-time. Step 6 is cap-movement trigger. EXR-d closes 1-5 (apparatus); cap moves when actual external reviewer walks apparatus end-to-end. What this slice DOES contribute: 32 new tests anchor summary template contract + 1 cross-coherence test ties EXR-b matrix to EXR-d template (canary against future drift) + cap-movement gate now has canonical frozen input — no more "what shape of evidence does the gate expect?". The honest score remains 120/126. **8 decisions worth re-reading** (documented in closeout): §1 has THREE verdict tiers not two (middle PASS-WITH-CONCERNS prevents binary inflation in either direction) / cap-movement decoupled from verdict (4 real combinations: PASS+DEFER / PASS-WITH-CONCERNS+DEFER / PASS+MOVE / FAIL+BLOCK) / REQUIRED/OPTIONAL HTML comments machine + human readable / §3 categories MIRROR EXR-b EXACTLY (tests pin down — future EXR-b rename without EXR-d update fails loudly) / appendix's "DON'T invent" guard rail / §0 reminds reviewer to RECOMPUTE bundle sha256 not trust self-report (tampered bundle could lie) / §4 PASS fallback explicit (forces positive declaration not silent skip) / §8 privacy is checklist not prose (markdown checkboxes force active confirmation; prose easier to skim past). **Deferred / out-of-scope**: real reviewer engagement (operator/reviewer-time) / multi-summary aggregation tool (cross-cycle trend reporting) / summary signing (GOV-AUDIT-0-style HMAC sealing — today plain markdown commit) / template i18n (currently English-only) / finding ledger (separate file aggregating F.N records across summaries) / auto-populate §0 from bundle (script reads bundle JSON pre-fills header — saves typing but loses "recompute sha256" canary unless carefully designed) / live-link matrix row references in finding template. 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry — meaningful blast radius runtime mutation of policy state) / **Operator runs harness-start.bat in production for ≥1 week** (FP-a + POL-UI-1 + SMART-3-POLISH + SMART-1-BASELINE + CSS-1 + EXR-d now combine to smoother experience) / **External reviewer engagement** (someone other than committer walks EXR-a bundle + EXR-b matrix + fills EXR-d summary template — this round's enabling apparatus) / **Pixel-diff visual testing** (Playwright/Puppeteer baseline) / **CSS-2** (additional surfaces) / **Multi-summary aggregation tool** (cross-cycle trend reporting).

**━━━ CSS-1 closed at 120/126 (2026-05-05) — Simple-shell banner card visual polish (closes recurring CSS deferred debt) ━━━**
CSS-1 — 2026-05-05 fourth follow-up slice after the 5-priority roadmap (RR0/SMART-LV/POL/FP/EXR) closed. Closes the recurring CSS debt that POL-UI-1 + SMART-3-POLISH + SMART-1-BASELINE all explicitly deferred. Three banner-card panels (`pack-info-card`, `recommendations-card`, `next-action-card`) were rendering with default browser styling (no border, no spacing, no severity tones). Operators saw raw text + buttons making dashboard feel half-built. CSS-1 grounds panels in existing harness shell design tokens (--hsh-bg-card / --hsh-border / --hsh-radius-md / --hsh-fs-* / --hsh-red/orange/yellow/blue/green / --hsh-text/text-dim) so they match the 4-card grid below. 2 sub-slices (CSS-1-a/b). (1) **CSS-1-a** `public/style.monitor.css` additive only at end of file (~440 lines). **Mount containers**: shared `.ss-first-run-mount` + `.ss-recs-mount` + `.ss-pack-info-mount` rules with max-width:960px + `:empty → display:none` so empty mounts don't add gap. **Banner-card chassis**: `.nac-card / .rec-card / .pic-card` grouped using --hsh-bg-card + --hsh-border + --hsh-radius-md tokens for visual continuity with .ss-cell. **Shared label**: 3 panel labels (.nac-label / .rec-label / .pic-label) grouped — mono uppercase caption matching .ndc-title pattern. **recommendations-card (SMART-1-c)**: 4 severity dot color rules `[data-severity="critical|high|medium|info"]` mapping to --hsh-red / --hsh-orange / --hsh-yellow / --hsh-blue / **SMART-1-BASELINE-a `system-ready` distinct styling**: green tint surface (75,201,114) + green dot — leans into "all clear" affordance since post-processing guarantees this rec only fires alone never competes with urgent recs / .rec-cta primary outline button + hover + :focus-visible (a11y) / .rec-dismiss reveal-on-hover (opacity 0.5 → 1 on row hover or focus-visible) / .rec-empty italic dim. **pack-info-card (POL-UI-1-a)**: .pic-current-pack pill badge with `[data-public-sector="true"]` orange variant (matches GOV-PII / posture color) — operator can tell at a glance "this is a regulated deployment" / .pic-public-sector-reqs 2px orange left-accent border + tinted background — 5-bullet checklist visually separated / .pic-alternatives `<details>` with ▸ rotation indicator (90deg on `[open]`) — native HTML disclosure no custom JS / 3 alt-card badge variants `.pic-alt-badge-ps` (orange) / `-hg` (red) / `-norm` (blue) — operator can compare packs at a glance / .pic-empty + .pic-restart-hint + .pic-alt-none low-contrast italic informational tone. **next-action-card (UI-FirstRun-c)**: .nac-cta default + `.is-primary` blue variant + hover + `:focus-visible` (a11y) — first-run operators get clear primary action / .nac-headline + .nac-body + .nac-meta + .nac-cta-row hierarchy. **Mobile** (`@media max-width: 720px`): rec-row 3-col grid collapses to stacked layout (CTAs span full width don't squeeze title) + pic-alt-list collapses to single column. 18 selector-presence tests in `tests/unit/style.monitor.css-1.test.js`. **Test strategy**: regex-match key CSS selectors in stylesheet file. NOT pixel-perfect output (visual diff tool's job); IS testing key selectors required by panels' data-attribute hooks exist. Future regression (someone deletes .rec-row[data-severity="critical"] etc.) caught fast — panels' data attributes would lose styling cue silently otherwise. Tests cover: file exists + slice marker comment / shared mount-container max-width grouping / empty-mount hide rule / banner-card chassis grouped using --hsh-bg-card + --hsh-radius-md / 4 severity dot rules + correct token mapping (red/orange/yellow/blue) / system-ready baseline rec distinct dot + row surface rules + green RGB tint (75,201,114) / rec-cta primary + hover + focus-visible + dismiss reveal-on-hover + empty / pack-info badge default + [data-public-sector="true"] variant using --hsh-orange / public-sector requirements call-out 2px solid orange left-accent / 3 alt-badge variants → 3 token colors / collapsible details with ▸ + 90deg rotation on [open] / empty placeholder + restart hint + alt-none / nac-cta default + primary blue + hover + focus-visible / nac-card headline + body + meta + cta-row / shared label style mono + uppercase / mobile breakpoint rec-actions full-width + pic-alt-list 1-col / brace balance sanity check. (2) **CSS-1-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-CSS-1 operator opens dashboard with ?monitor=1 → sees raw text for next-action ("프로필 설정이 필요합니다"), unstyled rec rows ("승인 요청 3개 대기 중" with no severity color), pack-info as plain HTML (no badge, no left-accent for public-sector requirements). Looks like developer prototype. Post-CSS-1 same scenario → cards render with harness shell visual language: bordered chassis, severity-toned dots, public-sector posture color, collapsible alternatives with rotation indicator, hover/focus states, mobile-responsive grid. Operator perception: "polished product". 3503 → 3521 unit (+18) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — CSS-1 ships visual polish for operator-facing surfaces NOT cap-worthy event. Does not add new safety boundary (Safety cap unchanged) / does not extend public-sector readiness (POL-UI-1's runtime data + 5-bullet requirements display were cap-relevant pieces; CSS just makes them visible) / does not extend reviewer hand-off (EXR-a/b/c stay relevant) / genuinely UI/Maintainability quality-of-life touch — same rubric position as POL-UI-1 + SMART-3-POLISH + SMART-1-BASELINE. What this slice DOES contribute: 18 new tests anchor CSS contract (selector + token presence) → future regressions caught immediately + shared design-token consumption (--hsh-*) means future theme rollouts (light mode? high contrast?) don't need per-panel CSS updates + system-ready baseline rec now has visually distinct "all clear" affordance — closes operator-DX loop SMART-1-BASELINE opened. The honest score remains 120/126. **6 decisions worth re-reading** (documented in closeout): selector-presence tests not pixel-diff (Puppeteer/Playwright adds dev dep + CI step + maintenance burden — sub-pixel browser shifts on every update; selector-presence catches same regression class without infrastructure cost) / shared chassis + per-panel specifics (one grouped selector not copy-pasted; future token rollouts hit one rule) / data-attribute hooks not class-toggle for severity (panels set data attributes; CSS reads — narrower contract than JS-toggled is-* classes) / green tint for system-ready not info-blue (severity stays "info" in engine; visual semantics stay in CSS; green only fires when rec-id matches not generic info) / mobile breakpoint at 720px not 600px (manual measurement: 3-col rec-row visibly squeezes CTAs below 720) / reveal-on-hover dismiss button (opacity 0.5 → 1 on hover or focus-visible — always-visible dismiss competes with primary CTA for attention; reveal pattern keeps primary action front-and-center while remaining accessible). **Deferred / out-of-scope**: light-mode theme (token-level override pattern; not in scope here) / high-contrast mode (same pattern) / pixel-diff testing (Playwright/Puppeteer screenshot comparison against golden baseline — selector-presence catches structural drift NOT computed-value regressions; worth doing if visual regressions become real problem) / welcome-overlay (UI-H8) styling harmonization (currently has CSS but could harmonize with CSS-1 design language) / approval-card (R3-e + UX-2) styling polish (write-tool approvals could benefit from CSS-1-style severity tones — higher stakes than read-tool) / CSS-2 round for additional surfaces (`.bd-tabs / .dac-* / .rt-* / etc.` — CSS-1 covered 3 most-visible operator-facing banner cards). 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry — meaningful blast radius runtime mutation of policy state) / **Operator runs harness-start.bat in production for ≥1 week** (FP-a + POL-UI-1 + SMART-3-POLISH + SMART-1-BASELINE + CSS-1 now combine to smoother experience) / **External reviewer engagement** (someone other than committer walks EXR-a bundle + EXR-b matrix) / **Pixel-diff visual testing** (Playwright/Puppeteer baseline against live dashboard render) / **CSS-2** (additional surfaces — approval-card / welcome-overlay / workflow surfaces).

**━━━ SMART-1-BASELINE closed at 120/126 (2026-05-05) — Recommendations-card baseline rule (system-ready) ━━━**
SMART-1-BASELINE — 2026-05-05 third follow-up slice after the 5-priority roadmap (RR0/SMART-LV/POL/FP/EXR) closed. Closes the recommendations-card empty-state UX gap that the SMART-3-POLISH closeout flagged: on fresh deployments with active profile but no events yet, operators were landing on "현재 권장 행동이 없습니다." (technically correct, operator-hostile). Baseline rule fills the gap with positive "✓ 시스템 준비됨" confirmation while NEVER competing for slot space with real urgent recommendations. 2 sub-slices (SMART-1-BASELINE-a/b). (1) **SMART-1-BASELINE-a** `public/js/runtime/recommendationEngine.js` additive only — 1 new RULE entry + 1 post-processing pass. **New rule**: `system-ready` (severity: info, **isBaseline: true**, appliesTo: hasActiveProfile === true defensive against null ctx, ctaActionId: open-setup-wizard safe destination — never mutates state). **Engine post-processing** (the key contract): after all rules evaluate, recommendFromContext now (1) collects all matching rules existing behavior + (2) **NEW**: if any non-baseline rule matches, filter out all baseline matches before sorting + returning + (3) sort by severity then rule index existing behavior + (4) return — output preserves isBaseline on every rec so panels can branch (e.g. CSS variant for "all clear" state). **Behavior matrix**: quiet context (hasActiveProfile=true, all else false) → 1 rec (system-ready) / any urgent signal (PII / approval pending / active runs / public-sector PII) → urgent recs only baseline filtered / !hasActiveProfile → complete-profile-setup (critical) baseline can never apply because appliesTo requires hasActiveProfile=true. **i18n** ko/en parity 3 keys per locale: smart.rec.systemReady.{title,body,cta}. **2 invariant updates**: tests/unit/recommendationEngine.test.js — RULES.length 7 → 8 (5 base + 2 public-sector + 1 baseline) + documented IDs list adds "system-ready". **1 canary update**: tests/unit/monitor.recommendations-card.test.js:145 originally asserted data-state==="empty" for ready-state context; now asserts data-state==="populated" + data-rec-id="system-ready". Intent preserved — if future change accidentally disables baseline, test catches it (state reverts to "empty"). 14 new SMART-1-BASELINE-a tests in `tests/unit/recommendationEngine.baseline.test.js`: rule shape (system-ready registered/frozen/isBaseline=true/ctaActionId=open-setup-wizard / all other rules NOT carrying isBaseline=true codifies "exactly one baseline" convention / exactly one baseline in registry — multi-baseline ordering out of scope; future round changing this MUST update test) / quiet-context behavior (hasActiveProfile=true all else false → exactly 1 rec system-ready INFO severity isBaseline=true / quiet PUBLIC-SECTOR publicSector=true but no PII no auditExportReady → still only system-ready) / filtering when non-baseline rules fire (complete-profile-setup → baseline filtered / approval pending → baseline filtered / multiple non-baseline PII+approval+active runs → ALL shown baseline filtered) / defensive guards (!hasActiveProfile → appliesTo returns false defense-in-depth / appliesTo(null) / undefined / {} / {booleans:{}} → all false / meta() returns empty object) / operator agency (baseline can be dismissed → empty rec list — back to empty-state UX for operators who explicitly hide it) / output shape (baseline rec output isBaseline=true / non-baseline rec output isBaseline=false NOT undefined — explicit value so panels can branch reliably). (2) **SMART-1-BASELINE-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-SMART-1-BASELINE operator boots harness with active profile + no events → recommendations-card lands on "현재 권장 행동이 없습니다." Empty. Operator unsure if system OK or broken. Post-SMART-1-BASELINE same scenario → "✓ 시스템 준비됨" rec appears with reassuring body + non-mutating CTA to setup wizard for verification. Operator confidence: explicit "all clear" signal. When real recommendations fire (PII / approval / active runs / etc.), baseline filtered out and urgent recs take the slot — no clutter no compete for attention. 3489 → 3503 unit (+14) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — SMART-1-BASELINE ships operator-DX improvement on recommendations-card NOT cap-worthy event. Does not add new safety boundary (Safety cap unchanged) / does not extend public-sector readiness (POL-UI-1 + FP-a/b stay relevant evidence) / does not extend reviewer hand-off (EXR-a/b/c stay relevant evidence) / genuinely Maintainability/UI quality-of-life touch — same rubric position as SMART-3-POLISH and POL-UI-1. What this slice DOES contribute: 14 new tests anchor baseline contract (rule shape + filtering + dismissal + appliesTo defensive guards) + 2 invariant updates codify "exactly one baseline rule" + "8 total rules" facts + 1 canary updated so future accidental disabling reverts to checking for "empty". The honest score remains 120/126. **8 decisions worth re-reading** (documented in closeout): isBaseline:true flag not severity-based filtering (would also filter monitor-active-runs + export-audit-evidence info-severity recs) / filter pass AFTER matching not in appliesTo (appliesTo stays pure depends only on ctx; filtering is single-line predicate) / baseline rec output carries isBaseline=true so panels can branch reliably / non-baseline output isBaseline=false explicit NOT undefined / CTA = open-setup-wizard (safe destination: read-only-by-default + provides operator-actionable next steps) / appliesTo: hasActiveProfile === true (defense in depth — engine filter would drop baseline when complete-profile-setup fires but explicit guard makes contract clear) / one baseline rule not many (test pins this down — future round adding second baseline MUST update test alongside engine logic) / baseline can be dismissed (operator agency — dismissing returns card to true empty state) / updated canary test rather than deleting (intent preserved: if future change disables baseline test reverts to checking "empty"). **Deferred / out-of-scope**: multi-baseline rules (e.g. "first-week onboarding tip" / "post-first-run welcome" — today exactly one baseline, test pins down) / baseline-specific CSS (data-rec-id="system-ready" + data-severity="info" styling hooks but actual color/icon polish is CSS follow-up — same deferred status as POL-UI-1 / SMART-3-POLISH visual polish) / localized baseline copy by deployment posture (public-sector operators might want different phrasing — today generic copy) / baseline metrics (dismiss event signal but not separately surfaced — future round could track baseline-dismissal rate as part of operator engagement metrics) / welcome-overlay integration (UI-H8 welcome-overlay + baseline rec both target first-time operators but live at different layers — could be unified or one removed but that's UX decision not regression risk). 사용자 권고 다음 라운드 후보: **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry — meaningful blast radius runtime mutation of policy state) / **Operator runs harness-start.bat in production for ≥1 week** (FP-a + POL-UI-1 + SMART-3-POLISH + SMART-1-BASELINE now combine to smoother experience) / **External reviewer engagement** (someone other than committer walks EXR-a bundle + EXR-b matrix) / **CSS styling for the simple-shell cards** (deferred CSS across pack-info-card + recommendations-card + next-action-card + baseline-rec becoming visible debt).

**━━━ SMART-3-POLISH closed at 120/126 (2026-05-05) — Dual-agent-console preset memory (localStorage) ━━━**
SMART-3-POLISH — 2026-05-05 second follow-up slice after the 5-priority roadmap (RR0/SMART-LV/POL/FP/EXR) closed. Picks the highest-DX item off the SMART-3 polish list per plan §S §S-next-after: **recently-used preset memory via localStorage**. Operators repeating "보안" / "Security" critique workflow no longer have to repick their preset every session. 2 sub-slices (SMART-3-POLISH-a/b). (1) **SMART-3-POLISH-a** `public/js/monitor/panels/dual-agent-console.js` additive only — 2 new constructor options + 2 helpers + 1 restoration step + 1 persist call. **2 new constructor options**: `storage` (localStorage shim; defaults to globalThis.localStorage when available; missing/inaccessible falls back to in-memory only — panel still works no persistence; pass null explicit opt-out; tests inject Map-backed shim) + `recentPresetsKey` (default "harness:recentPresetId:v1" — matches harness:<feature>:v<n> namespace pattern from harness:runHistory:v1; bumping version is how future schema change rolls out without operator intervention — old keys become orphans). **`_readRecentPresetId()` / `_writeRecentPresetId()` helpers** with: 128-char defensive cap (corrupt entry → ignored not crash) / **empty-string sentinel = "operator chose free-form"** (distinct from missing key = "never selected before") / try/catch around every storage call (browser private-mode + iframe-restricted-storage configs throw on access not return null). **`_fetchPresetsOnce` restoration step**: after server returns presets, IF selectedPresetId === null AND remembered presetId still in availablePresets, restore. Server-removed preset → fallback to null (legacy free-form dispatch behavior preserved). **`select.addEventListener("change")` persist immediately**: every selection write goes to storage; free-form choice writes empty-string sentinel so explicit choice survives next mount. **Backwards compat 100%**: 51 existing dual-agent-console tests (test.js + action-row.test.js + preset.test.js) all pass without modification. 14 new SMART-3-POLISH-a tests: change writes selectedPresetId to storage with canonical key / change to free-form writes empty-string sentinel / pre-existing storage value restores on mount (after listPresets resolves) / **headline**: empty-string sentinel does NOT restore (explicit free-form preserved across mounts) / stored presetId no longer in catalog → fallback to null / storage=null disables persistence (in-memory state still works) / recentPresetsKey custom value honored on read AND write / storage throwing on getItem → graceful null / storage throwing on setItem → panel does not crash / corrupt storage value (>128 chars) ignored / **headline**: change → unmount → remount restores selection / **headline**: free-form change → unmount → remount stays free-form (operator's explicit choice survives) / presetsFetchFailed (soft-fail path) → no restore attempted, stored value preserved for next successful mount / handle._state() exposes selectedPresetId + availablePresets for downstream tests. (2) **SMART-3-POLISH-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-SMART-3-POLISH operator picks "보안" → Send to Codex → critique arrives → archive session → start new session → dropdown reverts to "자유 입력 (preset 없음)" → must repick "보안" every session. Post-SMART-3-POLISH operator picks "보안" once → localStorage remembers → every subsequent mount of dual-agent-console pre-selects "보안". Operator switches to free-form once → localStorage remembers explicit "no preset" choice → subsequent mounts stay free-form. Server removes a preset → operator's stored value not in catalog → fallback to free-form dispatch. 3475 → 3489 unit (+14) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — SMART-3-POLISH ships operator-DX improvement, NOT a cap-worthy event. Does not add new safety boundary (Safety cap unchanged) / does not extend public-sector readiness (POL-UI-1 + FP-a/b stay relevant evidence) / does not extend reviewer hand-off (EXR-a/b/c stay relevant evidence) / genuinely a Maintainability/UI quality-of-life touch — rubric line for those at +1 headroom but cap movement requires pattern-of-many improvements not one slice. The honest score remains 120/126. What this slice DOES contribute: 14 new tests anchor storage contract → future regressions caught immediately + 2 new constructor options codify test-injection seam pattern matching welcome-overlay storage option precedent. **6 decisions worth re-reading** (documented in closeout): empty-string sentinel for "free-form" (canary test catches removal) / restore happens AFTER listPresets resolves not at mount time (validate against catalog before restoring) / selectedPresetId === null guard before restore (keeps door open for future URL query param / deep link overrides) / 128-char defensive cap (DevTools/extension pollution defense) / recentPresetsKey is constructor option not constant (test pollution avoidance) / storage = null explicit opt-out (3-state semantics match welcome-overlay precedent). **Deferred / out-of-scope**: keyboard shortcut (e.g. g p — adds key conflict surface; native <select> Tab+arrow already works; worth doing if operators report friction) / tooltip improvements (current shape functional; aria-live + role=status + severity instruction snippet are incremental) / multi-preset memory (single-most-recent gives ~95% value; ring buffer + dedup + ordering adds complexity for marginal gain) / CSS styling (same deferred status as pack-info-card + recommendations-card + next-action-card; visual polish in follow-up) / cross-deployment persistence (server-side per-profile preset is out-of-scope; localStorage per-browser is right scope). 사용자 권고 다음 라운드 후보: **SMART-1 panel acceptance** (recommendations-card mounted but no card rules fire on fresh deployment; setup-related first-paint recommendation could improve onboarding) / **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry — meaningful blast radius) / **Operator runs harness-start.bat in production for ≥1 week** (FP-a daily probe + POL-UI-1 pack-info card + SMART-3-POLISH preset memory now combine to smoother experience) / **External reviewer engagement** (someone other than committer walks EXR-a bundle + EXR-b matrix).

**━━━ POL-UI-1 closed at 120/126 (2026-05-05) — Pack-info-card panel UI completion (closes POL-c deferred UI gap) ━━━**
POL-UI-1 — 2026-05-05 first follow-up slice after the 5-priority roadmap closed (RR0 / SMART-LV / POL / FP / EXR). Closes the **POL-c deferred UI gap**: POL-c shipped store slice + legacy-bridge fetch + 23 i18n keys + 22 unit tests at boot but the actual operator-facing simple-shell pack-info card was deferred. Operators couldn't see which pack was active without curl /api/policy-packs. This round ships the DOM. 2 sub-slices (POL-UI-1-a/b). (1) **POL-UI-1-a** `public/js/monitor/panels/pack-info-card.js` (~280 LOC, UMD module) — operator-facing display of: card label "현재 정책 팩"/"Current policy pack" / current pack badge with localized modeId label + 현재 사용 중 hint (data-current-pack=<modeId> + data-public-sector="true" for visual variant) / runtime effective row showing 하드 게이트: HARD/WARN + 런 메모리: 활성/비활성 + 환경변수 명시 override badge when HARNESS_HARD_GATES / HARNESS_RUN_MEMORY_DISABLE explicitly set / public-sector requirements panel (5-bullet checklist; hidden unless currentPack.publicSector === true) / restart hint "팩 변경은 서버 재시작이 필요합니다 (HARNESS_DEPLOYMENT_PROFILE 환경변수 변경 + 재부팅)" always visible / collapsible alternatives <details> with up to 4 other packs as cards with 3 quick badges (publicSector / hardGatesDefault / runMemory OFF) + truncated description (≤140 chars defensive) / empty placeholder "정책 팩 정보를 불러오는 중..." visible until store has data. **Read-only**: no store mutations, subscribes via store.subscribe; _trigger wrapped in try/catch so render fault never breaks shell; handle.destroy() unsubscribes + removes scaffold + tolerates subsequent setPolicyPacks calls. **onCta seam reserved** for future ("compare packs side-by-side" / "open deployment guide" / "expand rule details" / "preview pack switch"). Mount position: simple-shell.js mounts the card BETWEEN recommendations-card and the 4-card grid (deployment posture banner above the operator-workflow trio); resolution via panels.packInfo (test-injected) or window.HarnessPackInfoCard fallback. New .ss-pack-info-mount container in the DOM. public/index.legacy.html: script tag for pack-info-card.js loaded BEFORE simple-shell.js (registered on window.HarnessPackInfoCard before mount). public/js/i18n/{ko,en}.js: 10 new i18n keys per locale (parity) — alternatives.summary / alternatives.none / empty / value.yes/no/enabled/disabled / altBadge.publicSector/hardGates/noRunMemory. tests/visual/baseline-product-shell.json refreshed via npm run visual:update to absorb new script tag (mandatory per visual.contract.test.js procedure). 17 panel tests: module surface (create exported) / guard rails (root + store + doc required) / empty state (no policyPacks → empty placeholder visible; header/runtime/alternatives all hidden) / filled state (current pack badge + runtime + 2 alternative pack cards) / public-sector pack: requirements section visible with 5 bullets + data-public-sector="true" attribute / standard pack: requirements hidden + no data-public-sector attribute / hard-gates env override: pic-runtime-override child appended with 환경변수 label / run-memory env override: same pattern + 비활성 state via runMemoryEffective false / alternatives badges: publicSector / hardGatesDefault / no-runMemory render correctly per pack / empty packs[] alternatives: "(다른 팩이 등록되어 있지 않습니다)" / i18n: custom translator overrides + missing i18n falls back to Korean defaults / subscribe: setPolicyPacks AFTER mount triggers re-render / destroy: scaffold removed + unsubscribe (later setPolicyPacks doesn't throw) / defensive: store.snapshot() throwing → render survives / _lastSnapshot() helper exposed for debug. 6 simple-shell integration tests: panels.packInfo injection mounts card in .ss-pack-info-mount / i18n forwarded to pack-info create() / onCta seam is callable (no-op today, future-extensible) / tolerates panels.packInfo NOT injected (mount container exists; no card child) / destroy() tears down stub / **mount-position invariant**: pack-info-card sits BETWEEN recommendations-card and the 4-card grid (.ss-recs-mount < .ss-pack-info-mount < .ss-grid in root.children order) — fails loudly if a future edit reorders mount slots. (2) **POL-UI-1-b** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end behavior change**: pre-POL-UI-1 operator runs HARNESS_DEPLOYMENT_PROFILE=public-sector → pack rules apply but operator must curl /api/policy-packs and read JSON to see which pack is active + 5-bullet requirements only in JSON response. Post-POL-UI-1 operator opens dashboard with ?monitor=1 → top of simple-shell shows 현재 정책 팩 banner with localized pack name + current hard-gates effective mode + run-memory state + env override badges + restart hint + collapsible alternatives + 5-bullet public-sector requirements (when applicable). 3452 → 3475 unit (+23 = 17 panel + 6 shell-mount) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — POL-UI-1 closes the POL-c deferred UI but does not move the cap (POL-c plumbed data; this renders it — regression protection + operator UX completion, not a new cap-worthy property). The cap-movement candidate POL-UI-1 contributes to is **Public-sector readiness** — 5-bullet requirements display is one piece of evidence, but the cap event needs the whole loop: operator runs harness-start.bat with HARNESS_DEPLOYMENT_PROFILE=public-sector for ≥1 working week / pack-info-card visible in simple-shell (operator confirms via screenshot or operator note) / 5-bullet requirements matched operator's deployment posture / FIELD-PILOT-0 daily probe snapshots committed for the week / EXTERNAL-REVIEW-0 reviewer walks the pack-info-card row in the claim/evidence matrix (Cat 6, 6.5/6.6) and marks PASS. The honest score until that loop closes is 120/126. EXR-b matrix Cat 6 row 6.6 ("GET /api/policy-packs route returns frozen catalog") operator-signal column ("Operator can compare 5 pack rule sets") is now actually true in the UI, not just in the route. **Deferred / out-of-scope**: CSS styling (functional but default browser styling — same pattern as recommendations-card and next-action-card defer dedicated CSS; visual polish in follow-up) / full 9-row pack rule table (alternatives only show 3 most-relevant badges) / pack comparison side-by-side / deployment guide link / reactive pack switch UI (still requires server restart) / per-pack policy preview / i18n smoke for new 10 keys / Playwright/Puppeteer pixel-diff against simple-shell render. 사용자 권고 다음 라운드 후보: **SMART-3 dropdown polish** (keyboard shortcut + recently-used preset memory + tooltip improvements) / **SMART-1 panel acceptance** (no card rules fire on fresh deployment; demo or welcome recommendation could improve first-paint) / **POL-UI-2 pack switch UI** (reactive switch with confirmation modal + runner-graceful-shutdown hook + audit chain entry) / **Operator runs harness-start.bat in production for ≥1 week** (FP+EXR cap-movement evidence) / **External reviewer engagement** (someone other than committer walks EXR-a bundle + EXR-b matrix).

**━━━ EXTERNAL-REVIEW-0 closed at 120/126 (2026-05-05) — Reviewer hand-off apparatus (evidence bundle + claim/evidence matrix) ━━━**
EXTERNAL-REVIEW-0 — 2026-05-05 user-supplied 5-priority roadmap priority 5 (the final priority). Closes the 5-round roadmap by shipping the *reviewer hand-off* apparatus — the bridge between the committer's "shipped X without regression" claim and a third party's verifiable answer ("yes, here is the evidence — sample N rows, all PASS"). Where prior 4 rounds shipped behaviour (RR0 long-running survival / SMART-LV live verification probe / POL pack-rule wiring + catalog API / FP daily probe + 4 runbook templates), EXR ships the *reviewer convenience layer* on top of all of them. 3 sub-slices (EXR-a/b/c). (1) **EXR-a** `scripts/external-review-bundle.js` (~480 LOC) + sh + ps1 wrappers — frozen-schema (`harness-external-review-bundle/v1`) JSON manifest that compiles every artifact a third-party reviewer needs to walk: **repo** (HEAD sha + branch + cleanWorkingTree + untracked + modifiedFiles), **scorecard** (path + bytes + sha256 + parsed currentScore numerator + cap), **readinessRubric** (path + bytes + sha256), **closeoutReports[]** from `docs/reports/*-eval.md` (sha256 + date + slice id, sorted newest-first), **fieldPilotSnapshots[]** from `docs/reports/*-field-pilot-status.json` (operator-time; OK to be empty), **rounds[]** parsed from scorecard trajectory closure banners (`ROUND-NAME closed at N/M (date) — title`) → `{id, score, scoreNumerator, scoreCap, date, title, lineNumber}` (live test confirms ≥4 priority rounds parse), **live** snapshot (default on; --skip-live opts out): /api/health + /api/server/info + /api/audit/runs/system chain.valid + readiness via `scripts/readiness-report.js --json --no-spawn`. **Frozen 4-tier verdict** (mirrors field-pilot-status): OK exit 0 (repo clean, scorecard parseable, ≥4 closeouts, live green) / DEGRADED exit 1 (uncommitted work, fewer closeouts, or live readiness < cap) / INCIDENT exit 2 (chain.valid === false, scorecard parse FAILED, or --strict + offline) / CONFIG exit 3 (scorecard.md / readiness-rubric.md missing, not a git repo). 9 CLI flags including --skip-live (offline reviewer hand-off), --strict (regulator's bundle: every artifact must be present + live probe must succeed), --json (stdout no file), --label, --notes. 22 CLI surface tests: --help/-h legend with 4 exit codes + schema string / --skip-live --json emits 13 frozen top-level keys / verdict is one of OK/DEGRADED/INCIDENT/CONFIG / scorecard block has parsed scoreNumerator + scoreCap + 64-char sha256 / readinessRubric block has bytes + sha256 / closeoutReports lists ≥4 / rounds trajectory parses ≥4 / live.skipped:true under --skip-live / repo block has 40-char HEAD / fieldPilotSnapshots is array / --label round-trip via file mode / --notes default empty + 5 library export tests covering SCHEMA constant + parseArgs defaults + parseArgs flags + 5 _computeVerdict scenarios (CONFIG / INCIDENT / DEGRADED / OK / --strict + offline → INCIDENT). (2) **EXR-b** `docs/external-review/claim-evidence-matrix.md` (~520 LOC) — companion to EXR-a (bundle compiles ARTIFACT LIST with sha256s; matrix compiles CLAIM → ARTIFACT MAP). 8 claim categories with 30 baseline rows: **Cat 1** Pipeline orchestration & dual-agent loop (4 rows; review_session_dispatch_started + 3045ms LV anchor), **Cat 2** Multi-run isolation (4 rows; Phase 2.5 Y/Z/AA-1/AA-2/AD), **Cat 3** Long-running task survival (4 rows; RR0-a/b/c/e + codex_killed_for_idle + codex_idle_warning + 30-min total cap + public_sector preset), **Cat 4** Account / profile management & safe guidance (4 rows; "never accepts passwords" invariant + firstRunClassifier CTAs + profile_switch_blocked + credential_plaintext_fallback), **Cat 5** Public-sector posture & GOV-* defenses (5 rows; 5 verb anchors local_executor_blocked + pii_scan_blocked + pii_file_scan_blocked + audit_bundle_exported + release_manifest_signed + exit 37 launcher gate), **Cat 6** Smart arc (7 rows; SMART-2 single-emit policy_gate_blocked + SMART-4 PII redaction with sourceHash only + SMART-0 decisionContext booleans + SMART-3 [Preset: <Label>] header + POL-a finance-high-privacy hardGatesDefault auto-apply + POL-b /api/policy-packs catalog + SMART-LV-0 6-property probe), **Cat 7** Field-pilot evidence collection (4 rows; field-pilot-status.js + harness-field-pilot-status/v1 + KNOWN_AUDIT_VERBS canary + 4 runbook templates cross-ref), **Cat 8** External reviewer hand-off (5 rows; EXR-a bundle exporter + sha256 tamper-detect + round trajectory parser + matrix structural tests + EXR-c closeout). Each row = 8 columns: # / Claim / Code / Test / Audit verb / Closeout / Operator signal / **Reviewer verdict (PASS / DOUBT / FAIL / blank)**. Reviewer workflow documented (§How to use this matrix during a review): 1 walk EXR-a bundle first (sanity); 2 pick sampling strategy (random across categories or focused); 3 per sampled row: open code anchor → run test anchor → grep audit chain for verb → read closeout → reproduce operator signal → mark PASS/DOUBT/FAIL with note; 4 aggregate verdicts + recommend cap movement OR list gaps. 36 structure tests (mirrors field-pilot-runbooks.test.js — structural only, not stylistic): 8 file-level invariants (file ≥4KB / H1 title / EXR-b slice tag / "How to use this template" / Privacy & retention / cross-references EXR-a + frozen schema / 8-column entry template / "How to use this matrix during a review" with sampling-strategy + verify-auditor-bundle.js mention) + 8 category-section presence tests + 8 category content invariants (covering all 5 GOV verbs + 6 SMART markers + RR0 audit verbs + Cat 8 self-references) + 8 markdown-table integrity tests (each Category contains ≥1 numbered claim row) + 4 cross-coherence tests (matrix path matches EXR-a output dir convention + 5 priority round groups in overview + 4 cap-movement targets in overview + entry template). (3) **EXR-c** closeout 보고서 + scorecard 마커 (이 라운드). **End-to-end reviewer loop**: operator runs `node scripts/external-review-bundle.js` → script writes `<date>-external-review-bundle.json` under docs/external-review/ → operator commits + hands the bundle to reviewer → reviewer opens bundle.json + walks artifact list + runs `verify-auditor-bundle.js` on per-run audit exports as needed → reviewer opens claim-evidence-matrix.md + samples N rows + marks PASS/DOUBT/FAIL → reviewer produces summary report. **Self-canary**: Cat 8 of the matrix has rows for the bundle script + matrix file + structure tests + this closeout — a future audit of EXR-a/b/c failures would notice missing rows in Cat 8 first. 3394 → 3452 unit (+58 = 22 EXR-a CLI + 36 EXR-b structure) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — apparatus만 ship; cap movement은 (i) external reviewer (not the committer) consumes a completed bundle, (ii) walks ≥1 row per category or ≥10 rows total, (iii) marks verdicts (PASS dominant, no FAIL), (iv) produces summary report at `docs/reports/<date>-external-review-summary.md`. 그 loop 한 번이 green 으로 닫히면 **두 cap movement가 동시 가능**: Public-sector readiness +1 (FP+EXR loop end-to-end documented) + Testability and regression suite +1 (matrix's structural tests + bundle's sha256 + round-trajectory parser → scorecard from markdown narrative to machine-readable claim→evidence map with regression protection). 사용자 권고 다음 라운드 후보: (i) **Operator runs harness-start.bat in production for ≥1 week** (FP bundle gets filled in, daily probes committed, deployment-log + incident-ledger become real artifacts), (ii) **External reviewer engagement** (someone other than committer walks bundle + matrix), (iii) **Phase 2 v2 follow-up slices** (SMART-3 dropdown polish / SMART-1 panel mount / POL-d UI pack-info card with restart-instructions banner). Reviewer-facing summary template / bundle HMAC sealing (GOV-AUDIT-0-style) / multi-bundle diff / matrix verdict aggregation parser / cross-pilot evidence aggregation / CI integration (`npm run external-review:check --strict`) / bundle CLI i18n 모두 deferred (foundation 준비; 후속 라운드 또는 reviewer-time).

**━━━ FIELD-PILOT-0 closed at 120/126 (2026-05-05) — 1-week production no-regression evidence apparatus ━━━**
FIELD-PILOT-0 — 2026-05-05 user-supplied 5-priority roadmap priority 4. POL/SMART-LV/RR0/SMART-arc 닫힘 후 cap-movement deferral 패턴이 누적된 시점에서, "1주 production 무회귀 + 운영자가 매일 evidence 캡처 + 인시던트 + 트러블슈팅 + 피드백 설문" 묶음을 위한 evidence-collection apparatus 라운드. 코드는 apparatus만; 실제 1주 deployment는 operator-time. 2 sub-slices (FP-a/b/c). (1) **FP-a** `scripts/field-pilot-status.js` (~400 LOC) + sh + ps1 wrappers — operator daily probe with frozen schema `harness-field-pilot-status/v1` (8 top-level keys: schema/capturedAt/verdict/environment/health/audit/runtime/notes). 7 health checks: server reachable / auth token / `/api/server/info` / `/api/policy-packs` (POL-a runtime metadata) / audit chain / `/api/decision-context` (SMART-0 booleans). Frozen `KNOWN_AUDIT_VERBS` catalog of ~50 verbs from SMART/RR0/POL/review-session/runner/GOV-* slices — anything else is anomaly. **4-tier verdict** (per plan §S §S-FP): OK (exit 0) / DEGRADED (exit 1) / INCIDENT (exit 2) / CONFIG (exit 3). 6 CLI flags including --notes for operator commentary. 10 CLI surface tests: --help/-h prints usage with exit-code legend / unreachable server → exit 3 / --json valid harness-field-pilot-status/v1 / 8 expected top-level keys / audit subschema (today + anomalies + unknownVerbs) / --notes preserved / missing --notes defaults empty / --label custom value accepted / verdict semantics CONFIG when health probe fails. (2) **FP-b** 4 runbook templates + 44 structure tests. **deployment-log.md**: per-day operator log with Pilot context block (operator/pack/harness commit/Codex CLI version/Claude CLI version/trust-store keys/manifest signing state/pilot goal/incident threshold) + 7-day stub + Daily entry template (probe verdict + label + snapshot file + what was deployed + activity counts + anomalies + operator note + tomorrow's plan) + Closeout block + cross-reference to 8 frozen JSON keys. **incident-ledger.md**: append-only severity ledger (info/degraded/incident/critical), Entry template + Resolution sub-entry template, mapping of probe verdict → typical severity, cross-reference of 8 critical-tier audit verbs (claim_verification_failed / trust_store_private_key_rejected / credential_plaintext_fallback / launcher_signature_failed / runner_handshake_collision / runner_host_lost / pii_scan_blocked / policy_gate_blocked) + privacy reminder sanitization rules. **troubleshooting.md**: 6-section catalog by failure surface (install/launcher / account/profile / timeouts/long-running / permissions/policy-gates / network/runtime / probe/evidence). Each entry has Symptom + Likely cause + Workaround + Safe-guidance principle (15+ entries). Covers E3-F1 exit codes 37+38, RR0 idle watchdog kills, POL-c pack-rule gate behavior, GOV-PII deep scan false-positives, runner WebSocket flapping, probe unknown-verb canary. **feedback-survey.md**: end-of-week retrospective (deliberately not daily diary). 1-5 Likert with 16 evaluation areas + open-ended section with 7 questions including 2 safety probes (3.6 over-stepping, 3.7 over-restriction). Pack-specific section opt-in. Recommendation block with top-3-changes. Privacy & retention guidance. **44 structure tests**: 4 common contract (file exists / H1 title / FP-b slice tag / "How to use" block / privacy reminder) + per-runbook required sections + cross-coherence (all 4 reference probe / log closeout links to ledger + survey). (3) **FP-c** closeout 보고서 + scorecard 마커. **End-to-end loop**: operator runs `field-pilot-status.sh` end-of-day → JSON snapshot + verdict + exit code → `<evidence-dir>/<label>-field-pilot-status.json` (committed); fills daily entry in deployment-log; opens incident-ledger entry on DEGRADED/INCIDENT; appends to troubleshooting on new symptom; submits feedback-survey end-of-week. 7 daily JSON files share frozen schema → reviewer `jq -r '.audit.today.byVerb.policy_gate_blocked' day-*.json` for trend. **Probe canary**: `audit.unknownVerbs` non-empty → new feature shipped that emits new verb without updating `KNOWN_AUDIT_VERBS` → operator sees on day 1. 3340 → 3394 unit (+54 = 10 FP-a CLI + 44 FP-b structure) / 553 integration / 90 smoke. **Cap movement decision**: 120/126 유지 — apparatus만 ship; cap movement은 (i) operator runs harness in production for 5+ working days, (ii) daily probe snapshots collected + committed, (iii) deployment log + incident ledger filled real-time, (iv) feedback survey submitted, (v) closeout. EXTERNAL-REVIEW-0이 완성된 pilot bundle을 소비해서 cap movement 결정. 다음 라운드 권고: **EXTERNAL-REVIEW-0** (evidence bundle + claim/evidence matrix + reviewer-facing summary report). 실제 1-week deployment / 운영자가 채운 runbook 인스턴스 / 자동 분류 of operator activity / 구조화된 root-cause tags / cross-pilot survey aggregation / operator-defined custom verb catalogs / probe i18n 모두 deferred (foundation 준비; 후속 라운드 또는 operator-time).

**━━━ POLICY-UX-0 closed at 120/126 (2026-05-05) — Pack-rule runtime wiring + operator-facing pack catalog API ━━━**
POLICY-UX-0 — 2026-05-05 user-supplied 5-priority roadmap priority 3. SMART-5 closeout deferred work ("hardGatesDefault auto-applied at runtime" / "runMemoryEnabled auto-applied at runtime") closure + operator-facing pack catalog. 4 sub-slices (POL-a/b/c/d). (1) **POL-a** runtime wiring: `policyGates.resolveGateMode(env, deploymentProfile?)` 새 2-arg signature 4-step precedence (env=1 → hard / env=0 → warn 명시 override / pack hardGatesDefault=true → hard / 기본 warn). 4 gate 함수 (gatePiiBlock/gateReleaseSigned/gateEvidenceExportReady/gateCompletionAllowed) 모두 deploymentProfile을 resolveGateMode에 전달. `runMemory._isOptOut(env, deploymentProfile?)` 새 2-arg signature: env disable=1 OR pack runMemoryEnabled=false → opt out. recordRunMemory가 opts.deploymentProfile 통과. **Backwards compat 100%**: 1-arg callers (no deploymentProfile) 레거시 동작 동일 — pre-POL-a 48 policyGates + 73 runMemory + 13 routes integration tests 회귀 0. 21 + 11 = 32 unit tests with precedence matrix + 3 realistic scenarios (finance-high-privacy automatic hard / public-sector graduated rollout warn / incident triage HARNESS_HARD_GATES=0 override). (2) **POL-b** `src/routes/policyPackRoutes.js` 새 `GET /api/policy-packs` route: schema "harness-policy-pack/v1" + currentPack (deploymentProfile.pack에서) + 5 packs full rule fields + isCurrent flag + metadata.hardGatesEffectiveMode (POL-a 런타임 결과) + runMemoryEffective + hardGatesEnvOverride/runMemoryEnvOverride bool + publicSectorRequirements 5-bullet 운영자 체크리스트 (agency-managed account / sandbox workspace / signed manifest / PII fail-closed / no plaintext secrets) + serverTime. server.js에서 mount. **Read-only**: pack 변경은 server restart 필요 (HARNESS_DEPLOYMENT_PROFILE env 변경 + 재부팅). 15 integration tests covering schema / 5 modeIds set 일치 / currentPack reflects profile / metadata POL-a precedence (env=1 vs pack default vs env=0 override) / publicSectorRequirements 5-bullet content / cross-field invariants visible (every public-sector pack allowLocalExecutor=false; only finance-high-privacy hardGatesDefault=true). (3) **POL-c** UI foundation: store `policyPacks` slice (null until first fetch) + 2 mutators (setPolicyPacks with schema check + idempotent dirty-skip + foreign schema rejection / clearPolicyPacks). snapshot defensive shallow copy of inner packs + publicSectorRequirements (caller mutation isolated). legacy-bridge `DEFAULT_POLICY_PACKS_URL = "/api/policy-packs"` + `policyPacksUrl` install option + `refreshPolicyPacks()` one-shot fetch on install (packs frozen at boot; no polling) + 새 stats counters policyPacksRefreshes / policyPacksErrors + handle.refreshPolicyPacks() 노출. i18n ko/en 23 keys parity (6 catalog labels including {mode}/{state} placeholders + 5 modeId localized labels + 9 rule field labels + 3 public-sector requirements headers). 16 store + 6 bridge unit tests. **UI panel deferred**: 실제 simple-shell pack-info card (catalog + 현재 pack 강조 + 4 alternatives + restart-instructions banner + public-sector requirement display)는 follow-up panel slice. 데이터 plumbed; DOM이 missing. (4) **POL-d** closeout 보고서 + scorecard 마커. **End-to-end behavior change**: pre-POL-0 operator chooses finance-high-privacy → pack rule hardGatesDefault=true 무시되고 추가로 HARNESS_HARD_GATES=1 set 안 하면 warn mode; post-POL-0 operator chooses finance-high-privacy → automatic hard mode (pack rule consulted) + GET /api/policy-packs 통해 catalog comparison 가능 + UI panel readiness. 3288 → 3340 unit (+52 = 32 POL-a + 20 POL-c) / 538 → 553 integration (+15 = POL-b) / 90 smoke. **Cap movement decision**: 120/126 유지 — POL-a closes SMART-5 deferred wiring (regression anchor, not cap event); POL-b/c는 read-only API + foundation; cap movement evidence는 operator field deployment (FIELD-PILOT-0 round)에서 finance-high-privacy 1+주 무회귀 운영 + live-verify-smart-arc.sh verdict=PASS + evidence packets 첨부. 사용자 권고 다음 라운드: **FIELD-PILOT-0** (1주 production 무회귀 + field log template + incident ledger + 설치/계정/timeout 문제 기록 + 사용성 피드백 수집), 그 다음 **EXTERNAL-REVIEW-0** (evidence bundle + claim/evidence matrix). UI panel (실제 pack-info 카드 + restart-instructions banner) / pack change runtime mutation + audit verb / pack 비교 side-by-side view / operator-defined custom packs 모두 deferred (foundation 준비; FIELD-PILOT 후 재평가).

**━━━ SMART-LV-0 closed at 120/126 (2026-05-05) — SMART arc 6-property live verification (in-process + operator probe) ━━━**
SMART-LV-0 — 2026-05-05 user-supplied 5-priority roadmap priority 2. SMART arc closeouts (SMART-2/4/5) cap-movement deferral의 evidence loop closer. 3 sub-slices (LV0-a/b/c). 2-layer evidence: (1) deterministic in-process integration test that wires all 6 SMART arc properties together with real evidenceLedger + real runMemory + real policyGates + real recommendationEngine + real presetLibrary + real deploymentProfile, AND (2) operator-runnable probe script for live deployment verification. 6 properties: P1 HARNESS_HARD_GATES env mode resolution, P2 finance-high-privacy auto-applies hardGatesDefault=true, P3 hard gate block on PII emits ONE policy_gate_blocked audit (state-immutability + single-emit invariants), P4 runMemory redacts PII at write time (privacy-by-design; raw email/secrets never in ledger; sourceHash only), P5 decisionContext booleans drive recommendation engine, P6 dispatch with presetId injects [Preset: <Label>] header + audit attribution. (1) **LV0-a** `tests/integration/smart-arc-live-evidence.test.js` 13 deterministic tests: 12 individual property + 2 HEADLINE (full chain integration of 6 properties in single ledger + chain detects tampering via eventHash mutation). 모든 6 properties end-to-end 검증; 4 verb signals (deployment_profile_resolved, policy_gate_blocked, review_session_dispatch_started with presetId, run_memory_recorded) 단일 evidenceLedger에 안착; ledger.verify()로 chain integrity 통과. **Privacy invariant 검증**: `JSON.stringify(memoryRow).includes("jane.doe@example.com") === false` — 전체 직렬화 ledger row가 raw PII 절대 carry 안 함. (2) **LV0-b** `scripts/live-verify-smart-arc.js` ~440 LOC operator probe + sh + ps1 wrappers. Probe steps: 0 health + auth, 1 server-info reveals environment, 3a session create, 3b PII send-codex → expect 409 policy_gate_blocked, 6a preset catalog (6 presets), 6b clean send-codex with preset=security → expect 200 + presetId="security", 5 decision-context, 4 run-memory route shape (404 expected for review-session id), audit chain inspection. Evidence packet schema `harness-smart-lv-evidence/v1` JSON: environment + 6 properties + auditChain + verdict (PASS/FAIL/CONFIG). Exit codes: 0/1/2. Output modes: ANSI default / --quiet (file only) / --json (stdout no file). 6 unit tests covering CLI surface (--help, CONFIG exit, JSON shape). (3) **LV0-c** closeout 보고서 + scorecard 마커 + evidence packet template (운영자가 finance-high-privacy 환경에서 probe 실행 후 채워서 commit). **End-to-end loop**: operator boots `HARNESS_DEPLOYMENT_PROFILE=finance-high-privacy + HARNESS_HARD_GATES=1 + HARNESS_TOKEN=<token> + node start.js` → run `./scripts/live-verify-smart-arc.sh` → probe verifies 6 properties via real HTTP routes → emits docs/reports/<date>-smart-arc-live-verify.json with verdict=PASS → operator commits evidence packet → reviewer can grep schema string + verify offline. 3282 → 3288 unit (+6 = LV0-b CLI tests) / 525 → 538 integration (+13 = LV0-a property tests) / 90 smoke. **Cap movement decision**: 120/126 유지 — LV0-a in-process test is regression anchor (not cap movement trigger); LV0-b probe is the TOOL. Cap movement evidence는 (i) operator runs `live-verify-smart-arc.sh` against finance-high-privacy in production gets verdict=PASS, AND (ii) 1-week regression-free run, AND (iii) evidence packet committed. 사용자 권고대로 다음 라운드 후보는 **POLICY-UX-0** (UI policy pack selector + hardGatesDefault runtime auto-apply + runMemoryEnabled runtime auto-apply + pack change confirmation + public-sector pack selection 시 sandbox/account requirement 표시), 그 다음 **FIELD-PILOT-0** (1주 production 무회귀 + field log template + incident ledger). Real-binary live evidence (Codex/Claude 실제 [Preset: Security] content 검증) / Probe in CI (server boot + probe + teardown CI job) / Audit-chain integrity probe (verify route 호출) 모두 deferred.

**━━━ RELEASE-READY-0 closed at 120/126 (2026-05-05) — Long-running task survival + account login guidance + central timeout policy ━━━**
RELEASE-READY-0 — 2026-05-05 user-supplied 5-priority roadmap top priority. "처음 설치한 사람이 자기 Claude/Codex 계정으로 막힘 없이 연결하고, 10분 이상 걸리는 작업도 부당하게 죽지 않게 한다" goal. 5 sub-slices (RR0-a/b/c/d/e). Pre-RR0 single-setTimeout 패턴이 25-min Codex critique를 minute 2에 죽이고 misleading "timeout" reason 표시. Post-RR0 watchdog 두-timer 모델로 "long but progressing" vs "stuck" 구분. (1) **RR0-a** `src/runtime/timeoutPolicy.js` — frozen 3 presets (interactive default 2/3/2/0.5min, long_run 20/30/20/5min, public_sector 30/45/30/2min). resolveTimeoutPolicy precedence: per-field env → HARNESS_TIMEOUT_PRESET → posture → interactive. 31 unit tests. (2) **RR0-b** `src/runtime/activityWatchdog.js` two-timer (total + idle reset on tick) + state machine (IDLE→ACTIVE→WARNING⇄ACTIVE→KILLED|CLEARED) + onIdleWarning at 75% idle. Defensive throws never corrupt state. codex-runner + claude-runner 통합: optional idleTimeoutMs / setTimeoutFn / clockFn 인자, 각 stdout/stderr chunk가 watchdog.tick(); broadcast `codex_idle_warning`/`claude_idle_warning` + `codex_killed_for_idle`/`claude_killed_for_idle` WS 이벤트. 레거시 path (idleTimeoutMs=null) 100% 보존. claude-runner constructor도 `broadcast` parameter 추가 (이전엔 누락). server.js: resolveTimeoutPolicy at boot + idleTimeoutMs=60000 when preset!=="interactive" + 두 runner에 defaultTimeoutMs from policy. 32 unit tests + 7 codex-runner-progress legacy tests 회귀 0. (3) **RR0-c** store `runnerActivity` Map slice keyed `${runner}:${runId}:${iteration}` + 4 mutators (recordRunnerIdleWarning/recordRunnerKilled/clearRunnerActivity/clearRunnerActivityForRun) + snapshot 정렬. legacy-bridge `_syncRunnerActivityFromEvent` 4개 watchdog WS 이벤트를 slice로 라우팅 (events ring 안 폴루션) + pipeline_complete/pipeline_reset 시 `clearRunnerActivityForRun` 자동 sweep. 24 + 11 unit tests. (4) **RR0-d** firstRunClassifier 확장: 3 new CTA (COPY_LOGIN_COMMAND_CLAUDE/CODEX/RECHECK_PROVIDERS) + frozen SAFE_GUIDANCE_PRINCIPLE (`harness-no-credential-collection/v1` + i18n 키) + frozen LOGIN_COMMANDS catalog (claude/codex auth login 명령 + docs URL i18n 키). PROVIDER_NOT_AUTHENTICATED state CTA 5개로 확장 (AUTH→COPY→RECHECK 친절 fallback). PROVIDER_MISSING도 RECHECK 추가. i18n ko/en parity 8 새 키. 14 + 14 (existing 갱신) unit tests. **safe-guidance principle 운영화**: (i) 비밀번호/OAuth 토큰 받는 route 0건, (ii) RR0-d CTA들은 clipboard-copy + external-browser-link only, (iii) 향후 audit verb `account_login_guidance_clicked`이 어떤 가이드 사용했는지 기록 (절대 credential은 X). (5) **RR0-e** `tests/integration/release-readiness-long-run.test.js` fake clock + fake spawn으로 5 시나리오: 12-min 30s 틱 stream 살아남음 (no kill) / 12-min stream 후 silence는 45s warning + 60s idle kill / 30-min total cap 강제 발효 / pre-RR0-b legacy path 100% 보존 / **headline test**: public-sector 25-min Codex critique with severity-tagged chunks parsed via `_extractFindings`. **End-to-end loop**: HARNESS_DEPLOYMENT_PROFILE=public-sector → resolveTimeoutPolicy → public_sector preset (30min/45min/30min/2min) + idleTimeoutMs=60s → CodexRunner / ClaudeRunner construct with watchdog → 25-min critique stream every 30s ticks watchdog → no premature kill → operator dashboard sees codex_idle_warning toast at 45s of silence (75% of idle) → kill at 60s OR total 30min cap → store.runnerActivity slice surfaces state → simple-shell 미래 panel renders "마지막 출력 후 N초". CLI 미설치/미로그인 시: setup wizard probe → providerStatus → firstRunClassifier → 5 CTAs (AUTH primary + COPY/RECHECK fallback) + safe-guidance footnote. 3170 → 3282 unit (+112) / 520 → 525 integration (+5) / 90 smoke 모두 green. **Cap movement decision**: 120/126 유지 (사용자 권고대로 cap-movement candidate은 "operator runs public-sector mode in production for 1+ week with no regressions" acceptance gate; SMART-2/4/5 closeout pattern과 동일). 다음 라운드 후보: **SMART-LV-0** (HARNESS_HARD_GATES=1 + finance-high-privacy live evidence packet). UI 패널 ("12분째 실행 중" 카드 + "강제 종료" 버튼) / hardGatesDefault runtime 자동 적용 / clipboard-copy renderer 와이어링 / real subprocess 12-min smoke probe는 모두 deferred (foundation 준비 완료).

**━━━ SMART-5 closed at 120/126 (2026-05-05) — Phase 2 SMART arc institutional policy packs (PHASE 2 SMART arc final) ━━━**
SMART-5 Institutional Policy Packs — Phase 2 SMART arc 다섯 번째 (마지막) 라운드 (plan §S §S-rounds v2 순서: SMART-0 → SMART-1 → SMART-3 → SMART-2 → SMART-4 → **SMART-5**; 5 packs + 운영자가 named 모드 픽). 4 sub-slices (S5-a/b/c/d). plan v2의 핵심 invariant는 production fail-closed: typo'd HARNESS_DEPLOYMENT_PROFILE이 silent standard fallback 대신 boot exit(1) — 공공기관 deployments에서 silent posture downgrade 방지. dev/migration window는 `HARNESS_POLICY_FAIL_OPEN=1` escape hatch 통해 legacy fallback 사용 (audit chain은 dev escape 신호 기록). (1) `src/policy/policyPackRegistry.js` (~280 LOC) — 5 frozen packs (developer-lab / finance-high-privacy / offline-internal-network / public-sector / standard). 각 pack 12 rule 필드 (publicSector, allowLocalExecutor, allowPersonalAccounts, allowPlaintextSecrets, requireSandboxWorkspace, requireAgencyManagedAccount, requireSignedManifest, requirePiiScanBeforeProviderDispatch, scannerFailurePolicy, hardGatesDefault, runMemoryEnabled). Cross-field invariants module-load 시 enforce: publicSector=true ⇒ allowLocalExecutor=false + allowPlaintextSecrets=false + requireSandboxWorkspace=true. Authoring 실수 require()-time 잡힘. SCHEMA `harness-policy-pack/v1`, PACK_IDS sorted/frozen, DEFAULT_PACK_ID="standard". listPackSummaries (UI catalog용 system prompt 본문 X). 22 unit tests. (2) `src/policy/deploymentProfile.js` 확장 — registry 통해 5 packs 모두 resolve. 새 export POLICY_PACK_UNKNOWN_CODE. _isFailOpen(env) helper (HARNESS_POLICY_FAIL_OPEN=1/true/yes case-insensitive). resolveDeploymentProfile 동작 매트릭스: env unset → DEFAULT_PACK_ID (backward compat); 알려진 pack → resolve; 알 수 없는 pack + production (default) → throw POLICY_PACK_UNKNOWN err with code/requested/knownPackIds; 알 수 없는 pack + HARNESS_POLICY_FAIL_OPEN=1 → fallback to standard + resolvedFromFallback=true + unknownRequested set. Profile shape 추가 (additive, 기존 필드 변경 X): pack/packLabel/hardGatesDefault/runMemoryEnabled/resolvedFromFallback/unknownRequested. RECOGNIZED_MODES re-derived from registry PACK_IDS. Plaintext 규칙 generalize: pack.allowPlaintextSecrets + env opt-in 모두 true 일 때만 허용; public-sector packs는 cross-field invariant로 allowPlaintextSecrets=false → env opt-in 무시 (defense-in-depth 보존). 25 unit tests (15 new + 10 updated). (3) `server.js` boot 확장 — resolveDeploymentProfile()을 try/catch로 wrap: err.code === POLICY_PACK_UNKNOWN_CODE → process.stderr.write(FATAL + remediation hint) + process.exit(1); 기타 errors → re-throw (기존 boot failure modes 보존). evidenceLedger 생성 후 단일 `deployment_profile_resolved` audit row emit ("system" runId; data: pack/packLabel/publicSector/allowLocalExecutor/allowPlaintextSecrets/requireSandboxWorkspace/requireSignedManifest/requirePiiScanBeforeProviderDispatch/scannerFailurePolicy/hardGatesDefault/runMemoryEnabled/resolvedFromFallback/unknownRequested). Defensive try/catch — ledger I/O 실패가 boot 막지 X. 10 smoke tests (`policy-pack-bootfail.test.js` — child node process spawn으로 process.exit(1) end-to-end 검증; 5 known packs boot OK + empty/unset OK + typo exit 1 + escape hatch OK + escape=0 exit 1) + 8 integration tests (`policy-pack-boot-audit.test.js` — verb shape lock; 모든 5 packs row data 일치 + dev escape signal + chain 무결성 + plaintext defense-in-depth audit 보존). (4) closeout 보고서. **End-to-end loop**: production typo `HARNESS_DEPLOYMENT_PROFILE="publicsector"` → resolveDeploymentProfile throws POLICY_PACK_UNKNOWN → server.js catch → stderr "FATAL" + remediation → process.exit(1) → pipeline NEVER runs under unintended posture. dev escape `HARNESS_POLICY_FAIL_OPEN=1` 추가 시 → resolvedFromFallback profile + boot continues + audit row의 dev-escape 신호 기록. 5 packs 모두 정상 boot → 1 audit row + SMART-2 hard gate 결정 / SMART-4 run memory writes / GOV-* runner enforcement 모두 동일 profile 참조. 3133 → 3170 unit (+37 = 22 registry + 15 deploymentProfile) / 512 → 520 integration (+8) / 80 → 90 smoke (+10) all green. **Cap movement decision**: 120/126 유지 (plan §S §S-score-trajectory가 SMART-5 = "120/126 유지 (cap candidate는 별도 acceptance gate)"로 명시) — 가치는 (1) 운영자가 finance-high-privacy mode를 production에서 1+주 무회귀 운영, (2) HARNESS_HARD_GATES=1 + ledger samples 출현 LV round, (3) 외부 리뷰가 새 properties 인정 시 본격화. **Phase 2 SMART arc final**: SMART-0 (decision context) → SMART-1 (recommendations) → SMART-3 (presets) → SMART-2 (hard gates) → SMART-4 (run memory) → SMART-5 (policy packs) — 6 라운드 모두 closed, 120/126 유지. Phase 2 종료. UI pack selector / 사용자 정의 pack config-file / cross-pack migration tooling / hardGatesDefault auto-applied at runtime / runMemoryEnabled auto-applied at runtime은 모두 deferred (모듈은 준비; live deployment evidence + LV round + 후속 라운드).

**━━━ SMART-4 closed at 120/126 (2026-05-05) — Phase 2 SMART arc redacted run memory ━━━**
SMART-4 Redacted Run Memory — Phase 2 SMART arc 네 번째 라운드 (plan §S §S-rounds v2 순서: SMART-0 → SMART-1 → SMART-3 → SMART-2 → **SMART-4** → SMART-5; SMART-2 hard gate 위 + SMART-3 preset 위에 "기억" 레이어 추가). 4 sub-slices (S4-a/b/c/d). plan v2의 핵심 요구는 "기억"이 새 위험 surface가 되지 않게 하는 6가지 privacy 보장: (i) TTL — records가 evidenceLedger에 `run_memory_recorded` audit row로 안착해서 기존 TTL machinery가 자동 처리, (ii) Opt-out — `HARNESS_RUN_MEMORY_DISABLE=1/true/yes` → recordRunMemory 즉시 noop, (iii) per-field max length (256B/2K/4K/512/1K) + 초과 시 truncate + ellipsis + truncated:true, (iv) NO 원문 — diff/patch raw bodies 절대 저장 X; sha256 sourceHash가 forensic 검증 enable, (v) public-sector redaction — piiScanner.scanForPii 통과 후 `[REDACTED:<type>]` + redacted:true + redactedTypes list, (vi) public-sector route auth+audit — getRunMemory 자체는 pure; HTTP route layer가 loopback + token + run_memory_accessed audit emit. (1) `src/runtime/runMemory.js` (~530 LOC) — frozen vocab (SCHEMA `harness-run-memory/v1`, AUDIT_VERBS{RECORDED/ACCESSED}, FIELD_LIMITS frozen) + 6 privacy guards. API: `buildRunMemoryRecord(runId, inputs, opts)` (pure builder; frozen record `{schema, runId, recordedAt, truncated, redacted, redactedTypes, sourceHash, fields:{goal/changeSummary/codexFindings/approvals counts-only/piiDetected types-only/failureCause/nextTimeWatchOuts}, gateMode}`), `recordRunMemory(opts)` (persistence wrapper; defensive against ledger throws — record returned even on persist fail for forensics), `getRunMemory(runId, ledger)` (latest run_memory_recorded; defensive against read throws), `computeSourceHash(content)` (canonical sha256 hex; null when no/empty content), `deriveFromPipelineSnapshot(snapshot)` (S4-c lossy projection: pipeline_complete snapshot → runMemory inputs). 46 + 27 = 73 unit tests. (2) `src/routes/runMemoryRoutes.js` — 단일 endpoint `GET /api/runs/:runId/memory`. Loopback only (global x-harness-token middleware). run_memory_accessed audit emits on found AND not-found reads (operator tracking sees missing-read attempts), NOT on 400 (operator UI bug). 503 vs 404 분리: route probes ledger.read DIRECTLY with own try/catch instead of trusting getRunMemory's defensive swallow — operator UI gets actionable error. 13 integration tests. (3) `executor/pipeline-executor.js` 확장 — constructor 새 optional `onRunComplete(runId, snapshot)` 콜백. `_complete()`가 broadcast(pipeline_complete) AFTER 호출 — UI + memory guaranteed consistent. try/catch wrap — recorder 실패 (ledger I/O / redactor throw / opt-out env / anything) NEVER `_complete` 깨짐. 10 unit tests covering 콜백 firing semantics + ordering + defensive throw + null-callback regression. (4) `server.js` PipelineOrchestrator.createExecutor가 `onRunComplete: (runId, snapshot) => runMemory.recordRunMemory({runId, inputs: deriveFromPipelineSnapshot(snapshot), ledger: evidenceLedger, deploymentProfile: _deploymentProfile})` 전달; createRunMemoryRoutes mount with auditFn:evidenceLedger.append.bind. Lazy require inside callback — boot 비용 0 when 파이프라인 안 돌 때. (5) closeout 보고서. **End-to-end loop**: pipeline run finishes → PipelineExecutor._complete → broadcast(pipeline_complete) → onRunComplete → recordRunMemory → buildRunMemoryRecord (truncate + redact) → ledger.append `run_memory_recorded` row → operator later GET /api/runs/<runId>/memory → run_memory_accessed audit + already-redacted record on the wire. **Privacy invariant anchors** (test로 anchor): (a) public-sector raw PII NEVER persisted (ledger.calls JSON.stringify 검증으로 raw email/phone 0 검출), (b) raw secrets in sourceContent NEVER 저장 (sha256만), (c) onRunComplete throw가 broadcast 깨지 X, (d) opt-out env recordRunMemory noop. 73 unit + 13 integration all green; 3050 → 3133 unit / 499 → 512 integration. **Cap movement decision**: 120/126 유지 (plan §S §S-score-trajectory가 SMART-4 = 유지로 명시) — 가치는 (1) 실제 운영 deployment 기록 + (2) public-sector 모드 zero-PII 검증 + (3) SMART-5가 memory records 소비할 때 본격화. SMART-5 + operator acceptance gate가 더 자연스러운 cap movement 근거. UI run-viewer "기억" 탭 / 운영자 nextTimeWatchOuts 입력 route / sourceContent from pipeline-executor / cross-run memory listing / manual delete / run_memory_record_failed broadcast은 모두 deferred (모듈은 준비; 후속 라운드).
UI-H8 (welcome overlay) + UI-H9 (recent-results drill-down + audit read API) + GOV-AUDIT-0 (sealed evidence export + offline verifier) + GOV-RELEASE-0 (Ed25519 manifest signing) — 5겹 GOV defense fully filled (cap 5/5).
**Phase 2 plan**: Round Sync → E3-F1 (launcher gate, production fail-closed) → UI-H10 (export button) → TRUST-STORE-0 (path resolver + auth + audit + delete protection) → LV-6 (real Claude hand-back evidence) → SMART-0 (decision context) → SMART-1 (recommendations) → SMART-3 (presets) → SMART-2 (hard gates with state-immutability) → SMART-4 (privacy-by-design memory) → SMART-5 (policy packs, fail-closed on unknown). See `~/.claude/plans/swift-waddling-hanrahan.md` Part S v2 for full design.

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

**Test counts grew from 936 unit / 197 integration (pre-R1) to <!-- AUTO:test-counts -->**3853 unit / 553 integration**<!-- /AUTO --> across R1-a through R1-k.** The R1 round added approximately +170 unit + +52 integration = +222 tests, all green.

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
- Test counts: <!-- AUTO:test-counts -->**3853 unit / 553 integration**<!-- /AUTO --> + legacy + smoke, all green. _(line auto-derived by `npm run scorecard:sync`; do not hand-edit between markers.)_
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
  - ~~**R3-d**~~ — **DONE 2026-04-29**. Implementation in `server.js:294-345` (gracefulShutdown) + `src/runner/runnerAgent.js:131-143` (clean stop()) + `tests/integration/runner-shutdown.test.js` (9/9 green). Counted under R3-c trajectory entry as operational primitives, no rubric move. **No separate `src/server/shutdown.js` file** — kept inside `server.js`.
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

### Rubric scale change (D1-g)

D1 closed the profile + credential + spawn round, plus inserted
the D1-gov public-sector policy baseline mid-round per
docs/public-sector-hardening-plan.md §9. The Config / portability
cap extended at D0-e (5 → 8) tracks the audience shift to
"operator with a download". D1 adds the next qualitative layer:
the operator now runs Claude/Codex with their OWN agency
account through fail-closed credential storage, profile-scoped
spawn-env composition, and a public-sector mode that hard-blocks
plaintext credentials + sandbox-only execution + agency-managed
profiles + signed-manifest distribution.

| Area | Pre-D1-g max | Post-D1-g max |
| --- | ---: | ---: |
| Config, portability, onboarding | 8 | **10** |
| **Total** | 113 | **115** |

The +1 score (104 → 105) within the new cap reflects:
- credentialStore with fail-closed default + 3-tier backend taxonomy
- profileStore with atomic write + schema-version mismatch loud-fail
- profileSpawn 4-layer env composition + refuse-partial-credentials
- ClaudeRunner / CodexRunner integrated through profileSpawn with
  defense-in-depth assertLocalExecutorAllowed
- profileRoutes 8-endpoint HTTP surface with active-run gate (409)
  + secret-VALUES-never-echoed regression guard
- EvidenceLedger sanitizer wired in production — every audit
  payload goes through the redactor before hashing
- Public-sector policy baseline (deploymentProfile + publicSectorPolicy)
  with integration into all three storage modules + both runners
- 137 new unit tests + 26 new integration tests covering every
  fail-closed default + every audit redaction + every regression
  guard against secret-value leakage

The remaining headroom (105 → 115) is reserved for:
- D2 setup wizard + cliProbe (~1 point: 8-step first-run flow)
- D3 UI account status + settings panel (~1 point)
- UX-0/UX-1/UX-2 simple/advanced/legacy mode shell + welcome
  overlay + per-call approval card (~2 points)
- E2 launch overhead — backup/restore/uninstall + manifest signing
  for public distribution (~3 points; E3 territory)
- Public-sector readiness cap (~3 points): end-to-end
  behavior-verification of public_sector_profile_policy returning
  400 over the wire under `HARNESS_DEPLOYMENT_PROFILE=public-sector`
  + sandbox-only dispatch + PII inline scanner + auditor evidence
  export. Pending Tasks 3-7 of `docs/public-sector-hardening-plan.md`.

### Rubric scale change (E1.5)

D1-g closed the profile + credential layer with the public-sector
**policy baseline** (`HARNESS_DEPLOYMENT_PROFILE` resolver,
`validateProfileForPublicSector` upsert gate, `assertLocalExecutorAllowed`
spawn-time gate, fail-closed `credentialStore`). E1.5 turns that
baseline into **runtime enforcement with audit narrative**:

- GOV-SB-0 adds the SECOND spawn-time gate (`assertSandboxWorkspaceRequired`)
  + `local_executor_blocked` audit row that fires from BOTH runners
  on either policy code in `POLICY_BLOCK_CODES`.
- GOV-PII-0 introduces a brand-new defense layer — KR-focused inline
  PII detection — that no previous slice covered. The scanner
  + gate are pure, reusable, and behavior-verified end-to-end via
  `gov-pii-block.test.js`.

Together these belong in their own rubric line. The "Safety and
security boundary" cap is already at 18/18 (R2.5 maxed it) and
covers the local-mode trust boundary + remote-mode trust boundary
+ controlled execution bridge — adding public-sector-specific work
inside that line would lose the auditor narrative. E1.5 introduces
a new rubric area:

| Area | Pre-E1.5 max | Post-E1.5 max |
| --- | ---: | ---: |
| Public-sector readiness | 0 | **3** |
| **Total** | 115 | **118** |

The 2-of-3 score (105 → 107) within the new cap reflects:
- GOV-SB-0 — sandbox-only execution at three layers (profileStore
  upsert validation, profileSpawn re-check, runner defense-in-depth)
  with stable `local_executor_blocked` audit emission carrying
  `{runner, reason, profileId, policyMode}`.
- GOV-PII-0 — KR-focused inline PII gate (주민등록번호 with check
  digit + birth date + gender code, Korean mobile/landline phone,
  email, credit card with Luhn) that refuses provider dispatch
  under public-sector posture and emits warn-level rows under
  standard posture. Samples are pre-redacted at the scanner level
  so audit chain never carries raw PII.

The remaining 1 star is reserved for GOV-PII-1 (deep-scan when an
attachment lands on disk; addresses + bank-account heuristics that
GOV-PII-0 deferred for false-positive control) OR GOV-AUDIT-0
(auditor evidence export) — whichever lands first in a future
public-sector hardening round.

### Rubric scale change (LV)

UI-H7 lifted Dual-agent integration cap 10 → 11 with the qualitative
shift from "operator can observe two AI streams" to "operator drives
review relay via 5 typed actions". UI-H7-f closed the wiring (route
→ dispatcher → runner.exec) but **was explicitly held at 11/11
pending live proof** per the user's guidance:

> "남은 배선 닫기"라서 처음에는 115/121 유지가 맞고, 실제 클릭
> → Codex 실행 → stream 귀속 → Claude hand-back까지 live proof가
> 나오면 그때 116/122 정도의 근거가 생깁니다.

The Live Verification Round closes that gap with concrete
real-binary evidence. The cap moves 11 → 12.

| Area | Pre-LV max | Post-LV max |
| --- | ---: | ---: |
| Dual-agent integration | 11 | **12** |
| **Total** | 121 | **122** |

The 12/12 score within the new cap reflects:
- **Self-CI smoke** (`tests/smoke/review-relay-end-to-end.test.js`)
  with streaming stub runners: 6 cases green, all dispatch verbs
  fire in correct order, severityCounts derived correctly, posture
  enforcement verified.
- **Operator probe scripts** (`scripts/live-verify-review-relay.{js,ps1,sh}`)
  ship with `--help`, JSON evidence emission, color-coded progress,
  exit-code semantic, public-sector / failure-mode variants.
- **Real-binary partial verification**: a probe run executed
  against a running harness server with real codex.cmd captured a
  3045ms audit row at `runs/system/ledger.jsonl`:

  ```
  t=0ms     review_session_created
  t=2ms     review_session_send_codex
  t=3ms     review_session_dispatch_started   (runner: codex)
  t=3045ms  review_session_dispatch_failed    (reason: exit_1, elapsedMs: 3045)
  ```

  The 3045ms gap is the proof — that's the real codex.cmd binary
  actually executing. Failure is graceful (no profile auth was
  configured during the probe), captured cleanly by the audit chain.
- **Operator runbook** (`docs/runbooks/live-verify-review-relay.md`)
  documents standard / public-sector / failure-mode probes +
  troubleshooting + CI-smoke alternative.
- **Round closeout report**
  (`docs/reports/2026-04-30-review-relay-live-verification.md`)
  captures both stub smoke + real-binary partial evidence with the
  ledger anchor.

What this round does NOT cover (operator follow-ups, no cap impact):
- Real-binary critique completion with authenticated profile
- Real-binary Claude hand-back round-trip
- Public-sector posture live probe

These are operator-runnable any time using the shipped probe scripts;
they extend the evidence but do not gate the 11 → 12 cap movement.
The decisive proof is the **first time** real codex.cmd is engaged
through the dispatcher with reviewSessionId hint and the audit chain
captures the lifecycle. That happened in this round.

### Rubric scale change (UI-H7)

UI-H4 landed `ReviewSessionManager` + 5-endpoint API as scaffolding
and explicitly deferred the operator UI driver and the runner-side
chunk routing. UI-H7 (a~e) closes both:

- The dual-agent-console grows a state-aware action row with 5
  buttons that call the API client (start session / send to Codex /
  follow up / hand back / archive). Buttons enable/disable based on
  the active session's state machine value.
- claude-runner / codex-runner grow a `reviewSessionId` exec opt
  that, when present and a `reviewSessionManager` is wired, pipes
  stdout chunks through `recordCodexChunk` / `recordClaudeChunk`
  and emits `recordCritiqueReceived` / `recordClaudeReceived` on
  successful close. severityCounts on the Codex side are derived
  from the existing `_extractFindings` regex via a new
  `_severityCountsFromFindings` helper.
- Public-sector posture flows through three layers: server returns
  409 with `error: "public_sector_local_executor_disabled"` for
  hand-back-claude AND follow-up target=claude; UI hides the
  hand-back button entirely + shows a posture badge; Korean error
  messages surface via `_formatReviewError` for any path the UI
  couldn't pre-block.

This is a qualitative shift from "two AI streams the operator can
observe" to "two AI streams the operator drives via 5 typed
actions, with chunks routed back into the right session". The
**Dual-agent integration** cap moves 10 → 11 to reflect this.

| Area | Pre-UI-H7 max | Post-UI-H7 max |
| --- | ---: | ---: |
| Dual-agent integration | 10 | **11** |
| **Total** | 120 | **121** |

The 11/11 score (10 → 11) within the new cap reflects:
- Operator drive: 5 typed action buttons, state-aware enable/
  disable, in-flight dedupe per sessionId.
- Server-runner round-trip: `reviewSessionId` hint flows from
  `/api/review-sessions/:id/send-codex` → server route → spawn
  with hint → runner stdout → `recordCodexChunk` → WS broadcast
  → store → action-row indicator update.
- Posture chain: live verified end-to-end (server 409 + client
  structured error code + UI hide + Korean message map).

| Area | Pre-E1.5 max | Post-E1.5 max | Pre-D2 score | Post-D2 score | Post-D3 score | Post-GOV-PII-1 score | Post-UI-H6 score | Post-UI-H7 score | **Post-LV score** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pipeline orchestration and phase model | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| State, artifacts, and quality gates | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| **Dual-agent integration** (cap 10→11 in UI-H7, 11→12 in LV) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 11 | **12** |
| Directive control and tool gating | 10 | 10 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| Safety and security boundary | 18 | 18 | 18 | 18 | 18 | 19 | 19 | 19 | 19 |
| Observability and runtime proof | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| Testability and regression suite | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 |
| Config, portability, onboarding | 10 | 10 | 9 | 10 | 10 | 10 | 10 | 10 | 10 |
| UI feedback loop | 7 | 7 | 6 | 6 | 7 | 7 | 8 | 8 | 8 |
| Maintainability and modularity | 8 | 8 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| Public-sector readiness | 0 | 3 | 2 | 2 | 2 | **3** | 3 | 3 | 3 |
| **Total** | **115** | **118** | **107** | **108** | **109** | **110** | **114** | **115** | **116** |

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

## Phase E1 D1 progress (profile + credential + spawn + public-sector baseline)

D1 closes the gap between "the launcher works on any machine"
(D0) and "the operator has their own Claude/Codex account, not
the developer's env vars". Six storage / runtime modules + one
HTTP route surface + a defense-in-depth audit-data sanitizer.

Mid-round insertion of **D1-gov policy baseline** (per
`docs/public-sector-hardening-plan.md` Task 1+2): every D1 module
now has a `public-sector` mode that fail-closes plaintext
credentials, sandbox-only execution, agency-managed accounts,
and signed-manifest distribution. Standard mode behavior is
unchanged.

- **D1-a — credentialStore** (commit `74d708c`):
  `src/security/credentialStore.js` — fail-closed default. Three
  backends: keychain (keytar via lazy require), plaintext (only
  when `HARNESS_ALLOW_PLAINTEXT_SECRETS=1` AND `NODE_ENV !=
  "production"`), none (refuse setSecret when nothing else is
  available). 26 unit tests cover the security baseline. Audit
  verbs: `credential_set` / `credential_deleted` /
  `credential_plaintext_fallback` / `credential_backend_unavailable`.
  Profile id sanitation matches the manifest version regex
  (`/^[A-Za-z0-9_.-]+$/`) so the OS keychain service name can
  never carry path-traversal or null-byte.

- **D1-b — profileStore** (commit `c775708`):
  `src/runtime/profileStore.js` — JSON-backed profile registry
  under `<HARNESS_CONFIG_DIR>/profiles.json` with atomic
  temp+rename writes, BOM tolerance, schema-version mismatch
  loud-fail, mode 0600 on POSIX. 28 unit tests cover the round-
  trip + active-profile lifecycle + audit verbs (`profile_created`
  / `profile_updated` / `profile_deleted` / `profile_switched`).
  Defensive copy on input.secretIds — caller mutation post-upsert
  cannot leak into persisted state.

- **D1-c — profileSpawn** (commit `37d338a`):
  `src/runtime/profileSpawn.js` — `buildSpawnEnv()` composes the
  spawn env in 4 layers: (1) P0 base via `filterSensitiveEnv`,
  (2) profile lookup, (3) credential injection per
  `profile.secretIds`, (4) telemetry env (`HARNESS_PROFILE_ID` +
  `HARNESS_WORKSPACE_PATH`). Refuses to spawn when any required
  credential is missing — no partial-credential execution. 17
  unit tests.

- **D1-gov-1 + D1-gov-2 — policy baseline** (commit `d87e622`):
  `src/policy/deploymentProfile.js` resolves
  `HARNESS_DEPLOYMENT_PROFILE` (default "standard"). Public-sector
  mode flips every fail-closed flag together: `allowLocalExecutor=false`,
  `allowPersonalAccounts=false`, `allowPlaintextSecrets=false` (overrides
  the opt-in flag in defense-in-depth), `requireSandboxWorkspace=true`,
  `requireSignedManifest=true`, `scannerFailurePolicy="block"`.
  `src/policy/publicSectorPolicy.js` exposes
  `validateProfileForPublicSector` (collects ALL violations in one
  pass — operator-friendly route response) and
  `assertLocalExecutorAllowed` (throws `PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED`).
  25 unit tests across the two modules.

- **D1-gov-3 + D1-gov-4 + D1-gov-5 — policy hooks** (commit `fff7b8b`):
  Wires the policy into the three D1 storage/runtime modules.
  credentialStore consults `deploymentProfile.allowPlaintextSecrets`
  and emits `credential_backend_unavailable` with reason
  `plaintext_blocked_in_public_sector` when public-sector hard-blocks.
  profileStore.upsert calls `validateProfileForPublicSector` when
  publicSector=true; persists agency-layer fields (accountType,
  workspaceMode, credentialBackend, dataClassification, egressPolicyId).
  profileSpawn calls `assertLocalExecutorAllowed` BEFORE any P0
  base env construction. +18 unit tests.

- **D1-d — runner spawn rewiring** (commit `17befc2`):
  `executor/claude-runner.js` + `executor/codex-runner.js` —
  constructor accepts `profileStore` / `credentialStore` / `ledger`
  (all optional, default null = pre-D1 behavior). `_tryExec` body
  wrapped in async IIFE so `await buildSpawnEnv(...)` fits between
  `dangerGate` and `spawn()`. Defense-in-depth:
  `assertLocalExecutorAllowed(resolveDeploymentProfile())` fires
  from the runner ITSELF in addition to inside profileSpawn — even
  if a future refactor bypasses profileSpawn, the runner-level
  gate still blocks the local executor under public-sector. Emits
  `profile_spawn_env_built` audit on profile-mode spawn. 10 unit
  tests covering: public-sector refusal in both runners (spawn
  never invoked), deleted profile / missing credential structured
  failures, profile-mode credential injection at the spawn boundary
  (CodexRunner uses spawnImpl injection for stub-driven assertion),
  P0 fallback path emits no audit (regression guard), legacy
  constructor still works.

- **D1-e — profileRoutes** (commit `8444102`):
  `src/routes/profileRoutes.js` — eight endpoints under
  `/api/profiles`. CRUD + active-switch (with **active-run gate**
  returning 409 + `profile_switch_blocked` audit when
  `childRegistry.snapshot()` reports any in-flight child) + secret
  KEY listing/setting/deleting. Critical regression guard: secret
  VALUES never appear in any response — GET only returns key
  names; POST never echoes the value back. Public-sector
  validation errors map to `400 {error: "public_sector_profile_policy",
  details: [...]}` so operators get every violation in one
  round-trip. Routes 503 (not 404) when stores aren't wired —
  actionable error during partial rollout. 19 integration tests.

- **D1-f — EvidenceLedger sanitizer** (commit `59f1494`):
  `src/security/auditSanitizer.js` — defense-in-depth secret
  redaction. Every audit `data` payload runs through the
  sanitizer before hashing + persisting. Walks the tree
  recursively; replaces values whose KEY name matches
  TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL with a structured
  redaction marker `{redacted: true, keyName, originalType,
  approxLength}`. SAFE_KEY_NAMES allowlist preserves audit-
  metadata fields (`secretCount` is a count, `secretsKeys` is an
  array of NAMES, `key` is a NAME not a value). Defenses:
  prototype-pollution skip (__proto__ / constructor / prototype
  never recurse), cycle protection (WeakSet → "[circular]"),
  depth limit (MAX_DEPTH=16). EvidenceLedger constructor accepts
  optional `sanitizer` — wired in production via server.js, opt-in
  for tests. Hash chain + signature both cover the SANITIZED form
  (verify() and verifyChain() round-trip cleanly). 13 unit + 7
  integration tests.

- **D1-g — D1 closeout + server.js wiring** (this commit):
  server.js wires the full D1 stack:
    - `evidenceLedger` constructed with `sanitizer: sanitizeAuditData`
    - `profileStore` constructed with `filePath` from configPaths +
      ledger
    - `credentialStore` constructed with `fsPaths` + ledger
    - `claudeRunner` + `codexRunner` constructed with
      `profileStore` + `credentialStore` + `ledger` (D1-d engages)
    - `createProfileRoutes` mounted under `/api` with the active-
      run gate reading `childRegistry.snapshot()`
  End-to-end live verification: harness-start.bat boots →
  `GET /api/profiles` returns `{profiles:[], activeProfileId:null}`
  + `/api/health` carries the D0-e `app:"HarnessPipeline"`
  discriminator.

D1 cap movement (104 → 105):
  Config / portability cap extended 8 → 10 to capture the shift
  from "operator double-clicks the launcher" (D0 — 6/8) to
  "operator double-clicks the launcher AND uses their own Claude/
  Codex account through profile + credential management"
  (D1 — 8/10). The remaining 2 points sit in:
    - D2 setup wizard (8-step first-run flow) — ~1 point
    - D3 UI account-status panel + accounts-modal — ~1 point

Public-sector cap movement: deferred. The hardening plan §11
suggests a public-sector readiness cap addition, but the score
movement gates on behavior-verified end-to-end (route-level
public-sector test fires only when the orchestrator is actually
running under `HARNESS_DEPLOYMENT_PROFILE=public-sector`). That
behavior-verification belongs to a later round (D1 ships the
mechanism; the production verification of `public_sector_profile_policy`
returning 400 over the wire under a real public-sector orchestrator
will close the cap movement).

Test counts cumulative across D1: 1309 -> 1446 unit (+137),
268 -> 294 integration (+26).

## Phase E1.5 progress (Public-sector hardening, GOV-SB-0 + GOV-PII-0)

Per user feedback (2026-04-29): the public-sector deployment story
needs runtime ENFORCEMENT, not just policy paper. D1's
`HARNESS_DEPLOYMENT_PROFILE=public-sector` resolver flips fail-
closed flags everywhere, but at runtime the only observable signal
was "spawn refused" — no audit narrative for the auditor / operator
review path. E1.5 turns that into a stable forensic chain AND
introduces a brand-new defense layer (PII detection) that no
previous slice covered.

- **GOV-SB-0 — sandbox-only execution at runtime**:
    - `src/policy/publicSectorPolicy.js` adds `assertSandboxWorkspaceRequired(profile, deploymentProfile)`
      as a SECOND spawn-time gate (the first being `assertLocalExecutorAllowed`
      from D1-gov-2). Even if a profile lands on disk via a legacy
      file format, hand-edit, or mid-process posture flip from
      standard → public-sector, the gate refuses to launch under it.
      Throws with code `PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED`
      so the audit row's reason field can distinguish "local-executor
      surface gated" from "wrong workspace mode for this profile".
    - `POLICY_BLOCK_CODES` frozen Set of {`PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED`,
      `PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED`} — the runner audit
      emitter consults this to decide whether `err.code` is policy-
      driven or a generic spawn-env failure. Frozen so a future caller
      can't extend the policy vocabulary without an explicit code change.
    - `src/runtime/profileSpawn.js` calls the new gate immediately
      after `profileStore.get()` so a profile lookup that succeeds
      under standard mode still gets policy-checked under public-
      sector before any credentials inject.
    - `executor/claude-runner.js` + `executor/codex-runner.js` emit
      a stable `local_executor_blocked` audit row carrying
      `{runner, reason, profileId, policyMode}` whenever an `err.code`
      lands in `POLICY_BLOCK_CODES`. The data shape is small +
      free of secret material (D1-f sanitizer is a defense-in-depth
      backstop for any future caller that accidentally passes raw
      values).
    - +9 unit tests + 6 integration tests (`tests/integration/gov-sandbox-block.test.js`).

- **GOV-PII-0 — inline KR-focused PII gate before provider dispatch**:
    - `src/security/piiScanner.js` (333 lines) — fast detector for
      five high-precision Korean PII patterns:
        - 주민등록번호 with check-digit + birth-date + gender-code
          validation (so `111111-1111111` doesn't trigger as a real
          RRN — would fail both check digit and date)
        - Korean mobile phone (010/011/016/017/018/019)
        - Korean landline phone (02 + 0XX-area)
        - Email
        - Credit card with Luhn validation (Luhn-fail strings pass
          through unredacted)
      `PATTERNS` registry frozen so a future caller can't extend the
      vocabulary without an explicit code change. Samples are
      ALREADY redacted at the scanner level (first 2 + last 2 chars
      + asterisks) so audit chain never carries raw PII.
    - `src/security/piiGate.js` (159 lines) — pure decision function
      `enforcePiiGate(text, {deploymentProfile, source})` returns
      `{ok, blocked, scan, reason, auditVerb, auditData}`. Public-
      sector posture → `pii_scan_blocked` row + spawn refused.
      Standard posture → `pii_scan_warn` row + spawn proceeds. Fail-
      closed: ANY signal (`requirePiiScanBeforeProviderDispatch=true`
      OR `scannerFailurePolicy="block"`) triggers the block path.
    - Runner integration in `claude-runner.js` + `codex-runner.js` —
      gate fires inline immediately after `buildSpawnEnv` and before
      `spawn()`. Verdict's `auditVerb` decides which row fires; on
      block, resolves with `code: "PII_SCAN_BLOCKED"` and unwinds
      runRegistry start.
    - +49 unit tests (`piiScanner.test.js` 33 + `piiGate.test.js` 16)
      + 6 integration tests (`gov-pii-block.test.js`).
    - Performance: 4KB scan completes in <1ms on commodity hardware
      (spec ceiling 50ms, well-cleared by 50×).

E1.5 cap movement (105 → 107):
  Public-sector readiness is a NEW rubric area (cap 3). Adding it
  inside Safety would lose the auditor narrative — Safety covers
  local-mode + remote-mode + controlled-execution-bridge already.
  Public-sector readiness is the orthogonal "would this deployment
  pass agency review" axis. 2/3 score: GOV-SB-0 (sandbox enforcement)
  + GOV-PII-0 (PII gate). Remaining 1 star reserved for GOV-PII-1
  (deep-scan when an attachment lands on disk) or GOV-AUDIT-0
  (auditor evidence export).

Test counts cumulative across E1.5: 1446 → 1504 unit (+58),
294 → 306 integration (+12). All gates green.

## Phase E1.5 D2 progress (Setup Wizard — D2-a, D2-b, D2-c, D2-d)

D1 closed the profile + credential layer; D0 closed the launcher.
D2 closes the gap between them: an OPERATOR-FACING wizard that
discovers Claude/Codex CLIs, builds a profile, and sets it active.
Two tracks (standard / public-sector) so the same wizard handles
both deployment postures.

- **D2-a — `src/runtime/cliProbe.js`** (cross-platform CLI discovery):
    - `discoverCli(name, opts)` resolves a CLI binary path on the
      user's system using `where` (Windows) / `which` (POSIX).
    - Strict CLI-name allowlist (`/^[A-Za-z][A-Za-z0-9_.-]*$/`)
      refuses paths, traversal, shell metacharacters, leading
      dot/digit/dash. `shell: false` on every spawn so a hypothetical
      bypass cannot open a shell.
    - 5s default timeout (configurable). CRLF + LF parsing. Multi-hit
      via `paths` field (where/which can return multiple matches).
    - Stable failure shape mirrors success shape (operator UX:
      every response carries the same 7 fields).
    - +24 unit tests covering input rejection (no spawn ever fires
      for refused names), cross-platform dispatch, parsing, timeout,
      spawn errors, return shape lock.

- **D2-b — `src/runtime/providerProbe.js`** (3-tier probe):
    - `probeProvider({runner, mode, profile, ...})` answers three
      escalating questions: installed (tier 1) → authenticated
      (tier 2) → canRun (tier 3, SPENDS tokens).
    - Each tier short-circuits on previous-tier failure so a missing
      CLI never reaches the auth or model-call paths. Tier 1 strips
      parent secrets via `filterSensitiveEnv`; tier 2/3 consume
      `buildSpawnEnv` (D1-c) so the layered env model stays the
      single source of truth.
    - Public-sector defense: `assertLocalExecutorAllowed` refuses ALL
      tiers under public-sector posture → `errorCode:
      "PUBLIC_SECTOR_BLOCKED"` (the wizard's public-sector track uses
      a different probe surface).
    - Frozen vocabulary via ERROR_CODES + PROBE_MODES + TIER_TIMEOUT_MS
      + RUNNER_CONFIG (claude/codex CLI shape table).
    - +21 unit tests covering runner validation, public-sector
      refusal, each tier (installed/auth/canRun), version + account
      label parsing, rate-limit detection, spawn errors, mode short-
      circuiting.

- **D2-c — `src/routes/setupRoutes.js`** (5 HTTP endpoints):
    - `POST /api/setup/probe-node` — Node ≥ 24 check.
    - `POST /api/setup/probe-cli` — `{name}` → discoverCli.
    - `POST /api/setup/probe-provider` — `{runner, mode?, profileId?,
      consentToTier3?}` → providerProbe. Tier 3 requires explicit
      consent in body (400 otherwise) — even if the wizard
      accidentally passes mode=tier1+2+3 without consent.
    - `POST /api/setup/probe-workspace` — `{workspacePath}` →
      write-then-delete probe. Auto-creates the directory if missing.
    - `POST /api/setup/finalize` — `{profile, setActive?}` →
      profileStore.upsert + (optional) profileStore.switch. Active-run
      gate fires regardless of setActive (409 + `setup_finalize_blocked`
      audit). Public-sector violation surfaces `details[]` from
      validateProfileForPublicSector.
    - server.js extracts `_isActiveRun` closure so /profiles AND /setup
      share the same childRegistry.snapshot() check.
    - +24 integration tests, including stub injection points for
      cliProbeImpl + probeProviderImpl + probeWorkspaceImpl + ledger.

- **D2-d — `scripts/setup-wizard.{js,ps1,sh}`** (interactive wizard):
    - 608-line Node script holds all interactive logic (JSON parsing
      + Read-Host in pure shell scripts is painful — PowerShell has
      ConvertFrom-Json but bash needs jq).
    - .ps1/.sh are 35-40 line wrappers: minimum-Node sanity, resolve
      sibling .js, hand off via @args / "$@" + exec. Operators
      discover the .ps1/.sh by name; the actual flow lives in the
      shared .js (precedent: launcher-cli.js).
    - **Standard track** 8 steps: Node check → Claude CLI (required)
      → Codex CLI (optional) → profile fields → workspace probe →
      optional Claude auth test → optional Codex auth test → finalize.
    - **Public-sector track** SKIPS local CLI discovery (sandbox runner
      is the authoritative provider in agency deployments). Collects
      agency-managed accountType + sandbox workspaceMode +
      dataClassification + egressPolicyId. REQUIRES three operator
      acknowledgments before finalize: sandbox runner configured /
      PII scanner active / trusted internal release. Each
      acknowledgment defaults to NO and rejecting the release ack
      aborts with exit 1 (public-sector deployments must come from
      a signed/internal channel, not a public download).
    - Track selection: `--standard` / `--public-sector` flag wins,
      else `HARNESS_DEPLOYMENT_PROFILE=public-sector` env, else
      default standard.
    - Audit verbs: `setup_finalize_ok` (success), `setup_finalize_blocked`
      (active-run gate refused). Both ride the signed + sanitized
      ledger chain that D1-f set up.
    - +28 unit tests (parseArgs/resolvers/postJson/main with stub fetch
      + stub prompt) + 17 smoke tests (.ps1/.sh wrapper contracts +
      POSIX exec bit + cross-wrapper sanity).

D2 cap movement (107 → 108):
  Config / portability cap was extended to 10 in D1-g, with a 9/10
  score (the +1 covered "operator runs Claude/Codex with their own
  agency account"). D2 closes the remaining 1 point: the operator
  experience is now end-to-end — double-click `harness-start.bat`
  → first-run wizard discovers CLIs / collects profile fields /
  finalizes via /api/setup/finalize / sets active. Standard and
  public-sector tracks share the same wizard process so a single
  installation supports both deployment postures.

Public-sector readiness stays 2/3:
  D2's public-sector wizard track collects agency profile fields
  and operator acknowledgments but doesn't yet PROBE sandbox-runner
  connectivity or perform deep-scan / auditor evidence export.
  Those live behind future GOV-* slices (GOV-PII-1 deep-scan,
  GOV-AUDIT-0 auditor evidence, GOV-RELEASE-0 signed/offline
  distribution, GOV-SANDBOX-PROBE for runner connectivity).

Test counts cumulative across D2: 1504 → 1577 unit (+73),
306 → 330 integration (+24), smoke +17 (existing 1505 + new 17).
All gates green.

## Phase E1.5 D3 progress (UI Account Status — D3-a, D3-b, D3-c, D3-d)

D2 closed the operator's first-run journey (launcher → wizard →
profile finalize). D3 closes the steady-state journey: at-a-glance
posture in the global bar + an operator-facing modal to manage
profiles without leaving the dashboard.

- **D3-a — `/api/server/info` extended with 4 ADDITIVE blocks**:
    - `profile { activeId, activeLabel, count, credentialBackend }`
    - `deployment { mode, publicSector, allowLocalExecutor,
                    allowPlaintextSecrets, requireSandboxWorkspace,
                    requirePiiScan }`
    - `bridge { mode }` — off | report | dispatch
    - `remote { mode, activeRunnerCount }` — off | preview | on
    - Stable-shape contract: every block ALWAYS present even when
      its dep is missing — the monitor shell renders without
      defensive null-checks past the top-level field.
    - server.js wires resolveDeploymentProfile() once at boot
      (frozen) + profileStore + credentialStore + runnerRegistry
      + hookRouter.getBridgeMode() + _remoteRunner.mode.
    - Defensive try/catch around every dep — observability path
      can NEVER break the info endpoint.
    - +18 integration tests covering each block + back-compat
      defaults + co-existence with MA0 activeChildren / R2.5-e
      hookStats / non-collision with existing keys.

- **D3-b — monitor store accountStatus slice + legacy-bridge mapping**:
    - `store.setAccountStatus(input)` — partial-friendly: missing
      sub-blocks preserve last-known-good (a partial poll response
      from a future server change can't wipe state).
    - `snapshot().accountStatus` returns DEFENSIVE shallow copies
      of each sub-block — mutating the snapshot can NEVER reach
      back into store state.
    - `legacy-bridge.refresh()` maps the four blocks to ONE
      `setAccountStatus` call per poll (single re-render).
    - Only fires when at least one D3 block is present (legacy
      pre-D3-a server response doesn't clobber state).
    - Tolerates missing `setAccountStatus` (older in-tree consumers).
    - +11 unit tests in monitor.account-status.test.js.

- **D3-c — global-bar 4 new at-a-glance cells**:
    - `profile` cell: active label + "+N" count suffix when count > 1;
      falls back to activeId; "(setup)" + warn tone when no active
      profile (operator nudge to setup-wizard).
    - `posture` cell: standard / public-sector with ERROR tone for
      public-sector (high salience — operators MUST notice if
      posture flips); flag summary tooltip
      (sandbox-only, PII gate, no local executor, plaintext OK).
    - `bridge` cell: off / report / dispatch with WARN tone for
      dispatch (active execution path — R2.5 controlled bridge on).
    - `remote` cell: off / preview / on with active runner count
      and WARN tone when count > 0; singular/plural noun in tooltip.
    - Pre-first-poll: all 4 cells render "(loading)" placeholder.
    - claude/codex CLI test cells DELIBERATELY omitted from D3-c —
      those live in D3-d settings modal where the operator gets
      explicit "Test" buttons. The bar stays at-a-glance honest.
    - +15 unit tests in monitor.global-bar.test.js.

- **D3-d — settings-accounts modal panel + layout integration**:
    - `public/js/monitor/panels/settings-accounts.js` (370 lines):
      list profiles via GET /api/profiles, mark active, Test Claude
      / Test Codex per profile (POST /api/setup/probe-provider
      mode=tier1+2 — no token spend), Switch (POST
      /api/profiles/:id/switch with 409 active-run toast), Delete
      (DELETE /api/profiles/:id with window.confirm() guard).
    - PUBLIC_SECTOR_BLOCKED test result → operator-readable toast
      routing to "use sandbox runner" (matches GOV-SB-0 messaging).
    - Toast auto-clears after TOAST_TTL_MS (4s) via injected setTimeout.
    - busy flag disables every button while a fetch is in flight
      (no operator-mashing race).
    - Layout integration: hidden region with role="dialog";
      global-bar Settings button (`gb-btn-settings`) toggles
      `is-hidden` class. Panel mounted ONCE — close just hides,
      preserving test cache + in-flight fetches.
    - destroy() teardown: panels first → settings → bridge LAST.
    - +17 unit tests in monitor.settings-accounts.test.js +
      2 new global-bar tests for the Settings button.

D3 cap movement (108 → 109):
  UI feedback loop cap 6 → 7 fully filled. Operator now sees
  posture / profile / bridge / remote at-a-glance AND manages
  profiles via the settings modal (test / switch / delete) without
  leaving the dashboard. The 4 cells in the global bar + the
  full-featured modal close the steady-state operator UX loop
  that D0 launcher + D1 profile + D2 wizard set up for.

Public-sector readiness stays 2/3:
  D3 exposes existing posture state through the UI but doesn't
  add a defense layer. The "PUBLIC_SECTOR_BLOCKED" toast in the
  settings modal routes the operator to "use sandbox runner" —
  but the actual sandbox-runner connectivity probe + auditor
  evidence export + signed distribution still live behind future
  GOV-* slices.

Test counts cumulative across D3: 1577 → 1622 unit (+45),
330 → 348 integration (+18), smoke unchanged.
All gates green.

## Phase E1.5 GOV-PII-1 progress (Deep file-import scan — GOV-PII-1-a, GOV-PII-1-b)

Closes the third star of the Public-sector readiness cap. With
GOV-SB-0 enforcing sandbox-only execution (audit row
`local_executor_blocked`) and GOV-PII-0 gating the inline pre-
dispatch path (audit row `pii_scan_blocked` / `_warn`), GOV-PII-1
catches PII at the file-import boundary — when an attachment lands
on disk for an agency-managed workspace, or when an operator runs
an explicit content audit via curl / settings UI.

- **GOV-PII-1-a — piiScanner depth selector + 3 KR deep patterns**:
    - `scanForPii(text, opts.depth)` accepts "inline" (GOV-PII-0 fast
      5-pattern set, default) or "deep" (8 patterns: inline + BRN +
      driver license + passport).
    - 사업자등록번호 (BRN) with full check digit per Korean tax
      authority spec — Luhn-equivalent precision: BRN-shaped
      sequences with bad check digit are rejected. Algorithm:
      weights [1,3,7,1,3,7,1,3,5] applied to first 9 digits + a
      `floor(digit[8]*5/10)` step. Severity: high.
    - 한국 운전면허번호 (12-digit format match, no check digit —
      false-positive risk acceptable in deep tier where operator
      already opted into a content scan). Severity: high.
    - 한국 여권번호 (M/S + 8 digits with anchored lookarounds so
      a passport-shaped token embedded in a longer alphanumeric
      identifier doesn't match). Severity: critical.
    - PATTERNS registry: 8 entries (5 inline + 3 deep), all frozen.
    - INLINE_PATTERN_TYPES + DEEP_PATTERN_TYPES exported as frozen
      wire-format locks.
    - Backwards compat: GOV-PII-0 callers (claude-runner, codex-runner,
      piiGate) keep the inline-only behavior. BRN / driver license /
      passport are INVISIBLE under default depth — explicit
      `depth: "deep"` opts in.
    - Sample redaction: BRN samples pre-redacted at the scanner
      level (first 2 + last 2 chars + asterisks). Audit chain never
      carries raw PII.
    - +25 unit tests (33 → 58 in piiScanner.test.js): BRN check
      digit positive/negative/format, KR driver license, KR
      passport (M/S + anchored), depth selector contract, frozen
      exports, redactPii honors depth.

- **GOV-PII-1-b — `/api/security/scan` HTTP endpoint**:
    - `src/routes/securityRoutes.js` (NEW, 196 lines).
    - One endpoint: `POST /api/security/scan` accepts
      `{ content, filename?, source?, depth? }` and emits one of:
        - `pii_file_scan_blocked` — public-sector + hasPii
        - `pii_file_scan_warn`    — standard + hasPii
        - (no audit verb) — clean scan (audit chain stays quiet
          under normal operation)
    - Default depth "deep" — operator calling /api/security/scan
      is opting INTO a file-content scan, so the deeper 8-pattern
      set is the expected behavior. Operator can pass
      `depth: "inline"` to fall back to the GOV-PII-0 fast set.
    - Posture decision mirrors GOV-PII-0 piiGate fail-closed
      semantics: ANY signal (`requirePiiScanBeforeProviderDispatch=true`
      OR `scannerFailurePolicy="block"`) triggers block.
    - Defenses: 1MB body cap (express.json + route guard), scanner
      throw → 500 with operator-readable error, missing
      deploymentProfile → standard posture (UI safety), invalid
      depth value → defaults to "deep", non-string content → 400
      content_required.
    - Audit data shape (already-redacted samples per scanner):
      `{ source, filename, sizeBytes, depth, findingCount,
         findingTypes, samples: { [type]: [redacted excerpts] } }`
    - server.js wires `evidenceLedger` (signed + sanitized chain)
      + `_deploymentProfile` (boot-resolved, frozen).
    - +19 integration tests (`security-scan.test.js`): body
      validation, depth selector, posture-driven block + warn,
      clean scan no-audit, audit data shape, response shape lock,
      back-compat (no deploymentProfile), fail-closed (one signal),
      scanner exception, frozen exports.

GOV-PII-1 cap movement (109 → 110):
  Public-sector readiness cap 2 → 3 fully filled. The three live-
  verified defense layers stack at distinct lifecycle moments:
    GOV-SB-0   — at runtime when a local provider would spawn
    GOV-PII-0  — at runtime when a prompt is about to dispatch
    GOV-PII-1  — at file-content boundary (explicit operator op)
  The new `pii_file_scan_*` verb prefix sits alongside GOV-PII-0's
  `pii_scan_*` so auditors triaging a forensic event distinguish
  inline-prompt detections from file-content detections without
  re-parsing the audit chain.

What's NOT in GOV-PII-1 (deferred to future GOV-* slices):
  - GOV-AUDIT-0 auditor evidence export (per-run forensic packet)
  - GOV-RELEASE-0 signed/offline distribution
  - GOV-SANDBOX-PROBE sandbox runner connectivity (auto-verify
    public-sector wizard's first ack)
  - "Scan File" UI in D3-d settings modal (the endpoint is wired;
    the operator UI is a follow-up)

Test counts cumulative across GOV-PII-1: 1622 → 1647 unit (+25),
348 → 367 integration (+19). All gates green.

## What 110 means

Single-user local harness with multi-run isolation, hardened external-input boundaries, AND a monitoring-first opt-in console with live data flow + agent observability + per-run detail contract + flow-level readiness rubric + behavior-verified readiness scoring + auto-derived doc trust + dispatcher-driven extraction pattern + CI-enforced regression protection + **a complete remote-execution design RFC** + **a complete implementation RFC with concrete tech decisions for runtime / image / JWT / ledger / control plane / network egress / bootstrap / failure recovery** + **the orchestrator-side primitives of remote mode actually shipped — JWT module + signed audit ledger + runner registry + handshake/heartbeat/hook routes + Dockerfile + server.js wiring + 6th readiness rubric category (remote-isolation, behavior-verified)** + **the runner-host primitives that complete the remote subsystem — WS path-aware demux + connection-lifecycle handler + `RunnerAgent` Node entrypoint + WS message protocol + `childRegistry` remote projection + readiness Star 3 upgraded to live runner→orchestrator round-trip** + **external-review correctness hardening — composite-key remote children with stop-path ownership verify + hook success audit-chain entries + runner-agent env validation that fails fast on bad numeric env** + **R2 single-runner deployment evaluation completed — all MF1 §4.1 gates G1-G9 verified live on the operator's Docker Desktop with repeatable probe scripts; 8 latent bugs surfaced and fixed** + **R2.5 controlled remote execution bridge — sanitized hooks now drive the local executor under an opt-in feature flag, with allowlist (5 hooks × 3 read-only tools), pure sanitizer with prototype-pollution resistance, and a 5-verb audit narrative (routed → rejected | sanitized → dispatched | dispatch_error). G4 hook ingress auth lifted from "partial PASS" to "full PASS"; runner-claimed runs are first-class in `/api/monitor/runs/:runId`**. The next-round work splits into two complementary axes: **R3 multi-runner pool + Linux host** for the layer 2/3 egress enforcement R2-4 left open, and a **per-call approval flow** before opening Bash / Write / Edit through the bridge. **R3-0 (plan) + R3-a (two-network topology) + R3-c (multi-runner pool primitives) landed**. R3-0 locked the gates; R3-a closes R2-4's dashboard host port gap (orchestrator dual-homed; strict override flips runner bridge only); R3-c ships the multi-runner pool primitives at registry + monitor layer (`selectFreshRunner` LEAST_LOADED + FIFO tie-break, `pruneStaleRunners` observation, `getAssignment` public surface, handshake collision detection with new `host_in_use` reason and `runner_handshake_collision` audit, `RunnerStaleMonitor` periodic prune wired into server.js with single-emit `runner_host_lost` audit row + dedupe-on-recovery + idle-host skip + ledger-failure resilience). R3-G01 + R3-G02 + R3-G06 + R3-G07 + R3-G09 + R3-G10 are GREEN. R3-G08 fairness algo verified by unit + integration; live deployment evidence deferred to R3-e. **R3-d (graceful shutdown polish) landed** — `src/server/shutdown.js` walks `wss.clients` on SIGTERM/SIGINT, sends `ws.close(1000, "orchestrator_shutdown")` to runner-bound connections; `runnerAgent.js` differentiates clean-1000 from 1006-crash and 1011/1008-fatal. **Phase E1 D0 (a-e) closed the productization launcher** — operator can install from a release zip, double-click `harness-start.bat` (or `./harness-start.sh`), and the launcher fetches/SHA256-verifies/atomic-installs/launches/health-checks/opens-browser, with https-only manifest URL, port-squat defense via `app:"HarnessPipeline"` discriminator, atomic install via `.install-complete` sentinel, and a `verify-health` CLI that distinguishes our server from any 200-OK responder. Config/portability cap extended 5 → 8 to capture the audience shift from "developer with `git clone`" to "operator with a download". Next: **R3-b** (Linux host nftables L2 + dnsmasq L3, requires Linux host), **R3-e** (per-call approval for write-side tools), and the **D1 profile + credential layer** that makes the harness usable with the operator's own Claude/Codex account instead of the developer-supplied env vars.

The MB1~MB6 + MC1~MC5 + MA7-a/b/c rounds closed the highest-leverage structural debt without bloating the surface. Each lift was behaviour-preserving + locked by tests; the file shrinkage is genuine. server.js dropped 276 lines, app.js dropped 252 lines. Module footprint expanded by 21 small UMD/Node modules, all under test, all CSP-compliant.

The "rewrite readiness" claim is now concrete: any new panel-specific handler can be added by creating a UMD that calls `HarnessEventDispatcher.register` — proven by `subagent-events.js` (MA7-c). React islands are unblocked when needed; the `monitor/store.js` + `monitor/normalizer.js` DOM-free contract is the seam.

The MD round added the missing operational layer: until MD2, every regression-prevention measure in this codebase (1133 tests, the readiness rubric, the scorecard sync) lived inside `npm run` scripts that operators COULD run but weren't required to. With the GitHub Actions workflow active, the same scripts now block merges. The qualitative shift — from "the suite exists" to "the suite gates the branch" — is what the Testability cap extension (10 → 11) captures.

The ME round was small but disciplined: GitHub flips the default JS-action runtime to Node 24 on 2026-06-02 and removes Node 20 entirely on 2026-09-16. ME1 opted in early via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and validated under v4 actions; ME2 then bumped checkout + setup-node to v6 (Node 24 native). Plus `permissions: contents:read` (least-privilege) and `concurrency: cancel-in-progress` (kill races between rapid pushes).

The MF round shifts the trust-boundary conversation from "vague future" to "design done, gates named". `docs/remote-sandbox-rfc.md` (532 lines) consolidates run origin + sandbox class + workspace/process/token/fs/network boundaries + UI metadata + 10 rollout gates G1-G10 into a single document. **No code lands until G10 (a follow-up implementation RFC) is approved.** Score 97 → 98 reflects the trust-boundary clarity, not implementation — the design _IS_ the deliverable for this round.

The MG round closes MF1 §4 G10 by committing to specific tech for each of MF1 §6's four open questions. `docs/remote-sandbox-impl.md` (702 lines) chooses **Docker rootless** (with daemon fallback) for `container-strict`, leaving kata/firecracker reserved for `vm-strict` in Phase R4. Hook ingress = **WS primary + HTTPS POST one-shot fallback**. JWT = **HS256, HKDF-derived from `HARNESS_TOKEN`** (separate label from the audit-ledger HMAC key, so neither use can forge the other). Audit ledger = **extend the existing `evidenceLedger` JSONL hash chain with HMAC-SHA256 per entry** (not a switch to SQLite — current scale ~900K rows fits append-only comfortably). Plus the runner-host control plane (env-only, heartbeat-driven discovery), the 3-layer egress policy (Docker `--internal` + nftables on bridge + dnsmasq allowlist on the controlled resolver), the 3-step bootstrap handshake (bootstrap token → runnerToken → runJWT), and the 10-row failure-mode table extending MF1 §4.2. Score 98 → 99 reflects the rollout phasing concreteness — operators can now audit each Phase R1-R4 phase against named criteria.

The R1 round (a/b/c/d/d-boost/f/h/i/j) ships the first code that backs the design. Every primitive that MG1 §1-§5 specifies — HKDF key derivation, HS256 JWT issue/verify with alg-confusion immunity, HMAC-signed audit ledger entries with `verifyChain` round-trip, single-use bootstrap → 24h sliding-TTL runnerToken → per-run runJWT taxonomy, `RunnerRegistry` with idempotent claim + reassign-safe transfer, default-off feature flag — is now real, tested code under `src/security/`, `src/runtime/`, `src/routes/`, and `src/server/`. The Dockerfile ships at `pipeline-dashboard/Dockerfile.runner` (multi-stage, non-root UID 10001, `--ignore-scripts` build layer) with companion build script + CycloneDX 1.5 SBOM tooling. The readiness rubric grew from 5×3=15 to 6×3=18 stars with the new remote-isolation category (3 stars, all in-process behavior-verified). Test counts moved 936/197 → 1025/226 across the round (+89 unit, +29 integration). Score 99 → 100 reflects the orchestrator-side primitives actually being deployable, not just designed. The runner-host agent + WS `/api/runner/events` upgrade are deliberately deferred to a paired R1-e + R1-g round so the path-aware demux design can stand independent of `verifyWsConnection`'s dashboard-focused auth gate.
