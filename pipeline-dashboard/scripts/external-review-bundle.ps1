# Slice EXR-a (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05) — PowerShell
# wrapper for external-review-bundle.js. Compile reviewer evidence
# bundle.
#
# Usage:
#   .\scripts\external-review-bundle.ps1 [-Base URL] [-OutputDir DIR]
#                                         [-Label STR] [-Notes STR]
#                                         [-TimeoutMs N] [-Quiet] [-Json]
#                                         [-Strict] [-SkipLive]
#
# Examples:
#   # Default — writes docs/external-review/<date>-external-review-bundle.json
#   .\scripts\external-review-bundle.ps1
#
#   # Offline reviewer hand-off (no live server probe)
#   .\scripts\external-review-bundle.ps1 -SkipLive -Notes "for auditor"
#
#   # JSON to stdout
#   .\scripts\external-review-bundle.ps1 -Json -SkipLive
#
# Exit codes (passed through from external-review-bundle.js):
#   0  OK
#   1  DEGRADED
#   2  INCIDENT
#   3  CONFIG

param(
    [string]$Base,
    [string]$OutputDir,
    [string]$Label,
    [string]$Notes,
    [int]$TimeoutMs,
    [switch]$Quiet,
    [switch]$Json,
    [switch]$Strict,
    [switch]$SkipLive
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$jsPath = Join-Path $scriptDir "external-review-bundle.js"

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
if ($PSBoundParameters.ContainsKey("Base"))        { $nodeArgs += @("--base", $Base) }
if ($PSBoundParameters.ContainsKey("OutputDir"))   { $nodeArgs += @("--output-dir", $OutputDir) }
if ($PSBoundParameters.ContainsKey("Label"))       { $nodeArgs += @("--label", $Label) }
if ($PSBoundParameters.ContainsKey("Notes"))       { $nodeArgs += @("--notes", $Notes) }
if ($PSBoundParameters.ContainsKey("TimeoutMs"))   { $nodeArgs += @("--timeout-ms", $TimeoutMs) }
if ($Quiet)    { $nodeArgs += @("--quiet") }
if ($Json)     { $nodeArgs += @("--json") }
if ($Strict)   { $nodeArgs += @("--strict") }
if ($SkipLive) { $nodeArgs += @("--skip-live") }

& node @nodeArgs
exit $LASTEXITCODE
