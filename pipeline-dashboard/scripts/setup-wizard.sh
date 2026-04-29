#!/usr/bin/env bash
# scripts/setup-wizard.sh — Slice D2-d (Phase E1.5, 2026-04-29)
#
# Thin bash wrapper around scripts/setup-wizard.js. Operators on
# macOS / Linux discover this .sh file naturally; the actual interactive
# logic lives in the Node script (see comment at top of setup-wizard.js
# for design rationale).
#
# Usage:
#   ./scripts/setup-wizard.sh               # standard track (default)
#   ./scripts/setup-wizard.sh --public-sector
#   ./scripts/setup-wizard.sh --help

set -euo pipefail

# Resolve to the .js sibling regardless of invocation path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIZARD_PATH="${SCRIPT_DIR}/setup-wizard.js"

if [ ! -f "${WIZARD_PATH}" ]; then
  echo "error: setup-wizard.js not found at ${WIZARD_PATH}" >&2
  exit 2
fi

# Minimum Node check. setup-wizard.js itself ALSO checks via the server
# probe-node endpoint, but we fail-fast here so the operator gets an
# actionable message even if they haven't started the server yet.
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js not found on PATH. Install Node 24+ from https://nodejs.org/" >&2
  exit 2
fi

# Hand off to the Node wizard. All args (--standard, --public-sector,
# --tier3, --no-prompt, --base-url, --token, --help) pass through.
exec node "${WIZARD_PATH}" "$@"
