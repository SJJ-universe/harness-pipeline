@echo off
:: ============================================================================
:: harness-start.bat - Pipeline Dashboard Windows launcher (Phase E1, D0-b)
:: ============================================================================
::
:: Why this file lives at the repo root (not in scripts/):
::   The user double-clicks this from the release zip. Putting it at the
::   root means "extract zip, double-click harness-start.bat" is the entire
::   first-run experience. No README spelunking.
::
:: Two operating modes:
::
::   DEV mode (server.js exists alongside this script)
::     The script is being run from a checked-out repo or unpacked release
::     zip. We launch start.js directly without any download/install dance.
::     This is the path used during E1 development and for the smoke tests.
::
::   INSTALLER mode (server.js absent, but HARNESS_MANIFEST_URL is set)
::     The script is acting as a bootstrap stub. We delegate to
::     scripts\launcher\install-version.ps1 to download + SHA256-verify +
::     extract a release zip into %LOCALAPPDATA%\HarnessPipeline\versions\<v>\,
::     then re-launch from that install dir. (Future-facing — needed by
::     E3 Release Hygiene; placeholder logic implemented in this slice.)
::
:: Environment overrides (read directly, no flags):
::   HARNESS_DATA_DIR        - override %LOCALAPPDATA%\HarnessPipeline
::                             (portable mode: point at a USB stick path)
::   HARNESS_CONFIG_DIR      - override %APPDATA%\HarnessPipeline\config
::   HARNESS_MANIFEST_URL    - source for installer mode's manifest.json
::   HARNESS_NO_BROWSER=1    - skip auto-open (CI / headless smoke)
::   HARNESS_PORT            - default 4201 (matches server.js default)
::   HARNESS_HOST            - default 127.0.0.1
::
:: Trust scope reminder (per Phase E plan §O-D0):
::   This launcher is for INTERNAL / PRIVATE distribution. SHA256
::   trust-on-first-use only proves the bytes match the manifest, not that
::   the manifest itself is authentic. Public release safety arrives in
::   E3 Release Hygiene (manifest signing). Until then, only run zips you
::   received via a trusted internal channel.
:: ============================================================================

setlocal EnableExtensions EnableDelayedExpansion

:: --- 1. Console hygiene ---------------------------------------------------
:: chcp 65001 makes Korean and emoji in audit logs render correctly. The
:: redirect to nul swallows the "Active code page: 65001" status line.
chcp 65001 >nul 2>&1
title Pipeline Dashboard

:: Anchor every relative path to the script's own directory. Without this,
:: double-clicking from Explorer leaves cwd at C:\Windows\System32 and node
:: cannot find server.js / start.js.
cd /d "%~dp0"
set "SCRIPT_DIR=%~dp0"

:: --- 2. Detect Node.js ---------------------------------------------------
:: We need the Node binary on PATH. If it's missing entirely, give a
:: pointed install hint instead of letting `node` error out.
where node >nul 2>&1
if errorlevel 1 (
    echo [harness-start] Node.js not found on PATH.
    echo                 Install Node.js 24+ from https://nodejs.org/
    echo                 then re-run harness-start.bat.
    pause
    exit /b 10
)

:: Capture the runtime version so launcher-cli can compare against
:: minNodeVersion. Quoting via "for /f" handles the leading "v" in
:: `node --version` output (e.g. "v24.5.0").
for /f "tokens=*" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo [harness-start] Node %NODE_VERSION% detected.

:: --- 3. Choose mode (dev vs installer) ----------------------------------
if exist "%SCRIPT_DIR%server.js" (
    set "MODE=dev"
    set "INSTALL_DIR=%SCRIPT_DIR%"
    echo [harness-start] dev mode: launching from %SCRIPT_DIR%
) else (
    set "MODE=installer"
    echo [harness-start] installer mode: server.js absent, will fetch release.
    if "%HARNESS_MANIFEST_URL%"=="" (
        echo [harness-start] HARNESS_MANIFEST_URL not set - cannot fetch.
        echo                 Either:
        echo                   1. Re-run from a directory that contains server.js, or
        echo                   2. Set HARNESS_MANIFEST_URL=^<https url^> and re-run.
        pause
        exit /b 11
    )
)

