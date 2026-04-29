#requires -version 5.1
<#
  scripts/launcher/check-update.ps1 — Slice D0-b (Phase E1, 2026-04-29)

  Notify-only update checker. Polls a manifest URL, compares the
  advertised version against an installed version, and prints whether
  an update is available. Does NOT download anything — that's
  install-version.ps1's job.

  Why notify-only (Phase E plan §O-D0, decision #4):
    Auto-update is an explicit out-of-scope for E1. An auto-updater
    that fetches and runs new code without operator review widens the
    supply-chain attack surface (compromised manifest URL → silent RCE).
    The conservative path: surface the update notice in audit logs and
    let the operator run install-version.ps1 manually.

  Usage scenarios:
    1. Operator polling (interactive):
         .\check-update.ps1 -ManifestUrl https://...
       Prints a human-readable summary.

    2. Scheduled task / dashboard ping (machine-readable):
         .\check-update.ps1 -ManifestUrl https://... -Json
       Emits structured JSON to stdout.

    3. Comparing against a known version (no install dir lookup):
         .\check-update.ps1 -ManifestUrl https://... -CurrentVersion 1.0.0

  Exit codes (so cron-style consumers can branch):
    0 - up-to-date
    1 - update available
    2 - error (network, manifest invalid, etc.)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestUrl,

    [string]$DataDir,

    [string]$CurrentVersion,

    [switch]$Json
)

$ErrorActionPreference = 'Stop'

$prevOutEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LauncherCli = Join-Path $ScriptDir 'launcher-cli.js'
if (-not (Test-Path $LauncherCli)) {
    Write-Error "launcher-cli.js not found at $LauncherCli"
    exit 2
}

# --- 1. Resolve current installed version --------------------------------
# When -CurrentVersion is omitted, we infer from the install marker that
# install-version.ps1 writes. The marker contains an absolute path to a
# versions/<v>/ directory; the leaf is the version string.
if ([string]::IsNullOrEmpty($CurrentVersion)) {
    if ([string]::IsNullOrEmpty($DataDir)) {
        if ($env:HARNESS_DATA_DIR) {
            $DataDir = $env:HARNESS_DATA_DIR
        } else {
            $DataDir = Join-Path $env:LOCALAPPDATA 'HarnessPipeline'
        }
    }
    $Marker = Join-Path $DataDir 'last-install.txt'
    if (Test-Path $Marker) {
        $InstallDir = (Get-Content $Marker -Raw -ErrorAction Stop).Trim()
        $CurrentVersion = Split-Path $InstallDir -Leaf
    } else {
        # No install marker → treat as "no install" (any version is "newer")
        $CurrentVersion = '0.0.0'
    }
}

# --- 2. Fetch + validate manifest ----------------------------------------
$TempDir = Join-Path $env:TEMP "harness-update-check-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
$ManifestFile = Join-Path $TempDir 'manifest.json'

try {
    Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestFile -UseBasicParsing
} catch {
    if ($Json) {
        $err = @{ ok = $false; error = "fetch_failed"; message = $_.Exception.Message } | ConvertTo-Json -Compress
        Write-Output $err
    } else {
        Write-Output "[check-update] manifest fetch failed: $($_.Exception.Message)"
    }
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 2
}

# Defer validation to launcher-cli so PowerShell never has its own copy
# of the schema rules (cross-platform parity guarantee).
$validate = & node $LauncherCli validate-manifest $ManifestFile
if ($LASTEXITCODE -ne 0) {
    if ($Json) {
        $err = @{ ok = $false; error = "manifest_invalid" } | ConvertTo-Json -Compress
        Write-Output $err
    } else {
        Write-Output "[check-update] manifest schema invalid - see stderr above."
    }
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 2
}

$manifest = Get-Content $ManifestFile -Raw | ConvertFrom-Json
$LatestVersion = $manifest.version

# --- 3. Compare ----------------------------------------------------------
$cmpOutput = & node $LauncherCli compare-semver $CurrentVersion $LatestVersion
$cmpExit = $LASTEXITCODE
if ($cmpExit -ne 0) {
    if ($Json) {
        $err = @{ ok = $false; error = "semver_compare_failed"; current = $CurrentVersion; latest = $LatestVersion } | ConvertTo-Json -Compress
        Write-Output $err
    } else {
        Write-Output "[check-update] semver compare failed (current=$CurrentVersion, latest=$LatestVersion)"
    }
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 2
}
$cmp = [int]$cmpOutput

# --- 4. Emit result ------------------------------------------------------
$updateAvailable = ($cmp -lt 0)
$exitCode = if ($updateAvailable) { 1 } else { 0 }

if ($Json) {
    $payload = @{
        ok = $true
        currentVersion = $CurrentVersion
        latestVersion = $LatestVersion
        updateAvailable = $updateAvailable
        publishedAt = $manifest.publishedAt
        manifestUrl = $ManifestUrl
    } | ConvertTo-Json -Compress
    Write-Output $payload
} else {
    Write-Output "[check-update] current  = $CurrentVersion"
    Write-Output "[check-update] latest   = $LatestVersion (published $($manifest.publishedAt))"
    if ($updateAvailable) {
        Write-Output "[check-update] update available - run install-version.ps1 to upgrade."
    } else {
        Write-Output "[check-update] up to date."
    }
}

Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
try { [Console]::OutputEncoding = $prevOutEnc } catch { }

exit $exitCode
