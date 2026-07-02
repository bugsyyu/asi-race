@echo off
rem ============================================================
rem  ASI RACE - one-click launcher for Windows
rem  Uses only built-in Windows components (PowerShell 5.1).
rem  Close this window to stop the game server.
rem ============================================================
chcp 65001 >nul
title ASI RACE
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\launcher.ps1"
if errorlevel 1 (
  echo.
  echo [The launcher reported an error - details above / see %%TEMP%%\asi-race-launch.log]
  pause
)
