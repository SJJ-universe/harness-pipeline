# Runbook — Field-Pilot Troubleshooting Catalog

**Slice FP-b (Phase 2 / FIELD-PILOT-0, 2026-05-05)**

This is the **shared troubleshooting catalog** for the field pilot. Operators
hit issues during the 7-day window; each new issue + workaround is appended
here so the next operator (or the next pilot) does not waste time
re-discovering the same problem.

The catalog is organized by **failure surface**, not by symptom — operators
typically know which surface they are on (install / account / timeout /
permission / network) before they know what the symptom means.

---

## How to use this catalog

1. **Before opening an incident**: skim the relevant section below. If your
   symptom matches an entry, follow the workaround.
2. **If your symptom is new**: complete the **incident ledger entry first**
   (`field-pilot-incident-ledger.md`), then add a new troubleshooting entry
   here, linked by entry-NNN anchor. The catalog is the operator-facing
   summary; the ledger is the chronological record.
3. **Do not delete entries**, even if the underlying bug is fixed. Add a
   "Status: resolved in commit X" line — the historical entry still helps
   future operators recognize the symptom.
4. Each entry includes a **safe-guidance principle**: never run an
   operator-supplied command that the operator does not understand. If
   troubleshooting requires a destructive command, the catalog tells the
   operator what the command does, where to read the docs, and lets them
   decide.

> **Privacy reminder**: when adding an entry, sanitize the symptom
> description. Replace real paths with `<install-dir>`, real usernames with
> `<operator>`, real run IDs with `<runId>`, etc.

---

## Section 1 — Installation & launcher

### 1.1 `orchestrator-start.bat` exits with code 37 (signature_missing)

**Symptom**: launcher refuses to install a fresh build.
**Likely cause**: production fail-closed gate (E3-F1) — manifest is unsigned
and the trust-store does not have the publisher key.

