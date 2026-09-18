#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

log() {
  printf '[smoke] %s\n' "$1"
}

fail() {
  printf '[smoke] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' 명령이 없습니다."
}

if [ "${1:-}" = "--test-db" ]; then
  exec "$REPO_ROOT/scripts/run-smoke-with-test-db.sh"
fi

require_cmd bash

if [ ! -x "$REPO_ROOT/scripts/team-dev-up.sh" ]; then
  fail "팀 개발 스택 실행 스크립트를 찾을 수 없습니다."
fi

log "개발 스택을 준비합니다."
"$REPO_ROOT/scripts/team-dev-up.sh"

log "frontend smoke 를 실행합니다."
(
  cd "$FRONTEND_DIR"
  SMOKE_SUITE=core npm run test:smoke
)

log "smoke 완료"
