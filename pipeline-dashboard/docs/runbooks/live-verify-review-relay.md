# Runbook — Live Verify Review Relay

**Slice LV (Phase D / Phase E1.5, 2026-04-30)**

This runbook walks an operator through the **live end-to-end verification** of the Review Relay chain (operator → dashboard → manager → dispatcher → real Codex/Claude binary → audit chain). Run this AFTER any change that touches:

- `src/runtime/reviewSessionManager.js`
- `src/runtime/reviewSpawnDispatcher.js`
- `src/routes/reviewSessionRoutes.js`
- `executor/codex-runner.js` / `executor/claude-runner.js`
- `public/js/monitor/panels/dual-agent-console.js`
- `public/js/monitor/review-session-client.js`

The companion CI-runnable smoke (`tests/smoke/review-relay-end-to-end.test.js`) covers the harness wiring with stub runners. This runbook covers what stubs cannot — actually invoking the operator's installed `codex` and `claude` CLIs against real APIs.

---

## 1. Pre-requisites

Before running the probe:

- [ ] **Node 24+** installed and on PATH (`node --version` ≥ v24).
- [ ] **Codex CLI** installed (`where codex` on Windows, `which codex` on Linux/Mac). If missing, install via `npm install -g @openai/codex`.
- [ ] **Claude CLI** installed (`where claude` / `which claude`). Required only for `--with-handback` runs. Install via `npm install -g @anthropic-ai/claude-code`.
- [ ] **A configured profile** in the harness with credentials for the runner you want to exercise:
  - For Codex critique: profile must have an `openai-api-key` secret OR Codex CLI must be authenticated globally (`codex auth status` returns "logged in").
  - For Claude hand-back: profile must have an `anthropic-api-key` secret OR Claude CLI must be globally authenticated.
- [ ] **A clean checkout** of the harness — `git status -s` shows only intentional changes.
- [ ] **No active runs** in the harness — `curl http://127.0.0.1:4201/api/server/info | jq .activeChildCount` returns `0`.

---

## 2. Standard-mode full-chain probe

This is the canonical case: standard posture, full Codex critique → operator hand-back to Claude.

### 2.1 Boot the harness server

```powershell
# Windows
.\harness-start.bat
```

```bash
# Mac / Linux
./harness-start.sh
```

Wait for the line `Pipeline Dashboard: http://127.0.0.1:4201` and the `terminal: enabled` indicator. Verify the server is up:

```bash
curl -s http://127.0.0.1:4201/api/health | jq
# expected: {"status":"ok","app":"HarnessPipeline",...}
```

### 2.2 Configure the active profile (one-time)

If `GET /api/server/info` returns `profile.activeId: null`, run the setup wizard:

```powershell
node scripts/setup-wizard.js
```

Pick the **Standard** track. Make sure `Test Claude` and `Test Codex` both pass (`tier 1+2`).

### 2.3 Run the live probe

In a second shell (the harness server keeps running in the first):

```powershell
.\scripts\live-verify-review-relay.ps1 `
  -Label "live-probe-$((Get-Date -Format 'yyyyMMdd-HHmm'))" `
  -Instruction "Review the recent change for security and correctness. Use [critical] [high] [medium] [low] severity tags." `
  -WithFollowup `
  -WithHandback `
  -TimeoutMs 180000
```

```bash
./scripts/live-verify-review-relay.sh \
  --label "live-probe-$(date +%Y%m%d-%H%M)" \
  --with-followup \
  --with-handback \
  --timeout-ms 180000
```

Watch the colored progress output. Each step (01 health → 09 archive) should report PASS in green.

### 2.4 What "PASS" means here

A PASS verdict means the probe verified, against the running server with real binaries, that:

1. Server health probe returns `app:HarnessPipeline`
2. Server info shows `deployment.publicSector: false` + `allowLocalExecutor: true`
3. `POST /api/review-sessions` creates a session (state: `created`)
4. `POST /:id/send-codex` returns 200 + `dispatched: true` + `runner: codex`
5. Polling reveals the session reaches `critique_received` within timeout
6. The latest history entry has non-empty `severityCounts`
7. `POST /:id/follow-up` (target: codex) succeeds with `dispatched: true`
8. `POST /:id/hand-back-claude` returns 200 + `dispatched: true` + `runner: claude`
9. Polling reveals the session reaches `claude_received` within timeout
10. `POST /:id/archive` succeeds (idempotent)

Evidence JSON is written to `docs/reports/<date>-review-relay-live-verify.json`.

### 2.5 Verify the audit chain captured the dispatch verbs

Open `runs/system/ledger.jsonl` and grep for the session ID returned in the probe output:

```bash
grep "<session-id-prefix>" /c/Users/SJ/harness-pipeline-analysis/runs/system/ledger.jsonl
```

You should see at minimum:

- `review_session_created`
- `review_session_send_codex`
- `review_session_dispatch_started` (action: send-codex, runner: codex)
- `review_session_critique_received` (with `severityCounts` from the manager)
- `review_session_dispatch_completed` (codex)
- `review_session_hand_back_claude`
- `review_session_dispatch_started` (action: hand-back-claude, runner: claude)
- `review_session_claude_received`
- `review_session_dispatch_completed` (claude)
- `review_session_archived`

Confirm the chain hashes verify:

```bash
node -e "const { EvidenceLedger } = require('./src/runtime/evidenceLedger'); const l = new EvidenceLedger({ rootDir: 'runs' }); console.log(l.verifyChain('system'));"
```

Expected output: `{ ok: true, chainLength: <N> }`.

---

## 3. Public-sector posture probe

This case verifies the policy gate: under public-sector posture, hand-back to local Claude returns 409.

### 3.1 Set posture before booting

```powershell
$env:HARNESS_DEPLOYMENT_PROFILE = "public-sector"
.\harness-start.bat
```

```bash
HARNESS_DEPLOYMENT_PROFILE=public-sector ./harness-start.sh
```

Verify `GET /api/server/info` returns `deployment.publicSector: true` + `allowLocalExecutor: false`.

### 3.2 Run the probe with `--posture public-sector`

```powershell
.\scripts\live-verify-review-relay.ps1 -Posture public-sector
```

```bash
./scripts/live-verify-review-relay.sh --posture public-sector
```

The probe runs steps 1–6 normally (Codex critique is read-only and always allowed under public-sector), then step 7 expects `POST /:id/hand-back-claude` to return **409** with `error: public_sector_local_executor_disabled`. The Claude runner must NOT have been invoked.

### 3.3 Verify the dispatch_blocked audit row

Look in the audit chain for:

```
review_session_dispatch_blocked
  data: { sessionId, actionType: "hand-back-claude", reason: "local_executor_disabled" }
