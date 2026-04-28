# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-down.sh.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ComposeFile = Join-Path $RepoRoot 'docker-compose.r2-single-runner.yml'

$CleanVolumes = $false
foreach ($arg in $args) {
    switch ($arg) {
        '--clean' { $CleanVolumes = $true }
        '-h'      { Write-Host "Usage: pwsh -File scripts/r2-down.ps1 [--clean]"; exit 0 }
        '--help'  { Write-Host "Usage: pwsh -File scripts/r2-down.ps1 [--clean]"; exit 0 }
        default   { Write-Error "[r2-down] unknown flag: $arg"; exit 64 }
    }
}

Write-Host "[r2-down] stopping containers (all profiles)..."
docker compose -f $ComposeFile --profile probe down --remove-orphans

if ($CleanVolumes) {
    Write-Host "[r2-down] removing evidence volume harness-r2-evidence..."
    $existed = docker volume rm harness-r2-evidence 2>$null
    if (-not $existed) {
        Write-Host "[r2-down] (volume already absent)"
    }
}

Write-Host "[r2-down] OK"
