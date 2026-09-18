from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

if load_dotenv is not None:
    load_dotenv(BACKEND_DIR / ".env")


def resolve_runtime_path(raw_path: str | os.PathLike[str], base_dir: Path) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


DEFAULT_ASSET_ROOT = BACKEND_DIR / "local_assets"
DEFAULT_IMAGE_ROOT = PROJECT_ROOT / "database" / "images"
DEFAULT_MANIFEST_ROOT = PROJECT_ROOT / "database" / "metadata" / "manifests"
DEFAULT_SQLITE_PATH = BACKEND_DIR / "data" / "local_3dgs.db"
DEFAULT_STARTUP_STATUS_PATH = BACKEND_DIR / "data" / "startup_status.json"

ASSET_ROOT_DIR = resolve_runtime_path(
    os.getenv("ASSET_ROOT", str(DEFAULT_ASSET_ROOT)),
    BACKEND_DIR,
)
IMAGE_ROOT_DIR = resolve_runtime_path(
    os.getenv("IMAGE_ROOT", str(DEFAULT_IMAGE_ROOT)),
    PROJECT_ROOT,
)
MANIFEST_ROOT_DIR = resolve_runtime_path(
    os.getenv("MANIFEST_ROOT", str(DEFAULT_MANIFEST_ROOT)),
    PROJECT_ROOT,
)
ARTWORK_IMAGE_DIR = IMAGE_ROOT_DIR / "artworks"
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "").strip()
STARTUP_STATUS_FILE = resolve_runtime_path(
    os.getenv("STARTUP_STATUS_FILE", str(DEFAULT_STARTUP_STATUS_PATH)),
    PROJECT_ROOT,
)


def allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return ["http://localhost:3000", "http://127.0.0.1:3000"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def ensure_runtime_directories() -> None:
    ASSET_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    ARTWORK_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_ROOT_DIR.mkdir(parents=True, exist_ok=True)
    STARTUP_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)


def public_url(path: str) -> str:
    normalized = f"/{path.lstrip('/')}"
    if not PUBLIC_BASE_URL:
        return normalized
    return f"{PUBLIC_BASE_URL}{normalized}"


def asset_url(relative_output_path: str) -> str:
    return public_url(f"/assets/{relative_output_path.lstrip('/')}")
