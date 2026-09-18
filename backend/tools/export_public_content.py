from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path, PurePosixPath
from typing import Any


SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)


def _rows(connection: sqlite3.Connection, query: str) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(query).fetchall()]


def _safe_audio_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("\\", "/").lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized.startswith("tts/") or not path.name or ".." in path.parts:
        return None
    return path.as_posix()


def _reject_secrets(value: Any) -> None:
    if isinstance(value, dict):
        for nested in value.values():
            _reject_secrets(nested)
    elif isinstance(value, list):
        for nested in value:
            _reject_secrets(nested)
    elif isinstance(value, str):
        for pattern in SECRET_PATTERNS:
            if pattern.search(value):
                raise ValueError("Secret-like value found in public content export")


def export_public_content(database_path: Path, output_path: Path) -> dict[str, int]:
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        artworks = _rows(
            connection,
            """
            SELECT id, title, artist, main_thema, sub_thema, main_emotion,
                   sub_emotion, era, era_year, asset_folder_name, image_path,
                   source, source_object_id, source_query, object_url,
                   is_public_domain, current_storytelling_version_id
            FROM artworks ORDER BY id
            """,
        )
        stories = _rows(
            connection,
            """
            SELECT id, artwork_id, version_number, story_title, story_text,
                   published_at, created_at
            FROM artwork_storytelling_versions
            WHERE status = 'published' AND trim(coalesce(story_text, '')) <> ''
            ORDER BY id
            """,
        )
        tts_rows = _rows(
            connection,
            """
            SELECT storytelling_version_id, voice_id, language_boost,
                   audio_path, audio_length, audio_size_bytes
            FROM tts_assets
            WHERE status = 'ready' AND audio_path IS NOT NULL
            ORDER BY storytelling_version_id
            """,
        )
    finally:
        connection.close()

    story_ids = {int(item["id"]) for item in stories}
    payload = {
        "schemaVersion": 1,
        "artworks": [
            {
                "id": item["id"],
                "title": item["title"],
                "artist": item["artist"],
                "mainThema": item["main_thema"],
                "subThema": item["sub_thema"],
                "mainEmotion": item["main_emotion"],
                "subEmotion": item["sub_emotion"],
                "era": item["era"],
                "eraYear": item["era_year"],
                "assetFolderName": item["asset_folder_name"],
                "imagePath": item["image_path"],
                "source": item["source"],
                "sourceObjectId": item["source_object_id"],
                "sourceQuery": item["source_query"],
                "objectUrl": item["object_url"],
                "isPublicDomain": bool(item["is_public_domain"]),
                "currentStorytellingVersionId": (
                    item["current_storytelling_version_id"]
                    if item["current_storytelling_version_id"] in story_ids
                    else None
                ),
            }
            for item in artworks
        ],
        "stories": [
            {
                "id": item["id"],
                "artworkId": item["artwork_id"],
                "versionNumber": item["version_number"],
                "storyTitle": item["story_title"],
                "storyText": item["story_text"],
                "publishedAt": item["published_at"],
                "createdAt": item["created_at"],
            }
            for item in stories
        ],
        "ttsAssets": [
            {
                "storytellingVersionId": item["storytelling_version_id"],
                "voiceId": item["voice_id"],
                "languageBoost": item["language_boost"],
                "audioPath": path,
                "audioLength": item["audio_length"],
                "audioSizeBytes": item["audio_size_bytes"],
            }
            for item in tts_rows
            if item["storytelling_version_id"] in story_ids
            if (path := _safe_audio_path(item["audio_path"])) is not None
        ],
    }
    _reject_secrets(payload)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {key: len(payload[key]) for key in ("artworks", "stories", "ttsAssets")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export allowlisted public museum content")
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(export_public_content(args.database.resolve(), args.output.resolve()))
