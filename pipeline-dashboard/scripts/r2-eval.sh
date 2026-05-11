#!/usr/bin/env bash
# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Smoke check for the R2 single-runner harness. This does NOT replace
# the formal evaluation report (R2-6 produces that); this script just
# confirms the deployment is alive and the basic primitives work:
#
#   1. Orchestrator dashboard responds on 127.0.0.1:4201/api/health.
#   2. Runner container is running.
#   3. Orchestrator's evidence ledger contains at least one
#      runner_handshake_ok entry for the configured runId.
#   4. Orchestrator's evidence ledger contains at least one
#      runner_ws_connected entry.
#
# Pass: exit 0 + green summary line.
# Fail: exit 1 + which assertion failed.

set -euo pipefail

# Wrap `docker exec` so MSYS / Git-Bash doesn't rewrite container-side
# absolute paths (e.g. /app/runs/...) into `C:/Program Files/Git/...`.
# Setting MSYS_NO_PATHCONV globally would also break `curl` (it returns
# "client returned ERROR on write" with exit 23), so we scope it to the
# docker calls that need it.
docker_exec() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec "$@"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.r2"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[r2-eval] missing $ENV_FILE — bring up the harness first (./scripts/r2-up.sh)" >&2
  exit 64
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

ORCH=harness-orchestrator-r2
RUNNER=harness-runner-r2

pass=0
fail=0
report() {
  local kind="$1" msg="$2"
  if [[ "$kind" == "PASS" ]]; then
    echo "  [PASS] $msg"
    pass=$(( pass + 1 ))
  else
    echo "  [FAIL] $msg" >&2
    fail=$(( fail + 1 ))
  fi
}

echo "[r2-eval] running smoke checks against the R2 single-runner harness…"

# 1. Orchestrator HTTP health. Avoid the `... || echo "000"` pattern —
# under Git-Bash `set -e`, both branches can run and concatenate.
http_status="000"
if out=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:4201/api/health 2>/dev/null); then
  http_status="$out"
fi
if [[ "$http_status" == "200" ]]; then
  report PASS "GET /api/health → 200"
else
  report FAIL "GET /api/health → $http_status (expected 200)"
fi

# 2. Runner container running.
runner_state=$(docker inspect --format '{{.State.Status}}' "$RUNNER" 2>/dev/null || echo "missing")
if [[ "$runner_state" == "running" ]]; then
  report PASS "runner container state = running"
else
  report FAIL "runner container state = $runner_state (expected running)"
fi

# 3 + 4. Audit chain entries. The orchestrator stores the ledger under
# /app/runs/<runId>/ledger.jsonl (see server.js: rootDir = REPO_ROOT/runs).
# runner_handshake_ok lands under runId="system" because the route
# handler doesn't have a JWT-verdict-runId yet at handshake time.
# runner_ws_connected lands under the actual ORCHESTRATOR_RUN_ID because by
# then the WS upgrade has the verified runJWT.
# Allow a brief settle window because the WS hello frame fires after
# the orchestrator marks the connection accepted, and the ledger flushes
# asynchronously.
echo "[r2-eval] waiting up to 30s for runner_handshake_ok + runner_ws_connected ledger entries…"
deadline=$(( $(date +%s) + 30 ))
handshake_ledger="/app/runs/system/ledger.jsonl"
ws_ledger="/app/runs/${ORCHESTRATOR_RUN_ID}/ledger.jsonl"
saw_handshake=false
saw_ws=false
while [[ $(date +%s) -lt $deadline ]]; do
  if ! $saw_handshake && docker_exec "$ORCH" test -f "$handshake_ledger" 2>/dev/null; then
    if docker_exec "$ORCH" cat "$handshake_ledger" 2>/dev/null | grep -q '"type":"runner_handshake_ok"'; then
      saw_handshake=true
    fi
  fi
  if ! $saw_ws && docker_exec "$ORCH" test -f "$ws_ledger" 2>/dev/null; then
    if docker_exec "$ORCH" cat "$ws_ledger" 2>/dev/null | grep -q '"type":"runner_ws_connected"'; then
      saw_ws=true
    fi
  fi
  if $saw_handshake && $saw_ws; then break; fi
  sleep 2
done
$saw_handshake \
  && report PASS "evidence chain has runner_handshake_ok for $ORCHESTRATOR_RUN_ID" \
  || report FAIL "evidence chain MISSING runner_handshake_ok for $ORCHESTRATOR_RUN_ID"
$saw_ws \
  && report PASS "evidence chain has runner_ws_connected for $ORCHESTRATOR_RUN_ID" \
  || report FAIL "evidence chain MISSING runner_ws_connected for $ORCHESTRATOR_RUN_ID"

echo
echo "[r2-eval] summary: $pass pass / $fail fail"
if [[ "$fail" -gt 0 ]]; then
  echo "[r2-eval] tail orchestrator logs:" >&2
  docker logs --tail 30 "$ORCH" >&2 || true
  echo "[r2-eval] tail runner logs:" >&2
  docker logs --tail 30 "$RUNNER" >&2 || true
  exit 1
fi
