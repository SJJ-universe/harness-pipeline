#!/usr/bin/env bash
# scripts/launcher/check-update.sh — Slice D0-c (Phase E1, 2026-04-29)
#
# bash counterpart to check-update.ps1. Notify-only update checker —
# polls a manifest URL, compares its version against the installed one,
# and prints the result. Does NOT download. Auto-update is explicit
# out-of-scope for E1 (Phase E plan §O-D0, decision #4).
#
# Usage:
#   check-update.sh --manifest-url <url> [--data-dir <path>]
#                                        [--current-version <ver>]
#                                        [--json]
#
# Exit codes:
#   0 - up to date
#   1 - update available
#   2 - error (network / manifest invalid / semver invalid)

set -euo pipefail

MANIFEST_URL=""
DATA_DIR=""
CURRENT_VERSION=""
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-url)    MANIFEST_URL="$2"; shift 2 ;;
    --data-dir)        DATA_DIR="$2"; shift 2 ;;
    --current-version) CURRENT_VERSION="$2"; shift 2 ;;
    --json)            JSON=1; shift ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "[check-update] unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$MANIFEST_URL" ]]; then
  echo "[check-update] --manifest-url is required" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_CLI="$SCRIPT_DIR/launcher-cli.js"
if [[ ! -f "$LAUNCHER_CLI" ]]; then
  echo "[check-update] launcher-cli.js not found at $LAUNCHER_CLI" >&2
  exit 2
fi

# --- 1. Resolve current version (from marker if not provided) ----------
if [[ -z "$CURRENT_VERSION" ]]; then
  if [[ -z "$DATA_DIR" ]]; then
    if [[ -n "${ORCHESTRATOR_DATA_DIR:-}" ]]; then
      DATA_DIR="$ORCHESTRATOR_DATA_DIR"
    elif [[ "$(uname)" == "Darwin" ]]; then
      DATA_DIR="$HOME/Library/Application Support/HarnessPipeline"
    else
      DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/HarnessPipeline"
    fi
  fi
  MARKER="$DATA_DIR/last-install.txt"
  if [[ -f "$MARKER" ]]; then
    INSTALL_DIR="$(cat "$MARKER")"
    CURRENT_VERSION="$(basename "$INSTALL_DIR")"
  else
    # No install marker → treat as 0.0.0 so any manifest version is "newer".
    CURRENT_VERSION="0.0.0"
  fi
fi

# --- 2. Fetch + validate manifest --------------------------------------
# Slice D0-e: enforce https:// before any network I/O.
if ! node "$LAUNCHER_CLI" validate-manifest-url "$MANIFEST_URL" 2>/dev/null; then
  if [[ $JSON -eq 1 ]]; then
    printf '{"ok":false,"error":"url_rejected"}\n'
  else
    echo "[check-update] manifest URL rejected — refusing to fetch." >&2
  fi
  exit 2
fi

TMP_DIR="$(mktemp -d -t harness-update.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
MANIFEST_FILE="$TMP_DIR/manifest.json"

if ! curl -fsSL --connect-timeout 10 -o "$MANIFEST_FILE" "$MANIFEST_URL" 2>/dev/null; then
  if [[ $JSON -eq 1 ]]; then
    printf '{"ok":false,"error":"fetch_failed"}\n'
  else
    echo "[check-update] manifest fetch failed: $MANIFEST_URL" >&2
  fi
  exit 2
fi

if ! node "$LAUNCHER_CLI" validate-manifest "$MANIFEST_FILE" >/dev/null 2>/dev/null; then
  if [[ $JSON -eq 1 ]]; then
    printf '{"ok":false,"error":"manifest_invalid"}\n'
  else
    echo "[check-update] manifest schema invalid" >&2
  fi
  exit 2
fi

# Slice D0-e: same manifest-field switch as install-version.sh — avoids
# inline `node -e require(...)` quoting fragility on paths with spaces.
LATEST_VERSION="$(node "$LAUNCHER_CLI" manifest-field "$MANIFEST_FILE" version)"
PUBLISHED_AT="$(node "$LAUNCHER_CLI" manifest-field "$MANIFEST_FILE" publishedAt)"

# --- 3. Compare semver --------------------------------------------------
# launcher-cli compare-semver prints -1/0/1 to stdout. capture as integer.
if ! CMP_OUTPUT="$(node "$LAUNCHER_CLI" compare-semver "$CURRENT_VERSION" "$LATEST_VERSION" 2>/dev/null)"; then
  if [[ $JSON -eq 1 ]]; then
    printf '{"ok":false,"error":"semver_compare_failed","current":"%s","latest":"%s"}\n' \
      "$CURRENT_VERSION" "$LATEST_VERSION"
  else
    echo "[check-update] semver compare failed (current=$CURRENT_VERSION, latest=$LATEST_VERSION)" >&2
  fi
  exit 2
fi

# --- 4. Emit result -----------------------------------------------------
if [[ "$CMP_OUTPUT" == "-1" ]]; then
  UPDATE_AVAILABLE=1
  EXIT_CODE=1
else
  UPDATE_AVAILABLE=0
  EXIT_CODE=0
fi

if [[ $JSON -eq 1 ]]; then
  printf '{"ok":true,"currentVersion":"%s","latestVersion":"%s","updateAvailable":%s,"publishedAt":"%s","manifestUrl":"%s"}\n' \
    "$CURRENT_VERSION" "$LATEST_VERSION" \
    "$([[ $UPDATE_AVAILABLE -eq 1 ]] && echo true || echo false)" \
    "$PUBLISHED_AT" "$MANIFEST_URL"
else
  echo "[check-update] current  = $CURRENT_VERSION"
  echo "[check-update] latest   = $LATEST_VERSION (published $PUBLISHED_AT)"
  if [[ $UPDATE_AVAILABLE -eq 1 ]]; then
    echo "[check-update] update available — run install-version.sh to upgrade."
  else
    echo "[check-update] up to date."
  fi
fi

exit $EXIT_CODE
