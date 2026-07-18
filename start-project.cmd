@echo off
setlocal
title W_SHA Local Dev Server

cd /d "%~dp0"
set "PORT=33000"
set "WEB_PORT=35173"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  goto :failed
)

where corepack.cmd >nul 2>&1
if errorlevel 1 (
  echo ERROR: Corepack is not installed or is not available in PATH.
  goto :failed
)

if not exist "%~dp0node_modules\" (
  echo ERROR: Dependencies are missing.
  echo Run corepack pnpm install in this directory first.
  goto :failed
)

echo Starting the project...
echo Project directory: %~dp0
echo Web address: http://127.0.0.1:%WEB_PORT%/
echo The browser will open when the web service is ready.
echo.
echo Keep this window open while using the application.
echo Press Ctrl+C or close this window to stop the project.
echo.

node "%~dp0scripts\dev-runner.cjs"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0

:failed
echo.
echo Press any key to close this window.
pause >nul
if not defined EXIT_CODE set "EXIT_CODE=1"
exit /b %EXIT_CODE%
