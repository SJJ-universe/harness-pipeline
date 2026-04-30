#!/usr/bin/env bash
# Slice LV-2 (Phase D / Phase E1.5, 2026-04-30) — bash wrapper for
# live-verify-review-relay.js. Resolves the sibling .js, sanity-
# checks Node, and passes through all flags.
#
# Usage:
#   ./scripts/live-verify-review-relay.sh [--base URL] [--label STR]
#                                         [--with-followup] [--with-handback]
#                                         [--posture standard|public-sector]
#                                         [--timeout-ms N] [--quiet] [--json]
#
# Examples:
#   # Standard posture, full chain (Codex → Claude hand-back)
#   ./scripts/live-verify-review-relay.sh --with-followup --with-handback
#
#   # Public-sector posture, expect 409 on hand-back
#   ./scripts/live-verify-review-relay.sh --posture public-sector
#
#   # Quiet JSON output for CI / scripting
#   ./scripts/live-verify-review-relay.sh --json
#
# Exit codes:
#   0  PASS
#   1  FAIL (evidence still emitted)
#   2  CONFIG (server unreachable / Node missing)

set -euo pipefail

# Sanity check: Node 18+
if ! command -v node > /dev/null 2>&1; then
  echo "ERROR: node not found in PATH. Install Node 24+ and retry." >&2
  exit 2
fi

NODE_VER="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "${NODE_VER}" -lt 18 ] 2>/dev/null; then
  echo "ERROR: Node ${NODE_VER} detected; this probe needs Node 18+ (uses globalThis.fetch)." >&2
  exit 2
fi

# Resolve sibling .js
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROBE_JS="${SCRIPT_DIR}/live-verify-review-relay.js"
if [ ! -f "${PROBE_JS}" ]; then
  echo "ERROR: probe script not found at ${PROBE_JS}" >&2
  exit 2
fi

# Pass all args through to the JS entry point
exec node "${PROBE_JS}" "$@"
