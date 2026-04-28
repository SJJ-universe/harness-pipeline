#!/usr/bin/env bash
# Slice R1-f (Phase D R1, 2026-04-28) — harness-runner image build script.
#
# Usage:
#
#   ./scripts/build-runner.sh                 # build + SBOM
#   ./scripts/build-runner.sh --no-sbom       # build only
#
# Outputs (working dir = pipeline-dashboard):
#
#   harness-runner:<sha>          local Docker image tag
#   sbom.cyclonedx.json           CycloneDX 1.5 SBOM (unless --no-sbom)
#
# Env overrides:
#
#   HARNESS_RUNNER_TAG            override the image:tag
#
# Cosign signing (R3+ requirement per MG1 §2) is intentionally omitted
# here. R1 is opt-in for image signing — operators wanting it should
# wrap this script.

set -euo pipefail

# Resolve to the pipeline-dashboard root regardless of where the script is
# invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'dirty')"
IMAGE_TAG="${HARNESS_RUNNER_TAG:-harness-runner:$GIT_SHA}"

EMIT_SBOM=1
for arg in "$@"; do
  case "$arg" in
    --no-sbom) EMIT_SBOM=0 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

echo "[build-runner] Building $IMAGE_TAG..."
docker build -f Dockerfile.runner -t "$IMAGE_TAG" .

if [ "$EMIT_SBOM" -eq 1 ]; then
  echo "[build-runner] Generating SBOM (CycloneDX 1.5, --omit=dev)..."
  npm sbom --sbom-format=cyclonedx-1.5 --omit=dev > sbom.cyclonedx.json
  echo "[build-runner] SBOM written to sbom.cyclonedx.json"
fi

echo "[build-runner] Done: $IMAGE_TAG"
