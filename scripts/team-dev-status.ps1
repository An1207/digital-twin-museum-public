Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $RepoRoot "docker-compose.dev.yml"

Push-Location $RepoRoot
try {
    Write-Host "== docker compose ps =="
    docker compose -f $ComposeFile ps
    Write-Host ""
    Write-Host "== backend startup status =="
    try {
        (Invoke-WebRequest -Uri "http://localhost:8000/startup-status" -TimeoutSec 3).Content
    } catch {
        Write-Host "backend startup status unavailable"
    }
} finally {
    Pop-Location
}
