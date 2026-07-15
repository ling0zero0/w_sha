@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  goto :failed
)

node "%~dp0scripts\project-manager.cjs" launch
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0

:failed
echo.
echo Press any key to close this window.
pause >nul
if not defined EXIT_CODE set "EXIT_CODE=1"
exit /b %EXIT_CODE%