```

If you see this, the route gate fired before the dispatcher even ran (correct behavior). The dispatcher's own defense-in-depth check would also fire if the route gate were ever bypassed — that path is covered by the integration tests in `tests/integration/review-relay-spawn.test.js`.

---

## 4. Failure-mode probe (optional)

To verify the harness handles dispatcher failures gracefully:

### 4.1 Force a failure

Run the probe against a misconfigured profile (e.g., expired API key) so Codex CLI exits with a non-zero status:

```powershell
.\scripts\live-verify-review-relay.ps1 -TimeoutMs 30000
```

Expected behavior:
- Step 04 (send-codex) returns 200 + `dispatched: true`
- Step 05 (poll critique_received) **times out** because Codex returns ok:false
- The audit chain shows `review_session_dispatch_failed` with `reason: "exit_<N>"` or `error: "..."`
- The session state stays at `awaiting_critique`
- The probe exits with code 1 and writes `verdict: FAIL_CRITIQUE_TIMEOUT` to the evidence JSON

This is the correct behavior — the operator UI can see the failure via the audit row + state-stuck session and can archive + retry.

---

## 5. Troubleshooting

### Server not reachable
- Confirm the harness is running: `curl http://127.0.0.1:4201/api/health`
- Check the port — the launcher prints `Pipeline Dashboard: http://127.0.0.1:<port>`
- Check the firewall isn't blocking 127.0.0.1:4201

### `dispatch_runner_unavailable` (503)
- The harness has `_reviewSpawnDispatcher` constructed but no codex/claude runner wired. Inspect `server.js` lines around the dispatcher construction. This shouldn't happen on a clean checkout — it indicates a regression in `server.js` wiring.

### `dispatch_already_in_flight` (409) on first call
- A previous probe run never reached completion and the in-flight Map still tracks that session. Restart the harness to clear in-process state.

### Codex/Claude exits with code 1
- Check authentication: `codex auth status` and `claude auth status`. If "Logged out", run the setup wizard or authenticate manually.
- Check the profile's API key: `node scripts/setup-wizard.js` → `Test Codex` (tier 1+2).

### Critique never arrives (poll timeout)
- Increase `--timeout-ms` (default 120000ms = 2 minutes). Real critique can take 1–5 minutes for non-trivial prompts.
- Check `runs/system/ledger.jsonl` for `review_session_dispatch_failed` — that means the runner returned ok:false before the chunks could complete.

### Public-sector posture probe returns 200 instead of 409
- The deployment profile didn't load. Check `GET /api/server/info` and confirm `deployment.publicSector: true`. Set `HARNESS_DEPLOYMENT_PROFILE=public-sector` BEFORE booting the harness.

---

## 6. Evidence report

After a successful probe run, the JSON written by the probe is the **machine-readable** evidence. The **human-readable** sibling is the per-run report at:

`docs/reports/<date>-review-relay-live-verification.md`

Fill in the relevant sections with the probe output. See the template in that file.

---

## 7. CI smoke alternative (no real binaries)

If you cannot run the full probe (no Codex/Claude installed, no API budget, etc.), the closest CI-runnable alternative is:

```bash
LIVE_RELAY_EVIDENCE=1 npm run test:smoke -- --test-name-pattern "LV-1 smoke"
```

This runs the stub-runner smoke (`tests/smoke/review-relay-end-to-end.test.js`) and emits stub-evidence JSON files to `docs/reports/<date>-review-relay-stub-smoke-*.json`. The stub-evidence proves the **harness wiring** works end-to-end; only the live probe proves the **real-binary integration** works.

A complete LV round closes BOTH:
- CI smoke green (in-process stub) — proves wiring
- Live probe green (real binaries) — proves integration
- Evidence files written for both
- Audit chain hashes verify

---

## 8. Related docs

- `tests/smoke/review-relay-end-to-end.test.js` — CI-runnable stub smoke
- `tests/integration/review-relay-spawn.test.js` — fake-runner unit-style integration
- `docs/reports/<date>-review-relay-live-verification.md` — evidence report
- `~/.claude/plans/swift-waddling-hanrahan.md` Part R — round plan
