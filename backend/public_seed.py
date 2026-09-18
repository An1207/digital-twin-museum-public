from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

import models
from runtime_config import asset_url


DEFAULT_SEED_PATH = Path(__file__).resolve().parent / "data" / "public_content_seed.json"


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _safe_asset_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("\\", "/").lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized.startswith("tts/") or not path.name or ".." in path.parts:
        return None
    return path.as_posix()


def seed_public_content(
    db: Session,
    owner_user_id: int,
    asset_root: Path,
    seed_path: Path | None = None,
) -> dict[str, int]:
    source_path = seed_path or DEFAULT_SEED_PATH
    if not source_path.is_file():
        return {"artworks": 0, "stories": 0, "tts": 0}

    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1:
        raise ValueError("Unsupported public content seed schema")

    counts = {"artworks": 0, "stories": 0, "tts": 0}
    for item in payload.get("artworks", []):
        artwork_id = int(item["id"])
        if db.get(models.Artwork, artwork_id) is not None:
            continue
        db.add(
            models.Artwork(
                id=artwork_id,
                owner_user_id=owner_user_id,
                title=str(item.get("title") or "Untitled"),
                artist=item.get("artist"),
                main_thema=item.get("mainThema"),
                sub_thema=item.get("subThema"),
                main_emotion=item.get("mainEmotion"),
                sub_emotion=item.get("subEmotion"),
                era=item.get("era"),
                era_year=item.get("eraYear"),
                asset_folder_name=str(item.get("assetFolderName") or f"asset_{artwork_id}"),
                image_path=item.get("imagePath"),
                source=item.get("source"),
                source_object_id=item.get("sourceObjectId"),
                source_query=item.get("sourceQuery"),
                object_url=item.get("objectUrl"),
                is_public_domain=bool(item.get("isPublicDomain", False)),
            )
        )
        counts["artworks"] += 1
    db.flush()

    stories = payload.get("stories", [])
    pending_stories = [
        item
        for item in stories
        if db.get(models.ArtworkStorytellingVersion, int(item["id"])) is None
        and db.get(models.Artwork, int(item["artworkId"])) is not None
    ]
    batch = None
    if pending_stories:
        artwork_ids = sorted({int(item["artworkId"]) for item in pending_stories})
        batch = models.ArtworkStorytellingGenerationBatch(
            created_by_user_id=owner_user_id,
            batch_name="Public content seed",
            global_note=None,
            selected_artwork_ids=artwork_ids,
            per_artwork_notes=None,
            provider_name="public-snapshot",
            model_name="import-v1",
            status="completed",
            result_count=len(pending_stories),
            request_payload_json={},
            response_payload_json=None,
        )
        db.add(batch)
        db.flush()

    for item in sorted(pending_stories, key=lambda value: int(value["id"])):
        artwork_id = int(item["artworkId"])
        version_number = int(item["versionNumber"])
        duplicate = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(
                models.ArtworkStorytellingVersion.artwork_id == artwork_id,
                models.ArtworkStorytellingVersion.version_number == version_number,
            )
            .first()
        )
        if duplicate is not None:
            continue
        db.add(
            models.ArtworkStorytellingVersion(
                id=int(item["id"]),
                artwork_id=artwork_id,
                batch_id=batch.id,
                created_by_user_id=owner_user_id,
                version_number=version_number,
                status="published",
                story_title=str(item["storyTitle"]),
                story_text=str(item["storyText"]),
                request_note=None,
                global_note=None,
                prompt_json={},
                generation_metadata_json=None,
                provider_name="public-snapshot",
                model_name="import-v1",
                published_at=_parse_datetime(item.get("publishedAt")),
                created_at=_parse_datetime(item.get("createdAt")) or datetime.utcnow(),
            )
        )
        counts["stories"] += 1
    db.flush()

    for item in payload.get("artworks", []):
        current_id = item.get("currentStorytellingVersionId")
        artwork = db.get(models.Artwork, int(item["id"]))
        version = db.get(models.ArtworkStorytellingVersion, int(current_id)) if current_id else None
        if artwork is not None and version is not None and version.artwork_id == artwork.id:
            artwork.current_storytelling_version_id = version.id

    for item in payload.get("ttsAssets", []):
        version_id = int(item["storytellingVersionId"])
        if db.get(models.ArtworkStorytellingVersion, version_id) is None:
            continue
        if db.query(models.TtsAsset).filter_by(storytelling_version_id=version_id).first() is not None:
            continue
        relative_path = _safe_asset_path(item.get("audioPath"))
        if relative_path is None or not (asset_root / PurePosixPath(relative_path)).is_file():
            continue
        db.add(
            models.TtsAsset(
                storytelling_version_id=version_id,
                provider_name="public-snapshot",
                model_name="pre-generated",
                voice_id=str(item.get("voiceId") or "Korean_CalmGentleman"),
                language_boost=str(item.get("languageBoost") or "Korean"),
                output_format="mp3",
                status="ready",
                audio_url=asset_url(relative_path),
                audio_path=relative_path,
                trace_id=None,
                audio_length=item.get("audioLength"),
                audio_size_bytes=item.get("audioSizeBytes"),
                error_message=None,
                provider_metadata=None,
            )
        )
        counts["tts"] += 1

    db.commit()
    return counts
