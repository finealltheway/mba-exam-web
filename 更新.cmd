@echo off
chcp 65001 >nul
title MBA Exam - Update to GitHub Pages
cd /d "%~dp0"

echo.
echo ========================================
echo   MBA Exam Web - One-Click Update
echo ========================================
echo.

rem Locate Git Bash shipped with Git for Windows.
set "BASH="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH=C:\Program Files\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"

if not defined BASH (
    echo [X] Git Bash not found.
    echo.
    echo     Please install Git for Windows: https://git-scm.com/download/win
    echo     Keep the default options, then double-click this file again.
    echo.
    pause
    exit /b 1
)

rem Default message so you don't have to invent one each time.
set "MSG=%~1"
if "%MSG%"=="" set "MSG=update web content"

"%BASH%" "%~dp0update.sh" "%MSG%"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
    echo ========================================
    echo   DONE - takes 1-2 minutes to go live
    echo   https://finealltheway.github.io/mba-exam-web/
    echo ========================================
    echo.
    echo   Output above is in Chinese; some characters may look garbled
    echo   in this console. The script itself still runs correctly.
) else (
    echo [X] FAILED. Scroll up for the message telling you what to do.
    echo.
    echo   Most common cause: network blocked.
    echo   Turn on your proxy (Clash / v2ray) then double-click this file again.
)
echo.
pause