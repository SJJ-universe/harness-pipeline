#!/usr/bin/env bash
# ============================================================================
# harness-start.sh - Pipeline Dashboard Mac/Linux launcher (Phase E1, D0-c)
# ============================================================================
#
# Companion to harness-start.bat. Phase E plan §O-cross-platform: Windows is
# the 1st-class target, Mac/Linux is best-effort. The same logic still
# applies — mode detection, manifest validation via launcher-cli.js,
# health-check loop, browser auto-open — just expressed in bash.
#
# Two operating modes (mirrors the .bat):
#
#   DEV mode (server.js exists alongside this script)
#     Launch start.js directly from the script's directory. No download.
#
#   INSTALLER mode (server.js absent, HARNESS_MANIFEST_URL is set)
#     Delegate to scripts/launcher/install-version.sh. After it writes
#     the install marker, cd into the install dir and launch.
#
# Environment overrides (read directly):
#   HARNESS_DATA_DIR        - override ~/.local/share/HarnessPipeline (Linux)
#                             or ~/Library/Application Support/HarnessPipeline (Mac)
#   HARNESS_CONFIG_DIR      - override ~/.config/HarnessPipeline (Linux)
#   HARNESS_MANIFEST_URL    - source for installer mode's manifest.json
#   HARNESS_NO_BROWSER=1    - skip auto-open (CI / headless smoke)
#   HARNESS_PORT            - default 4201
#   HARNESS_HOST            - default 127.0.0.1
#
# Trust scope reminder (per Phase E plan §O-D0):
#   INTERNAL / PRIVATE distribution only. SHA256 trust-on-first-use only
#   proves the bytes match the manifest — public-release safety arrives
#   in E3 Release Hygiene with manifest signing. Until then, only run
#   release zips received via a trusted internal channel.

set -euo pipefail

# --- 1. Anchor cwd to the script's own dir -------------------------------
# Without this, `./harness-start.sh` from a parent dir would launch from
# the wrong place. `cd "$(dirname …)"` works under Bash 3.2+ (macOS ships 3.2).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- 2. Detect Node.js ---------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "[harness-start] Node.js not found on PATH." >&2
  echo "                Install Node.js 24+ from https://nodejs.org/" >&2
  exit 10
fi

NODE_VERSION="$(node --version)"
echo "[harness-start] Node $NODE_VERSION detected."

# --- 3. Choose mode ------------------------------------------------------
if [[ -f "$SCRIPT_DIR/server.js" ]]; then
  MODE="dev"
  INSTALL_DIR="$SCRIPT_DIR"
  echo "[harness-start] dev mode: launching from $SCRIPT_DIR"
else
  MODE="installer"
  echo "[harness-start] installer mode: server.js absent."
  if [[ -z "${HARNESS_MANIFEST_URL:-}" ]]; then
    echo "[harness-start] HARNESS_MANIFEST_URL not set — cannot fetch." >&2
    echo "                Either:" >&2
    echo "                  1. Re-run from a directory containing server.js, or" >&2
    echo "                  2. Set HARNESS_MANIFEST_URL=<https url> and re-run." >&2
    exit 11
  fi
fi

# --- 4. Installer mode: delegate to install-version.sh ------------------
if [[ "$MODE" == "installer" ]]; then
  bash "$SCRIPT_DIR/scripts/launcher/install-version.sh" \
    --manifest-url "$HARNESS_MANIFEST_URL"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "[harness-start] install-version.sh failed (rc=$rc) — see log above." >&2
    exit 12
  fi

  # Resolve the install marker. Using the same env-priority order as the .bat:
  # explicit HARNESS_DATA_DIR > OS default. The OS default mirrors what
  # configPaths.js resolves on this platform.
  if [[ -n "${HARNESS_DATA_DIR:-}" ]]; then
    DATA_DIR="$HARNESS_DATA_DIR"
  elif [[ "$(uname)" == "Darwin" ]]; then
    DATA_DIR="$HOME/Library/Application Support/HarnessPipeline"
  else
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/HarnessPipeline"
  fi
  MARKER="$DATA_DIR/last-install.txt"
  if [[ ! -f "$MARKER" ]]; then
    echo "[harness-start] install marker missing at $MARKER" >&2
    exit 13
  fi
  INSTALL_DIR="$(cat "$MARKER")"
  echo "[harness-start] installed at $INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# --- 5. Verify Node version meets minimum ------------------------------
