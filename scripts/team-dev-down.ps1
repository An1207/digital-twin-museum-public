Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $RepoRoot "docker-compose.dev.yml"

Push-Location $RepoRoot
try {
    docker compose -f $ComposeFile down
} finally {
    Pop-Location
}
