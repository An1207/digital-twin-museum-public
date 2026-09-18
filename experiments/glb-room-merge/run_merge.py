from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from placement import (
    MODEL_PLACEMENTS,
    PUBLIC_OUTPUT_PATH,
    PUBLIC_EXPERIMENT_DIR,
    SOURCE_DIR,
    SOURCE_MODEL_DIR,
    EXPERIMENT_ROOT,
)


BLENDER_SCRIPT = EXPERIMENT_ROOT / "blender_merge_room_space.py"
GLB_MAGIC = b"glTF"


def _which(command: str) -> str | None:
    for path_entry in os.getenv("PATH", "").split(os.pathsep):
        candidate = Path(path_entry) / command
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def ensure_blender_available(blender_bin: str) -> Path:
    candidate = Path(blender_bin).expanduser()
    if candidate.exists():
        return candidate.resolve()

    discovered = _which(blender_bin)
    if discovered:
        return Path(discovered).resolve()

    raise FileNotFoundError(f"Blender binary not found: {blender_bin}")


def copy_source_models() -> list[Path]:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_EXPERIMENT_DIR.mkdir(parents=True, exist_ok=True)

    copied: list[Path] = []
    for placement in MODEL_PLACEMENTS:
        source_path = SOURCE_MODEL_DIR / placement.filename
        if not source_path.exists():
            raise FileNotFoundError(f"Missing source GLB: {source_path}")
        target_path = SOURCE_DIR / placement.filename
        shutil.copy2(source_path, target_path)
        copied.append(target_path)
    return copied


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the room-merge Blender experiment.")
    parser.add_argument("--blender-bin", default=os.getenv("BLENDER_BIN", "blender"))
    parser.add_argument("--force", action="store_true", help="Overwrite the merged output if it already exists.")
    parser.add_argument(
        "--emit-stdout",
        action="store_true",
        help="Capture the Blender export from stdout and write it into the public output path.",
    )
    return parser.parse_args()


def extract_glb_bytes(stream: bytes) -> bytes:
    for offset in range(len(stream) - 12):
        if stream[offset : offset + 4] != GLB_MAGIC:
            continue
        version = int.from_bytes(stream[offset + 4 : offset + 8], "little")
        total_length = int.from_bytes(stream[offset + 8 : offset + 12], "little")
        if version != 2 or total_length < 12:
            continue
        end = offset + total_length
        if end <= len(stream):
            return stream[offset:end]
    raise RuntimeError("Could not locate a valid GLB payload in Blender stdout.")


def main() -> int:
    args = parse_args()
    blender_bin = ensure_blender_available(args.blender_bin)
    copy_source_models()

    if PUBLIC_OUTPUT_PATH.exists() and not args.force:
        print(f"[skip] merged output already exists: {PUBLIC_OUTPUT_PATH}")
        return 0

    command = [
        str(blender_bin),
        "--factory-startup",
        "--background",
        "--python",
        str(BLENDER_SCRIPT),
        "--",
        str(SOURCE_DIR),
        str(PUBLIC_OUTPUT_PATH),
    ]
    if args.emit_stdout:
        command.append("--emit-stdout")

    result = subprocess.run(command, cwd=EXPERIMENT_ROOT.parent, capture_output=True)
    if result.returncode != 0:
        if result.stderr:
            sys.stderr.buffer.write(result.stderr)
        raise SystemExit(result.returncode)

    if args.emit_stdout:
        if not result.stdout:
            raise RuntimeError("Blender stdout export returned no data.")
        PUBLIC_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        PUBLIC_OUTPUT_PATH.write_bytes(extract_glb_bytes(result.stdout))

    print(f"[done] merged GLB written to {PUBLIC_OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
