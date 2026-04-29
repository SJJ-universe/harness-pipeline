#!/usr/bin/env bash
# scripts/launcher/install-version.sh — Slice D0-c (Phase E1, 2026-04-29)
#
# bash counterpart to install-version.ps1. Downloads + SHA256-verifies +
# extracts a release zip into the per-user data directory. The validation
# logic itself lives in launcher-cli.js so Windows + Mac/Linux see the
# same parser, the same comparator, and the same SHA256 result.
#
# Trust scope reminder (Phase E plan §O-D0):
#   INTERNAL / PRIVATE distribution only. SHA256 trust-on-first-use only
#   proves the bytes match the manifest, not that the manifest is
#   authentic. E3 Release Hygiene adds manifest signing.
#
# Usage:
#   install-version.sh --manifest-url <url> [--data-dir <path>] [--force]
#
# Exit codes (mirror install-version.ps1):
#   30 launcher-cli.js missing                  31 manifest fetch failed
#   32 manifest schema invalid                  33 zip download failed
#   34 SHA256 mismatch (zip quarantined)         0 success

set -euo pipefail

MANIFEST_URL=""
DATA_DIR=""
FORCE=0

# Long-option-only parser. Keeping it small instead of pulling getopt
# avoids the BSD-vs-GNU getopt portability dance (macOS ships BSD; Linux
# typically GNU). Each flag advances the cursor by 2.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-url) MANIFEST_URL="$2"; shift 2 ;;
    --data-dir)     DATA_DIR="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "[install-version] unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [[ -z "$MANIFEST_URL" ]]; then
  echo "[install-version] --manifest-url is required" >&2
  exit 64
fi

# --- 1. Resolve script + cli paths ---------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_CLI="$SCRIPT_DIR/launcher-cli.js"
if [[ ! -f "$LAUNCHER_CLI" ]]; then
  echo "[install-version] launcher-cli.js not found at $LAUNCHER_CLI" >&2
  exit 30
fi

# --- 2. Resolve data dir ------------------------------------------------
if [[ -z "$DATA_DIR" ]]; then
  if [[ -n "${HARNESS_DATA_DIR:-}" ]]; then
    DATA_DIR="$HARNESS_DATA_DIR"
    echo "[install-version] DataDir from HARNESS_DATA_DIR: $DATA_DIR"
  elif [[ "$(uname)" == "Darwin" ]]; then
    DATA_DIR="$HOME/Library/Application Support/HarnessPipeline"
    echo "[install-version] DataDir default (macOS): $DATA_DIR"
  else
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/HarnessPipeline"
    echo "[install-version] DataDir default (XDG): $DATA_DIR"
  fi
fi
mkdir -p "$DATA_DIR/versions"
VERSIONS_DIR="$DATA_DIR/versions"

# --- 3. Download manifest ------------------------------------------------
TMP_DIR="$(mktemp -d -t harness-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
MANIFEST_FILE="$TMP_DIR/manifest.json"

echo "[install-version] fetching manifest: $MANIFEST_URL"
if ! curl -fsSL --connect-timeout 10 -o "$MANIFEST_FILE" "$MANIFEST_URL"; then
  echo "[install-version] manifest download failed" >&2
  exit 31
fi

# --- 4. Validate manifest schema -----------------------------------------
echo "[install-version] validating manifest schema..."
if ! node "$LAUNCHER_CLI" validate-manifest "$MANIFEST_FILE" >/dev/null; then
  echo "[install-version] manifest schema validation failed" >&2
  exit 32
fi

# Pull the version + url + sha256 fields directly via node — keeps the
# script jq-free (jq isn't installed everywhere; node always is here
# because we just verified it via Node check).
VERSION="$(node -e "process.stdout.write(require('$MANIFEST_FILE').version);")"
ZIP_URL="$(node -e "process.stdout.write(require('$MANIFEST_FILE').url);")"
EXPECTED_SHA="$(node -e "process.stdout.write(require('$MANIFEST_FILE').sha256);")"
echo "[install-version] manifest OK: version=$VERSION url=$ZIP_URL"

# --- 5. Resolve install dir + Force handling ----------------------------
INSTALL_DIR="$VERSIONS_DIR/$VERSION"
if [[ -d "$INSTALL_DIR" ]]; then
  if [[ $FORCE -eq 0 ]]; then
    echo "[install-version] version $VERSION already installed at $INSTALL_DIR (use --force to re-extract)"
  else
    echo "[install-version] --force: removing existing $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
  fi
fi

# --- 6. Download zip + verify SHA256 + extract --------------------------
if [[ ! -d "$INSTALL_DIR" ]]; then
  ZIP_FILE="$TMP_DIR/harness-pipeline-$VERSION.zip"
  echo "[install-version] downloading zip to $ZIP_FILE..."
  if ! curl -fsSL --connect-timeout 30 -o "$ZIP_FILE" "$ZIP_URL"; then
    echo "[install-version] zip download failed" >&2
    exit 33
  fi

  echo "[install-version] verifying SHA256 (expected: $EXPECTED_SHA)..."
  if ! node "$LAUNCHER_CLI" verify-sha256 "$ZIP_FILE" "$EXPECTED_SHA" >/dev/null; then
    # Quarantine the bad zip — moving instead of deleting because a
    # mismatched zip is a security signal worth retaining.
    QUARANTINE="$DATA_DIR/quarantine-$VERSION-$(date -u +%Y%m%d%H%M%S).zip"
    mv "$ZIP_FILE" "$QUARANTINE"
    echo "[install-version] SHA256 mismatch — moved zip to $QUARANTINE for forensics" >&2
    exit 34
  fi
  echo "[install-version] SHA256 verified."

  echo "[install-version] extracting to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  # Use unzip if available (most Linux distros), else `tar -xf` for the
  # zip (BSD tar handles zip on modern Mac). Decide once at runtime.
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ZIP_FILE" -d "$INSTALL_DIR"
  elif tar --version 2>/dev/null | grep -qi 'bsdtar'; then
    tar -xf "$ZIP_FILE" -C "$INSTALL_DIR"
  else
    echo "[install-version] no unzip available; install 'unzip' package and retry" >&2
    rm -rf "$INSTALL_DIR"
    exit 35
  fi

  cp "$MANIFEST_FILE" "$INSTALL_DIR/manifest.json"
fi

# --- 7. Write install marker --------------------------------------------
MARKER="$DATA_DIR/last-install.txt"
printf '%s' "$INSTALL_DIR" > "$MARKER"

echo "[install-version] done. install dir: $INSTALL_DIR"
echo "[install-version] marker written: $MARKER"
exit 0
