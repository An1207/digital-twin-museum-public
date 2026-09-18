#!/usr/bin/env bash
set -euo pipefail

startup_status_file="${STARTUP_STATUS_FILE:-/runtime/startup-status.json}"

write_status() {
  local percent="$1"
  local stage="$2"
  local message="$3"

  mkdir -p "$(dirname "$startup_status_file")"
  cat > "$startup_status_file" <<EOF
{
  "ready": false,
  "percent": $percent,
  "stage": "$stage",
  "message": "$message"
}
EOF
  echo "[startup] ${percent}% ${stage} - ${message}"
}

seed_dir_if_empty() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "$target_dir"
  if find "$target_dir" -mindepth 1 -print -quit | grep -q .; then
    return 0
  fi

  if [ -d "$source_dir" ] && find "$source_dir" -mindepth 1 -print -quit | grep -q .; then
    cp -R "$source_dir"/. "$target_dir"/
  fi
}

sqlite_scalar() {
  local db_path="$1"
  local sql="$2"

  python3 - "$db_path" "$sql" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
query = sys.argv[2]

try:
    connection = sqlite3.connect(db_path)
    cursor = connection.cursor()
    cursor.execute(query)
    row = cursor.fetchone()
    print(0 if row is None or row[0] is None else row[0])
except Exception:
    print(0)
finally:
    try:
        connection.close()
    except Exception:
        pass
PY
}

refresh_runtime_sqlite_from_seed_if_stale() {
  local seed_sqlite_path="/seed/sqlite/local_3dgs.db"

  if [ -z "$runtime_sqlite_path" ] || [ ! -f "$runtime_sqlite_path" ] || [ ! -f "$seed_sqlite_path" ]; then
    return 0
  fi

  local runtime_curator_spaces_count
  local seed_curator_spaces_count

  runtime_curator_spaces_count="$(sqlite_scalar "$runtime_sqlite_path" "SELECT COUNT(*) FROM curator_spaces")"
  seed_curator_spaces_count="$(sqlite_scalar "$seed_sqlite_path" "SELECT COUNT(*) FROM curator_spaces")"

  if [ "$runtime_curator_spaces_count" -eq 0 ] && [ "$seed_curator_spaces_count" -gt 0 ]; then
    write_status 12 "sqlite-resync" "Refreshing stale SQLite database from seed snapshot"
    cp "$runtime_sqlite_path" "${runtime_sqlite_path}.stale-$(date +%Y%m%d%H%M%S)"
    cp "$seed_sqlite_path" "$runtime_sqlite_path"
  fi
}

runtime_sqlite_path=""
if [[ "${DATABASE_URL:-}" == sqlite:////* ]]; then
  runtime_sqlite_path="/${DATABASE_URL#sqlite:////}"
fi

write_status 5 "bootstrap" "Preparing runtime volumes"

if [ -n "$runtime_sqlite_path" ]; then
  mkdir -p "$(dirname "$runtime_sqlite_path")"
  if [ ! -f "$runtime_sqlite_path" ] && [ -f /seed/sqlite/local_3dgs.db ]; then
    write_status 10 "sqlite-seed" "Seeding SQLite database"
    cp /seed/sqlite/local_3dgs.db "$runtime_sqlite_path"
  fi
fi

refresh_runtime_sqlite_from_seed_if_stale

write_status 15 "image-seed" "Seeding image and manifest data"
seed_dir_if_empty /seed/database/images "${IMAGE_ROOT:-/runtime/database/images}"
seed_dir_if_empty /seed/database/metadata "${MANIFEST_ROOT%/manifests}"

write_status 20 "asset-seed" "Seeding generated asset data"
seed_dir_if_empty /seed/assets "${ASSET_ROOT:-/runtime/assets}"

exec "$@"
