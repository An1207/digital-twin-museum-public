#!/usr/bin/env python3

from database import SessionLocal, engine
from main import ensure_runtime_schema, refresh_recommendation_features
import models


def main():
    ensure_runtime_schema()
    models.Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        refresh_recommendation_features(db, force=True)
        count = db.query(models.ArtworkRecommendationFeature).count()
        print(f"rebuild complete: {count} recommendation features")
    finally:
        db.close()


if __name__ == "__main__":
    main()
