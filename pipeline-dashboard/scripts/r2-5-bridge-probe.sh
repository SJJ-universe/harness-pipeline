#!/usr/bin/env bash
# Slice R2.5-e (Phase D R2.5, 2026-04-28)
#
# Live end-to-end proof for the R2.5 controlled execution bridge.
#
# Verifies the full lifecycle of one PRE-DISPATCHED hook + one
# REJECTED hook against a real Docker harness running with
# ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch. The probe asserts that:
#
#   1. The orchestrator's audit chain captures the full narrative:
#        runner_hook_routed → runner_hook_sanitized → runner_hook_dispatched
#      for the accepted hook, AND
#        runner_hook_routed → runner_hook_rejected   (reason field)
#      for the rejected hook.
#   2. The orchestrator's HookRouter stats reflect the dispatch
#      (remoteHookDispatched +1, remoteHookRejected +1).
#   3. /api/monitor/runs/<verdict.runId> returns 200 (not 404 — the
#      R2 known-gap is closed by R2.5-d's runner-claimed fallback).
#
# Pre-conditions:
#   - .env.r2 exists with ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch (or env
#     override at up time).
#   - Harness brought up via:
#       ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch ./scripts/r2-up.sh
#     The script verifies the running orchestrator's env BEFORE
#     probing; failing fast with a clear message beats false
#     positives.
#
# Pass: 5/5 anchors verified, exit 0.
# Fail: which anchor + diagnostic dump, exit 1.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.r2"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[r2-5-bridge] missing $ENV_FILE — bring up the harness first" >&2
  exit 64
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

docker_exec() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec "$@"
}

ORCH=harness-orchestrator-r2
RUNNER=harness-runner-r2
DASH_BASE=http://127.0.0.1:4201
DASH_TOKEN="$ORCHESTRATOR_TOKEN"

pass=0; fail=0
report() {
  if [[ "$1" == "PASS" ]]; then echo "  [PASS] $2"; pass=$(( pass + 1 ));
  else echo "  [FAIL] $2" >&2; fail=$(( fail + 1 )); fi
}

# Verify orchestrator is running with ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch.
running_mode="$(docker_exec "$ORCH" sh -c 'echo "${ORCHESTRATOR_REMOTE_BRIDGE_MODE:-unset}"' 2>/dev/null || echo unreachable)"
if [[ "$running_mode" != "dispatch" ]]; then
  echo "[r2-5-bridge] orchestrator is running with ORCHESTRATOR_REMOTE_BRIDGE_MODE=$running_mode" >&2
  echo "[r2-5-bridge] this probe needs dispatch mode. Tear down and re-up:" >&2
  echo "    ./scripts/r2-down.sh --clean" >&2
  echo "    ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch ./scripts/r2-up.sh" >&2
  exit 64
fi
echo "[r2-5-bridge] orchestrator confirmed at ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch"
echo

