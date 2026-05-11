# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-down.sh.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$ComposeFile = Join-Path $RepoRoot 'docker-compose.r2-single-runner.yml'
$EnvFile = Join-Path $RepoRoot '.env.r2'

# Compose still validates ${VAR:?msg} references on `down`, so we have
# to populate them. Fall back to dummy values if .env.r2 is gone — they
# are not actually used at teardown time.
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
            $name = $Matches[1]
            $value = $Matches[2]
            if ($value -match '^"(.*)"$') { $value = $Matches[1] }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}
foreach ($pair in @(
    @('ORCHESTRATOR_TOKEN','down-only-noop'),
    @('RUNNER_BOOTSTRAP_TOKEN','down-only-noop'),
    @('ORCHESTRATOR_RUN_JWT','down-only-noop'),
    @('ORCHESTRATOR_HOST_IDENTITY','runner-r2-001'),
    @('ORCHESTRATOR_RUN_ID','rr-r2-eval-001'))) {
    if (-not [Environment]::GetEnvironmentVariable($pair[0], 'Process')) {
        [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
    }
}

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
