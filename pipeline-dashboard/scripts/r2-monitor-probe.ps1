# Slice R2-3 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-monitor-probe.sh. Behaviour matches the
# bash version 1:1; see r2-monitor-probe.sh for full prose.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env.r2'

if (-not (Test-Path $EnvFile)) {
    Write-Error "[r2-monitor-probe] missing $EnvFile - bring up the harness first"
    exit 64
}

# Load .env.r2 into the current process env.
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
        $name = $Matches[1]; $value = $Matches[2]
        if ($value -match '^"(.*)"$') { $value = $Matches[1] }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

$Orch = 'harness-orchestrator-r2'
$Runner = 'harness-runner-r2'
$DashBase = 'http://127.0.0.1:4201'
$DashToken = $env:ORCHESTRATOR_TOKEN

$Pass = 0; $Fail = 0
function Report {
    param([string]$Kind, [string]$Msg)
    if ($Kind -eq 'PASS') { Write-Host "  [PASS] $Msg"; $script:Pass++ }
    else { Write-Host "  [FAIL] $Msg" -ForegroundColor Red; $script:Fail++ }
}

function Dashboard-Get {
    param([string]$Path)
    try {
        return (Invoke-WebRequest -Uri "$DashBase$Path" -Headers @{ 'x-harness-token' = $DashToken } -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop).Content
    } catch {
        return ''
    }
}

Write-Host "[r2-monitor-probe] verifying live monitor / auth round-trip..."
Write-Host ""

# Anchor 1: bootstrap.runners[]
$boot = Dashboard-Get '/api/monitor/bootstrap'
if (-not $boot) {
    Report 'FAIL' 'GET /api/monitor/bootstrap unreachable'
} else {
    $j = $boot | ConvertFrom-Json
    $found = $false
    foreach ($r in @($j.runners)) {
        if ($r.hostIdentity -eq $env:ORCHESTRATOR_HOST_IDENTITY) { $found = $true; break }
    }
    if ($found) {
        Report 'PASS' "/api/monitor/bootstrap.runners[] contains $($env:ORCHESTRATOR_HOST_IDENTITY)"
    } else {
        Report 'FAIL' "/api/monitor/bootstrap.runners[] missing $($env:ORCHESTRATOR_HOST_IDENTITY)"
    }
}

# Anchor 2: launch background WS probe inside runner, then observe.
Write-Host "[r2-monitor-probe] launching in-runner WS probe (15s lifetime)..."
$probeScript = @'
const { WebSocket } = require("ws");
const wsUrl = process.env.ORCHESTRATOR_ORCHESTRATOR_URL.replace(/^http/, "ws")
  + "/api/runner/events?runId=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_ID)
  + "&token=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_JWT);
const ws = new WebSocket(wsUrl);
ws.on("message", (m) => {
  try { const f = JSON.parse(m); if (f.type === "hello") {
    ws.send(JSON.stringify({ type: "agent_started", id: "r2-monitor-probe-agent",
      label: "r2-monitor-probe", agentType: "claude" }));
    ws.send(JSON.stringify({ type: "hook",
      event: { hook: "PreToolUse", tool: "Read", data: { path: "monitor-probe-trace" } } }));
  } } catch (_) {}
});
setTimeout(() => process.exit(0), 15000);
'@
docker exec -w /app -d $Runner node -e $probeScript | Out-Null
Start-Sleep -Seconds 3

# Anchor 2: activeChildren remote
$boot2 = Dashboard-Get '/api/monitor/bootstrap'
$remoteChildFound = $false
if ($boot2) {
    $j2 = $boot2 | ConvertFrom-Json
    foreach ($c in @($j2.activeChildren)) {
        if ($c.remote -eq $true -and $c.runId -eq $env:ORCHESTRATOR_RUN_ID) { $remoteChildFound = $true; break }
    }
}
if ($remoteChildFound) {
    Report 'PASS' "/api/monitor/bootstrap.activeChildren[] has remote child for $($env:ORCHESTRATOR_RUN_ID)"
} else {
    Report 'FAIL' "/api/monitor/bootstrap.activeChildren[] missing remote=true entry for $($env:ORCHESTRATOR_RUN_ID)"
}

# Anchor 3: per-run origin shape
$detail = Dashboard-Get '/api/monitor/runs/default'
$originShape = 'missing'
if ($detail) {
    $jd = $detail | ConvertFrom-Json
    if ($jd.origin) {
        $required = @('runOrigin','sandboxClass','hostIdentity')
        $missing = @()
        foreach ($k in $required) {
            if (-not $jd.origin.PSObject.Properties.Name.Contains($k)) { $missing += $k }
        }
        if ($missing.Count -eq 0) { $originShape = 'ok' } else { $originShape = "missing-$($missing -join ',')" }
    }
}
if ($originShape -eq 'ok') {
    Report 'PASS' '/api/monitor/runs/default.origin has runOrigin / sandboxClass / hostIdentity'
} else {
    Report 'FAIL' "/api/monitor/runs/default.origin shape: $originShape"
}

# Anchor 4: runner_hook_routed in ledger
Start-Sleep -Seconds 2
$ledgerHit = $null
try {
    $ledgerHit = docker exec $Orch sh -c "grep -l '\"type\":\"runner_hook_routed\"' /app/runs/*/ledger.jsonl 2>/dev/null || true"
} catch {}
if ($ledgerHit) {
    Report 'PASS' 'evidence chain has runner_hook_routed (R1-k2 forensic anchor)'
} else {
    Report 'FAIL' 'evidence chain MISSING runner_hook_routed - hook frames did not audit'
}

Write-Host ""
Write-Host "[r2-monitor-probe] summary: $Pass pass / $Fail fail"
if ($Fail -gt 0) {
    Write-Host "[r2-monitor-probe] tail orchestrator logs:"
    docker logs --tail 20 $Orch
    exit 1
}
Write-Host "[r2-monitor-probe] G5 + R1-k2 anchors verified live."
