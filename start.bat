@echo off
title ChickPence Local Server
echo Starting ChickPence Development Server...
cd /d "%~dp0"
start http://localhost:3000
npm run dev
pause
