@echo off
setlocal
chcp 65001 >nul
title W_SHA Local Dev Server 8F2C1A

cd /d "%~dp0.."

node "%~dp0project-manager.cjs" serve
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" exit /b 0

echo.
echo Project startup failed with code %EXIT_CODE%.
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%
