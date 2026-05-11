# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-up.sh. Behaviour matches the bash
# version 1:1; see r2-up.sh for the full prose.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env.r2'
$ComposeFile = Join-Path $RepoRoot 'docker-compose.r2-single-runner.yml'

if (-not (Test-Path $EnvFile)) {
    Write-Error "[r2-up] missing $EnvFile - copy .env.r2.example to .env.r2 and edit it"
    exit 64
}
if (-not (Test-Path $ComposeFile)) {
    Write-Error "[r2-up] missing $ComposeFile - repo state corrupt?"
    exit 64
}

# Load .env.r2 into the current process env. Each KEY=VALUE line is
# parsed and exported. Lines starting with # are skipped.
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        $name = $Matches[1]
        $value = $Matches[2]
        # Strip optional surrounding double quotes (matches bash `source`).
        if ($value -match '^"(.*)"$') { $value = $Matches[1] }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

# Validate required values.
function Require-RealValue {
    param([string]$Name)
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrEmpty($value)) {
        Write-Error "[r2-up] $Name is empty in $EnvFile"
        exit 78
    }
    if ($value.StartsWith('change-me')) {
        Write-Error "[r2-up] $Name still has the change-me placeholder - replace it in $EnvFile"
        exit 78
    }
}
Require-RealValue 'ORCHESTRATOR_TOKEN'
Require-RealValue 'RUNNER_BOOTSTRAP_TOKEN'
Require-RealValue 'ORCHESTRATOR_HOST_IDENTITY'
Require-RealValue 'ORCHESTRATOR_RUN_ID'

Write-Host "[r2-up] minting ORCHESTRATOR_RUN_JWT for runId=$($env:ORCHESTRATOR_RUN_ID) hostIdentity=$($env:ORCHESTRATOR_HOST_IDENTITY)"

# Mint the per-run JWT using src/security/jwt.js. Pass values via env to
# avoid shell-injection through node -e.
$jwtScript = @'
const { issue, deriveJwtKey } = require("./src/security/jwt");
const key = deriveJwtKey(process.env.ORCHESTRATOR_TOKEN);
const token = issue({
  runId: process.env.ORCHESTRATOR_RUN_ID,
  key,
  runDurationMs: 3600000,
  harness: {
    hostIdentity: process.env.ORCHESTRATOR_HOST_IDENTITY,
    sandboxClass: process.env.ORCHESTRATOR_SANDBOX_CLASS || "container-strict",
    runOrigin: "container-remote",
  },
});
process.stdout.write(token);
'@

Push-Location $RepoRoot
try {
    $RunJwt = node -e $jwtScript 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[r2-up] failed to mint runJWT:`n$RunJwt"
        exit 70
    }
} finally {
    Pop-Location
}
$env:ORCHESTRATOR_RUN_JWT = $RunJwt
Write-Host "[r2-up] runJWT minted (length: $($RunJwt.Length))"

Write-Host "[r2-up] building orchestrator + runner images..."
docker compose -f $ComposeFile build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[r2-up] starting orchestrator + runner (probe profile NOT activated by default)..."
docker compose -f $ComposeFile up -d orchestrator runner
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[r2-up] waiting for orchestrator healthcheck..."
$deadline = (Get-Date).AddSeconds(60)
$status = ''
while ((Get-Date) -lt $deadline) {
    try {
        $status = docker inspect --format '{{.State.Health.Status}}' harness-orchestrator-r2 2>$null
    } catch { $status = '' }
    if ($status -eq 'healthy') {
        Write-Host "[r2-up] orchestrator healthy"
        break
    }
    Start-Sleep -Seconds 1
}
if ($status -ne 'healthy') {
    Write-Error "[r2-up] orchestrator did not become healthy within 60s (status=$status)"
    Write-Host "[r2-up] tail orchestrator logs:"
    docker logs --tail 30 harness-orchestrator-r2
    exit 1
}

$runnerState = docker inspect --format '{{.State.Status}}' harness-runner-r2 2>$null
Write-Host "[r2-up] runner state: $runnerState"
Write-Host "[r2-up] OK. Inspect with:"
Write-Host "    docker logs -f harness-orchestrator-r2"
Write-Host "    docker logs -f harness-runner-r2"
Write-Host "    pwsh -File scripts/r2-eval.ps1   # smoke check"
Write-Host "    pwsh -File scripts/r2-down.ps1   # tear down"
