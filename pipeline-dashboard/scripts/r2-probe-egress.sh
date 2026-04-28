#!/usr/bin/env bash
# Slice R2-4 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Egress strict-mode probe. Run AFTER bringing up the harness with the
# strict override:
#
#   docker compose \
#     -f docker-compose.r2-single-runner.yml \
#     -f docker-compose.r2-strict.override.yml \
#     up -d orchestrator runner probe
#
# Then:
#
#   ./scripts/r2-probe-egress.sh          # 4-target probe + summary
#
# The probe exercises four MG1 §7-relevant blast radii from inside the
# alpine sidecar (which sits on the same internal-only bridge as the
# runner):
#
#   1. 169.254.169.254          — cloud-metadata IP (must NOT be reachable)
#   2. 10.0.0.1                 — RFC1918 peer (no route off the bridge)
#   3. 172.16.0.1               — RFC1918 peer
#   4. 192.168.1.1              — RFC1918 peer
#   5. www.google.com           — DNS-dependent public host
#   6. orchestrator:4201        — same-bridge peer; MUST succeed (control)
#
# Each probe gets ~2s. The script reports BLOCK / ALLOW per target. With
# `internal: true` on the bridge, expect:
#
#   - Targets 1-5 BLOCK (no NAT to host's default gateway / no DNS)
#   - Target 6 ALLOW (intra-bridge traffic still works)
#
# Anything else is a misconfiguration. Exit 0 iff the expected pattern
# holds.

set -euo pipefail

PROBE=harness-probe-r2

if ! docker ps --format '{{.Names}}' | grep -q "^$PROBE$"; then
  echo "[r2-probe] $PROBE container not running." >&2
  echo "[r2-probe] bring up the harness with the strict override first:" >&2
  echo "    docker compose \\" >&2
  echo "      -f docker-compose.r2-single-runner.yml \\" >&2
  echo "      -f docker-compose.r2-strict.override.yml \\" >&2
  echo "      up -d orchestrator runner probe" >&2
  exit 64
fi

# Wrap docker exec so MSYS path conversion doesn't mangle absolute
# container paths on Git-Bash. (See r2-eval.sh for the same trick.)
docker_exec() {
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker exec "$@"
}

# A single probe attempt. Returns 0 if reachable, non-zero if blocked.
# Stdout: status text. Stderr: details (kept inside the function — we
# inspect the captured combined output).
probe_one() {
  local label="$1"
  local target="$2"
  local should_succeed="$3"   # "yes" | "no"

  # `wget --timeout=2 -q -O- ... 2>&1` collapses stderr into stdout so we
  # can pattern-match. busybox wget exits non-zero on any error; success
  # exits 0. We don't need the body, only the verdict.
  local out exit_code
  if out=$(docker_exec "$PROBE" wget --timeout=2 -q -O- "$target" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  local verdict
  if [[ "$exit_code" == "0" ]]; then verdict="ALLOW"; else verdict="BLOCK"; fi

  local expected pass_state
  if [[ "$should_succeed" == "yes" ]]; then expected="ALLOW"; else expected="BLOCK"; fi
  if [[ "$verdict" == "$expected" ]]; then pass_state="PASS"; else pass_state="FAIL"; fi

  printf '  [%s] %-32s -> %-5s (expected %s)\n' "$pass_state" "$label" "$verdict" "$expected"
  # First line of the wget message helps explain why it blocked.
  local first_line="$(printf '%s' "$out" | head -1)"
  if [[ -n "$first_line" ]] && [[ "$verdict" == "BLOCK" ]]; then
    printf '          %s\n' "$first_line"
  fi
  [[ "$pass_state" == "PASS" ]]
}

echo "[r2-probe] running egress probes from $PROBE (alpine sidecar in the strict-mode bridge)..."
echo

pass=0
fail=0
run_probe() {
  if probe_one "$@"; then
    pass=$(( pass + 1 ))
  else
    fail=$(( fail + 1 ))
  fi
}

# Cloud-metadata + RFC1918 + public host: all should be BLOCKED.
run_probe "169.254.169.254 (cloud-metadata)" "http://169.254.169.254/" "no"
run_probe "10.0.0.1 (RFC1918 peer)"          "http://10.0.0.1/"        "no"
run_probe "172.16.0.1 (RFC1918 peer)"        "http://172.16.0.1/"      "no"
run_probe "192.168.1.1 (RFC1918 peer)"       "http://192.168.1.1/"     "no"
run_probe "www.google.com (DNS public)"      "http://www.google.com/"  "no"
# Intra-bridge control: must still ALLOW.
run_probe "orchestrator:4201/api/health"     "http://orchestrator:4201/api/health" "yes"

echo
echo "[r2-probe] summary: $pass pass / $fail fail"

if [[ "$fail" -gt 0 ]]; then
  echo "[r2-probe] strict egress containment is NOT clean — review failures above." >&2
  exit 1
fi
echo "[r2-probe] strict egress containment verified (G3 layer-1 evidence captured)."
