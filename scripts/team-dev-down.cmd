@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0team-dev-down.ps1" %*
endlocal