:: --- 4. Installer mode: delegate to PowerShell --------------------------
:: PowerShell is bundled with every Windows install and handles HTTPS
:: download, SHA256 verification (via launcher-cli), and zip extraction
:: cleanly. Keep the .bat file as a thin orchestrator.
::
:: NOTE: comments inside `( ... )` blocks must use `rem` (not `::`).
:: cmd.exe parses the entire block at once and treats `::` as a label,
:: which it then tries to parse as a drive letter, spamming "not
:: recognized" errors to stderr even when the block is skipped.
if "%MODE%"=="installer" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
        -File "%SCRIPT_DIR%scripts\launcher\install-version.ps1" ^
        -ManifestUrl "%HARNESS_MANIFEST_URL%"
    if errorlevel 1 (
        echo [harness-start] install-version.ps1 failed - see log above.
        pause
        exit /b 12
    )
    rem install-version.ps1 prints the install dir on its last stdout line.
    rem We capture it via a marker file rather than parsing stdout to avoid
    rem cmd's quoting/escaping headaches.
    set "MARKER=%LOCALAPPDATA%\HarnessPipeline\last-install.txt"
    if "%HARNESS_DATA_DIR%" NEQ "" set "MARKER=%HARNESS_DATA_DIR%\last-install.txt"
    if not exist "!MARKER!" (
        echo [harness-start] install marker missing at !MARKER!
        pause
        exit /b 13
    )
    rem `set /p ... < file` is unreliable inside `( ... )` blocks on some
    rem Windows builds (some interpret the redirect as launcher input).
    rem `for /f` reads the file content portably.
    for /f "usebackq delims=" %%i in ("!MARKER!") do set "INSTALL_DIR=%%i"
    echo [harness-start] installed at !INSTALL_DIR!
    cd /d "!INSTALL_DIR!"
)

:: --- 5. Verify Node version meets minimum ------------------------------
:: When a manifest is available (installer mode or a manifest pinned in
:: the install dir from a prior run), enforce minNodeVersion. Without a
:: manifest (raw dev mode) we accept whatever Node we found.
set "MANIFEST_PATH=!INSTALL_DIR!\manifest.json"
if exist "!MANIFEST_PATH!" (
    rem launcher-cli.js manifest-field extracts a single field cleanly —
    rem far simpler than wrestling cmd's quoting around an inline `node -e`.
    for /f "tokens=*" %%v in ('node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" manifest-field "!MANIFEST_PATH!" minNodeVersion 2^>nul') do set "MIN_NODE=%%v"
    if "!MIN_NODE!" NEQ "" (
        node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" check-runtime "%NODE_VERSION%" "!MIN_NODE!" >nul 2>&1
        if errorlevel 1 (
            echo [harness-start] Node %NODE_VERSION% does not satisfy minNodeVersion=!MIN_NODE!
            echo                 Upgrade from https://nodejs.org/
            pause
            exit /b 14
        )
    )
)

:: --- 6. Health-check existing instance ---------------------------------
:: If a server is already running on the configured port, just open the
:: browser and exit. Multi-launch protection: never start a second server.
set "HEALTH_PORT=%HARNESS_PORT%"
if "%HEALTH_PORT%"=="" set "HEALTH_PORT=4201"
set "HEALTH_HOST=%HARNESS_HOST%"
if "%HEALTH_HOST%"=="" set "HEALTH_HOST=127.0.0.1"
set "HEALTH_URL=http://%HEALTH_HOST%:%HEALTH_PORT%"

curl -s --connect-timeout 2 "%HEALTH_URL%/api/health" >nul 2>&1
if not errorlevel 1 (
    echo [harness-start] already running at %HEALTH_URL%
    if "%HARNESS_NO_BROWSER%"=="1" (
        echo                 HARNESS_NO_BROWSER=1 set - not opening browser.
    ) else (
        start "" "%HEALTH_URL%"
    )
    exit /b 0
)

:: --- 7. Launch supervisor ----------------------------------------------
:: start.js is the supervisor that forks server.js. Using `start /b` lets
:: the BAT continue to the health-check loop while the server boots.
echo [harness-start] starting supervisor (node start.js)...
start "" /b node start.js

:: --- 8. Health-check loop (10s budget, 1s ticks) -----------------------
set RETRY=0
:WAIT_LOOP
if %RETRY% GEQ 10 (
    echo [harness-start] server did not respond within 10s - check the supervisor logs.
    pause
    exit /b 20
)
:: 1-second sleep that survives redirected stdin (CI / Start-Process):
:: `timeout /t 1` aborts with "Input redirection is not supported" when
:: stdin is not a real console. `ping -n 2 127.0.0.1` schedules two
:: echos with a 1s gap, giving us ~1s of wait without the stdin gate.
ping 127.0.0.1 -n 2 >nul 2>&1
curl -s --connect-timeout 2 "%HEALTH_URL%/api/health" >nul 2>&1
if errorlevel 1 (
    set /a RETRY+=1
    goto WAIT_LOOP
)

echo [harness-start] server up at %HEALTH_URL%

:: --- 9. Open browser (skippable for CI) --------------------------------
if "%HARNESS_NO_BROWSER%"=="1" (
    echo [harness-start] HARNESS_NO_BROWSER=1 - browser not opened.
) else (
    start "" "%HEALTH_URL%"
)

echo [harness-start] launcher complete. Server runs in the background.
echo                 Close this window or Ctrl+C to keep server up; stop the
echo                 server from the dashboard UI or with: taskkill /im node.exe
endlocal
exit /b 0