MANIFEST_PATH="$INSTALL_DIR/manifest.json"
if [[ -f "$MANIFEST_PATH" ]]; then
  # Pull minNodeVersion straight via node — avoids forking jq just for
  # one field. This stays portable to systems without jq installed.
  MIN_NODE="$(node -e "process.stdout.write(require('$MANIFEST_PATH').minNodeVersion||'');")"
  if [[ -n "$MIN_NODE" ]]; then
    if ! node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" check-runtime "$NODE_VERSION" "$MIN_NODE" >/dev/null 2>&1; then
      echo "[harness-start] Node $NODE_VERSION does not satisfy minNodeVersion=$MIN_NODE" >&2
      echo "                Upgrade from https://nodejs.org/" >&2
      exit 14
    fi
  fi
fi

# --- 6. Health-check existing instance ---------------------------------
HEALTH_PORT="${HARNESS_PORT:-4201}"
HEALTH_HOST="${HARNESS_HOST:-127.0.0.1}"
HEALTH_URL="http://$HEALTH_HOST:$HEALTH_PORT"

# Helper for open-browser. Mac uses `open`, Linux uses `xdg-open`; both
# are best-effort. If neither is found, we print the URL and let the
# operator click it. Define before any call site so the early-return
# already-running branch can use it.
open_browser_or_print() {
  local url="$1"
  if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1
  else
    echo "[harness-start] open at: $url"
  fi
}

if curl -s --connect-timeout 2 "$HEALTH_URL/api/health" >/dev/null 2>&1; then
  echo "[harness-start] already running at $HEALTH_URL"
  if [[ "${HARNESS_NO_BROWSER:-0}" != "1" ]]; then
    open_browser_or_print "$HEALTH_URL" || true
  else
    echo "                HARNESS_NO_BROWSER=1 set — not opening browser."
  fi
  exit 0
fi

# --- 7. Launch supervisor (background) ----------------------------------
echo "[harness-start] starting supervisor (node start.js)..."
# `nohup … &` detaches from the controlling terminal so closing the
# launcher shell doesn't take the server with it. stdout/stderr go to
# the install dir's nohup.out — which the dashboard's logs view can tail.
nohup node start.js >> "$INSTALL_DIR/launcher.log" 2>&1 &
SUPERVISOR_PID=$!
echo "[harness-start] supervisor pid=$SUPERVISOR_PID logfile=$INSTALL_DIR/launcher.log"

# --- 8. Health-check loop (10s budget, 1s ticks) -----------------------
RETRY=0
while [[ $RETRY -lt 10 ]]; do
  sleep 1
  if curl -s --connect-timeout 2 "$HEALTH_URL/api/health" >/dev/null 2>&1; then
    echo "[harness-start] server up at $HEALTH_URL"
    if [[ "${HARNESS_NO_BROWSER:-0}" != "1" ]]; then
      open_browser_or_print "$HEALTH_URL" || true
    else
      echo "[harness-start] HARNESS_NO_BROWSER=1 — browser not opened."
    fi
    echo "[harness-start] launcher complete. Server runs in the background (pid=$SUPERVISOR_PID)."
    echo "                Stop the server from the dashboard UI or with: kill $SUPERVISOR_PID"
    exit 0
  fi
  RETRY=$((RETRY + 1))
done

echo "[harness-start] server did not respond within 10s — see $INSTALL_DIR/launcher.log" >&2
exit 20
