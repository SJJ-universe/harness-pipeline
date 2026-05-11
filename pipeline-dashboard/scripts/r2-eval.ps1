# Slice R2-1 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-eval.sh.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env.r2'

if (-not (Test-Path $EnvFile)) {
    Write-Error "[r2-eval] missing $EnvFile - bring up the harness first (pwsh -File scripts/r2-up.ps1)"
    exit 64
}

# Load .env.r2 into the current process env (matches r2-up.ps1 logic).
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

$Orch = 'harness-orchestrator-r2'
$Runner = 'harness-runner-r2'

$Pass = 0
$Fail = 0
function Report {
    param([string]$Kind, [string]$Msg)
    if ($Kind -eq 'PASS') {
        Write-Host "  [PASS] $Msg"
        $script:Pass = $script:Pass + 1
    } else {
        Write-Host "  [FAIL] $Msg" -ForegroundColor Red
        $script:Fail = $script:Fail + 1
    }
}

Write-Host "[r2-eval] running smoke checks against the R2 single-runner harness..."

# 1. Orchestrator HTTP health.
$httpStatus = '000'
try {
    $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:4201/api/health' -Method Get -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $httpStatus = [string]$resp.StatusCode
} catch {
    if ($_.Exception.Response) {
        $httpStatus = [string]$_.Exception.Response.StatusCode.value__
    }
}
if ($httpStatus -eq '200') {
    Report 'PASS' 'GET /api/health -> 200'
} else {
    Report 'FAIL' "GET /api/health -> $httpStatus (expected 200)"
}

# 2. Runner container running.
$runnerState = docker inspect --format '{{.State.Status}}' $Runner 2>$null
if (-not $runnerState) { $runnerState = 'missing' }
if ($runnerState -eq 'running') {
    Report 'PASS' 'runner container state = running'
} else {
    Report 'FAIL' "runner container state = $runnerState (expected running)"
}

# 3 + 4. Audit chain entries. See r2-eval.sh for the path rationale.
Write-Host "[r2-eval] waiting up to 30s for runner_handshake_ok + runner_ws_connected ledger entries..."
$deadline = (Get-Date).AddSeconds(30)
$handshakeLedger = '/app/runs/system/ledger.jsonl'
$wsLedger = "/app/runs/$($env:ORCHESTRATOR_RUN_ID)/ledger.jsonl"
$sawHandshake = $false
$sawWs = $false
while ((Get-Date) -lt $deadline) {
    if (-not $sawHandshake) {
        $exists = docker exec $Orch test -f $handshakeLedger 2>$null
        if ($LASTEXITCODE -eq 0) {
            $body = docker exec $Orch cat $handshakeLedger 2>$null
            if ($body -match '"type":"runner_handshake_ok"') { $sawHandshake = $true }
        }
    }
    if (-not $sawWs) {
        $exists = docker exec $Orch test -f $wsLedger 2>$null
        if ($LASTEXITCODE -eq 0) {
            $body = docker exec $Orch cat $wsLedger 2>$null
            if ($body -match '"type":"runner_ws_connected"') { $sawWs = $true }
        }
    }
    if ($sawHandshake -and $sawWs) { break }
    Start-Sleep -Seconds 2
}

if ($sawHandshake) {
    Report 'PASS' "evidence chain has runner_handshake_ok for $($env:ORCHESTRATOR_RUN_ID)"
} else {
    Report 'FAIL' "evidence chain MISSING runner_handshake_ok for $($env:ORCHESTRATOR_RUN_ID)"
}
if ($sawWs) {
    Report 'PASS' "evidence chain has runner_ws_connected for $($env:ORCHESTRATOR_RUN_ID)"
} else {
    Report 'FAIL' "evidence chain MISSING runner_ws_connected for $($env:ORCHESTRATOR_RUN_ID)"
}

Write-Host ""
Write-Host "[r2-eval] summary: $Pass pass / $Fail fail"
if ($Fail -gt 0) {
    Write-Host "[r2-eval] tail orchestrator logs:"
    docker logs --tail 30 $Orch
    Write-Host "[r2-eval] tail runner logs:"
    docker logs --tail 30 $Runner
    exit 1
}
