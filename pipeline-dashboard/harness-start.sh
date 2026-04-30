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
#   HARNESS_TRUST_STORE     - explicit trust-store.json path for the
#                             E3-F1 manifest signature gate. Falls back
#                             to HARNESS_CONFIG_DIR, OS default, or
#                             portable bundled location.
#   HARNESS_DEPLOYMENT_PROFILE=public-sector
#                             switches signature gate to fail-closed
#                             with NO escape. Public-sector ignores the
#                             dev opt-in below.
#   HARNESS_ALLOW_UNSIGNED_MANIFEST=1
#                             dev-only escape: install unsigned manifest
#                             with LOUD warning + audit
#                             launcher_signature_bypass entry. Public-
#                             sector ignores. NEVER set in production.
#
# Trust scope (per Phase E plan §O-D0 + §S-E3-F1, 2026-04-30):
#   E3-F1 promotes the install path to PRODUCTION FAIL-CLOSED. The gate
#   logic lives in scripts/launcher/install-version.sh; this launcher
#   surfaces the resolved trust-store path for boot-time visibility.

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
  # D0-e: scheme check before delegating to install-version.sh.
  if ! node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" validate-manifest-url "$HARNESS_MANIFEST_URL" >/dev/null 2>&1; then
    echo "[harness-start] HARNESS_MANIFEST_URL must use https:// (set" >&2
    echo "                HARNESS_ALLOW_INSECURE_MANIFEST_URL=1 for dev only)." >&2
    exit 15
  fi
fi

# --- 4. Installer mode: delegate to install-version.sh ------------------
if [[ "$MODE" == "installer" ]]; then
  # E3-F1-c: pre-flight visibility of the signature gate (informational).
  # The actual enforcement lives in install-version.sh; this echoes
  # the resolved posture + trust-store so the operator sees what the
  # install will demand BEFORE manifest fetch.
  POSTURE="standard"
  [[ "${HARNESS_DEPLOYMENT_PROFILE:-}" == "public-sector" ]] && POSTURE="public-sector"
  echo "[harness-start] signature gate posture: $POSTURE"
  if [[ "${HARNESS_ALLOW_UNSIGNED_MANIFEST:-}" == "1" ]]; then
    if [[ "$POSTURE" == "public-sector" ]]; then
      echo "[harness-start] WARNING: HARNESS_ALLOW_UNSIGNED_MANIFEST=1 is IGNORED under public-sector posture."
    else
      echo "[harness-start] WARNING: HARNESS_ALLOW_UNSIGNED_MANIFEST=1 set (dev escape; never use in production)."
    fi
  fi
  # Resolve trust-store path for visibility. Failure is non-fatal — the
  # gate inside install-version.sh will surface the real error.
  TRUST_RESOLVED="$(node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" resolve-trust-store-path 2>/dev/null || true)"
  if [[ -n "$TRUST_RESOLVED" ]]; then
    TRUST_INFO="$(echo "$TRUST_RESOLVED" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s);process.stdout.write(`${r.path} (source=${r.source}, exists=${r.exists})`);}catch(e){}})' 2>/dev/null || true)"
    [[ -n "$TRUST_INFO" ]] && echo "[harness-start] trust store: $TRUST_INFO"
  fi

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
  # Slice D0-e: switch from inline `node -e require(...)` to
  # `manifest-field`. Quoting-safe for install dirs with spaces and
  # shares the BOM-tolerant parsing path used by the schema validator.
  # `|| true` so a missing field doesn't abort under `set -e`; the
  # next line treats the empty string as "no minimum to enforce".
  MIN_NODE="$(node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" manifest-field "$MANIFEST_PATH" minNodeVersion 2>/dev/null || true)"
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

# D0-e: verify-health discriminates "HarnessPipeline is running" from
# "some unrelated service squatted port 4201". Without this check, an
# arbitrary HTTP-200 responder would let the launcher open the browser
# at someone else's app.
if node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" verify-health "$HEALTH_URL/api/health" >/dev/null 2>&1; then
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
  # D0-e: poll verify-health (not raw curl) so we wait until the
  # response identifies as HarnessPipeline. Random services that boot
  # faster on port 4201 won't satisfy this and won't make us declare
  # success early.
  if node "$SCRIPT_DIR/scripts/launcher/launcher-cli.js" verify-health "$HEALTH_URL/api/health" >/dev/null 2>&1; then
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
