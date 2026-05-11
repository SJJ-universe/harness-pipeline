# Slice R2.5-e (Phase D R2.5, 2026-04-28)
#
# PowerShell counterpart of r2-5-bridge-probe.sh. See bash version
# for full prose explanation of each anchor.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env.r2'

if (-not (Test-Path $EnvFile)) {
    Write-Error "[r2-5-bridge] missing $EnvFile - bring up the harness first"
    exit 64
}
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

# Verify orchestrator's runtime mode.
$runningMode = docker exec $Orch sh -c 'echo "${ORCHESTRATOR_REMOTE_BRIDGE_MODE:-unset}"' 2>$null
if (-not $runningMode) { $runningMode = 'unreachable' }
$runningMode = $runningMode.Trim()
if ($runningMode -ne 'dispatch') {
    Write-Error "[r2-5-bridge] orchestrator is running with ORCHESTRATOR_REMOTE_BRIDGE_MODE=$runningMode"
    Write-Host "[r2-5-bridge] this probe needs dispatch mode. Tear down and re-up:"
    Write-Host "    pwsh -File scripts/r2-down.ps1 --clean"
    Write-Host "    `$env:ORCHESTRATOR_REMOTE_BRIDGE_MODE='dispatch'; pwsh -File scripts/r2-up.ps1"
    exit 64
}
Write-Host "[r2-5-bridge] orchestrator confirmed at ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch"
Write-Host ""

$Pass = 0; $Fail = 0
function Report {
    param([string]$Kind, [string]$Msg)
    if ($Kind -eq 'PASS') { Write-Host "  [PASS] $Msg"; $script:Pass++ }
    else { Write-Host "  [FAIL] $Msg" -ForegroundColor Red; $script:Fail++ }
}

# Inject probe frames inside the runner container.
$probeScript = @'
const { WebSocket } = require("ws");
const wsUrl = process.env.ORCHESTRATOR_ORCHESTRATOR_URL.replace(/^http/, "ws")
  + "/api/runner/events?runId=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_ID)
  + "&token=" + encodeURIComponent(process.env.ORCHESTRATOR_RUN_JWT);
const ws = new WebSocket(wsUrl);
let helloSeen = false;
ws.on("message", (m) => {
  try { const f = JSON.parse(m); if (f.type === "hello" && !helloSeen) {
    helloSeen = true;
    ws.send(JSON.stringify({ type: "hook", event: { hook: "PreToolUse", tool: "Read",
      data: { file_path: "/work/in/r2-5-probe.txt", limit: 100 } } }));
    ws.send(JSON.stringify({ type: "hook", event: { hook: "PreToolUse", tool: "Bash",
      data: { command: "rm -rf /" } } }));
    setTimeout(() => { ws.close(1000, "probe done"); }, 500);
  } } catch (_) {}
});
ws.on("close", () => process.exit(0));
setTimeout(() => process.exit(1), 5000);
'@
Write-Host "[r2-5-bridge] launching probe inside $Runner..."
docker exec -w /app $Runner node -e $probeScript | Out-Null
Start-Sleep -Seconds 2

# Read audit chain.
$ledgerFile = "/app/runs/$($env:ORCHESTRATOR_RUN_ID)/ledger.jsonl"
$ledgerText = docker exec $Orch cat $ledgerFile 2>$null

# Anchor 1: runner_hook_dispatched
$dispatchedLine = ($ledgerText -split "`n" | Where-Object { $_ -match '"type":"runner_hook_dispatched"' }) | Select-Object -First 1
if ($dispatchedLine -and $dispatchedLine -match '"method":"([^"]*)"') {
    if ($Matches[1] -eq 'onPreTool') {
        Report 'PASS' 'audit chain has runner_hook_dispatched method=onPreTool'
    } else {
        Report 'FAIL' "runner_hook_dispatched present but method=$($Matches[1])"
    }
} else {
    Report 'FAIL' 'audit chain MISSING runner_hook_dispatched'
}

# Anchor 2: runner_hook_rejected
$rejectedLine = ($ledgerText -split "`n" | Where-Object { $_ -match '"type":"runner_hook_rejected"' }) | Select-Object -First 1
if ($rejectedLine -and $rejectedLine -match '"reason":"([^"]*)"') {
    if ($Matches[1] -eq 'tool_not_allowed') {
        Report 'PASS' 'audit chain has runner_hook_rejected reason=tool_not_allowed (Bash blocked)'
    } else {
        Report 'FAIL' "runner_hook_rejected present but reason=$($Matches[1])"
    }
} else {
    Report 'FAIL' 'audit chain MISSING runner_hook_rejected'
}

# Anchor 3: runner_hook_sanitized
if ($ledgerText -match '"type":"runner_hook_sanitized"') {
    Report 'PASS' 'audit chain has runner_hook_sanitized (dispatch precondition)'
} else {
    Report 'FAIL' 'audit chain MISSING runner_hook_sanitized'
}

# Anchor 4: HookRouter stats
try {
    $info = (Invoke-WebRequest -Uri "$DashBase/api/server/info" -Headers @{ 'x-harness-token' = $DashToken } -TimeoutSec 5 -UseBasicParsing).Content | ConvertFrom-Json
    $dispatched = ($info.hookStats.remoteHookDispatched -as [int])
    if ($dispatched -ge 1) {
        Report 'PASS' "HookRouter.stats.remoteHookDispatched = $dispatched (>=1)"
    } else {
        Report 'FAIL' "HookRouter.stats.remoteHookDispatched = $dispatched (expected >=1)"
    }
} catch {
    Report 'FAIL' 'could not GET /api/server/info to inspect HookRouter stats'
}

# Anchor 5: monitor route returns 200
$detailStatus = '000'
try {
    $resp = Invoke-WebRequest -Uri "$DashBase/api/monitor/runs/$($env:ORCHESTRATOR_RUN_ID)" -Headers @{ 'x-harness-token' = $DashToken } -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $detailStatus = [string]$resp.StatusCode
} catch {
    if ($_.Exception.Response) { $detailStatus = [string]$_.Exception.Response.StatusCode.value__ }
}
if ($detailStatus -eq '200') {
    Report 'PASS' "/api/monitor/runs/$($env:ORCHESTRATOR_RUN_ID) returns 200 (R2 known-gap closed)"
} else {
    Report 'FAIL' "/api/monitor/runs/$($env:ORCHESTRATOR_RUN_ID) returned $detailStatus"
}

Write-Host ""
Write-Host "[r2-5-bridge] summary: $Pass pass / $Fail fail"
if ($Fail -gt 0) {
    Write-Host "[r2-5-bridge] tail of audit chain:"
    Write-Host (($ledgerText -split "`n" | Select-Object -Last 10) -join "`n")
    exit 1
}
Write-Host "[r2-5-bridge] G4 dispatch leg verified live (R2.5 bridge end-to-end)."
