from __future__ import annotations

import json
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from runtime_config import STARTUP_STATUS_FILE

_LOCK = Lock()
_STATE: dict[str, Any] = {
    "ready": False,
    "percent": 0,
    "stage": "booting",
    "message": "Booting",
    "updatedAt": None,
}


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_startup_status(
    percent: int,
    stage: str,
    message: str,
    *,
    ready: bool = False,
    log: bool = True,
) -> dict[str, Any]:
    payload = {
        "ready": ready,
        "percent": max(0, min(100, int(percent))),
        "stage": stage,
        "message": message,
        "updatedAt": _timestamp(),
    }

    with _LOCK:
        _STATE.update(payload)
        STARTUP_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
        STARTUP_STATUS_FILE.write_text(
            json.dumps(_STATE, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    if log:
        print(f"[startup] {payload['percent']}% {stage} - {message}", flush=True)
    return dict(_STATE)


def current_startup_status() -> dict[str, Any]:
    with _LOCK:
        return dict(_STATE)
