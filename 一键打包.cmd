@echo off
setlocal
title W_SHA Package Builder

pushd "%~dp0"

echo ========================================
echo W_SHA Windows Package Builder
echo ========================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 goto missing_node

where corepack.cmd >nul 2>&1
if errorlevel 1 goto missing_corepack

echo Building portable ZIP and Windows installer...
echo Do not close this window.
echo.
call corepack.cmd pnpm package:installer
if errorlevel 1 goto build_failed

echo.
echo ========================================
echo Build completed successfully.
echo Output directory: release
echo ========================================
start "" "%CD%\release"
goto finish

:missing_node
echo [ERROR] Node.js was not found. Install Node.js 22 or later.
goto failed

:missing_corepack
echo [ERROR] Corepack was not found. Check your Node.js installation.
goto failed

:build_failed
echo.
echo [ERROR] Packaging failed. Check the error messages above.
echo Make sure dependencies and Inno Setup 6 are installed.

:failed
echo.
echo Fix the error, then run this script again.

:finish
echo.
pause
popd
endlocal
