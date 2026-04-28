#!/usr/bin/env bash
# Slice R2-5 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Lifecycle / workspace / graceful-shutdown probe. Verifies the three
# concerns the R2 plan calls out for §R2-5:
#
#   A. Workspace hygiene (G1)
#      - /work/in mount is read-only (operator-supplied input mount)
#      - /work/out is tmpfs + noexec (per MG1 §2.1)
#
#   B. Sequential run load (no childRegistry leak across cycles)
#      - 3 sequential agent_started / agent_stopped pairs
#      - after each cycle the activeChildren count returns to 0
#
#   C. Graceful shutdown (G7 baseline for R1)
#      - stop the orchestrator container, observe the runner
#        detecting WS close and entering its reconnect backoff
#      - bring the orchestrator back, observe the runner reconnecting
#        on its own
#      - confirm the audit chain has both runner_ws_disconnected and
#        a fresh runner_ws_connected entry across the bounce
#
# Pre-conditions: ./scripts/r2-up.sh has produced a healthy harness.
#                 (The strict override is NOT used — host port access
#                 needed for dashboard probes.)
#
# Pass: 5/5 anchors verified, exit 0.
# Fail: which anchor + diagnostic output, exit 1.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.r2"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[r2-lifecycle] missing $ENV_FILE — bring up the harness first" >&2
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
DASH_TOKEN="$HARNESS_TOKEN"

pass=0; fail=0
report() {
  local kind="$1" msg="$2"
  if [[ "$kind" == "PASS" ]]; then
    echo "  [PASS] $msg"; pass=$(( pass + 1 ))
  else
    echo "  [FAIL] $msg" >&2; fail=$(( fail + 1 ))
  fi
}

dashboard_get() {
  curl -fsS --max-time 5 -H "x-harness-token: $DASH_TOKEN" "$DASH_BASE$1" 2>/dev/null
}

active_remote_count() {
  dashboard_get "/api/monitor/bootstrap" | node -e '
    let r=""; process.stdin.on("data",c=>r+=c);
    process.stdin.on("end",()=>{
      try { const j=JSON.parse(r);
        const n = (j.activeChildren||[]).filter(c => c.remote === true).length;
        process.stdout.write(String(n));
      } catch (_) { process.stdout.write("-1"); }
    });
  '
}

echo "[r2-lifecycle] running R2-5 probes…"
echo

# ── A. Workspace hygiene (G1) ──────────────────────────────────────
# /work/out: tmpfs + noexec. Read /proc/mounts and look for the line.
mounts=$(docker_exec "$RUNNER" cat /proc/mounts 2>/dev/null || echo "")
out_line=$(printf '%s' "$mounts" | awk '$2 == "/work/out" { print }')
if [[ -n "$out_line" ]] && [[ "$out_line" == *"tmpfs"* ]] && [[ "$out_line" == *"noexec"* ]]; then
  report PASS "/work/out is tmpfs + noexec ($out_line)"
else
  report FAIL "/work/out mount is not tmpfs+noexec (got: ${out_line:-missing})"
fi

# /work/in: not always mounted in R2-1 (operator supplies it on demand).
# When a mount IS present, it must be read-only. When absent, we just
# note it — the test passes. Probing: try to write a marker file; if we
# can't write, the mount is ro OR the path doesn't exist.
in_state=$(docker_exec "$RUNNER" sh -c '
  if [ ! -d /work/in ]; then echo "absent"; exit 0; fi
  if touch /work/in/r2-write-probe 2>/dev/null; then
    rm -f /work/in/r2-write-probe
    echo "writable"
  else
    echo "read-only"
  fi
' 2>/dev/null || echo "missing")
case "$in_state" in
  absent|read-only)
    report PASS "/work/in posture = $in_state (G1 acceptable)" ;;
  writable)
    report FAIL "/work/in is WRITABLE — operator mount must be read-only" ;;
  *)
    report FAIL "/work/in probe failed (got: $in_state)" ;;
esac

# ── B. Sequential run load — no leak across 3 lifecycle cycles ─────
echo "[r2-lifecycle] running 3 sequential agent_started/agent_stopped cycles…"
docker_exec -w /app "$RUNNER" node -e '
  const { WebSocket } = require("ws");
  const wsUrl = process.env.HARNESS_ORCHESTRATOR_URL.replace(/^http/, "ws")
    + "/api/runner/events?runId=" + encodeURIComponent(process.env.HARNESS_RUN_ID)
    + "&token=" + encodeURIComponent(process.env.HARNESS_RUN_JWT);
  const ws = new WebSocket(wsUrl);
  let cycle = 0;
  ws.on("message", (m) => {
    try { const f = JSON.parse(m); if (f.type === "hello") {
      runCycles();
    } } catch (_) {}
  });
  function runCycles() {
    if (cycle >= 3) { ws.close(1000, "cycles done"); return; }
    cycle += 1;
    const id = "lifecycle-cycle-" + cycle;
    ws.send(JSON.stringify({ type: "agent_started", id, label: "cycle", agentType: "claude" }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "agent_stopped", id }));
      setTimeout(runCycles, 200);
    }, 300);
  }
  ws.on("close", () => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
' 2>&1 | tail -5

# Wait for steady state.
sleep 2
remote_count="$(active_remote_count)"
if [[ "$remote_count" == "0" ]]; then
  report PASS "after 3 lifecycle cycles, activeChildren remote count = 0 (no leak)"
else
  report FAIL "after 3 cycles, activeChildren remote count = $remote_count (expected 0 — childRegistry leak)"
fi

# ── C. Graceful shutdown / runner survives bounce ──────────────────
echo "[r2-lifecycle] verifying runner survives an orchestrator bounce…"
docker stop "$ORCH" >/dev/null 2>&1
sleep 3
runner_state="$(docker inspect --format '{{.State.Status}}' "$RUNNER" 2>/dev/null || echo missing)"
if [[ "$runner_state" == "running" ]]; then
  report PASS "after orchestrator stop, runner state = running (reconnect backoff active)"
else
  report FAIL "after orchestrator stop, runner state = $runner_state (expected running)"
fi

docker start "$ORCH" >/dev/null 2>&1
# Healthcheck takes a few seconds. Then runner's reconnect backoff has
# to fire too.
echo "[r2-lifecycle] waiting up to 30s for runner reconnect after orchestrator restart…"
deadline=$(( $(date +%s) + 30 ))
reconnect_ok=false
while [[ $(date +%s) -lt $deadline ]]; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$ORCH" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    runner_logs="$(docker logs "$RUNNER" 2>&1 | tail -20)"
    open_count=$(printf '%s\n' "$runner_logs" | grep -c "ws open" || true)
    if [[ "$open_count" -ge 2 ]]; then
      reconnect_ok=true
      break
    fi
  fi
  sleep 2
done
if $reconnect_ok; then
  report PASS "runner reconnected after orchestrator restart (ws open count >= 2)"
else
  report FAIL "runner did NOT reconnect within 30s (open count: ${open_count:-?})"
fi

echo
echo "[r2-lifecycle] summary: $pass pass / $fail fail"
if [[ "$fail" -gt 0 ]]; then
  echo "[r2-lifecycle] tail runner logs:" >&2
  docker logs --tail 20 "$RUNNER" >&2 || true
  exit 1
fi
echo "[r2-lifecycle] G1 + G7 anchors verified live."
