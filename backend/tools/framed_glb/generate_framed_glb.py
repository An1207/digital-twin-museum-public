from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from database import Base, engine
from database import SessionLocal
import models
from recommendation import resolve_image_path
from runtime_config import ASSET_ROOT_DIR

TOOLS_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_NAME = "framed_artwork.glb"
DEFAULT_MAX_ITEMS = 20
DEFAULT_BLENDER_BIN = os.getenv("BLENDER_BIN") or "blender"
DEFAULT_BLENDER_MCP_PORT = os.getenv("BLENDER_MCP_PORT", "9876")
BLENDER_SCRIPT_PATH = TOOLS_DIR / "blender_make_frame_glb.py"
CURRENT_FRAME_GENERATOR_VERSION = "fit_v2_front_v1"


ASSET_ROOT = ASSET_ROOT_DIR


@dataclass
class GenerationTarget:
    artwork_id: int
    title: str
    asset_folder_name: str
    image_source_path: Path
    output_path: Path


def compute_fitted_frame_geometry(image_path: Path, target_long_edge: float, frame_thickness: float) -> dict[str, float | int | str]:
    with Image.open(image_path) as image:
        pixel_width, pixel_height = image.size

    if pixel_width <= 0 or pixel_height <= 0:
        raise ValueError(f"Invalid image size for {image_path}: {pixel_width}x{pixel_height}")

    if pixel_width >= pixel_height:
        artwork_width = target_long_edge
        artwork_height = target_long_edge * (pixel_height / pixel_width)
    else:
        artwork_height = target_long_edge
        artwork_width = target_long_edge * (pixel_width / pixel_height)

    return {
        "image_pixel_width": pixel_width,
        "image_pixel_height": pixel_height,
        "image_orientation": "portrait" if pixel_height > pixel_width else "landscape",
        "artwork_width_units": artwork_width,
        "artwork_height_units": artwork_height,
        "frame_outer_width_units": artwork_width + frame_thickness * 2,
        "frame_outer_height_units": artwork_height + frame_thickness * 2,
    }


def ensure_generated_asset_schema() -> None:
    Base.metadata.create_all(bind=engine)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate framed GLB assets from artwork images using Blender."
    )
    parser.add_argument("--artwork-id", type=int, help="Single artwork id to generate.")
    parser.add_argument("--batch", action="store_true", help="Generate multiple artworks from the DB.")
    parser.add_argument("--max-items", type=int, default=DEFAULT_MAX_ITEMS, help="Max batch items to process.")
    parser.add_argument("--limit", type=int, help="Optional DB query limit before applying max-items.")
    parser.add_argument("--offset", type=int, default=0, help="DB query offset for batch mode.")
    parser.add_argument("--source", help="Filter by artwork source.")
    parser.add_argument("--query", help="Filter by artwork source_query substring.")
    parser.add_argument("--only-public-domain", action="store_true", help="Only process public-domain artworks.")
    parser.add_argument("--image-path", help="Override source image path for single mode.")
    parser.add_argument("--output-name", default=DEFAULT_OUTPUT_NAME, help="Output GLB filename inside asset folder.")
    parser.add_argument("--blender-bin", default=DEFAULT_BLENDER_BIN, help="Path to Blender binary.")
    parser.add_argument("--blender-mcp-port", default=DEFAULT_BLENDER_MCP_PORT, help="Optional MCP port to expose to Blender process.")
    parser.add_argument("--artwork-width", type=float, default=2.0, help="Target long-edge size for the visible artwork plane.")
    parser.add_argument("--frame-thickness", type=float, default=0.12)
    parser.add_argument("--board-depth", type=float, default=0.06)
    parser.add_argument("--frame-depth", type=float, default=0.10)
    parser.add_argument("--force", action="store_true", help="Overwrite existing GLB output.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned work without running Blender.")
    parser.add_argument("--keep-going", action="store_true", help="Continue after per-item failures.")
    args = parser.parse_args()

    if not args.batch and args.artwork_id is None:
        parser.error("Provide --artwork-id for single mode or use --batch.")
    if args.batch and args.max_items <= 0:
        parser.error("--max-items must be greater than 0.")
    if not args.batch and args.max_items != DEFAULT_MAX_ITEMS:
        print("[warn] --max-items is ignored in single mode.", file=sys.stderr)

    return args


def ensure_blender_available(blender_bin: str) -> Path:
    blender_path = Path(blender_bin).expanduser()
    if blender_path.exists():
        return blender_path.resolve()

    discovered = shutil_which(blender_bin)
    if discovered:
        return Path(discovered).resolve()

    raise FileNotFoundError(
        f"Blender binary not found: {blender_bin}. Set --blender-bin or BLENDER_BIN."
    )


