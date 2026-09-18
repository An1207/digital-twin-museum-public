[CmdletBinding()]
param(
    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ComposeFile = Join-Path $RepoRoot "docker-compose.dev.yml"
$EnvFile = Join-Path $RepoRoot ".env"
$EnvExample = Join-Path $RepoRoot ".env.example"
$BackendStatusUrl = "http://localhost:8000/startup-status"
$FrontendUrl = "http://localhost:3000"
$BackendHealthUrl = "http://localhost:8000/health"
$BackendImage = "digital-twin-museum-backend"

function Log([string]$Message) {
    Write-Host "[team-dev-up] $Message"
}

function Fail([string]$Message) {
    Write-Host "[team-dev-up] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "'$Name' 명령을 찾을 수 없습니다."
    }
}

Require-Command "docker"

function Ensure-DockerRunning {
    try {
        docker info | Out-Null
        return
    } catch {
    }

    $OpenCommand = Get-Command "open" -ErrorAction SilentlyContinue
    if ($null -ne $OpenCommand) {
        Log "Docker Desktop이 실행 중이 아닙니다. 자동으로 실행합니다."
        try {
            Start-Process -FilePath $OpenCommand.Path -ArgumentList @("-a", "Docker") | Out-Null
        } catch {
            Fail "Docker Desktop 앱을 실행하지 못했습니다."
        }
    } else {
        Log "Docker Desktop이 실행 중이 아닙니다. 자동으로 실행합니다."
        try {
            Start-Process -FilePath "Docker Desktop" | Out-Null
        } catch {
            Fail "Docker Desktop 앱을 실행하지 못했습니다."
        }
    }

    $DockerWaitSeconds = 0
    $DockerWaitLimitSeconds = 180
    while ($DockerWaitSeconds -lt $DockerWaitLimitSeconds) {
        try {
            docker info | Out-Null
            Log "Docker Desktop이 준비되었습니다."
            return
        } catch {
            Start-Sleep -Seconds 2
            $DockerWaitSeconds += 2
            Log "Docker Desktop 준비 대기 중... (${DockerWaitSeconds}s/${DockerWaitLimitSeconds}s)"
        }
    }

    Fail "Docker Desktop 시작 대기 시간이 초과되었습니다."
}

Ensure-DockerRunning

if (-not (Test-Path $EnvFile)) {
    if (-not (Test-Path $EnvExample)) {
        Fail ".env.example 파일을 찾을 수 없습니다."
    }
    Copy-Item $EnvExample $EnvFile
    Log ".env 파일이 없어서 .env.example 기준으로 생성했습니다."
}

$NeedsBuild = $Build -or ($args -contains "--build")
if (-not $NeedsBuild) {
    docker image inspect $BackendImage *> $null
    if ($LASTEXITCODE -ne 0) {
        $NeedsBuild = $true
    }
}

$ComposeArgs = @("-f", $ComposeFile, "up", "-d")
if ($NeedsBuild) {
    Log "개발용 Docker 스택을 빌드/기동합니다."
    $ComposeArgs += "--build"
} else {
    Log "개발용 Docker 스택을 기동합니다."
}

Push-Location $RepoRoot
try {
    docker compose @ComposeArgs
} finally {
    Pop-Location
}

Log "backend startup 진행률을 확인합니다."
$MaxAttempts = 72
$BackendPollInterval = 5
$BackendMaxWaitSeconds = $BackendPollInterval * $MaxAttempts

for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
    $BackendElapsedSeconds = ($Attempt - 1) * $BackendPollInterval
    try {
        $Status = Invoke-RestMethod -Uri $BackendStatusUrl -TimeoutSec 3
        $Percent = if ($null -ne $Status.percent) { [string]$Status.percent } else { "?" }
        $Stage = if ($null -ne $Status.stage) { [string]$Status.stage } else { "unknown" }
        $Message = if ($null -ne $Status.message) { [string]$Status.message } else { "" }
        $StatusLine = "backend startup: $Percent% $Stage $Message ($BackendElapsedSeconds`s/$BackendMaxWaitSeconds`s)"
        Log $StatusLine
        if ($Status.ready -eq $true) {
            break
        }
    } catch {
        Log "backend startup: ?% waiting ${BackendElapsedSeconds}s/${BackendMaxWaitSeconds}s $BackendStatusUrl"
    }

    Start-Sleep -Seconds $BackendPollInterval

    if ($Attempt -eq $MaxAttempts) {
        Fail "backend startup 대기 시간이 초과되었습니다. 'docker compose -f docker-compose.dev.yml logs backend'로 확인하세요."
    }
}

Log "frontend 서버준비 시작합니다."
Log "frontend startup 진행률을 확인합니다."
$FrontendReady = $false
$FrontendPollInterval = 5
$FrontendMaxAttempts = 24
$FrontendMaxWaitSeconds = $FrontendPollInterval * $FrontendMaxAttempts

for ($FrontendAttempt = 1; $FrontendAttempt -le $FrontendMaxAttempts; $FrontendAttempt++) {
    $FrontendElapsedSeconds = ($FrontendAttempt - 1) * $FrontendPollInterval
    $FrontendProgressPercent = [math]::Floor(($FrontendElapsedSeconds * 100) / $FrontendMaxWaitSeconds)

    try {
        Invoke-WebRequest -Uri $FrontendUrl -TimeoutSec 3 | Out-Null
        $FrontendReady = $true
        Log "frontend startup: $FrontendProgressPercent% ready Frontend startup complete"
        break
    } catch {
        Log "frontend startup: $FrontendProgressPercent% (${FrontendElapsedSeconds}s/${FrontendMaxWaitSeconds}s) waiting $FrontendUrl"
        Start-Sleep -Seconds $FrontendPollInterval
    }
}

if (-not $FrontendReady) {
    Fail "frontend startup 대기 시간이 초과되었습니다. 'docker compose -f docker-compose.dev.yml logs frontend'로 확인하세요."
}

Log "개발 환경 준비 완료"
Log "frontend: $FrontendUrl"
Log "backend:  http://localhost:8000"
Log "health:   $BackendHealthUrl"
Log "startup:  $BackendStatusUrl"
