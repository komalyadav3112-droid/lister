@echo off
title Lister
rem The desktop timer runs on its own, so it keeps counting after Lister is closed.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0widget.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 (
  echo.
  echo Lister could not start. Take a screenshot of this window and share it.
  pause
)
