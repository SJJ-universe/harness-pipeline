@echo off
:: ============================================================================
:: orchestrator-start.bat - Pipeline Dashboard Windows launcher (Phase E1, D0-b)
:: ============================================================================
::
:: Why this file lives at the repo root (not in scripts/):
::   The user double-clicks this from the release zip. Putting it at the
::   root means "extract zip, double-click orchestrator-start.bat" is the entire
::   first-run experience. No README spelunking.
::
:: Two operating modes:
::
::   DEV mode (server.js exists alongside this script)
::     The script is being run from a checked-out repo or unpacked release
::     zip. We launch start.js directly without any download/install dance.
::     This is the path used during E1 development and for the smoke tests.
::
::   INSTALLER mode (server.js absent, but ORCHESTRATOR_MANIFEST_URL is set)
::     The script is acting as a bootstrap stub. We delegate to
::     scripts\launcher\install-version.ps1 to download + SHA256-verify +
::     extract a release zip into %LOCALAPPDATA%\HarnessPipeline\versions\<v>\,
::     then re-launch from that install dir. (Future-facing — needed by
::     E3 Release Hygiene; placeholder logic implemented in this slice.)
::
:: Environment overrides (read directly, no flags):
::   ORCHESTRATOR_DATA_DIR        - override %LOCALAPPDATA%\HarnessPipeline
::                             (portable mode: point at a USB stick path)
::   ORCHESTRATOR_CONFIG_DIR      - override %APPDATA%\HarnessPipeline\config
::   ORCHESTRATOR_MANIFEST_URL    - source for installer mode's manifest.json
::   ORCHESTRATOR_NO_BROWSER=1    - skip auto-open (CI / headless smoke)
::   ORCHESTRATOR_PORT            - default 4201 (matches server.js default)
::   ORCHESTRATOR_HOST            - default 127.0.0.1
::   ORCHESTRATOR_TRUST_STORE     - explicit trust-store.json path for the
::                             E3-F1 manifest signature gate. If unset,
::                             the resolver falls back to ORCHESTRATOR_CONFIG_DIR
::                             then OS default (%APPDATA%\HarnessPipeline\)
::                             then portable bundled fallback.
::   ORCHESTRATOR_DEPLOYMENT_PROFILE=public-sector
::                             switches signature gate to fail-closed
::                             with NO escape (the dev opt-in below is
::                             ignored under public-sector posture).
::   ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST=1
::                             dev-only escape: install unsigned manifest
::                             with LOUD warning + audit
::                             launcher_signature_bypass entry. NEVER set
::                             this in production. Public-sector ignores.
::
:: Trust scope (per Phase E plan §O-D0 + §S-E3-F1, 2026-04-30):
::   E3-F1 (Slice "Launcher Signature Gate") promotes the install path
::   to PRODUCTION FAIL-CLOSED: an unsigned manifest, an unknown signing
::   key, or a missing trust store all fail with exit 37/38 unless the
::   operator opts in via ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST=1 in standard
::   mode. Public-sector mode never honors that escape. The gate logic
::   itself lives in scripts\launcher\install-version.ps1 — the .bat
::   surfaces the resolved trust-store path for boot-time visibility.
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
    echo                 then re-run orchestrator-start.bat.
    echo.
    echo                 [KO] Node.js가 설치되어 있지 않습니다.
    echo                      https://nodejs.org/ 에서 LTS(24 이상^)을
    echo                      설치한 다음 orchestrator-start.bat을 다시 실행하세요.
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
    if "%ORCHESTRATOR_MANIFEST_URL%"=="" (
        echo [harness-start] ORCHESTRATOR_MANIFEST_URL not set - cannot fetch.
        echo                 Either:
        echo                   1. Re-run from a directory that contains server.js, or
        echo                   2. Set ORCHESTRATOR_MANIFEST_URL=^<https url^> and re-run.
        pause
        exit /b 11
    )
    rem D0-e: scheme check before delegating to install-version.ps1, so
    rem the operator sees a fast, focused error instead of a generic
    rem "install-version.ps1 failed (rc=35)" further down the call chain.
    rem Note the ^) escapes below — unescaped close-paren inside an `( ... )`
    rem block (we are inside the `if exist ... else ( ... )` block) prematurely
    rem terminates the block. The same trap already bit "for dev only)" — we
    rem fix it by escaping every `)` in echoed user-facing text.
    node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" validate-manifest-url "%ORCHESTRATOR_MANIFEST_URL%" >nul 2>&1
    if errorlevel 1 (
        echo [harness-start] ORCHESTRATOR_MANIFEST_URL must use https:// ^(set
        echo                 ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1 for dev only^).
        pause
        exit /b 15
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
    rem E3-F1-c: pre-flight visibility of the signature gate. This is
    rem informational — the actual gate enforcement happens inside
    rem install-version.ps1. We surface the deployment posture + the
    rem resolved trust-store path so a first-time operator sees what
    rem the install will demand BEFORE the manifest is fetched.
    set "POSTURE=standard"
    if /i "%ORCHESTRATOR_DEPLOYMENT_PROFILE%"=="public-sector" set "POSTURE=public-sector"
    echo [harness-start] signature gate posture: !POSTURE!
    if /i "%ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST%"=="1" (
        if "!POSTURE!"=="public-sector" (
            echo [harness-start] WARNING: ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST=1 is IGNORED under public-sector posture.
        ) else (
            echo [harness-start] WARNING: ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST=1 set ^(dev escape; never use in production^).
        )
    )
    rem Resolve trust-store path for visibility. Failure is non-fatal —
    rem install-version will surface the actual error if the gate trips.
    for /f "tokens=*" %%t in ('node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" resolve-trust-store-path 2^>nul ^| node -e "let s=''; process.stdin.on('data',d=>s+=d); process.stdin.on('end',()=>{try{const r=JSON.parse(s);process.stdout.write(`${r.path} (source=${r.source}, exists=${r.exists})`);}catch(e){}})"') do set "TRUST_INFO=%%t"
    if "!TRUST_INFO!" NEQ "" echo [harness-start] trust store: !TRUST_INFO!

    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
        -File "%SCRIPT_DIR%scripts\launcher\install-version.ps1" ^
        -ManifestUrl "%ORCHESTRATOR_MANIFEST_URL%"
    if errorlevel 1 (
        echo [harness-start] install-version.ps1 failed - see log above.
        pause
        exit /b 12
    )
    rem install-version.ps1 prints the install dir on its last stdout line.
    rem We capture it via a marker file rather than parsing stdout to avoid
    rem cmd's quoting/escaping headaches.
    set "MARKER=%LOCALAPPDATA%\HarnessPipeline\last-install.txt"
    if "%ORCHESTRATOR_DATA_DIR%" NEQ "" set "MARKER=%ORCHESTRATOR_DATA_DIR%\last-install.txt"
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
set "HEALTH_PORT=%ORCHESTRATOR_PORT%"
if "%HEALTH_PORT%"=="" set "HEALTH_PORT=4201"
set "HEALTH_HOST=%ORCHESTRATOR_HOST%"
if "%HEALTH_HOST%"=="" set "HEALTH_HOST=127.0.0.1"
set "HEALTH_URL=http://%HEALTH_HOST%:%HEALTH_PORT%"

