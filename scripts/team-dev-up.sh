#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
BACKEND_STATUS_URL="http://localhost:8000/startup-status"
FRONTEND_URL="http://localhost:3000"
BACKEND_HEALTH_URL="http://localhost:8000/health"
BACKEND_IMAGE="digital-twin-museum-backend"

log() {
  printf '[team-dev-up] %s\n' "$1"
}

fail() {
  printf '[team-dev-up] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' 명령이 없습니다."
}

require_cmd docker
require_cmd curl
require_cmd python3

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v open >/dev/null 2>&1; then
    fail "Docker Desktop 또는 Docker daemon이 실행 중이 아니고, Docker를 자동 실행할 수 없습니다."
  fi

  log "Docker Desktop이 실행 중이 아닙니다. 자동으로 실행합니다."
  open -a Docker >/dev/null 2>&1 || fail "Docker Desktop 앱을 실행하지 못했습니다."

  docker_wait_seconds=0
  docker_wait_limit_seconds=180
  while [ "$docker_wait_seconds" -lt "$docker_wait_limit_seconds" ]; do
    if docker info >/dev/null 2>&1; then
      log "Docker Desktop이 준비되었습니다."
      return 0
    fi

    sleep 2
    docker_wait_seconds=$((docker_wait_seconds + 2))
    log "Docker Desktop 준비 대기 중... (${docker_wait_seconds}s/${docker_wait_limit_seconds}s)"
  done

  fail "Docker Desktop 시작 대기 시간이 초과되었습니다."
}

ensure_docker_running

if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$ENV_EXAMPLE" ]; then
    fail ".env.example 파일을 찾을 수 없습니다."
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  log ".env 파일이 없어서 .env.example 기준으로 생성했습니다."
fi

compose_args=(-f "$COMPOSE_FILE" up -d)
if [ "${1:-}" = "--build" ] || ! docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1; then
  log "개발용 Docker 스택을 빌드/기동합니다."
  compose_args+=("--build")
else
  log "개발용 Docker 스택을 기동합니다."
fi

docker compose "${compose_args[@]}"

log "backend startup 진행률을 확인합니다."
max_attempts=72
attempt=1
backend_poll_interval=5
backend_max_wait_seconds=$((backend_poll_interval * max_attempts))

while [ "$attempt" -le "$max_attempts" ]; do
  raw_status="$(curl -fsS "$BACKEND_STATUS_URL" 2>/dev/null || true)"
  if [ -n "$raw_status" ]; then
    parsed_status="$(
      RAW_STATUS="$raw_status" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["RAW_STATUS"])
print(payload.get("percent", ""))
print(payload.get("stage", ""))
print(payload.get("message", ""))
print("true" if payload.get("ready") else "false")
PY
    )"
    percent="$(printf '%s' "$parsed_status" | sed -n '1p')"
    stage="$(printf '%s' "$parsed_status" | sed -n '2p')"
    message="$(printf '%s' "$parsed_status" | sed -n '3p')"
    ready="$(printf '%s' "$parsed_status" | sed -n '4p')"

    backend_elapsed_seconds=$(((attempt - 1) * backend_poll_interval))
    status_line="backend startup: ${percent:-?}% ${stage:-unknown} ${message:-}"
    log "${status_line} (${backend_elapsed_seconds}s/${backend_max_wait_seconds}s)"

    if [ "$ready" = "true" ]; then
      break
    fi
  else
    backend_elapsed_seconds=$(((attempt - 1) * backend_poll_interval))
    log "backend startup: ?% waiting ${backend_elapsed_seconds}s/${backend_max_wait_seconds}s $BACKEND_STATUS_URL"
  fi

  sleep "$backend_poll_interval"
  attempt=$((attempt + 1))
done

if [ "$attempt" -gt "$max_attempts" ]; then
  fail "backend startup 대기 시간이 초과되었습니다. 'docker compose -f docker-compose.dev.yml logs backend'로 확인하세요."
fi

log "frontend 서버준비 시작합니다."
log "frontend startup 진행률을 확인합니다."
frontend_ready="false"
frontend_poll_interval=5
frontend_max_attempts=24
frontend_max_wait_seconds=$((frontend_poll_interval * frontend_max_attempts))
frontend_attempt=1

while [ "$frontend_attempt" -le "$frontend_max_attempts" ]; do
  if curl -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
    frontend_ready="true"
    frontend_elapsed_seconds=$(((frontend_attempt - 1) * frontend_poll_interval))
    frontend_progress_percent=$((frontend_elapsed_seconds * 100 / frontend_max_wait_seconds))
    log "frontend startup: ${frontend_progress_percent}% ready Frontend startup complete"
    break
  fi

  frontend_elapsed_seconds=$(((frontend_attempt - 1) * frontend_poll_interval))
  frontend_progress_percent=$((frontend_elapsed_seconds * 100 / frontend_max_wait_seconds))
  log "frontend startup: ${frontend_progress_percent}% (${frontend_elapsed_seconds}s/${frontend_max_wait_seconds}s) waiting $FRONTEND_URL"

  sleep "$frontend_poll_interval"
  frontend_attempt=$((frontend_attempt + 1))
done

if [ "$frontend_ready" != "true" ]; then
  fail "frontend startup 대기 시간이 초과되었습니다. 'docker compose -f docker-compose.dev.yml logs frontend'로 확인하세요."
fi

log "개발 환경 준비 완료"
log "frontend: $FRONTEND_URL"
log "backend:  http://localhost:8000"
log "health:   $BACKEND_HEALTH_URL"
log "startup:  $BACKEND_STATUS_URL"
