@echo off
chcp 65001 >nul 2>&1
title Pipeline Dashboard

echo ========================================
echo   Pipeline Dashboard 시작 중...
echo ========================================

cd /d "%~dp0"

:: 이미 실행 중인지 확인
curl -s --connect-timeout 2 http://localhost:4200/api/health >nul 2>&1
if %errorlevel%==0 (
    echo [이미 실행 중] http://localhost:4200
    echo.
    echo  대시보드 모드: http://localhost:4200
    echo  터미널 모드:   http://localhost:4200/?mode=terminal
    echo.
    set /p MODE="터미널 모드로 열까요? (Y/N, 기본: Y): "
    if /i "%MODE%"=="N" (
        start http://localhost:4200
    ) else (
        start http://localhost:4200/?mode=terminal
    )
    exit /b
)

:: 서버 시작 (백그라운드)
echo 서버를 시작합니다...
start /b node server.js

:: 서버 준비 대기
set RETRY=0
:WAIT_LOOP
if %RETRY% GEQ 10 (
    echo [오류] 서버 시작 실패. 로그를 확인하세요.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s --connect-timeout 2 http://localhost:4200/api/health >nul 2>&1
if %errorlevel% NEQ 0 (
    set /a RETRY+=1
    goto WAIT_LOOP
)

echo.
echo [성공] 서버 시작 완료!
echo.
echo  대시보드 모드: http://localhost:4200
echo  터미널 모드:   http://localhost:4200/?mode=terminal
echo.

:: 터미널 모드로 브라우저 열기
start http://localhost:4200/?mode=terminal

echo 이 창을 닫으면 서버가 종료됩니다.
echo 종료하려면 Ctrl+C를 누르세요.

:: 서버 프로세스가 끝날 때까지 대기
wait
