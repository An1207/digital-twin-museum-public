#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

from recommendation import BACKGROUND_IMAGE_DIR
from recommendation_providers import OpenAIVisionMetaProvider, ProviderUnavailableError


OUTPUT_DIR = Path(__file__).resolve().parent / "data" / "evaluation_reports"


def pick_test_images(limit: int = 10) -> list[Path]:
    return sorted(path for path in BACKGROUND_IMAGE_DIR.iterdir() if path.is_file())[:limit]


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    images = pick_test_images(10)
    if len(images) < 10:
        raise SystemExit(f"Expected at least 10 images in {BACKGROUND_IMAGE_DIR}")

    try:
        provider = OpenAIVisionMetaProvider()
    except ProviderUnavailableError as exc:
        raise SystemExit(f"blocked: {exc}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = OUTPUT_DIR / f"background_eval_{timestamp}.json"
    csv_path = OUTPUT_DIR / f"background_eval_{timestamp}.csv"

    results: list[dict] = []
    for image_path in images:
        meta = provider.analyze_image(image_path)
        critique = meta.critique
        row = {
            "filename": image_path.name,
            "provider": meta.provider_name,
            "title_guess": critique.title_guess,
            "visual_summary": critique.visual_summary,
            "theme_scores": critique.theme_scores,
            "era_scores": critique.era_scores,
            "emotion_scores": critique.emotion_scores,
            "estimated_year": critique.estimated_year,
            "estimated_year_reason": critique.estimated_year_reason,
            "tags": critique.tags,
            "rationale": critique.rationale,
        }
        results.append(row)
        print(f"evaluated {image_path.name}")

    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "filename",
                "provider",
                "title_guess",
                "visual_summary",
                "theme_scores",
                "era_scores",
                "emotion_scores",
                "estimated_year",
                "estimated_year_reason",
                "tags",
                "rationale",
            ],
        )
        writer.writeheader()
        for row in results:
            writer.writerow(
                {
                    **row,
                    "theme_scores": json.dumps(row["theme_scores"], ensure_ascii=False),
                    "era_scores": json.dumps(row["era_scores"], ensure_ascii=False),
                    "emotion_scores": json.dumps(row["emotion_scores"], ensure_ascii=False),
                    "tags": json.dumps(row["tags"], ensure_ascii=False),
                    "rationale": json.dumps(row["rationale"], ensure_ascii=False),
                }
            )

    print(f"json={json_path}")
    print(f"csv={csv_path}")


if __name__ == "__main__":
    main()
