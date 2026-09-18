@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0team-dev-up.ps1" %*
endlocal
