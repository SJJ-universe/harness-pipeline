# Slice FP-a (Phase 2 / FIELD-PILOT-0, 2026-05-05) — PowerShell wrapper
# for field-pilot-status.js. Operator daily status probe.
#
# Usage:
#   .\scripts\field-pilot-status.ps1 [-Base URL] [-EvidenceDir DIR]
#                                     [-Label STR] [-Notes STR]
#                                     [-TimeoutMs N] [-Quiet] [-Json]
#
# Examples:
#   # Daily check
#   .\scripts\field-pilot-status.ps1 -Notes "deployed 9 AM"
#
#   # JSON to stdout
#   .\scripts\field-pilot-status.ps1 -Json
#
#   # Day-N labeled
#   .\scripts\field-pilot-status.ps1 -Label "day-3"
#
# Exit codes (passed through from field-pilot-status.js):
#   0  OK
#   1  DEGRADED
#   2  INCIDENT
#   3  CONFIG

param(
    [string]$Base,
    [string]$EvidenceDir,
    [string]$Label,
    [string]$Notes,
    [int]$TimeoutMs,
    [switch]$Quiet,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsPath = Join-Path $scriptDir "field-pilot-status.js"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Error "node not found on PATH (need Node 18+)"
    exit 3
}
if (-not (Test-Path $jsPath)) {
    Write-Error "$jsPath not found"
    exit 3
}
$nodeVersion = & node --version
$nodeMajor = [int]($nodeVersion -replace 'v', '' -split '\.')[0]
if ($nodeMajor -lt 18) {
    Write-Error "Node 18+ required (got $nodeVersion)"
    exit 3
}

$nodeArgs = @($jsPath)
if ($PSBoundParameters.ContainsKey("Base"))         { $nodeArgs += @("--base", $Base) }
if ($PSBoundParameters.ContainsKey("EvidenceDir"))  { $nodeArgs += @("--evidence-dir", $EvidenceDir) }
if ($PSBoundParameters.ContainsKey("Label"))        { $nodeArgs += @("--label", $Label) }
if ($PSBoundParameters.ContainsKey("Notes"))        { $nodeArgs += @("--notes", $Notes) }
if ($PSBoundParameters.ContainsKey("TimeoutMs"))    { $nodeArgs += @("--timeout-ms", $TimeoutMs) }
if ($Quiet) { $nodeArgs += @("--quiet") }
if ($Json)  { $nodeArgs += @("--json") }

& node @nodeArgs
exit $LASTEXITCODE
