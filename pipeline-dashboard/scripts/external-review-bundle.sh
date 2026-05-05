#!/usr/bin/env bash
# Slice EXR-a (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05) — bash wrapper
# for external-review-bundle.js. Compile reviewer evidence bundle.
#
# Usage:
#   ./scripts/external-review-bundle.sh [--base URL] [--output-dir DIR]
#                                       [--label STR] [--notes STR]
#                                       [--timeout-ms N] [--quiet]
#                                       [--json] [--strict] [--skip-live]
#
# Examples:
#   # Default — emits docs/external-review/<date>-external-review-bundle.json
#   ./scripts/external-review-bundle.sh
#
#   # Offline reviewer hand-off (no live server probe)
#   ./scripts/external-review-bundle.sh --skip-live --notes "for auditor"
#
#   # Strict mode — fail loudly if any artifact missing
#   ./scripts/external-review-bundle.sh --strict
#
#   # JSON to stdout for pipelines
#   ./scripts/external-review-bundle.sh --json --skip-live
#
# Exit codes:
#   0  OK         — repo clean, scorecard parseable, ≥4 closeouts, live green
#   1  DEGRADED   — uncommitted work, fewer closeouts, or live readiness < cap
#   2  INCIDENT   — audit chain integrity FAILED, scorecard parse FAILED
#   3  CONFIG     — scorecard.md / readiness-rubric.md missing, not a git repo

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
JS_PATH="$SCRIPT_DIR/external-review-bundle.js"

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
