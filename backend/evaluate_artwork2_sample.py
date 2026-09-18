#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

import recommendation


OUTPUT_DIR = Path(__file__).resolve().parent / "data" / "evaluation_reports"


class SampleArtwork:
    def __init__(self, payload: dict):
        self.__dict__.update(payload)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_records = recommendation.load_manifest_records()
    sample_records = recommendation.sample_artwork_manifest_records(manifest_records, limit=50)
    if len(sample_records) != 50:
        raise SystemExit(f"expected 50 sampled records, got {len(sample_records)}")

    results: list[dict] = []
    for index, record in enumerate(sample_records, start=1):
        seed_payload = recommendation.bootstrap_artwork_seed_from_manifest_record(
            record,
            artwork_id=index,
        )
        artwork = SampleArtwork(seed_payload)
        feature_payload = recommendation.infer_recommendation_feature(artwork, manifest_records)
        notes = feature_payload["notes"]
        results.append(
            {
                "filename": record.get("filename"),
                "source": record.get("source"),
                "object_id": record.get("object_id"),
                "title": record.get("title"),
                "artist": record.get("artist"),
                "object_url": record.get("object_url"),
                "query": record.get("query"),
                "estimated_year": notes.get("estimated_year"),
                "estimated_year_reason": notes.get("estimated_year_reason"),
                "derived_era_key": notes.get("derived_era_key"),
                "derived_era_label_ko": notes.get("derived_era_label_ko"),
                "visual_embedding_dim": len(feature_payload["visual_embedding"]),
                "visual_embedding": feature_payload["visual_embedding"],
                "theme_scores": feature_payload["theme_scores"],
                "era_scores": feature_payload["era_scores"],
                "emotion_scores": feature_payload["emotion_scores"],
                "visual_summary": notes.get("visual_summary"),
                "tags": notes.get("tags"),
                "rationale": notes.get("rationale"),
                "metadata_source": notes.get("metadata_source"),
                "visual_provider": notes.get("visual_provider"),
                "meta_provider": notes.get("meta_provider"),
            }
        )
        print(f"evaluated {index:02d}/50 {record.get('filename')}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = OUTPUT_DIR / f"artwork2_sample_eval_{timestamp}.json"
    csv_path = OUTPUT_DIR / f"artwork2_sample_eval_{timestamp}.csv"

    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "filename",
                "source",
                "object_id",
                "title",
                "artist",
                "object_url",
                "query",
                "estimated_year",
                "estimated_year_reason",
                "derived_era_key",
                "derived_era_label_ko",
                "visual_embedding_dim",
                "theme_scores",
                "era_scores",
                "emotion_scores",
                "visual_summary",
                "tags",
                "rationale",
                "metadata_source",
                "visual_provider",
                "meta_provider",
            ],
        )
        writer.writeheader()
        for row in results:
            csv_row = {key: row[key] for key in writer.fieldnames}
            writer.writerow(
                {
                    **csv_row,
                    "theme_scores": json.dumps(csv_row["theme_scores"], ensure_ascii=False),
                    "era_scores": json.dumps(csv_row["era_scores"], ensure_ascii=False),
                    "emotion_scores": json.dumps(csv_row["emotion_scores"], ensure_ascii=False),
                    "tags": json.dumps(csv_row["tags"], ensure_ascii=False),
                    "rationale": json.dumps(csv_row["rationale"], ensure_ascii=False),
                }
            )

    print(f"json={json_path}")
    print(f"csv={csv_path}")


if __name__ == "__main__":
    main()
