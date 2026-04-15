@echo off
chcp 65001 >nul
title Pipeline Dashboard - Harness Engineering
color 07

set "DASH_DIR=C:\Users\SJ\workspace\pipeline-dashboard"
set "DASH_URL=http://127.0.0.1:4200"

echo ========================================================
echo   Pipeline Dashboard - Harness Engineering
echo   Live Tool Feed + Critique Timeline + Codex Verify
echo   Server auto-shutdown on webpage close (supervised)
echo   %DASH_URL%
echo ========================================================
echo.

cd /d "%DASH_DIR%"
if errorlevel 1 (
    echo [ERROR] Directory not found: %DASH_DIR%
    pause
    exit /b 1
)

netstat -ano | findstr :4200 | findstr LISTENING >nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Server already running on 4200. Opening browser only.
    echo.
    start "" "%DASH_URL%"
    ping -n 2 127.0.0.1 >nul
    exit /b 0
)

echo [INFO] Starting Node.js server (supervised via start.js)...
echo [INFO] Close this window OR close the browser tab to stop the server.
echo.

start "" cmd /c "ping -n 3 127.0.0.1 >nul && start %DASH_URL%"

node start.js

echo.
echo [INFO] Server stopped.
pause