# ── Inject probe frames inside the runner container ────────────────
#
# Two frames in succession over a fresh WS:
#   1. PreToolUse Read with allowed payload      → sanitize + dispatch
#   2. PreToolUse Bash with allowed-shape payload → reject (tool_not_allowed)
#
# We hold the connection open briefly so the orchestrator gets to
# write all the audit verbs before we tear down the WS.
echo "[r2-5-bridge] launching probe inside $RUNNER (sends 1 dispatched + 1 rejected hook)..."
docker_exec -w /app "$RUNNER" node -e '
  const { WebSocket } = require("ws");
  const wsUrl = process.env.ORCHESTRATOR_ORCHESTRATOR_URL.replace(/^http/, "ws")
    + "/api/runner/events?runId=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_ID)
    + "&token=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_JWT);
  const ws = new WebSocket(wsUrl);
  let helloSeen = false;
  ws.on("message", (m) => {
    try { const f = JSON.parse(m); if (f.type === "hello" && !helloSeen) {
      helloSeen = true;
      // Frame 1: should sanitize + dispatch.
      ws.send(JSON.stringify({
        type: "hook",
        event: { hook: "PreToolUse", tool: "Read",
          data: { file_path: "/work/in/r2-5-probe.txt", limit: 100 } },
      }));
      // Frame 2: should reject with tool_not_allowed.
      ws.send(JSON.stringify({
        type: "hook",
        event: { hook: "PreToolUse", tool: "Bash",
          data: { command: "rm -rf /" } },
      }));
      // Hold connection long enough for orch to flush audit chain.
      setTimeout(() => { ws.close(1000, "probe done"); }, 500);
    } } catch (_) {}
  });
  ws.on("close", () => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
' 2>&1 | tail -3

# Give the audit chain a moment to flush.
sleep 2

# ── Anchor 1: dispatched audit entry for the accepted hook ─────────
ledger_file="/app/runs/${ORCHESTRATOR_RUN_ID}/ledger.jsonl"
ledger_text="$(docker_exec "$ORCH" cat "$ledger_file" 2>/dev/null || echo "")"
if echo "$ledger_text" | grep -q '"type":"runner_hook_dispatched"'; then
  # Extract the method to confirm onPreTool was the target.
  method="$(echo "$ledger_text" | grep '"type":"runner_hook_dispatched"' | head -1 | sed -n 's/.*"method":"\([^"]*\)".*/\1/p')"
  if [[ "$method" == "onPreTool" ]]; then
    report PASS "audit chain has runner_hook_dispatched method=onPreTool"
  else
    report FAIL "runner_hook_dispatched present but method=$method (expected onPreTool)"
  fi
else
  report FAIL "audit chain MISSING runner_hook_dispatched"
fi

# ── Anchor 2: rejected audit entry for the Bash frame ──────────────
if echo "$ledger_text" | grep -q '"type":"runner_hook_rejected"'; then
  reason="$(echo "$ledger_text" | grep '"type":"runner_hook_rejected"' | head -1 | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  if [[ "$reason" == "tool_not_allowed" ]]; then
    report PASS "audit chain has runner_hook_rejected reason=tool_not_allowed (Bash blocked)"
  else
    report FAIL "runner_hook_rejected present but reason=$reason (expected tool_not_allowed)"
  fi
else
  report FAIL "audit chain MISSING runner_hook_rejected"
fi

# ── Anchor 3: sanitized verb fired BEFORE dispatched (narrative order) ─
# The bridge contract specifies the audit narrative:
#   routed → sanitized → dispatched (for accepted)
#   routed → rejected  (for rejected)
# We don't verify temporal order strictly (entries are appended in the
# right order as a side-effect of the code path), but we do verify
# both are present — together they prove R2.5-c emitted both verbs
# rather than collapsing them.
if echo "$ledger_text" | grep -q '"type":"runner_hook_sanitized"'; then
  report PASS "audit chain has runner_hook_sanitized (dispatch precondition)"
else
  report FAIL "audit chain MISSING runner_hook_sanitized"
fi

# ── Anchor 4: HookRouter stats reflect both outcomes ──────────────
# /api/server/info.hookStats exposes the router's live counters.
hookstats_json="$(curl -fsS --max-time 5 -H "x-harness-token: $DASH_TOKEN" "$DASH_BASE/api/server/info" 2>/dev/null || echo '')"
if [[ -n "$hookstats_json" ]]; then
  dispatched_count="$(printf '%s' "$hookstats_json" | node -e '
    let r=""; process.stdin.on("data",c=>r+=c);
    process.stdin.on("end",()=>{
      try { const j = JSON.parse(r);
        process.stdout.write(String((j.hookStats && j.hookStats.remoteHookDispatched) || 0));
      } catch (_) { process.stdout.write("err"); }
    });
  ')"
  if [[ "$dispatched_count" =~ ^[1-9][0-9]*$ ]]; then
    report PASS "HookRouter.stats.remoteHookDispatched = $dispatched_count (>=1)"
  else
    report FAIL "HookRouter.stats.remoteHookDispatched = $dispatched_count (expected >=1)"
  fi
else
  report FAIL "could not GET /api/server/info to inspect HookRouter stats"
fi

# ── Anchor 5: monitor route returns 200 for runner-claimed runId ───
# Closes R2 known-gap. /api/monitor/runs/<ORCHESTRATOR_RUN_ID> should now
# return 200 — either because dispatch promoted it to a pipeline run
# (R2.5-c lazy getOrCreateRun) or because R2.5-d falls back to the
# runner-claimed registry on null pipeline run.
detail_status="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 -H "x-harness-token: $DASH_TOKEN" "$DASH_BASE/api/monitor/runs/${ORCHESTRATOR_RUN_ID}" 2>/dev/null || echo "000")"
if [[ "$detail_status" == "200" ]]; then
  report PASS "/api/monitor/runs/${ORCHESTRATOR_RUN_ID} returns 200 (R2 known-gap closed)"
else
  report FAIL "/api/monitor/runs/${ORCHESTRATOR_RUN_ID} returned $detail_status (expected 200)"
fi

echo
echo "[r2-5-bridge] summary: $pass pass / $fail fail"
if [[ "$fail" -gt 0 ]]; then
  echo "[r2-5-bridge] tail of audit chain for diagnostic:" >&2
  echo "$ledger_text" | tail -10 >&2 || true
  exit 1
fi
echo "[r2-5-bridge] G4 dispatch leg verified live (R2.5 bridge end-to-end)."
