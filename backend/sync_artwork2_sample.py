#!/usr/bin/env python3

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from database import SessionLocal, engine
from main import ensure_runtime_schema, refresh_recommendation_features, _resolve_legacy_artwork_owner_user_id
import models
import recommendation


DB_PATH = Path(__file__).resolve().parent / "data" / "local_3dgs.db"


def backup_database() -> Path | None:
    if not DB_PATH.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = DB_PATH.with_name(f"{DB_PATH.stem}.bak_{timestamp}{DB_PATH.suffix}")
    shutil.copy2(DB_PATH, backup_path)
    return backup_path


def main():
    ensure_runtime_schema()
    models.Base.metadata.create_all(bind=engine)

    manifest_records = recommendation.load_manifest_records()
    sample_records = recommendation.sample_artwork_manifest_records(manifest_records, limit=50)
    if len(sample_records) != 50:
        raise SystemExit(f"expected 50 sampled records, got {len(sample_records)}")

    backup_path = backup_database()
    if backup_path:
        print(f"backup={backup_path}")

    db = SessionLocal()
    try:
        owner_user_id = _resolve_legacy_artwork_owner_user_id(db)
        db.query(models.ArtworkRecommendationFeature).delete()
        db.query(models.Artwork).delete()

        for index, record in enumerate(sample_records, start=1):
            payload = recommendation.bootstrap_artwork_seed_from_manifest_record(
                record,
                artwork_id=index,
                owner_user_id=owner_user_id,
            )
            db.add(models.Artwork(**payload))

        db.commit()
        refresh_recommendation_features(db, force=True)

        artwork_count = db.query(models.Artwork).count()
        feature_count = db.query(models.ArtworkRecommendationFeature).count()
        print(f"seeded_artworks={artwork_count}")
        print(f"seeded_features={feature_count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
