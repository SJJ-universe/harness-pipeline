# Slice R2-5 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-lifecycle-probe.sh. See the bash version
# for the full prose explanation of each anchor.

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvFile = Join-Path $RepoRoot '.env.r2'

if (-not (Test-Path $EnvFile)) {
    Write-Error "[r2-lifecycle] missing $EnvFile - bring up the harness first"
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
$DashToken = $env:HARNESS_TOKEN

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
    } catch { return '' }
}
function Active-Remote-Count {
    $body = Dashboard-Get '/api/monitor/bootstrap'
    if (-not $body) { return -1 }
    try {
        $j = $body | ConvertFrom-Json
        return @($j.activeChildren | Where-Object { $_.remote -eq $true }).Count
    } catch { return -1 }
}

Write-Host "[r2-lifecycle] running R2-5 probes..."
Write-Host ""

# A. Workspace hygiene
$mounts = docker exec $Runner cat /proc/mounts 2>$null
$outLine = ($mounts -split "`n" | Where-Object { $_ -match '^\S+\s+/work/out\s' }) | Select-Object -First 1
if ($outLine -and $outLine -match 'tmpfs' -and $outLine -match 'noexec') {
    Report 'PASS' "/work/out is tmpfs + noexec ($outLine)"
} else {
    Report 'FAIL' "/work/out mount is not tmpfs+noexec (got: $outLine)"
}

$inProbe = @'
if [ ! -d /work/in ]; then echo "absent"; exit 0; fi
if touch /work/in/r2-write-probe 2>/dev/null; then
  rm -f /work/in/r2-write-probe
  echo "writable"
else
  echo "read-only"
fi
'@
$inState = (docker exec $Runner sh -c $inProbe 2>$null) | Select-Object -First 1
if (-not $inState) { $inState = 'missing' }
switch ($inState) {
    'absent'    { Report 'PASS' "/work/in posture = absent (G1 acceptable)" }
    'read-only' { Report 'PASS' "/work/in posture = read-only (G1 acceptable)" }
    'writable'  { Report 'FAIL' "/work/in is WRITABLE - operator mount must be read-only" }
    default     { Report 'FAIL' "/work/in probe failed (got: $inState)" }
}

# B. Sequential cycles
Write-Host "[r2-lifecycle] running 3 sequential agent_started/agent_stopped cycles..."
$cycleScript = @'
const { WebSocket } = require("ws");
const wsUrl = process.env.HARNESS_ORCHESTRATOR_URL.replace(/^http/, "ws")
  + "/api/runner/events?runId=" + encodeURIComponent(process.env.HARNESS_RUN_ID)
  + "&token=" + encodeURIComponent(process.env.HARNESS_RUN_JWT);
const ws = new WebSocket(wsUrl);
let cycle = 0;
ws.on("message", (m) => {
  try { const f = JSON.parse(m); if (f.type === "hello") { runCycles(); } } catch (_) {}
});
function runCycles() {
  if (cycle >= 3) { ws.close(1000, "cycles done"); return; }
  cycle += 1;
  const id = "lifecycle-cycle-" + cycle;
  ws.send(JSON.stringify({ type: "agent_started", id, label: "cycle", agentType: "claude" }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "agent_stopped", id }));
    setTimeout(runCycles, 200);
  }, 300);
}
ws.on("close", () => process.exit(0));
setTimeout(() => process.exit(1), 10000);
'@
docker exec -w /app $Runner node -e $cycleScript | Out-Null
Start-Sleep -Seconds 2
$remote = Active-Remote-Count
if ($remote -eq 0) {
    Report 'PASS' "after 3 lifecycle cycles, activeChildren remote count = 0 (no leak)"
} else {
    Report 'FAIL' "after 3 cycles, activeChildren remote count = $remote (expected 0)"
}

# C. Orchestrator bounce
Write-Host "[r2-lifecycle] verifying runner survives an orchestrator bounce..."
docker stop $Orch | Out-Null
Start-Sleep -Seconds 3
$runnerState = docker inspect --format '{{.State.Status}}' $Runner 2>$null
if ($runnerState -eq 'running') {
    Report 'PASS' "after orchestrator stop, runner state = running (reconnect backoff active)"
} else {
    Report 'FAIL' "after orchestrator stop, runner state = $runnerState"
}

docker start $Orch | Out-Null
Write-Host "[r2-lifecycle] waiting up to 30s for runner reconnect after orchestrator restart..."
$deadline = (Get-Date).AddSeconds(30)
$reconnectOk = $false; $openCount = 0
while ((Get-Date) -lt $deadline) {
    $health = docker inspect --format '{{.State.Health.Status}}' $Orch 2>$null
    if ($health -eq 'healthy') {
        $logs = docker logs $Runner 2>&1 | Select-Object -Last 20
        $openCount = ($logs | Where-Object { $_ -match 'ws open' } | Measure-Object).Count
        if ($openCount -ge 2) { $reconnectOk = $true; break }
    }
    Start-Sleep -Seconds 2
}
if ($reconnectOk) {
    Report 'PASS' "runner reconnected after orchestrator restart (ws open count >= 2)"
} else {
    Report 'FAIL' "runner did NOT reconnect within 30s (open count: $openCount)"
}

Write-Host ""
Write-Host "[r2-lifecycle] summary: $Pass pass / $Fail fail"
if ($Fail -gt 0) {
    Write-Host "[r2-lifecycle] tail runner logs:"
    docker logs --tail 20 $Runner
    exit 1
}
Write-Host "[r2-lifecycle] G1 + G7 anchors verified live."