:: D0-e: verify the running service is OUR app (app=="HarnessPipeline")
:: before treating "200 OK" as "already running". This protects against
:: an unrelated HTTP service squatting the port and tricking the
:: launcher into opening the browser at someone else's app.
node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" verify-health "%HEALTH_URL%/api/health" >nul 2>&1
if not errorlevel 1 (
    echo [harness-start] already running at %HEALTH_URL%
    if "%ORCHESTRATOR_NO_BROWSER%"=="1" (
        echo                 ORCHESTRATOR_NO_BROWSER=1 set - not opening browser.
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
    echo.
    echo                 [KO] 서버가 10초 안에 응답하지 않았습니다.
    echo                      위 로그에서 빨간색 오류 메시지를 확인하세요.
    echo                      포트 충돌이면 'set ORCHESTRATOR_PORT=4301' 후 다시 실행.
    echo                      자세한 안내: docs/runbooks/first-time-use.md §4.2
    pause
    exit /b 20
)
:: 1-second sleep that survives redirected stdin (CI / Start-Process):
:: `timeout /t 1` aborts with "Input redirection is not supported" when
:: stdin is not a real console. `ping -n 2 127.0.0.1` schedules two
:: echos with a 1s gap, giving us ~1s of wait without the stdin gate.
ping 127.0.0.1 -n 2 >nul 2>&1
:: D0-e: poll `verify-health` (not raw curl) so we wait until the
:: response says app=="HarnessPipeline". A racy "200 OK" from a
:: different service squatting the port is rejected here.
node "%SCRIPT_DIR%scripts\launcher\launcher-cli.js" verify-health "%HEALTH_URL%/api/health" >nul 2>&1
if errorlevel 1 (
    set /a RETRY+=1
    goto WAIT_LOOP
)

echo [harness-start] server up at %HEALTH_URL%

:: --- 9. Open browser (skippable for CI) --------------------------------
if "%ORCHESTRATOR_NO_BROWSER%"=="1" (
    echo [harness-start] ORCHESTRATOR_NO_BROWSER=1 - browser not opened.
) else (
    start "" "%HEALTH_URL%"
)

echo [harness-start] launcher complete. Server runs in the background.
echo                 Close this window or Ctrl+C to keep server up; stop the
echo                 server from the dashboard UI or with: taskkill /im node.exe
echo.
echo                 [KO] 시작 완료. 서버는 뒤에서 계속 실행됩니다.
echo                      이 창을 닫아도 서버는 동작합니다. 종료하려면
echo                      대시보드 UI 또는 'taskkill /im node.exe' 사용.
echo                      처음 사용자: docs/runbooks/first-time-use.md
endlocal
exit /b 0
