# Slice LV0-b (Phase 2 / SMART-LV-0, 2026-05-05) — PowerShell wrapper
# for live-verify-smart-arc.js. Mirrors live-verify-review-relay.ps1.
#
# Usage:
#   .\scripts\live-verify-smart-arc.ps1 [-Base URL] [-Label STR]
#                                        [-PiiInstruction STR] [-CleanInstruction STR]
#                                        [-Preset ID] [-EvidenceDir DIR]
#                                        [-TimeoutMs N] [-Quiet] [-Json]
#
# Prerequisites:
#   Boot the harness with:
#     $env:HARNESS_DEPLOYMENT_PROFILE = "finance-high-privacy"
#     $env:HARNESS_HARD_GATES = "1"
#     $env:HARNESS_TOKEN = "<test-token>"
#     node start.js
#
# Examples:
#   # Default probe
#   .\scripts\live-verify-smart-arc.ps1
#
#   # JSON for CI / scripting
#   .\scripts\live-verify-smart-arc.ps1 -Json
#
#   # Custom preset
#   .\scripts\live-verify-smart-arc.ps1 -Preset accuracy
#
# Exit codes (passed through from live-verify-smart-arc.js):
#   0  PASS — all 6 SMART arc properties evidenced
#   1  FAIL — at least one property unverifiable
#   2  CONFIG — server down / wrong env / no token

param(
    [string]$Base,
    [string]$Label,
    [string]$PiiInstruction,
    [string]$CleanInstruction,
    [string]$Preset,
    [string]$EvidenceDir,
    [int]$TimeoutMs,
    [switch]$Quiet,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsPath = Join-Path $scriptDir "live-verify-smart-arc.js"

# Sanity checks
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "node not found on PATH (need Node 18+)"
    exit 2
}
if (-not (Test-Path $jsPath)) {
    Write-Error "$jsPath not found (script broken)"
    exit 2
}

$nodeVersion = & node --version
$nodeMajor = [int]($nodeVersion -replace 'v', '' -split '\.')[0]
if ($nodeMajor -lt 18) {
    Write-Error "Node 18+ required (got $nodeVersion)"
    exit 2
}

# Translate PowerShell named params → CLI flags for the JS probe
$nodeArgs = @($jsPath)
if ($PSBoundParameters.ContainsKey("Base"))             { $nodeArgs += @("--base", $Base) }
if ($PSBoundParameters.ContainsKey("Label"))            { $nodeArgs += @("--label", $Label) }
if ($PSBoundParameters.ContainsKey("PiiInstruction"))   { $nodeArgs += @("--pii-instruction", $PiiInstruction) }
if ($PSBoundParameters.ContainsKey("CleanInstruction")) { $nodeArgs += @("--clean-instruction", $CleanInstruction) }
if ($PSBoundParameters.ContainsKey("Preset"))           { $nodeArgs += @("--preset", $Preset) }
if ($PSBoundParameters.ContainsKey("EvidenceDir"))      { $nodeArgs += @("--evidence-dir", $EvidenceDir) }
if ($PSBoundParameters.ContainsKey("TimeoutMs"))        { $nodeArgs += @("--timeout-ms", $TimeoutMs) }
if ($Quiet) { $nodeArgs += @("--quiet") }
if ($Json)  { $nodeArgs += @("--json") }

& node @nodeArgs
exit $LASTEXITCODE
