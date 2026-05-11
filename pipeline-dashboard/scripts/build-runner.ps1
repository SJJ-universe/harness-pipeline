# Slice R1-f (Phase D R1, 2026-04-28) — harness-runner image build script (Windows mirror).
#
# Usage:
#
#   pwsh -File scripts/build-runner.ps1
#   pwsh -File scripts/build-runner.ps1 -NoSbom
#
# Outputs (working dir = pipeline-dashboard):
#
#   harness-runner:<sha>          local Docker image tag
#   sbom.cyclonedx.json           CycloneDX 1.5 SBOM (unless -NoSbom)
#
# Env overrides:
#
#   $env:ORCHESTRATOR_RUNNER_TAG       override the image:tag

[CmdletBinding()]
param(
  [switch]$NoSbom
)

$ErrorActionPreference = "Stop"

# Resolve to the pipeline-dashboard root regardless of where the script
# is invoked from.
$ScriptDir = Split-Path -Parent $PSCommandPath
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$gitSha = (& git rev-parse --short HEAD 2>$null)
if (-not $gitSha) { $gitSha = "dirty" }
$imageTag = if ($env:ORCHESTRATOR_RUNNER_TAG) { $env:ORCHESTRATOR_RUNNER_TAG } else { "harness-runner:$gitSha" }

Write-Host "[build-runner] Building $imageTag..."
& docker build -f Dockerfile.runner -t $imageTag .
if ($LASTEXITCODE -ne 0) { throw "docker build failed (exit $LASTEXITCODE)" }

if (-not $NoSbom) {
  Write-Host "[build-runner] Generating SBOM (CycloneDX 1.5, --omit=dev)..."
  & npm sbom --sbom-format=cyclonedx-1.5 --omit=dev | Out-File -Encoding utf8 sbom.cyclonedx.json
  if ($LASTEXITCODE -ne 0) { throw "npm sbom failed (exit $LASTEXITCODE)" }
  Write-Host "[build-runner] SBOM written to sbom.cyclonedx.json"
}

Write-Host "[build-runner] Done: $imageTag"
