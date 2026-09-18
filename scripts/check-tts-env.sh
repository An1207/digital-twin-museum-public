#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

log() {
  printf '[tts-check] %s\n' "$1"
}

fail() {
  printf '[tts-check] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' 명령이 없습니다."
}

require_cmd curl
require_cmd python3

if [ ! -f "$BACKEND_DIR/.venv/bin/python" ]; then
  fail "backend/.venv/bin/python 을 찾을 수 없습니다."
fi

log "MINIMAX_API_KEY 로드 여부를 확인합니다."
minimax_loaded="$(
  cd "$BACKEND_DIR"
  ./.venv/bin/python - <<'PY'
from runtime_config import MINIMAX_API_KEY
print("true" if bool(MINIMAX_API_KEY) else "false")
PY
)"

if [ "$minimax_loaded" != "true" ]; then
  fail "MINIMAX_API_KEY 가 backend/.env 에서 로드되지 않았습니다."
fi

log "backend health 를 확인합니다."
curl -fsS http://127.0.0.1:8000/health >/dev/null

log "TTS 환경 점검 완료"
