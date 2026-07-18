@echo off
setlocal

cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  goto :failed
)

node "%~dp0scripts\stop-project.cjs"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" (
  ping 127.0.0.1 -n 2 >nul
  exit /b 0
)

:failed
echo.
echo Press any key to close this window.
pause >nul
if not defined EXIT_CODE set "EXIT_CODE=1"
exit /b %EXIT_CODE%
