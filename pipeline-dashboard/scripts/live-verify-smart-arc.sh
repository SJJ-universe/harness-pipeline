#!/usr/bin/env bash
# Slice LV0-b (Phase 2 / SMART-LV-0, 2026-05-05) — bash wrapper for
# live-verify-smart-arc.js. Mirrors live-verify-review-relay.sh.
#
# Usage:
#   ./scripts/live-verify-smart-arc.sh [--base URL] [--label STR]
#                                       [--pii-instruction STR] [--clean-instruction STR]
#                                       [--preset ID] [--evidence-dir DIR]
#                                       [--timeout-ms N] [--quiet] [--json]
#
# Prerequisites:
#   Boot the harness with:
#     ORCHESTRATOR_DEPLOYMENT_PROFILE=finance-high-privacy
#     ORCHESTRATOR_HARD_GATES=1
#     ORCHESTRATOR_TOKEN=<test-token>
#     node start.js
#
# Examples:
#   # Default probe — finance-high-privacy + hard gates
#   ./scripts/live-verify-smart-arc.sh
#
#   # JSON for CI / scripting
#   ./scripts/live-verify-smart-arc.sh --json
#
#   # Custom preset
#   ./scripts/live-verify-smart-arc.sh --preset accuracy
#
# Exit codes:
#   0  PASS — all 6 SMART arc properties evidenced
#   1  FAIL — at least one property unverifiable (evidence still emitted)
#   2  CONFIG — server down / wrong env / no token

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
JS_PATH="$SCRIPT_DIR/live-verify-smart-arc.js"

if ! command -v node >/dev/null 2>&1; then
  echo "fatal: node not found on PATH (need Node 18+)" >&2
  exit 2
fi

if [ ! -f "$JS_PATH" ]; then
  echo "fatal: $JS_PATH not found (script broken)" >&2
  exit 2
fi

NODE_VERSION_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_VERSION_MAJOR" -lt 18 ]; then
  echo "fatal: Node 18+ required (got $(node -v))" >&2
  exit 2
fi

exec node "$JS_PATH" "$@"
