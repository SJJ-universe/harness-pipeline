# Slice LV-2 (Phase D / Phase E1.5, 2026-04-30) — PowerShell wrapper
# for live-verify-review-relay.js. Resolves the sibling .js, sanity-
# checks Node, and passes through all flags.
#
# Usage:
#   .\scripts\live-verify-review-relay.ps1 [-Base URL] [-Label STR]
#                                          [-WithFollowup] [-WithHandback]
#                                          [-Posture standard|public-sector]
#                                          [-TimeoutMs N] [-Quiet] [-Json]
#
# Examples:
#   # Standard posture, full chain (Codex → Claude hand-back)
#   .\scripts\live-verify-review-relay.ps1 -WithFollowup -WithHandback
#
#   # Public-sector posture, expect 409 on hand-back
#   .\scripts\live-verify-review-relay.ps1 -Posture public-sector
#
#   # Quiet JSON output for CI / scripting
#   .\scripts\live-verify-review-relay.ps1 -Json
#
# Exit codes (passed through from live-verify-review-relay.js):
#   0  PASS — review relay end-to-end live verified
#   1  FAIL — at least one step failed (evidence still emitted)
#   2  CONFIG — server unreachable / Node missing / etc.

[CmdletBinding()]
param(
  [string]$Base = "http://127.0.0.1:4201",
  [string]$Label = "operator-live-probe",
  [string]$Instruction = "Review the recent change for security and correctness. Use [critical] [high] [medium] [low] severity tags.",
  [switch]$WithFollowup,
  [switch]$WithHandback,
  [ValidateSet("standard", "public-sector")]
  [string]$Posture = "standard",
  [int]$TimeoutMs = 120000,
  [int]$PollMs = 1500,
  [string]$EvidenceDir,
  [switch]$Quiet,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

# Sanity check: Node 18+
$nodeVer = & node --version 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Node.js not found in PATH. Install Node 24+ and retry." -ForegroundColor Red
  exit 2
}
$major = [int]($nodeVer -replace "^v", "" -replace "\..*$", "")
if ($major -lt 18) {
  Write-Host "ERROR: Node $nodeVer detected; this probe needs Node 18+ (uses globalThis.fetch)." -ForegroundColor Red
  exit 2
}

# Resolve sibling .js
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$probeJs = Join-Path $scriptDir "live-verify-review-relay.js"
if (-not (Test-Path $probeJs)) {
  Write-Host "ERROR: probe script not found at $probeJs" -ForegroundColor Red
  exit 2
}

# Build args list for the .js entry point
$args = @(
  "--base", $Base,
  "--label", $Label,
  "--instruction", $Instruction,
  "--posture", $Posture,
  "--timeout-ms", $TimeoutMs,
  "--poll-ms", $PollMs
)
if ($WithFollowup) { $args += "--with-followup" }
if ($WithHandback) { $args += "--with-handback" }
if ($Quiet)        { $args += "--quiet" }
if ($Json)         { $args += "--json" }
if ($EvidenceDir)  { $args += @("--evidence-dir", $EvidenceDir) }

# Pass through to Node
& node $probeJs @args
exit $LASTEXITCODE
