#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"
echo "== docker compose ps =="
docker compose -f docker-compose.dev.yml ps
echo
echo "== backend startup status =="
curl -fsS http://localhost:8000/startup-status || echo "backend startup status unavailable"
