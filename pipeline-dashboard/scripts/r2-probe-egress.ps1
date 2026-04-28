# Slice R2-4 (Phase D R2 deployment evaluation, 2026-04-28)
#
# PowerShell counterpart of r2-probe-egress.sh. Behaviour matches the
# bash version 1:1; see r2-probe-egress.sh for the full prose.

$ErrorActionPreference = 'Stop'

$Probe = 'harness-probe-r2'

$running = docker ps --format '{{.Names}}' | Where-Object { $_ -eq $Probe }
if (-not $running) {
    Write-Error "[r2-probe] $Probe container not running."
    Write-Host "[r2-probe] bring up the harness with the strict override first:"
    Write-Host "    docker compose ``"
    Write-Host "      -f docker-compose.r2-single-runner.yml ``"
    Write-Host "      -f docker-compose.r2-strict.override.yml ``"
    Write-Host "      up -d orchestrator runner probe"
    exit 64
}

$Pass = 0
$Fail = 0

function Probe-One {
    param([string]$Label, [string]$Target, [string]$ShouldSucceed)

    $exit_code = 0
    try {
        $out = docker exec $Probe wget --timeout=2 -q -O- $Target 2>&1
        $exit_code = $LASTEXITCODE
    } catch {
        $out = $_.Exception.Message
        $exit_code = 1
    }

    $verdict = if ($exit_code -eq 0) { 'ALLOW' } else { 'BLOCK' }
    $expected = if ($ShouldSucceed -eq 'yes') { 'ALLOW' } else { 'BLOCK' }
    $pass_state = if ($verdict -eq $expected) { 'PASS' } else { 'FAIL' }

    Write-Host ("  [{0}] {1,-32} -> {2,-5} (expected {3})" -f $pass_state, $Label, $verdict, $expected)
    $first_line = ($out | Select-Object -First 1)
    if ($first_line -and $verdict -eq 'BLOCK') {
        Write-Host "          $first_line"
    }
    if ($pass_state -eq 'PASS') {
        $script:Pass = $script:Pass + 1
    } else {
        $script:Fail = $script:Fail + 1
    }
}

Write-Host "[r2-probe] running egress probes from $Probe (alpine sidecar in the strict-mode bridge)..."
Write-Host ""

Probe-One "169.254.169.254 (cloud-metadata)" "http://169.254.169.254/" "no"
Probe-One "10.0.0.1 (RFC1918 peer)"          "http://10.0.0.1/"        "no"
Probe-One "172.16.0.1 (RFC1918 peer)"        "http://172.16.0.1/"      "no"
Probe-One "192.168.1.1 (RFC1918 peer)"       "http://192.168.1.1/"     "no"
Probe-One "www.google.com (DNS public)"      "http://www.google.com/"  "no"
Probe-One "orchestrator:4201/api/health"     "http://orchestrator:4201/api/health" "yes"

Write-Host ""
Write-Host "[r2-probe] summary: $Pass pass / $Fail fail"

if ($Fail -gt 0) {
    Write-Error "[r2-probe] strict egress containment is NOT clean — review failures above."
    exit 1
}
Write-Host "[r2-probe] strict egress containment verified (G3 layer-1 evidence captured)."
