@echo off
title gnomemepad UI
cd /d "%~dp0web"
echo.
echo  Starting gnomemepad web UI...
echo  Keep this window OPEN while using the UI.
echo.
echo  Open:  http://127.0.0.1:5173
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node.exe not found. Install Node.js from https://nodejs.org
  pause
  exit /b 1
)
node server.mjs
echo.
echo Server stopped.
pause
