#!/usr/bin/env bash
# Slice FP-a (Phase 2 / FIELD-PILOT-0, 2026-05-05) — bash wrapper for
# field-pilot-status.js. Operator daily status probe.
#
# Usage:
#   ./scripts/field-pilot-status.sh [--base URL] [--evidence-dir DIR]
#                                    [--label STR] [--notes STR]
#                                    [--timeout-ms N] [--quiet] [--json]
#
# Examples:
#   # Daily check — emits docs/reports/<date>-field-pilot-status.json
#   ./scripts/field-pilot-status.sh --notes "deployed 9 AM, no incidents"
#
#   # JSON to stdout for cron logs
#   ./scripts/field-pilot-status.sh --json > /var/log/harness-pilot.log
#
#   # Day-N labeled
#   ./scripts/field-pilot-status.sh --label day-3
#
# Exit codes:
#   0  OK         — no incidents detected
#   1  DEGRADED   — review recommended (idle kill / file conflict / readiness < 18)
#   2  INCIDENT   — investigation required (chain tampering / signature fail / key rejection)
#   3  CONFIG     — server unreachable / no token

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
JS_PATH="$SCRIPT_DIR/field-pilot-status.js"

if ! command -v node >/dev/null 2>&1; then
  echo "fatal: node not found on PATH (need Node 18+)" >&2
  exit 3
fi
if [ ! -f "$JS_PATH" ]; then
  echo "fatal: $JS_PATH not found (script broken)" >&2
  exit 3
fi
NODE_VERSION_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_VERSION_MAJOR" -lt 18 ]; then
  echo "fatal: Node 18+ required (got $(node -v))" >&2
  exit 3
fi

exec node "$JS_PATH" "$@"
