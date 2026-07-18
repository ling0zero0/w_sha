@echo off
setlocal
title W_SHA Werewolf LAN
cd /d "%~dp0"

set "PORT=35173"
set "WEB_PORT=35173"
set "HOST=0.0.0.0"
set "NODE_ENV=production"
set "OPEN_BROWSER=1"
set "WEB_ROOT=%~dp0app\public"
set "DATABASE_PATH=%LOCALAPPDATA%\W_SHA\werewolf.sqlite"

if not exist "%~dp0node.exe" (
  echo ERROR: node.exe is missing. Please extract the complete package again.
  pause
  exit /b 1
)

echo W_SHA is starting at http://127.0.0.1:%PORT%/
echo Keep this window open while playing. Close it to stop the service.
echo.
"%~dp0node.exe" "%~dp0app\server\dist\index.js"

if errorlevel 1 (
  echo.
  echo Startup failed. Port %PORT% may already be in use.
  pause
)
