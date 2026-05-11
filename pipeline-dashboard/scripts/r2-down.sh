#!/usr/bin/env bash
# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# Tear down the R2 single-runner harness. By default keeps the
# r2-evidence volume so the audit chain survives. Pass `--clean` to
# remove the volume too.
#
# Usage:
#   ./scripts/r2-down.sh           # stop + remove containers, keep volume
#   ./scripts/r2-down.sh --clean   # also delete the evidence volume

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.r2-single-runner.yml"
ENV_FILE="$REPO_ROOT/.env.r2"

# Compose still validates `${VAR:?msg}` references on `down`, so we have
# to populate them. If .env.r2 has been deleted (operator pruned it
# already), fall back to dummy values just to satisfy interpolation —
# the values aren't actually used at down-time.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
export ORCHESTRATOR_TOKEN="${ORCHESTRATOR_TOKEN:-down-only-noop}"
export RUNNER_BOOTSTRAP_TOKEN="${RUNNER_BOOTSTRAP_TOKEN:-down-only-noop}"
export ORCHESTRATOR_RUN_JWT="${ORCHESTRATOR_RUN_JWT:-down-only-noop}"
export ORCHESTRATOR_HOST_IDENTITY="${ORCHESTRATOR_HOST_IDENTITY:-runner-r2-001}"
export ORCHESTRATOR_RUN_ID="${ORCHESTRATOR_RUN_ID:-rr-r2-eval-001}"

CLEAN_VOLUMES=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_VOLUMES=true ;;
    -h|--help)
      echo "Usage: $0 [--clean]"
      echo "  --clean   Also delete the harness-r2-evidence Docker volume."
      exit 0 ;;
    *) echo "[r2-down] unknown flag: $arg" >&2; exit 64 ;;
  esac
done

# Cover both the default profile and the probe profile so an active probe
# container also gets reaped.
echo "[r2-down] stopping containers (all profiles)…"
docker compose -f "$COMPOSE_FILE" --profile probe down --remove-orphans

if [[ "$CLEAN_VOLUMES" == "true" ]]; then
  echo "[r2-down] removing evidence volume harness-r2-evidence…"
  docker volume rm harness-r2-evidence 2>/dev/null || \
    echo "[r2-down] (volume already absent)"
fi

echo "[r2-down] OK"
