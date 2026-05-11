#!/usr/bin/env bash
# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Bring up the R2 single-runner harness. Reads .env.r2, mints the per-run
# JWT, then `docker compose up -d`. Idempotent — running twice is fine
# (compose reuses running services).
#
# Pre-conditions:
#   - .env.r2 exists in the repo root (copy from .env.r2.example).
#   - Docker Desktop / Docker Engine is reachable on the host.
#
# Failure modes (script exits non-zero):
#   - .env.r2 missing                            → exit 64 (EX_USAGE)
#   - required env var blank                     → exit 78 (EX_CONFIG)
#   - node tool missing or jwt module load fails → exit 70 (EX_SOFTWARE)
#   - docker compose up failure                  → exit 1 (passed through)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.r2"
COMPOSE_FILE="$REPO_ROOT/docker-compose.r2-single-runner.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[r2-up] missing $ENV_FILE — copy .env.r2.example to .env.r2 and edit it" >&2
  exit 64
fi
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[r2-up] missing $COMPOSE_FILE — repo state corrupt?" >&2
  exit 64
fi

# Load .env.r2 into the shell. `set -a` exports each subsequent
# assignment so `docker compose` inherits them.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Validate required values are not blank or still placeholders.
require_real_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "[r2-up] $name is empty in $ENV_FILE" >&2
    exit 78
  fi
  if [[ "$value" == change-me* ]]; then
    echo "[r2-up] $name still has the change-me placeholder — replace it in $ENV_FILE" >&2
    exit 78
  fi
}
require_real_value ORCHESTRATOR_TOKEN
require_real_value RUNNER_BOOTSTRAP_TOKEN
require_real_value ORCHESTRATOR_HOST_IDENTITY
require_real_value ORCHESTRATOR_RUN_ID

# Mint the per-run JWT using src/security/jwt.js. Fresh on every up so a
# previous run's token can't be reused after compose restart.
echo "[r2-up] minting ORCHESTRATOR_RUN_JWT for runId=$ORCHESTRATOR_RUN_ID hostIdentity=$ORCHESTRATOR_HOST_IDENTITY"
RUN_JWT="$(cd "$REPO_ROOT" && node -e '
  const { issue, deriveJwtKey } = require("./src/security/jwt");
  const key = deriveJwtKey(process.env.ORCHESTRATOR_TOKEN);
  const token = issue({
    runId: process.env.ORCHESTRATOR_RUN_ID,
    key,
    runDurationMs: 3600000,
    harness: {
      hostIdentity: process.env.ORCHESTRATOR_HOST_IDENTITY,
      sandboxClass: process.env.ORCHESTRATOR_SANDBOX_CLASS || "container-strict",
      runOrigin: "container-remote",
    },
  });
  process.stdout.write(token);
' 2>&1)" || {
  echo "[r2-up] failed to mint runJWT:" >&2
  echo "$RUN_JWT" >&2
  exit 70
}
export ORCHESTRATOR_RUN_JWT="$RUN_JWT"
echo "[r2-up] runJWT minted (length: ${#ORCHESTRATOR_RUN_JWT})"

# Build images first so any build error surfaces clearly before `up`.
echo "[r2-up] building orchestrator + runner images…"
docker compose -f "$COMPOSE_FILE" build

echo "[r2-up] starting orchestrator + runner (probe profile NOT activated by default)…"
docker compose -f "$COMPOSE_FILE" up -d orchestrator runner

echo "[r2-up] waiting for orchestrator healthcheck…"
deadline=$(( $(date +%s) + 60 ))
while [[ $(date +%s) -lt $deadline ]]; do
  status="$(docker inspect --format '{{.State.Health.Status}}' harness-orchestrator-r2 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "[r2-up] orchestrator healthy"
    break
  fi
  sleep 1
done
if [[ "$status" != "healthy" ]]; then
  echo "[r2-up] orchestrator did not become healthy within 60s (status=$status)" >&2
  echo "[r2-up] tail orchestrator logs:" >&2
  docker logs --tail 30 harness-orchestrator-r2 >&2 || true
  exit 1
fi

echo "[r2-up] runner state: $(docker inspect --format '{{.State.Status}}' harness-runner-r2 2>/dev/null || echo missing)"
echo "[r2-up] OK. Inspect with:"
echo "    docker logs -f harness-orchestrator-r2"
echo "    docker logs -f harness-runner-r2"
echo "    ./scripts/r2-eval.sh         # smoke check"
echo "    ./scripts/r2-down.sh         # tear down"
