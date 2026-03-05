@echo off
setlocal

cd /d "%~dp0\.."

if "%SAMPLE_MS%"=="" set "SAMPLE_MS=5000"
if "%RETAIN_HOURS%"=="" set "RETAIN_HOURS=168"
if "%PORT%"=="" set "PORT=8080"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Please install Node.js (recommended 18+), then reopen the terminal.
  echo After that, run: node server\index.js
  exit /b 1
)

node server\index.js
