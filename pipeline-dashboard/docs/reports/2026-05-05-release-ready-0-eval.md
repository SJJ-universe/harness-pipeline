# RELEASE-READY-0 Closeout — Long-running Tasks + Account Login Guidance + Timeout Policy

- **Date**: 2026-05-05
- **Round**: Phase 2 / RELEASE-READY-0 (User-supplied 5-priority roadmap, top priority)
- **Plan reference**: 2026-05-05 user recommendation
- **Score before**: 120/126
- **Score after**: 120/126 (cap movement candidate; deferred per
  acceptance gate — "operator runs public-sector mode in production
  with no regressions for 1+ week")

## What this round shipped

Five sub-slices addressing the user's "처음 설치한 사람이 자기 Claude/Codex 계정으로 막힘 없이 연결하고, 10분 이상 걸리는 작업도 부당하게 죽지 않게 한다" goal:

### Sub-slice RR0-a — Timeout Policy Core
- New `src/runtime/timeoutPolicy.js` (~270 LOC)
- 3 frozen presets:
  | preset | codex | claude | phase | queue |
  |---|---|---|---|---|
  | interactive (default) | 2 min | 3 min | 2 min | 30 s |
  | long_run | 20 min | 30 min | 20 min | 5 min |
  | public_sector | 30 min | 45 min | 30 min | 2 min |
- Resolver precedence: per-field env override → ORCHESTRATOR_TIMEOUT_PRESET → deploymentProfile.publicSector → interactive
- Per-field overrides: ORCHESTRATOR_CODEX_TIMEOUT_MS, ORCHESTRATOR_CLAUDE_TIMEOUT_MS, ORCHESTRATOR_PHASE_TIMEOUT_MS, ORCHESTRATOR_CHILD_QUEUE_TIMEOUT_MS
- Bounds: [100 ms, 4 hours] — out-of-range overrides fall back to preset
- 31 unit tests

### Sub-slice RR0-b — Activity-Based Watchdog + Runner Integration
- New `src/runtime/activityWatchdog.js` (~190 LOC) — two-timer model:
  - **Total timer**: hard upper bound, fires unconditionally
  - **Idle timer**: resets on each tick(); fires when no activity for idleTimeoutMs
  - **Idle warning**: fires once at 75% of idle budget (pre-kill alert for UI)
- State machine: IDLE → ACTIVE → (WARNING ⇄ ACTIVE)* → KILLED|CLEARED
- All callbacks defensive (try/catch); state corruption-safe
- 32 unit tests covering total/idle/warning timer + race + clear + defensive throws + 25-min realistic scenarios
- `executor/codex-runner.js` + `executor/claude-runner.js`:
  - Constructor accepts `idleTimeoutMs`, `setTimeoutFn`, `clearTimeoutFn`, `clockFn`
  - When `idleTimeoutMs` is set, replaces the legacy `setTimeout(...).then(child.kill)` with a watchdog
  - Each stdout/stderr chunk calls `watchdog.tick()`
  - `onIdleWarning` broadcasts `codex_idle_warning` / `claude_idle_warning` WS events
  - `onKill` broadcasts `codex_killed_for_idle` / `claude_killed_for_idle`
  - When `idleTimeoutMs` is null (default), legacy single-timer behavior preserved verbatim
  - claude-runner constructor also gained `broadcast` parameter (was missing!)
- `server.js`:
  - `resolveTimeoutPolicy` called once at boot
  - `_idleTimeoutMs = 60_000 ms` when preset !== "interactive" (interactive preserves pre-RR0 semantics)
  - Both runners get `defaultTimeoutMs` from policy + `idleTimeoutMs` from preset

### Sub-slice RR0-c — Long-running Task Store Slice + Bridge Wiring
- `public/js/monitor/store.js`:
  - New `runnerActivity` Map slice keyed by `${runner}:${runId}:${iteration}`
  - 4 mutators: `recordRunnerIdleWarning`, `recordRunnerKilled`, `clearRunnerActivity`, `clearRunnerActivityForRun`
  - Snapshot includes `runnerActivity` (sorted by warningFiredAt|killedAt desc)
  - `reset()` wipes via `freshState()`
- `public/js/monitor/legacy-bridge.js`:
  - New `_syncRunnerActivityFromEvent(type, data)` routes 4 watchdog WS events to slice mutators
  - Watchdog events do NOT pollute the events ring (own slice; high volume)
  - `pipeline_complete` / `pipeline_reset` sweep `clearRunnerActivityForRun(runId)`
  - New stats counter: `runnerActivitySyncs`
- 24 store unit tests + 11 bridge unit tests

### Sub-slice RR0-d — Account Login Guidance
- `public/js/runtime/firstRunClassifier.js`:
  - 3 new CTA constants: `COPY_LOGIN_COMMAND_CLAUDE`, `COPY_LOGIN_COMMAND_CODEX`, `RECHECK_PROVIDERS`
  - New `SAFE_GUIDANCE_PRINCIPLE` frozen export: `{id: "harness-no-credential-collection/v1", shortKey, longKey}`
  - New `LOGIN_COMMANDS` frozen catalog: `{claude: {runner, command: "claude auth login", docsUrlKey}, codex: {...}}`
  - `STATE_CTAS[PROVIDER_NOT_AUTHENTICATED]` extended: AUTH_CLAUDE, AUTH_CODEX, COPY_LOGIN_COMMAND_CLAUDE, COPY_LOGIN_COMMAND_CODEX, RECHECK_PROVIDERS (5 CTAs)
  - `STATE_CTAS[PROVIDER_MISSING]` extended: REOPEN_SETUP_FOR_PROVIDERS, RECHECK_PROVIDERS (2 CTAs)
- 8 new i18n keys per locale (ko/en parity preserved):
  - `firstRun.cta.copyLoginCommandClaude / Codex / recheckProviders`
  - `firstRun.safeGuidance.short / long`
  - `firstRun.docsUrl.claude / codex` (full anthropic + openai docs URLs)
- 14 new unit tests; 2 existing tests updated for the new CTA list shapes

### Sub-slice RR0-e — Release Readiness Smoke
- New `tests/integration/release-readiness-long-run.test.js` — 5 integration tests using fake spawn + fake clock:
  - **Headline test**: 12-minute fake stream with 30s ticks survives (no kill, no warning)
  - 12-min stream then silence triggers warning at 45 s, kill at 60 s
  - Total timeout fires at 30 min even with constant ticks
  - Pre-RR0-b legacy path (no idleTimeoutMs) preserved verbatim
  - Public-sector 25-min Codex critique full integration test (severity-tagged chunks parsed via `_extractFindings`)

## End-to-end behavior change

**Pre-RR0-b**: Operator runs `ORCHESTRATOR_DEPLOYMENT_PROFILE=public-sector` and starts a 25-minute Codex security review. Runner kills the child at minute 2 with a misleading "timeout" reason. Operator can't tell if Codex is broken or just slow.

**Post-RR0-e**:
1. Server boots → `resolveTimeoutPolicy()` returns public_sector preset (codex 30 min total / claude 45 min)
2. `_idleTimeoutMs = 60_000` engages the watchdog
3. CodexRunner / ClaudeRunner construct with `idleTimeoutMs: 60_000`
4. Operator launches the 25-min critique
5. Codex streams output every ~30 s — watchdog ticks reset the idle timer
6. UI sees `codex_idle_warning` if Codex goes silent for 45 s (75% of 60 s)
7. UI dashboard sees `codex_killed_for_idle {reason: "idle_timeout"}` only after 60 s of silence (or `total_timeout` if the run actually exceeds 30 min)
8. `runnerActivity` slice surfaces the warning/kill state; future UI panel renders "마지막 출력 후 N초"
9. Pipeline completes normally → bridge calls `clearRunnerActivityForRun` to sweep stale entries

If operator's CLI is missing or unauthenticated:
1. Setup wizard probes → providerStatus = `{installed: false}` or `{installed: true, authenticated: false}`
2. firstRun classifier → PROVIDER_MISSING or PROVIDER_NOT_AUTHENTICATED
3. UI panel renders RR0-d CTAs:
   - Primary: `AUTH_CLAUDE` / `AUTH_CODEX` (existing flow if runner has built-in auth UI)
   - Fallback: `COPY_LOGIN_COMMAND_CLAUDE` (clipboard `claude auth login`)
   - Tail: `RECHECK_PROVIDERS` ("I logged in externally — please re-probe")
4. Footnote shows `SAFE_GUIDANCE_PRINCIPLE.shortKey` text — operator sees Harness never asks for password / OAuth token

## Test counts

|              | Before | After  | Δ    |
|--------------|-------:|-------:|-----:|
| Unit         |   3170 |   3282 | +112 |
| Integration  |    520 |    525 | +5   |
| Smoke        |     90 |     90 |  0   |

Per sub-slice:
- RR0-a: +31 unit (timeoutPolicy)
- RR0-b: +32 unit (activityWatchdog) + 0 new test files for runner integration (existing codex/claude tests cover legacy path)
- RR0-c: +35 unit (24 store + 11 bridge) — runnerActivity slice
- RR0-d: +14 unit (firstRunClassifier RR0-d additions)
- RR0-e: +5 integration (release-readiness-long-run)

## Files touched

### Created
- `src/runtime/timeoutPolicy.js`
- `src/runtime/activityWatchdog.js`
- `tests/unit/timeoutPolicy.test.js`
- `tests/unit/activityWatchdog.test.js`
- `tests/unit/monitor.store.runnerActivity.test.js`
- `tests/unit/monitor.legacy-bridge.runnerActivity.test.js`
- `tests/unit/firstRunClassifier.rr0d.test.js`
- `tests/integration/release-readiness-long-run.test.js`
- `docs/reports/2026-05-05-release-ready-0-eval.md` (this file)

### Modified
- `executor/codex-runner.js` (constructor accepts watchdog deps; exec() branches on idleTimeoutMs)
- `executor/claude-runner.js` (mirror; constructor also gains broadcast param)
- `server.js` (resolveTimeoutPolicy at boot; both runners receive defaultTimeoutMs + idleTimeoutMs from policy)
- `public/js/monitor/store.js` (runnerActivity slice + 4 mutators + snapshot field)
- `public/js/monitor/legacy-bridge.js` (4 WS event types routed; pipeline_complete sweep)
- `public/js/runtime/firstRunClassifier.js` (3 new CTAs + SAFE_GUIDANCE_PRINCIPLE + LOGIN_COMMANDS)
- `public/js/i18n/{ko,en}.js` (+8 keys per locale)
- `tests/unit/firstRunClassifier.test.js` (CTA assertions updated for new entries)
- `docs/scorecard.md` (RELEASE-READY-0 closure marker)

## Decisions worth re-reading later

1. **Backward compat preserved verbatim**: Every pre-RR0-b runner caller (test or production) that doesn't pass `idleTimeoutMs` sees the legacy single-timer behavior unchanged. The new watchdog path engages only when an operator explicitly opts in via env (ORCHESTRATOR_TIMEOUT_PRESET=long_run/public_sector) or deployment profile (publicSector). This invariant is anchored by the codex-runner-progress.test.js (7 tests, all green) which exercises the legacy path.

2. **Two-timer over one-timer because "long" ≠ "stuck"**: Pre-RR0-b's single setTimeout treated a 25-min critique with constant output the same as a 25-min hung process. The watchdog distinguishes via the idle timer — long but progressing keeps ticking; hung doesn't. Operators see different audit verbs (`total_timeout` vs `idle_timeout`) and the UI can render different copy.

3. **75% idle warning threshold = "tell me before you kill me"**: Choosing 75% (vs 50% or 90%) gives operators ~25% of the idle budget to intervene. With 60 s idle: warning at 45 s, kill at 60 s. The 15-second window matches typical "operator notices toast and clicks 'wait longer'" reaction time. Adjustable via `idleWarningRatio` constructor option.

4. **`server.js` engages watchdog only for non-interactive presets**: Interactive deployments (the pre-RR0 default) keep the legacy single-timer behavior so existing CI runs / dev loops aren't disturbed. Long-run + public-sector deployments get the watchdog automatically. This matches the user's "interactive default; opt into long-run" rollout strategy.

5. **`runnerActivity` slice owns its own state, NOT the events ring**: Watchdog warnings can fire every 45 s on a long-running task — that's noise in the events ring. Routing to a dedicated slice (analogous to reviewSessions, pendingApprovals) keeps the operator's main timeline clean while still giving the long-running task UI a place to render from.

6. **`SAFE_GUIDANCE_PRINCIPLE` is documentation-as-code, not a runtime check**: The guarantee "Harness never asks for passwords / OAuth tokens" is enforced by the *absence* of a route that accepts credentials. The frozen export is a stable id + i18n keys for the UI panel to render; an audit-chain entry referencing this id documents WHICH guidance was given when. The principle is robust because adding a credential-accepting route would require deleting this principle's id (a code change auditors can grep for).

7. **Clipboard-copy CTAs vs OAuth flows**: Some operators have CLI clients with built-in auth flows (e.g., `claude auth login` opens a browser). Others have CLIs that require manual token paste. RR0-d ships both paths — `AUTH_CLAUDE` for the built-in flow, `COPY_LOGIN_COMMAND_CLAUDE` for the manual paste — and the UI panel can render both as buttons (operator picks). The `LOGIN_COMMANDS` catalog is frozen so a future caller can't sneak a credential-accepting URL into the docs link.

8. **`legacy-bridge` watches lifecycle events for cleanup**: When a pipeline completes/resets, we sweep the runnerActivity entries for that runId. This avoids the "ghost warning" pattern where a 12-minute run finishes successfully but the dashboard still shows the warning that fired at minute 11.

9. **Fake clock + fake spawn for the 12-minute smoke test**: Real 12-minute integration tests would block CI for 12 minutes (unacceptable) and race against actual timer drift (flaky). The `tests/integration/release-readiness-long-run.test.js` simulates 25 minutes of activity in milliseconds with deterministic behavior. The trade-off: we don't test real subprocess teardown — that's covered by the existing codex-runner-progress.test.js which exercises real timers with short timeouts.

10. **Score movement deferred to operator field evidence**: SMART-2/4/5 closeouts queued cap movement to a "1+ week production deployment" gate. RR0 follows the same pattern. The cap-movement landing is when an operator runs the harness in public-sector mode for a sustained period without:
    - Premature timeouts (RR0-b proven by 12-min smoke)
    - Confused about why something was killed (RR0-c surfaces idle vs total)
    - Stuck at "Claude says I'm not logged in" with no path forward (RR0-d gives 5 CTAs)

## What's deferred / out of scope

- **Long-running task UI panel**: The store slice + bridge route data into `runnerActivity`; a future enhancement adds a simple-shell card showing "활성 N건 / 경고 M건" with last-output timestamp + queue position. The hooks are ready.
- **"강제 종료" UI button**: Operator-initiated kill from the UI requires backend API (`POST /api/runs/:runId/kill`). The kill plumbing in the runner is there (`child.kill()` works) but the route + auth check + UI confirmation modal are out of scope. Watchdog gives "automatic kill on idle"; manual kill is a future enhancement.
- **Per-pack `hardGatesDefault` runtime auto-application**: SMART-5's policy packs declare `hardGatesDefault` but `resolveGateMode()` doesn't currently consult `deploymentProfile.hardGatesDefault`. Same for SMART-4's `runMemoryEnabled`. RR0 doesn't change either; future SMART-6 (?) round can wire these.
- **Real subprocess long-run smoke**: The integration test uses fake clock + fake spawn. A real subprocess test that runs for 12 minutes is impractical for CI. A separate manual smoke (`scripts/release-readiness-probe.{sh,ps1}`) could spawn `node` with a stdout-printing loop, but that's a follow-up.
- **Account login guidance: clipboard-copy implementation**: The classifier returns the CTA IDs (`COPY_LOGIN_COMMAND_CLAUDE`); a UI panel renderer (`firstRunPanel.onCta` handler) needs to wire `navigator.clipboard.writeText(LOGIN_COMMANDS.claude.command)` + emit a toast. The renderer is in a future UI panel slice.

## Per plan §S §S-next-after — RELEASE-READY-0 → SMART-LV-0

User-supplied roadmap: "RELEASE-READY-0 뒤에는 SMART live verification을 추천합니다." Next round candidate:

**SMART-LV-0**: Live evidence packet for SMART arc — exercises ORCHESTRATOR_HARD_GATES=1 + finance-high-privacy or public-sector pack on a real run + captures `policy_gate_blocked` audit, redacted run memory entry, recommendation card render, expert preset dispatch in actual operator output. Provides the cap-movement evidence the SMART arc closeouts queued.

End of RELEASE-READY-0 closeout.
