# scripts/setup-wizard.ps1 — Slice D2-d (Phase E1.5, 2026-04-29)
#
# Thin PowerShell wrapper around scripts/setup-wizard.js. Operators on
# Windows discover this .ps1 file naturally; the actual interactive
# logic lives in the Node script (see comment at top of setup-wizard.js
# for design rationale).
#
# Usage:
#   .\scripts\setup-wizard.ps1               # standard track (default)
#   .\scripts\setup-wizard.ps1 --public-sector
#   .\scripts\setup-wizard.ps1 --help

$ErrorActionPreference = "Stop"

# Resolve to the .js sibling — works whether invoked via . sourcing,
# absolute path, or PSScriptRoot fallback.
$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$wizardPath = Join-Path $scriptDir "setup-wizard.js"

if (-not (Test-Path $wizardPath)) {
  Write-Host "error: setup-wizard.js not found at $wizardPath" -ForegroundColor Red
  exit 2
}

# Minimum Node check. setup-wizard.js itself ALSO checks via the server
# probe-node endpoint, but we fail-fast here so the operator gets an
# actionable message even if they haven't started the server yet.
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "error: Node.js not found on PATH. Install Node 24+ from https://nodejs.org/" -ForegroundColor Red
  exit 2
}

# Hand off to the Node wizard. All args (--standard, --public-sector,
# --tier3, --no-prompt, --base-url, --token, --help) pass through.
& node $wizardPath @args
exit $LASTEXITCODE
