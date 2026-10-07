@echo off
chcp 65001 >nul
title MBA 模考系统 - 一键更新到 GitHub Pages
cd /d "%~dp0"

echo.
echo ========================================
echo   MBA 模考系统 · 一键更新
echo ========================================
echo.

rem 优先用系统 Git 自带的 Git Bash；没有就退到 Git 自带的 usr\bin
set "BASH="
if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH=C:\Program Files\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"

if not defined BASH (
    echo [X] 没找到 Git Bash
    echo.
    echo     请安装 Git for Windows：https://git-scm.com/download/win
    echo     安装时保持默认选项即可，装完再双击本文件。
    echo.
    pause
    exit /b 1
)

rem 没传说明时自动填一条，省得每次都要想写什么
set "MSG=%~1"
if "%MSG%"=="" set "MSG=更新网页内容"

"%BASH%" "%~dp0update.sh" "%MSG%"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
    echo ========================================
    echo   完成，约 1-2 分钟后线上生效
    echo   https://finealltheway.github.io/mba-exam-web/
    echo ========================================
) else (
    echo [X] 没成功。往上翻看红色提示，按里面的说明处理。
    echo     常见原因：网络不通 -> 先开启代理（Clash / v2ray）再双击本文件。
)
echo.
pause