def shutil_which(command: str) -> str | None:
    for path_entry in os.getenv("PATH", "").split(os.pathsep):
        candidate = Path(path_entry) / command
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def query_artworks(args: argparse.Namespace) -> list[models.Artwork]:
    db = SessionLocal()
    try:
        query = db.query(models.Artwork).order_by(models.Artwork.id)
        if args.artwork_id is not None:
            artwork = query.filter(models.Artwork.id == args.artwork_id).first()
            return [artwork] if artwork else []

        if args.source:
            query = query.filter(models.Artwork.source == args.source)
        if args.query:
            query = query.filter(models.Artwork.source_query.ilike(f"%{args.query}%"))
        if args.only_public_domain:
            query = query.filter(models.Artwork.is_public_domain.is_(True))
        if args.offset:
            query = query.offset(args.offset)
        if args.limit:
            query = query.limit(args.limit)
        rows = query.all()
        return rows[: args.max_items]
    finally:
        db.close()


def resolve_target(artwork: models.Artwork, args: argparse.Namespace) -> GenerationTarget:
    source_image = Path(args.image_path).expanduser().resolve() if args.image_path else resolve_image_path(artwork.image_path)
    if source_image is None or not source_image.exists():
        raise FileNotFoundError(
            f"Unable to resolve image for artwork_id={artwork.id} image_path={artwork.image_path!r}"
        )

    output_dir = ASSET_ROOT / artwork.asset_folder_name
    output_path = output_dir / args.output_name
    return GenerationTarget(
        artwork_id=artwork.id,
        title=artwork.title or f"Artwork {artwork.id}",
        asset_folder_name=artwork.asset_folder_name,
        image_source_path=source_image,
        output_path=output_path,
    )


def relative_output_path_for_db(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ASSET_ROOT))
    except ValueError:
        return str(path.resolve())


def get_generated_asset_record(db, artwork_id: int, asset_kind: str = "framed_glb"):
    return (
        db.query(models.ArtworkGeneratedAsset)
        .filter(
            models.ArtworkGeneratedAsset.artwork_id == artwork_id,
            models.ArtworkGeneratedAsset.asset_kind == asset_kind,
        )
        .first()
    )


def is_current_generated_asset(record: models.ArtworkGeneratedAsset | None) -> bool:
    if record is None or record.status != "ready":
        return False

    notes = record.notes if isinstance(record.notes, dict) else {}
    return (
        notes.get("fit_mode") == "long_edge"
        and notes.get("rotation_fix_version") == "baked_v1"
        and notes.get("generator_version") == CURRENT_FRAME_GENERATOR_VERSION
    )


def upsert_generated_asset_record(
    db,
    target: GenerationTarget,
    status: str,
    notes: dict | None = None,
) -> models.ArtworkGeneratedAsset:
    record = get_generated_asset_record(db, target.artwork_id)
    now = datetime.utcnow()
    file_size = target.output_path.stat().st_size if target.output_path.exists() else None
    payload = {
        "status": status,
        "file_name": target.output_path.name,
        "relative_output_path": relative_output_path_for_db(target.output_path),
        "source_image_path": str(target.image_source_path),
        "file_size_bytes": file_size,
        "notes": notes or {},
        "updated_at": now,
    }

    if record is None:
        record = models.ArtworkGeneratedAsset(
            artwork_id=target.artwork_id,
            asset_kind="framed_glb",
            generated_at=now,
            **payload,
        )
        db.add(record)
    else:
        for key, value in payload.items():
            setattr(record, key, value)

    db.commit()
    return record


def build_blender_command(
    blender_bin: Path,
    target: GenerationTarget,
    args: argparse.Namespace,
    geometry: dict[str, float | int | str],
) -> list[str]:
    return [
        str(blender_bin),
        "--background",
        "--python",
        str(BLENDER_SCRIPT_PATH),
        "--",
        str(target.image_source_path),
        str(target.output_path),
        str(args.artwork_width),
        str(args.frame_thickness),
        str(args.board_depth),
        str(args.frame_depth),
        str(geometry["image_orientation"]),
    ]


