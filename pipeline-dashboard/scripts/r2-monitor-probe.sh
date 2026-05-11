#!/usr/bin/env bash
# Slice R2-3 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Live monitor / auth round-trip probe. Exercises the four observable
# anchors from MG1 §3 + MF1 §3.2 against the running R2 harness:
#
#   1. /api/monitor/bootstrap.runners[]      — runner registry → monitor
#                                              (G5 evidence path 1)
#   2. /api/monitor/bootstrap.activeChildren[] (remote=true entry)
#                                            — childRegistry remote
#                                              projection (G5 + readiness)
#   3. /api/monitor/runs/<defaultRunId>.origin
#                                            — envelope `origin` field
#                                              shape on a real run
#                                              (run_origin / sandbox_class
#                                              / hostIdentity)
#   4. evidenceLedger has `runner_hook_routed`
#                                            — R1-k2 audit entry lands
#                                              when hooks cross the
#                                              remote trust boundary
#                                              (forensic completeness)
#
# Usage: bring up non-strict harness first (`./scripts/r2-up.sh`), then:
#
#   ./scripts/r2-monitor-probe.sh
#
# Pass: 4/4 anchors verified, exit 0.
# Fail: which anchor failed + diagnostic output, exit 1.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.r2"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[r2-monitor-probe] missing $ENV_FILE — bring up the harness first" >&2
  exit 64
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Wrap docker exec to dodge MSYS path conversion (see r2-eval.sh).
docker_exec() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec "$@"
}

ORCH=harness-orchestrator-r2
RUNNER=harness-runner-r2
DASH_BASE=http://127.0.0.1:4201
DASH_TOKEN="$ORCHESTRATOR_TOKEN"

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
  local path="$1"
  curl -fsS --max-time 5 -H "x-harness-token: $DASH_TOKEN" "$DASH_BASE$path" 2>/dev/null
}

echo "[r2-monitor-probe] verifying live monitor / auth round-trip…"
echo

# ── Anchor 1: bootstrap.runners[] ─────────────────────────────────
boot=$(dashboard_get "/api/monitor/bootstrap" || echo "")
if [[ -z "$boot" ]]; then
  report FAIL "GET /api/monitor/bootstrap unreachable"
else
  hostFound=$(printf '%s' "$boot" | node -e '
    let r=""; process.stdin.on("data",c=>r+=c);
    process.stdin.on("end",()=>{
      try { const j = JSON.parse(r);
        const found = (j.runners||[]).some(x => x.hostIdentity === process.env.ORCHESTRATOR_HOST_IDENTITY);
        process.stdout.write(found ? "yes" : "no");
      } catch (_) { process.stdout.write("parse-error"); }
    });
  ')
  if [[ "$hostFound" == "yes" ]]; then
    report PASS "/api/monitor/bootstrap.runners[] contains $ORCHESTRATOR_HOST_IDENTITY"
  else
    report FAIL "/api/monitor/bootstrap.runners[] missing $ORCHESTRATOR_HOST_IDENTITY (got: $hostFound)"
  fi
fi

# ── Anchor 2: open a probe WS, inject agent_started + hook, observe ─
# We launch the probe in the background inside the runner container so
# the WS stays open while the dashboard query runs. Kill at the end.
echo "[r2-monitor-probe] launching in-runner WS probe (15s lifetime)…"
docker_exec -w /app -d "$RUNNER" node -e '
  const { WebSocket } = require("ws");
  const wsUrl = process.env.ORCHESTRATOR_ORCHESTRATOR_URL.replace(/^http/, "ws")
    + "/api/runner/events?runId=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_ID)
    + "&token=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_JWT);
  const ws = new WebSocket(wsUrl);
  ws.on("message", (m) => {
    try { const f = JSON.parse(m); if (f.type === "hello") {
      ws.send(JSON.stringify({ type: "agent_started", id: "r2-monitor-probe-agent",
        label: "r2-monitor-probe", agentType: "claude" }));
      ws.send(JSON.stringify({ type: "hook",
        event: { hook: "PreToolUse", tool: "Read", data: { path: "monitor-probe-trace" } } }));
    } } catch (_) {}
  });
  setTimeout(() => process.exit(0), 15000);
' >/dev/null 2>&1 || true
# Give the server a moment to hydrate.
sleep 3

# Anchor 2: activeChildren[] has remote=true entry.
boot2=$(dashboard_get "/api/monitor/bootstrap" || echo "")
remoteChildFound=$(printf '%s' "$boot2" | node -e '
  let r=""; process.stdin.on("data",c=>r+=c);
  process.stdin.on("end",()=>{
    try { const j = JSON.parse(r);
      const found = (j.activeChildren||[]).some(c => c.remote === true && c.runId === process.env.ORCHESTRATOR_RUN_ID);
      process.stdout.write(found ? "yes" : "no");
    } catch (_) { process.stdout.write("parse-error"); }
  });
')
if [[ "$remoteChildFound" == "yes" ]]; then
  report PASS "/api/monitor/bootstrap.activeChildren[] has remote child for $ORCHESTRATOR_RUN_ID"
else
  report FAIL "/api/monitor/bootstrap.activeChildren[] missing remote=true entry for $ORCHESTRATOR_RUN_ID"
fi

# ── Anchor 3: per-run detail.origin ─────────────────────────────────
# Use "default" because R1's transport-only runner doesn't auto-create a
# pipeline run, so /api/monitor/runs/<runner-runId> returns 404. The
# `default` run is the orchestrator's own run and exposes the envelope
# `origin` shape we want to lock here.
detail=$(dashboard_get "/api/monitor/runs/default" || echo "")
originShape=$(printf '%s' "$detail" | node -e '
  let r=""; process.stdin.on("data",c=>r+=c);
  process.stdin.on("end",()=>{
    try { const j = JSON.parse(r);
      const o = j.origin;
      if (!o || typeof o !== "object") { process.stdout.write("missing"); return; }
      const required = ["runOrigin","sandboxClass","hostIdentity"];
      const missing = required.filter(k => !(k in o));
      process.stdout.write(missing.length ? "missing-" + missing.join(",") : "ok");
    } catch (_) { process.stdout.write("parse-error"); }
  });
')
if [[ "$originShape" == "ok" ]]; then
  report PASS "/api/monitor/runs/default.origin has runOrigin / sandboxClass / hostIdentity"
else
  report FAIL "/api/monitor/runs/default.origin shape: $originShape"
fi

# ── Anchor 4: runner_hook_routed in evidence ledger ─────────────────
sleep 2  # let the ledger flush
ledgerHit=$(docker_exec "$ORCH" sh -c "grep -l '\"type\":\"runner_hook_routed\"' /app/runs/*/ledger.jsonl 2>/dev/null || true")
if [[ -n "$ledgerHit" ]]; then
  report PASS "evidence chain has runner_hook_routed (R1-k2 forensic anchor)"
else
  report FAIL "evidence chain MISSING runner_hook_routed — hook frames did not audit"
fi

echo
echo "[r2-monitor-probe] summary: $pass pass / $fail fail"

if [[ "$fail" -gt 0 ]]; then
  echo "[r2-monitor-probe] tail orchestrator logs:" >&2
  docker logs --tail 20 "$ORCH" >&2 || true
  exit 1
fi
echo "[r2-monitor-probe] G5 + R1-k2 anchors verified live."
