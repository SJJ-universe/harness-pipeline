@echo off
chcp 65001 >nul 2>&1
title Pipeline Dashboard

echo ========================================
echo   Pipeline Dashboard ?쒖옉 以?..
echo ========================================

cd /d "%~dp0"

:: ?대? ?ㅽ뻾 以묒씤吏 ?뺤씤
curl -s --connect-timeout 2 http://localhost:4201/api/health >nul 2>&1
if %errorlevel%==0 (
    echo [?대? ?ㅽ뻾 以? http://localhost:4201
    echo.
    echo  ??쒕낫??紐⑤뱶: http://localhost:4201
    echo  ?곕???紐⑤뱶:   http://localhost:4201/?mode=terminal
    echo.
    set /p MODE="?곕???紐⑤뱶濡??닿퉴?? (Y/N, 湲곕낯: Y): "
    if /i "%MODE%"=="N" (
        start http://localhost:4201
    ) else (
        start http://localhost:4201/?mode=terminal
    )
    exit /b
)

:: ?쒕쾭 ?쒖옉 (諛깃렇?쇱슫??
echo ?쒕쾭瑜??쒖옉?⑸땲??..
start /b node server.js

:: ?쒕쾭 以鍮??湲?
set RETRY=0
:WAIT_LOOP
if %RETRY% GEQ 10 (
    echo [?ㅻ쪟] ?쒕쾭 ?쒖옉 ?ㅽ뙣. 濡쒓렇瑜??뺤씤?섏꽭??
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s --connect-timeout 2 http://localhost:4201/api/health >nul 2>&1
if %errorlevel% NEQ 0 (
    set /a RETRY+=1
    goto WAIT_LOOP
)

echo.
echo [?깃났] ?쒕쾭 ?쒖옉 ?꾨즺!
echo.
echo  ??쒕낫??紐⑤뱶: http://localhost:4201
echo  ?곕???紐⑤뱶:   http://localhost:4201/?mode=terminal
echo.

:: ?곕???紐⑤뱶濡?釉뚮씪?곗? ?닿린
start http://localhost:4201/?mode=terminal

echo ??李쎌쓣 ?レ쑝硫??쒕쾭媛 醫낅즺?⑸땲??
echo 醫낅즺?섎젮硫?Ctrl+C瑜??꾨Ⅴ?몄슂.

:: ?쒕쾭 ?꾨줈?몄뒪媛 ?앸궇 ?뚭퉴吏 ?湲?
wait

