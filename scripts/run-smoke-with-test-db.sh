#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_PORT=8000
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
FRONTEND_PORT=3000
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}"
TEST_DB_PATH="$BACKEND_DIR/data/test_3dgs.db"
TEST_ASSET_DIR="$BACKEND_DIR/local_assets/curator-space-files"
BACKEND_LOG="/tmp/dtm-smoke-testdb-backend.log"
FRONTEND_LOG="/tmp/dtm-smoke-testdb-frontend.log"
BACKEND_PID=""
FRONTEND_PID=""
STARTED_FRONTEND="false"

log() {
  printf '[smoke-testdb] %s\n' "$1"
}

fail() {
  printf '[smoke-testdb] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' 명령이 없습니다."
}

spawn_backend() {
  local database_url="$1"
  DATABASE_URL="$database_url" python3 - "$BACKEND_DIR" "$BACKEND_PORT" "$BACKEND_LOG" <<'PY'
import os
import subprocess
import sys

backend_dir, port, log_path = sys.argv[1:4]
cmd = [
    os.path.join(backend_dir, ".venv/bin/uvicorn"),
    "main:app",
    "--host",
    "127.0.0.1",
    "--port",
    port,
]

with open(log_path, "ab", buffering=0) as log_file:
    proc = subprocess.Popen(
        cmd,
        cwd=backend_dir,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=log_file,
        start_new_session=True,
    )
    print(proc.pid)
PY
}

wait_for_backend() {
  local attempts=120
  local attempt=1
  while [ "$attempt" -le "$attempts" ]; do
    if curl -fsS "$BACKEND_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

seed_test_assets() {
  python3 - "$REPO_ROOT" "$TEST_DB_PATH" "$TEST_ASSET_DIR" <<'PY'
import os
import shutil
import sqlite3
import sys
from pathlib import Path

repo_root = Path(sys.argv[1])
db_path = Path(sys.argv[2])
asset_root = Path(sys.argv[3])
model_root = repo_root / "frontend" / "public" / "models"

asset_root.mkdir(parents=True, exist_ok=True)

with sqlite3.connect(db_path) as conn:
    rows = conn.execute(
        """
        select stored_file_path, original_file_name
        from curator_space_files
        where deleted_at is null and status = 'ready'
        """
    ).fetchall()

for stored_file_path, original_file_name in rows:
    source = model_root / original_file_name
    if not source.is_file():
      continue

    destination = asset_root.parent / stored_file_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
PY
}

spawn_frontend() {
  python3 - "$FRONTEND_DIR" "$FRONTEND_LOG" "$FRONTEND_PORT" <<'PY'
import os
import subprocess
import sys

frontend_dir, log_path, port = sys.argv[1:4]
cmd = [
    "npm",
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    port,
]

with open(log_path, "ab", buffering=0) as log_file:
    proc = subprocess.Popen(
        cmd,
        cwd=frontend_dir,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=log_file,
        start_new_session=True,
    )
    print(proc.pid)
PY
}

wait_for_frontend() {
  local attempts=60
  local attempt=1
  while [ "$attempt" -le "$attempts" ]; do
    if curl -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

ensure_frontend() {
  local existing_frontend_pid
  existing_frontend_pid="$(lsof -tiTCP:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

  if [ -n "$existing_frontend_pid" ]; then
    log "기존 3000 프론트엔드($existing_frontend_pid)를 사용합니다."
    if ! wait_for_frontend; then
      fail "기존 프론트엔드가 응답하지 않습니다. 포트 ${FRONTEND_PORT} 상태를 확인하세요."
    fi
    return 0
  fi

  log "3000 프론트엔드가 없어 로컬 Vite 서버를 시작합니다."
  FRONTEND_PID="$(spawn_frontend)"
  STARTED_FRONTEND="true"

  if ! wait_for_frontend; then
    fail "로컬 프론트엔드가 준비되지 않았습니다. 로그: $FRONTEND_LOG"
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" >/dev/null 2>&1 || true
  fi

  rm -f "$TEST_DB_PATH"
  rm -rf "$TEST_ASSET_DIR"

  if [ "$STARTED_FRONTEND" = "true" ] && [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    wait "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  log "표준 백엔드를 다시 시작합니다."
  BACKEND_PID="$(spawn_backend 'sqlite:///data/local_3dgs.db')"

  if ! wait_for_backend; then
    log "표준 백엔드 재기동 확인에 실패했습니다. 로그: $BACKEND_LOG"
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

require_cmd curl
require_cmd git
require_cmd lsof
require_cmd npm
require_cmd python3

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  fail "backend/.venv 가 없습니다. 먼저 백엔드 가상환경을 준비하세요."
fi

if [ ! -f "$BACKEND_DIR/.venv/bin/uvicorn" ]; then
  fail "backend/.venv/bin/uvicorn 을 찾을 수 없습니다."
fi

ensure_frontend

existing_backend_pid="$(lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [ -n "$existing_backend_pid" ]; then
  log "기존 8000 백엔드($existing_backend_pid)를 중지합니다."
  kill "$existing_backend_pid" >/dev/null 2>&1 || true
  sleep 1
fi

log "테스트용 DB를 준비합니다."
git -C "$REPO_ROOT" show HEAD:backend/data/local_3dgs.db > "$TEST_DB_PATH"
seed_test_assets

log "테스트용 백엔드를 시작합니다."
BACKEND_PID="$(spawn_backend 'sqlite:///data/test_3dgs.db')"

if ! wait_for_backend; then
  fail "테스트용 백엔드가 준비되지 않았습니다. 로그: $BACKEND_LOG"
fi

log "smoke 를 실행합니다."
(
  cd "$FRONTEND_DIR"
  BASE_URL="http://127.0.0.1:3000" TEST_DB_PATH="$TEST_DB_PATH" SMOKE_SUITE=testdb npm run test:smoke
)

log "smoke 완료, 정리 단계로 이동합니다."
