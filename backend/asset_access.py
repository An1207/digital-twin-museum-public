"""Apply database visibility to private space files and storytelling audio."""
from pathlib import PurePosixPath

from fastapi import HTTPException, Request
from fastapi.staticfiles import StaticFiles

import models
from auth import AUTH_BEARER, get_current_principal_optional
from database import SessionLocal


class ProtectedAssets(StaticFiles):
    async def get_response(self, path, scope):
        normalized = path.replace("\\", "/")
        parts = PurePosixPath(normalized).parts
        if any(part.startswith(".") for part in parts):
            raise HTTPException(status_code=404)
        if PurePosixPath(normalized).suffix.lower() not in {".glb", ".gltf", ".mp3", ".wav", ".png", ".jpg", ".jpeg", ".webp"}:
            raise HTTPException(status_code=404)
        if parts and parts[0].casefold() in {"curator-space-files", "tts"}:
            with SessionLocal() as db:
                owner_id, published = None, False
                if parts[0].casefold() == "curator-space-files":
                    record = db.query(models.CuratorSpaceFile).filter(
                        models.CuratorSpaceFile.stored_file_path == normalized,
                        models.CuratorSpaceFile.deleted_at.is_(None),
                    ).first()
                    if record:
                        owner_id = record.owner_user_id
                        space = db.query(models.CuratorSpace).filter(
                            models.CuratorSpace.id == record.space_id,
                            models.CuratorSpace.deleted_at.is_(None),
                        ).first()
                        published = space is not None and space.status == "published"
                else:
                    result = db.query(models.TtsAsset, models.ArtworkStorytellingVersion, models.Artwork).join(
                        models.ArtworkStorytellingVersion, models.ArtworkStorytellingVersion.id == models.TtsAsset.storytelling_version_id,
                    ).join(models.Artwork, models.Artwork.id == models.ArtworkStorytellingVersion.artwork_id).filter(
                        models.TtsAsset.audio_path == normalized,
                    ).first()
                    if result:
                        asset, version, artwork = result
                        owner_id = artwork.owner_user_id
                        published = version.status == "published" and asset.status == "ready"
                if not published:
                    credentials = await AUTH_BEARER(Request(scope))
                    principal = get_current_principal_optional(credentials, db)
                    if owner_id is None or principal is None or (principal.user_id != owner_id and "admin" not in principal.roles):
                        raise HTTPException(status_code=404)
        response = await super().get_response(path, scope)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "private, no-store"
        return response