def run_target(db, blender_bin: Path, target: GenerationTarget, args: argparse.Namespace) -> str:
    existing_record = get_generated_asset_record(db, target.artwork_id)
    if target.output_path.exists() and existing_record and is_current_generated_asset(existing_record) and not args.force:
        print(f"[skip] artwork_id={target.artwork_id} output exists: {target.output_path}")
        return "skipped"
    if target.output_path.exists() and existing_record and not is_current_generated_asset(existing_record):
        print(f"[regen] artwork_id={target.artwork_id} existing asset is stale; rebuilding.")
        if not args.force:
            target.output_path.unlink(missing_ok=True)
    if target.output_path.exists() and not existing_record:
        upsert_generated_asset_record(
            db,
            target,
            status="ready",
            notes={"synced_existing_file": True},
        )
        if not args.force:
            print(f"[skip] artwork_id={target.artwork_id} existing file synced to DB: {target.output_path}")
            return "skipped"

    target.output_path.parent.mkdir(parents=True, exist_ok=True)
    if target.output_path.exists() and args.force:
        target.output_path.unlink()

    geometry = compute_fitted_frame_geometry(
        target.image_source_path,
        args.artwork_width,
        args.frame_thickness,
    )
    command = build_blender_command(blender_bin, target, args, geometry)
    print(
        f"[run] artwork_id={target.artwork_id} asset={target.asset_folder_name} "
        f"image={target.image_source_path.name} output={target.output_path.name} "
        f"px={geometry['image_pixel_width']}x{geometry['image_pixel_height']} "
        f"orientation={geometry['image_orientation']} "
        f"art={geometry['artwork_width_units']:.4f}x{geometry['artwork_height_units']:.4f}"
    )

    if args.dry_run:
        print(f"       {' '.join(command)}")
        return "planned"

    env = os.environ.copy()
    env["BLENDER_MCP_PORT"] = str(args.blender_mcp_port)
    result = subprocess.run(
        command,
        cwd=BACKEND_DIR.parent,
        env=env,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        upsert_generated_asset_record(
            db,
            target,
            status="failed",
            notes={"stderr": result.stderr[-4000:], "stdout": result.stdout[-4000:]},
        )
        raise RuntimeError(
            f"Blender export failed for artwork_id={target.artwork_id}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    if result.stdout.strip():
        print(result.stdout.strip())

    # Verify the GLB file was actually created even when Blender exits 0.
    # bpy.ops.export_scene.gltf can silently cancel without raising an error.
    if not target.output_path.exists():
        error_detail = (result.stderr or result.stdout or "").strip()[-2000:]
        upsert_generated_asset_record(
            db,
            target,
            status="failed",
            notes={
                "error": "Blender exited 0 but output GLB file was not created.",
                "stderr": error_detail,
            },
        )
        raise RuntimeError(
            f"Blender exited 0 but GLB not created for artwork_id={target.artwork_id}: {target.output_path}"
        )

    upsert_generated_asset_record(
        db,
        target,
        status="ready",
        notes={
            "blender_mcp_port": str(args.blender_mcp_port),
            "generator_version": CURRENT_FRAME_GENERATOR_VERSION,
            "fit_mode": "long_edge",
            "rotation_fix_version": "baked_v1",
            **geometry,
        },
    )
    return "generated"


def iter_targets(artworks: Iterable[models.Artwork], args: argparse.Namespace) -> list[GenerationTarget]:
    targets: list[GenerationTarget] = []
    for artwork in artworks:
        if artwork is None:
            continue
        targets.append(resolve_target(artwork, args))
    return targets


def build_runtime_args(
    *,
    artwork_id: int,
    batch: bool = False,
    max_items: int = DEFAULT_MAX_ITEMS,
    limit: int | None = None,
    offset: int = 0,
    source: str | None = None,
    query: str | None = None,
    only_public_domain: bool = False,
    image_path: str | None = None,
    output_name: str = DEFAULT_OUTPUT_NAME,
    blender_bin: str = DEFAULT_BLENDER_BIN,
    blender_mcp_port: str = DEFAULT_BLENDER_MCP_PORT,
    artwork_width: float = 2.0,
    frame_thickness: float = 0.12,
    board_depth: float = 0.06,
    frame_depth: float = 0.10,
    force: bool = False,
    dry_run: bool = False,
    keep_going: bool = False,
) -> argparse.Namespace:
    return argparse.Namespace(
        artwork_id=artwork_id,
        batch=batch,
        max_items=max_items,
        limit=limit,
        offset=offset,
        source=source,
        query=query,
        only_public_domain=only_public_domain,
        image_path=image_path,
        output_name=output_name,
        blender_bin=blender_bin,
        blender_mcp_port=blender_mcp_port,
        artwork_width=artwork_width,
        frame_thickness=frame_thickness,
        board_depth=board_depth,
        frame_depth=frame_depth,
        force=force,
        dry_run=dry_run,
        keep_going=keep_going,
    )


def main() -> int:
    args = parse_args()
    ensure_generated_asset_schema()
    blender_bin = ensure_blender_available(args.blender_bin)
    artworks = query_artworks(args)
    if not artworks:
        print("[error] No artworks matched the request.", file=sys.stderr)
        return 1

    generated = 0
    planned = 0
    skipped = 0
    failed = 0

    try:
        targets = iter_targets(artworks, args)
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    print(
        f"[info] mode={'batch' if args.batch else 'single'} items={len(targets)} "
        f"asset_root={ASSET_ROOT} blender={blender_bin} mcp_port={args.blender_mcp_port}"
    )

    db = SessionLocal()
    try:
        for target in targets:
            try:
                status = run_target(db, blender_bin, target, args)
                if status == "skipped":
                    skipped += 1
                elif status == "planned":
                    planned += 1
                else:
                    generated += 1
            except Exception as exc:
                failed += 1
                print(f"[error] artwork_id={target.artwork_id} {exc}", file=sys.stderr)
                if not args.keep_going:
                    break
    finally:
        db.close()

    print(f"[summary] generated={generated} planned={planned} skipped={skipped} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
