@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0team-dev-status.ps1" %*
endlocal
