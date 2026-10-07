@echo off
chcp 65001 >nul
title MBA Exam - One-Click Update
cd /d "%~dp0"

rem ============================================================
rem  Output is written to update-log.txt as well as the screen,
rem  so you can read it even if this window closes by itself.
rem ============================================================
set "LOG=%~dp0update-log.txt"

echo.
echo ============================================================
echo   MBA Exam Web - One-Click Update
echo============================================================
echo.

rem --- locate Git Bash ---
set "BASH="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH=C:\Program Files\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"

if not defined BASH (
    echo [X] Git Bash not found.
    echo     Install Git for Windows^: https://git-scm.com/download/win
    goto :finish
)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=update web content"

echo [running] update.sh %MSG%
echo.

rem --- run it ---
rem "< NUL" stops Git Bash from swallowing the pause keystroke later.
rem Output is duplicated into the log with a second redirect.
"%BASH%" "%~dp0update.sh" "%MSG%" < NUL > "%LOG%" 2>&1
set "CODE=%ERRORLEVEL%"

rem --- show the log back on screen ---
type "%LOG%"

:finish
echo.
if "%CODE%"=="0" (
    echo ============================================================
    echo   DONE - takes 1-2 minutes to go live
    echo   https://finealltheway.github.io/mba-exam-web/
    echo ============================================================
) else (
    echo [X] FAILED - see the messages above
    echo     Most common cause^: network blocked.
    echo     Turn on your proxy ^(Clash / v2ray^) then try again.
)

echo.
echo Log saved to^: %~dp0update-log.txt
echo.
echo Press any key to close this window^.
pause > nul
exit /b 0