**Workaround (production)**:
1. Confirm the build came from a trusted source (your team's release pipeline).
2. Use `node scripts/sign-manifest.js --help` to sign the manifest with
   your team's release key (private key never enters this catalog).
3. Add the corresponding public key to the trust-store via the dashboard
   `Settings → Manifest signing keys` panel.
4. Retry `orchestrator-start.bat`.

**Workaround (dev only — DO NOT USE IN PRODUCTION)**:
- Set `ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST=1` and re-run. The launcher will
  install with a LOUD warning and emit `launcher_signature_bypass` to the
  audit chain. Public-sector pack ignores this escape — exit 37 still fires.

**Safe-guidance principle**: do not bypass the signature gate in
production. The exit 37 is fail-closed by design.

**Status**: by design, not a bug.

---

### 1.2 Launcher exits with code 38 (unknown_key_id)

**Symptom**: signed manifest, but install still refuses.
**Likely cause**: the manifest is signed by a key whose fingerprint is not
in the local trust-store.

**Workaround**:
1. Verify the key fingerprint with the publisher (out-of-band — phone,
   in-person, signed email).
2. Add the public key (DER base64) via `Settings → Manifest signing keys`.
3. Retry.

**Safe-guidance principle**: never paste a public key from chat or an
untrusted source. Verify the fingerprint with the publisher first.

---

### 1.3 `node --version` says < 24

**Symptom**: launcher refuses to start, or orchestrator server boot fails with a
syntax error.
**Likely cause**: the operator's Node is older than the minimum (24+).

**Workaround**:
- Install Node 24+ from <https://nodejs.org> (long-term support track).
- Re-open the terminal so `PATH` re-resolves.

---

### 1.4 `where codex` / `which codex` returns nothing

**Symptom**: setup wizard step `Test Codex` fails.
**Likely cause**: Codex CLI not installed or not on PATH.

**Workaround**:
- Install: `npm install -g @openai/codex`
- Verify: `codex --version`
- If `npm install -g` fails on Windows due to permission, run from an
  elevated shell once.

---

### 1.5 Setup wizard `Test Claude` returns `tier 1+2 fail`

**Symptom**: Claude CLI is installed but the wizard cannot reach the API.
**Likely cause**: missing or expired API key.

**Workaround**:
- Open `Settings → Profiles → <activeProfileId>` in the dashboard.
- Use the `Set Anthropic API key` action to (re)set the key.
- Re-run wizard `Test Claude`.

**Safe-guidance principle**: never paste an API key into a chat. The
dashboard's credential panel writes it to the OS credential store, not to
JSON.

---

## Section 2 — Account & profile

### 2.1 `claude login` opens a browser but never returns

**Symptom**: operator runs `claude login` from the orchestrator dashboard's
copy-login-command CTA, the browser opens, but the CLI never finishes.
**Likely cause**: corporate proxy intercepting the OAuth callback, or the
browser is opening on a different machine than the CLI.

**Workaround**:
1. Run `claude login` from the same machine where the orchestrator server is
   running (not over SSH or RDP).
2. If a corporate proxy is involved, ask IT to whitelist the Anthropic
   auth domains.
3. As a last resort, paste the device-code in the terminal manually.

**Safe-guidance principle**: the orchestrator's `COPY_LOGIN_COMMAND_CLAUDE` CTA
copies the command to clipboard but does not run it — by design. The
operator runs it, observes the browser, and confirms manually.

---

### 2.2 `codex auth status` says "logged in" but Codex CLI returns 401

**Symptom**: critique starts, runs ~3000 ms, then fails with a 401.
**Likely cause**: token rotated externally (e.g. someone re-issued the team's
OpenAI key) but the local CLI cache is stale.

**Workaround**:
1. `codex auth logout`
2. `codex auth login`
3. Re-run the failed review session.

---

### 2.3 Profile switch returns 409 `active_run`

**Symptom**: operator clicks `Switch profile` in the dashboard; backend
returns `active_run`.
**Likely cause**: the orchestrator blocks profile switch while a run is active
(D1 invariant).

**Workaround**:
- Wait for the active run to complete, OR cancel it via the dashboard.
- Profile switch will then succeed.

**Safe-guidance principle**: the block is intentional — credentials cannot
change mid-run because the audit chain entry would not match.

---

### 2.4 Multiple operators on one machine, each their own pilot

**Symptom**: operator A's runs show up in operator B's deployment log.
**Likely cause**: same `<install-dir>`, same audit chain.

**Workaround**:
- Each operator should use a distinct `ORCHESTRATOR_DATA_DIR` (or full install
  copy). The audit chain is per-install — there is no per-operator
  partition.
- For team pilots, prefer separate machines or separate user profiles on
  the same machine (each user gets their own `%APPDATA%`).

---

## Section 3 — Timeouts & long-running tasks

### 3.1 Codex critique killed at 30 min for idle

**Symptom**: review session in `AWAITING_CRITIQUE` state shows
`codex_killed_for_idle` in the audit chain.
**Likely cause**: RELEASE-READY-0 (RR0) idle watchdog fired — Codex was
silent for ≥ idle timeout (default 20 min for `long_run` preset).

**Workaround (case 1: critique was genuinely idle)**:
- The Codex CLI can pause when waiting on remote API rate limits. Re-run
  the critique with `--timeout-policy long_run` (already default for
  reviews).
- If the operator expects critiques > 20 min idle, switch to
  `public_sector` preset (idle limit 30 min) or set
  `ORCHESTRATOR_TIMEOUT_PRESET=public_sector`.

**Workaround (case 2: critique was producing output but operator wants
more total budget)**:
- The total timer (default 20 min for `long_run`) is separate from idle.
- Increase total: `ORCHESTRATOR_TIMEOUT_TOTAL_MS=2700000` (45 min).

**Safe-guidance principle**: do not disable the watchdog. Idle kill is the
field-pilot's first line of defense against runaway spend.

---

### 3.2 Claude hand-back fires `claude_killed_for_idle`

**Symptom**: hand-back to Claude (with critique) is killed at idle limit.
**Likely cause**: Claude was waiting on operator approval for a write tool
(R3-e) that no one approved.

**Workaround**:
- Open `Settings → Approvals` in the dashboard. There may be a pending
  approval blocking the run.
- If approvals are coming in too slow, lower the approval timeout
  (`ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS`) so the run fails fast instead of
  hanging on idle.

---

### 3.3 Long-running review session runs are correctly observed

**Symptom**: probe shows verdict `OK` even though the operator saw a 25-min
critique.
**Likely cause**: nothing — this is the intended behavior. RR0's idle
watchdog only fires when the runner is silent. Active critiques can run as
long as the total budget allows.

**Verification**:
- Look at `audit.today.byVerb.review_session_dispatch_completed` — should be
  ≥ 1 for the day.
- Look at the snapshot's `audit.anomalies` — empty means no anomalies.

---

## Section 4 — Permissions & policy gates

### 4.1 `policy_gate_blocked` fired but the operator did not expect it

**Symptom**: a tool call (Bash / Edit / Write) was blocked by `runner_hook_*`
gate; ledger entry shows `policy_gate_blocked`.
**Likely cause**: pack rule from POL-c is active. Pack `public-sector`
blocks remote write tools; `finance-high-privacy` blocks remote bash.

**Workaround**:
1. Check active pack: `curl http://127.0.0.1:4201/api/policy-packs`.
2. Read the pack's `publicSectorRequirements` (POL-c) to understand which
   gates are hard.
3. If the gate is **wrong for your context**, switch packs:
   `ORCHESTRATOR_DEPLOYMENT_PROFILE=standard` and restart.
4. Do **not** set `ORCHESTRATOR_HARD_GATES=warn` on a public-sector or
   finance-high-privacy pack — that escape is a regression for those
   packs.

**Safe-guidance principle**: gate behavior is a property of the pack. If
the gate is wrong for the work, the pack is wrong for the work.

---

### 4.2 `pii_scan_blocked` on a string the operator believes contains no PII

**Symptom**: GOV-PII deep scan blocked a prompt; operator says "but that's
not PII".
**Likely cause**: pattern false-positive — most commonly Korean RRN-shaped
digit sequences (`YYMMDD-NNNNNNN`) that are actually order numbers.

**Workaround**:
- The deep scan is intentionally conservative. If the digit sequence is
  not PII, **rephrase the prompt** to avoid the pattern (e.g. add a hyphen
  or split the digits).
- Do not disable the scan — that defeats GOV-PII guarantees.

---

## Section 5 — Network & runtime

### 5.1 `orchestrator-heartbeat` count is 0 in today's audit

**Symptom**: probe `audit.today.byVerb.harness_heartbeat` is 0; verdict may
still be `OK`.
**Likely cause**: heartbeat broadcast was not running, OR audit ledger was
filtering it.

**Workaround**:
- Check `GET /api/server/info` `runtime.uptimeMs` — if very low, the server
  was restarted recently.
- Heartbeat is informational; if all other checks pass, this is not an
  incident.

---

### 5.2 Runner WebSocket disconnects every few minutes

**Symptom**: probe shows high `runner_ws_disconnected` count.
**Likely cause**: aggressive corporate firewall idle-killing WebSocket
connections.

**Workaround**:
- Increase the runner heartbeat frequency (`ORCHESTRATOR_RUNNER_HEARTBEAT_MS`).
- If the firewall kills any connection idle for more than N seconds, set
  the heartbeat to less than N/2.

---

### 5.3 `runner_host_lost` flapping

**Symptom**: same host appears, disappears, re-appears in the runner
registry.
**Likely cause**: network instability (laptop on Wi-Fi sleep, VPN
re-connect).

**Workaround**:
- If the operator is on a laptop, prefer a wired connection during pilot
  hours.
- Do not run the pilot from a VPN that re-handshakes hourly.

---

## Section 6 — Probe & evidence

### 6.1 `field-pilot-status.js` exits 3 (CONFIG)

**Symptom**: probe cannot reach the server.
**Likely cause**: `orchestrator-start.bat` did not finish booting, OR a different
process is on port 4201.

**Workaround**:
- `curl -s http://127.0.0.1:4201/api/health` — if this fails too, the
  server is not up.
- `netstat -ano | findstr :4201` (Windows) or `lsof -i :4201` (mac/linux)
  to identify the listener.
- Restart `orchestrator-start.bat`.

---

### 6.2 Probe shows `audit.unknownVerbs` non-empty

**Symptom**: snapshot lists audit verbs that the probe does not recognize.
**Likely cause**: a new feature shipped that emits a new verb, but the
probe's `KNOWN_AUDIT_VERBS` set was not updated.

**Workaround**:
- Open `scripts/field-pilot-status.js`, find `KNOWN_AUDIT_VERBS`, add the
  new verb.
- Run `npm run test:unit -- field-pilot-status` to confirm the CLI test
  still passes.
- Add a troubleshooting entry here referencing the feature commit.

**Safe-guidance principle**: the unknown-verb signal is the field-pilot's
canary for "the orchestrator changed in a way the operator did not expect".
Treat it as an opportunity to update the ledger, not as noise.

---

## Adding a new entry

When a new troubleshooting entry is needed:

1. Pick the right section (1–6 above). If none fit, add a new top-level
   section at the bottom with a short rationale.
2. Use the **entry skeleton** below.
3. Cross-link from the incident-ledger entry that triggered the discovery.
4. Run `npm run test:unit -- field-pilot-runbooks` to confirm the
   structure check still passes.

```markdown
### N.N <short title>

**Symptom**: ...
**Likely cause**: ...

**Workaround**:
1. ...
2. ...

**Safe-guidance principle**: ... (one sentence — what NOT to do, even if it
seems faster)

**Status**: open / mitigated / resolved in commit `<sha>`
```
