@echo off
title ChickPence Local Server
cd /d "%~dp0"
if exist node_modules goto run
echo Installing packages the first time, this takes a few minutes...
call npm install
if errorlevel 1 (
  echo npm install failed. Is Node.js installed? Check with: node -v
  pause
  exit /b 1
)
:run
echo Starting ChickPence Development Server...
start http://localhost:3000
npm run dev
pause
