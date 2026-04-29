#requires -version 5.1
<#
  scripts/launcher/install-version.ps1 — Slice D0-b (Phase E1, 2026-04-29)

  Downloads + SHA256-verifies + extracts a release zip into the
  per-user data directory, so that subsequent `harness-start.bat` runs
  can launch from `versions/<v>/` without re-fetching.

  Why this is PowerShell, not pure batch:
    - HTTPS download with proper TLS handling needs Invoke-WebRequest.
      Batch's `curl` works but lacks structured error handling.
    - `Expand-Archive` handles cross-version zip formats reliably
      (the .zip layout the release pipeline produces).
    - PowerShell can wait on async I/O cleanly so we can stream the
      download to disk without buffering 70MB in memory.
    - PowerShell 5.1 ships with every supported Windows release, so
      no "install pwsh first" bootstrap problem.

  Why the actual SHA256 + semver logic still goes through Node
  (`launcher-cli.js`), not PowerShell:
    - Single source of truth: cross-platform parity with bash launcher.
    - Constant-time hex comparison via Node crypto.timingSafeEqual.
    - Unit-tested in `tests/unit/launcherManifest.test.js`. PowerShell
      logic would need a parallel test surface in PS itself.

  Trust scope reminder (Phase E plan §O-D0):
    INTERNAL / PRIVATE distribution only. SHA256 trust-on-first-use
    proves the bytes match the manifest, not that the manifest itself
    is authentic. E3 Release Hygiene adds manifest signing.

  Usage (called by harness-start.bat):
    powershell.exe -NoProfile -ExecutionPolicy Bypass `
      -File install-version.ps1 -ManifestUrl https://...

  Manual usage (operator dry-run):
    .\install-version.ps1 -ManifestUrl 'https://example.com/manifest.json' -WhatIf

  Optional parameters:
    -DataDir   override %LOCALAPPDATA%\HarnessPipeline (HARNESS_DATA_DIR)
    -Force     re-extract even if version dir already exists
    -WhatIf    print actions without performing them (PSv5 standard)
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestUrl,

    [string]$DataDir,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# UTF-8 console so audit logs / Korean output don't render as mojibake.
$prevOutEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }

# Anchor the launcher-cli path relative to THIS script. The script ships
# at scripts/launcher/install-version.ps1; launcher-cli.js sits next to it.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LauncherCli = Join-Path $ScriptDir 'launcher-cli.js'
if (-not (Test-Path $LauncherCli)) {
    Write-Error "launcher-cli.js not found at $LauncherCli (script must ship alongside it)"
    exit 30
}

function Write-Step {
    param([string]$Msg)
    Write-Output "[install-version] $Msg"
}

function Invoke-LauncherCli {
    # Wrap `node launcher-cli.js <cmd>` with a non-throw exit policy. We
    # check $LASTEXITCODE manually so PowerShell doesn't flip $? on a
    # native-command stderr line (a 5.1 quirk).
    param([string[]]$CliArgs)
    $output = & node $LauncherCli @CliArgs
    return @{ ExitCode = $LASTEXITCODE; Output = $output }
}

# --- 1. Resolve data dir + version dir layout ------------------------------
# Prefer the explicit -DataDir parameter > HARNESS_DATA_DIR env > OS default.
# Surfacing the resolution origin helps when an operator wonders why a USB
# stick portable mode picked up a stale APPDATA path.
if ([string]::IsNullOrEmpty($DataDir)) {
    if ($env:HARNESS_DATA_DIR) {
        $DataDir = $env:HARNESS_DATA_DIR
        Write-Step "DataDir from HARNESS_DATA_DIR env: $DataDir"
    } else {
        $DataDir = Join-Path $env:LOCALAPPDATA 'HarnessPipeline'
        Write-Step "DataDir default %LOCALAPPDATA%\HarnessPipeline: $DataDir"
    }
} else {
    Write-Step "DataDir from -DataDir param: $DataDir"
}

$VersionsDir = Join-Path $DataDir 'versions'
if (-not (Test-Path $VersionsDir)) {
    if ($PSCmdlet.ShouldProcess($VersionsDir, 'Create')) {
        New-Item -ItemType Directory -Path $VersionsDir -Force | Out-Null
    }
}

# --- 2. Download manifest --------------------------------------------------
# Stage manifest + zip in a per-run temp dir. Cleaning the temp dir is
# important for re-runs (Force re-install scenario) since Invoke-WebRequest
# refuses to overwrite an existing file by default.
$TempDir = Join-Path $env:TEMP "harness-install-$([guid]::NewGuid().ToString('N'))"
if ($PSCmdlet.ShouldProcess($TempDir, 'Create temp dir')) {
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
}
$ManifestFile = Join-Path $TempDir 'manifest.json'

Write-Step "fetching manifest: $ManifestUrl"
try {
    if ($PSCmdlet.ShouldProcess($ManifestUrl, 'Download manifest')) {
        # UseBasicParsing keeps us off the IE engine that PSv5 sometimes
        # falls back to; that engine prompts for first-launch consent and
        # would block in a non-interactive launcher.
        Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestFile -UseBasicParsing
    }
} catch {
    Write-Error "manifest download failed: $($_.Exception.Message)"
    exit 31
}

# --- 3. Validate manifest schema ------------------------------------------
Write-Step "validating manifest schema..."
$validate = Invoke-LauncherCli -CliArgs @('validate-manifest', $ManifestFile)
if ($validate.ExitCode -ne 0) {
    Write-Error 'manifest schema validation failed (see launcher-cli stderr above)'
    exit 32
}

# Re-parse the validated JSON — launcher-cli already verified the schema,
# but we still need the URL/SHA/version fields to drive the next steps.
$manifest = Get-Content $ManifestFile -Raw | ConvertFrom-Json
$Version = $manifest.version
$ZipUrl = $manifest.url
$ExpectedSha = $manifest.sha256

Write-Step "manifest OK: version=$Version url=$ZipUrl"

# --- 4. Resolve install dir + Force handling ------------------------------
$InstallDir = Join-Path $VersionsDir $Version
if (Test-Path $InstallDir) {
    if (-not $Force) {
        Write-Step "version $Version already installed at $InstallDir (use -Force to re-extract)"
        # Fall through to marker write so the caller can read the install path.
    } else {
        Write-Step "Force flag: removing existing $InstallDir"
        if ($PSCmdlet.ShouldProcess($InstallDir, 'Remove existing install')) {
            Remove-Item -Path $InstallDir -Recurse -Force
        }
    }
}

# --- 5. Download zip (if needed) + verify SHA256 --------------------------
if (-not (Test-Path $InstallDir)) {
    $ZipFile = Join-Path $TempDir "harness-pipeline-$Version.zip"
    Write-Step "downloading zip to $ZipFile..."
    try {
        if ($PSCmdlet.ShouldProcess($ZipUrl, 'Download zip')) {
            Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipFile -UseBasicParsing
        }
    } catch {
        Write-Error "zip download failed: $($_.Exception.Message)"
        exit 33
    }

    Write-Step "verifying SHA256 (expected: $ExpectedSha)..."
    if ($PSCmdlet.ShouldProcess($ZipFile, 'Verify SHA256')) {
        $verify = Invoke-LauncherCli -CliArgs @('verify-sha256', $ZipFile, $ExpectedSha)
        if ($verify.ExitCode -ne 0) {
            # Quarantine the bad zip so the operator can inspect it
            # forensically — moving instead of deleting because a
            # mismatched zip is a security signal, not a transient error.
            $Quarantine = Join-Path $DataDir "quarantine-$Version-$([datetime]::UtcNow.ToString('yyyyMMddHHmmss')).zip"
            Write-Error "SHA256 mismatch - moved to $Quarantine for forensics"
            Move-Item -Path $ZipFile -Destination $Quarantine -Force
            exit 34
        }
        Write-Step "SHA256 verified."
    }

    Write-Step "extracting to $InstallDir..."
    if ($PSCmdlet.ShouldProcess($InstallDir, 'Expand zip')) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Expand-Archive -Path $ZipFile -DestinationPath $InstallDir -Force
    }

    # Persist the manifest alongside the install so harness-start.bat can
    # re-validate (and check-update.ps1 can compare versions). Copying is
    # cheap (manifest.json is < 1 KB).
    $InstalledManifest = Join-Path $InstallDir 'manifest.json'
    Copy-Item -Path $ManifestFile -Destination $InstalledManifest -Force
}

# --- 6. Write the install marker so the .bat can pick up the path --------
# harness-start.bat reads this single line and `cd`s into the directory
# before launching node. Using a marker file (not stdout parsing) avoids
# all the cmd quoting nightmares.
$Marker = Join-Path $DataDir 'last-install.txt'
if ($PSCmdlet.ShouldProcess($Marker, 'Write install marker')) {
    Set-Content -Path $Marker -Value $InstallDir -Encoding UTF8 -NoNewline
}

Write-Step "done. install dir: $InstallDir"
Write-Step "marker written: $Marker"

# --- 7. Cleanup temp + restore console ------------------------------------
try {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
} catch { }

try { [Console]::OutputEncoding = $prevOutEnc } catch { }

exit 0
