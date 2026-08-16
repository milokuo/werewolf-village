@echo off
chcp 65001 >nul
title WerewolfVillage Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Need Node.js. Download: https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
)

echo.
echo Starting WerewolfVillage server... close this window to stop.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node server\server.js
pause
