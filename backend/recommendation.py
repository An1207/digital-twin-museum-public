from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

import models
from recommendation_providers import build_meta_provider, build_visual_provider
from runtime_config import ARTWORK_IMAGE_DIR, IMAGE_ROOT_DIR, MANIFEST_ROOT_DIR


THEME_KEYS = ("nature", "folk", "city", "war")
THEME_LABELS = {
    "nature": "자연",
    "folk": "민속",
    "city": "도시",
    "war": "전쟁",
}
THEME_KEYWORDS = {
    "nature": (
        "nature", "landscape", "forest", "river", "mountain", "sea", "garden",
        "flower", "spring", "summer", "autumn", "winter", "natural", "storm",
        "바다", "강", "산", "자연", "풍경", "꽃", "숲", "산수",
    ),
    "folk": (
        "folk", "daily", "market", "peasant", "village", "family", "festival",
        "genre", "민속", "생활", "시장", "풍속", "가족", "농부",
    ),
    "city": (
        "city", "urban", "street", "bridge", "port", "architecture", "interior",
        "portrait", "metropolitan", "도시", "거리", "항구", "건축", "초상",
    ),
    "war": (
        "war", "battle", "soldier", "weapon", "history", "royal", "religious",
        "saint", "martyr", "king", "queen", "전쟁", "전투", "역사", "왕", "성인",
    ),
}

ERA_KEYS = (
    "ancient",
    "medieval",
    "renaissance_baroque",
    "eighteenth_nineteenth",
    "modern_contemporary",
)
ERA_LABELS = {
    "ancient": "고대",
    "medieval": "중세",
    "renaissance_baroque": "르네상스·바로크",
    "eighteenth_nineteenth": "18-19세기",
    "modern_contemporary": "근현대",
}
ERA_YEAR_RANGES = {
    "ancient": (None, 499),
    "medieval": (500, 1399),
    "renaissance_baroque": (1400, 1699),
    "eighteenth_nineteenth": (1700, 1899),
    "modern_contemporary": (1900, None),
}
ERA_YEAR_RANGE_LABELS = {
    "ancient": "~499",
    "medieval": "500-1399",
    "renaissance_baroque": "1400-1699",
    "eighteenth_nineteenth": "1700-1899",
    "modern_contemporary": "1900~",
}
ERA_HINTS = {
    "ancient": (
        "ancient", "egyptian", "roman", "greek", "pharaoh", "stela", "bowl",
        "scarab", "amulet", "bronze", "terracotta", "고대", "이집트",
    ),
    "medieval": (
        "medieval", "byzantine", "icon", "gothic", "illuminated", "manuscript",
        "buddhist", "cross", "sutra", "중세", "불화",
    ),
    "renaissance_baroque": (
        "renaissance", "baroque", "mannerist", "altarpiece", "madonna", "saint",
        "biblical", "holy family", "르네상스", "바로크",
    ),
    "eighteenth_nineteenth": (
        "rococo", "neoclassical", "romantic", "impressionism", "portrait", "landscape",
        "nineteenth", "eighteenth", "18th", "19th", "18세기", "19세기",
    ),
    "modern_contemporary": (
        "modern", "contemporary", "post-impressionism", "expressionism", "cubist",
        "abstract", "photograph", "cityscape", "20th", "21st", "근현대", "현대",
    ),
}

EMOTION_KEYS = ("serene", "dynamic", "sadness", "awe")
EMOTION_LABELS = {
    "serene": "평온",
    "dynamic": "역동",
    "sadness": "슬픔",
    "awe": "경이",
}
EMOTION_KEYWORDS = {
    "serene": (
        "calm", "serene", "still", "quiet", "rest", "sleep", "peace", "pastoral",
        "평온", "고요", "잔잔", "평화",
    ),
    "dynamic": (
        "dynamic", "storm", "battle", "action", "dance", "running", "energy",
        "역동", "격렬", "활기", "폭풍",
    ),
    "sadness": (
        "sad", "melancholy", "grief", "lamentation", "lonely", "death", "mourning",
        "슬픔", "애잔", "쓸쓸", "비애",
    ),
    "awe": (
        "awe", "majestic", "holy", "sublime", "miracle", "divine", "epic",
        "경이", "웅장", "장엄", "신성",
    ),
}

FEATURE_VERSION = "hybrid-v2-meta-year"
VISUAL_VECTOR_SIZE = 512

_VISUAL_PROVIDER = None
_META_PROVIDER = None
_SOURCE_METADATA_CACHE: dict[tuple[str, str], dict[str, Any] | None] = {}


@dataclass
class RecommendationResult:
    artwork: models.Artwork
    feature: models.ArtworkRecommendationFeature
    final_score: float
    visual_score: float
    theme_score: float
    era_score: float
    emotion_score: float
    reasons: list[str]


def _normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[\w가-힣]+", _normalize_text(text))


def _base_distribution(keys: Iterable[str]) -> dict[str, float]:
    keys = list(keys)
    if not keys:
        return {}
    base = round(1.0 / len(keys), 4)
    return {key: base for key in keys}


def _normalized_distribution(
    raw_scores: dict[str, float] | None,
    keys: tuple[str, ...],
    fallback: dict[str, float] | None = None,
) -> dict[str, float]:
    base = fallback or _base_distribution(keys)
    if not raw_scores:
        return dict(base)

    coerced = {key: max(0.0, float(raw_scores.get(key, 0.0))) for key in keys}
    total = sum(coerced.values())
    if total <= 0:
        return dict(base)
    return {key: round(coerced[key] / total, 4) for key in keys}


def _score_from_keywords(
    texts: Iterable[str],
    keys: tuple[str, ...],
    keyword_map: dict[str, tuple[str, ...]],
) -> dict[str, float]:
    normalized_texts = [_normalize_text(text) for text in texts if text]
    combined = " ".join(normalized_texts)
    tokens: list[str] = []
    for text in normalized_texts:
        tokens.extend(_tokenize(text))

    scores = {key: 0.0 for key in keys}
    for key in keys:
        for keyword in keyword_map[key]:
            normalized_keyword = _normalize_text(keyword)
            if normalized_keyword in combined or normalized_keyword in tokens:
                scores[key] += 1.0

    if all(value == 0.0 for value in scores.values()):
        return _base_distribution(keys)

    total = sum(scores.values())
    return {key: round(scores[key] / total, 4) for key in keys}


def derive_era_key_from_year(year: int | None) -> str:
    if year is None:
        return "modern_contemporary"
    if year <= 499:
        return "ancient"
    if year <= 1399:
        return "medieval"
    if year <= 1699:
        return "renaissance_baroque"
    if year <= 1899:
        return "eighteenth_nineteenth"
    return "modern_contemporary"


def derive_era_label_from_year(year: int | None) -> str:
    return ERA_LABELS[derive_era_key_from_year(year)]


def year_range_label_for_era(era_key: str) -> str:
    return ERA_YEAR_RANGE_LABELS.get(era_key, "")


def format_year_display(year: int | None, estimated: bool = False) -> str:
    if year is None or year == 0:
        return "Unknown year"
    return f"c. {year}" if estimated else str(year)


def _infer_era_scores(texts: Iterable[str], year: int | None) -> dict[str, float]:
    if year is not None:
        era_key = derive_era_key_from_year(year)
        return {key: round(1.0 if key == era_key else 0.0, 4) for key in ERA_KEYS}

    return _score_from_keywords(texts, ERA_KEYS, ERA_HINTS)


def _hash_to_unit_vector(payload: str, size: int = VISUAL_VECTOR_SIZE) -> list[float]:
    digest = hashlib.sha256(payload.encode("utf-8")).digest()
    values: list[float] = []
    for idx in range(size):
        byte = digest[idx % len(digest)]
        values.append((byte / 255.0) * 2 - 1)

    norm = math.sqrt(sum(value * value for value in values)) or 1.0
    return [round(value / norm, 6) for value in values]


def _blend_vectors(*vectors: list[float]) -> list[float]:
    valid_vectors = [vector for vector in vectors if vector]
    if not valid_vectors:
        return []

    size = len(valid_vectors[0])
    blended = [0.0] * size
    for vector in valid_vectors:
        if len(vector) != size:
            continue
        for index in range(size):
            blended[index] += vector[index]

    norm = math.sqrt(sum(value * value for value in blended)) or 1.0
    return [round(value / norm, 6) for value in blended]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    cosine = dot / (left_norm * right_norm)
    return max(0.0, min(1.0, (cosine + 1) / 2))


def _one_hot_query(key: str, keys: tuple[str, ...]) -> dict[str, float]:
    return {candidate: 1.0 if candidate == key else 0.0 for candidate in keys}


def _distribution_similarity(query: dict[str, float], candidate: dict[str, float]) -> float:
    if not candidate:
        return 0.0
    score = sum(query.get(key, 0.0) * candidate.get(key, 0.0) for key in query)
    return max(0.0, min(1.0, score))


def _get_visual_provider():
    global _VISUAL_PROVIDER
    if _VISUAL_PROVIDER is None:
        _VISUAL_PROVIDER = build_visual_provider()
    return _VISUAL_PROVIDER


def _get_meta_provider():
    global _META_PROVIDER
    if _META_PROVIDER is None:
        _META_PROVIDER = build_meta_provider()
    return _META_PROVIDER


def resolve_image_path(image_path: str | None) -> Path | None:
    if not image_path:
        return None

    candidate = Path(image_path)
    if candidate.is_absolute() and candidate.exists():
        return candidate

    normalized = image_path.lstrip("/")
    direct = IMAGE_ROOT_DIR / normalized
    if direct.exists():
        return direct

    artwork_candidate = ARTWORK_IMAGE_DIR / image_path
    if artwork_candidate.exists():
        return artwork_candidate

    return None


def build_visual_query(theme_key: str, era_key: str, emotion_key: str) -> list[float]:
    visual_provider = _get_visual_provider()
    query_text = (
        f"{THEME_LABELS.get(theme_key, theme_key)} themed museum artwork, "
        f"{ERA_LABELS.get(era_key, era_key)} period, "
        f"{EMOTION_LABELS.get(emotion_key, emotion_key)} mood"
    )
    if visual_provider and hasattr(visual_provider, "embed_text"):
        try:
            return visual_provider.embed_text(query_text).embedding
        except Exception:
            pass

    return _blend_vectors(
        _hash_to_unit_vector(f"theme:{theme_key}"),
        _hash_to_unit_vector(f"era:{era_key}"),
        _hash_to_unit_vector(f"emotion:{emotion_key}"),
    )


def score_artwork(
    artwork: models.Artwork,
    feature: models.ArtworkRecommendationFeature,
    theme_key: str,
    era_key: str,
    emotion_key: str,
) -> RecommendationResult:
    visual_query = build_visual_query(theme_key, era_key, emotion_key)
    return score_artwork_with_visual_query(
        artwork,
        feature,
        theme_key=theme_key,
        era_key=era_key,
        emotion_key=emotion_key,
        visual_query=visual_query,
    )


def score_artwork_with_visual_query(
    artwork: models.Artwork,
    feature: models.ArtworkRecommendationFeature,
    theme_key: str,
    era_key: str,
    emotion_key: str,
    visual_query: list[float],
) -> RecommendationResult:
    visual_score = round(_cosine_similarity(visual_query, feature.visual_embedding or []), 4)
    theme_score = round(_distribution_similarity(_one_hot_query(theme_key, THEME_KEYS), feature.theme_scores or {}), 4)
    era_score = round(_distribution_similarity(_one_hot_query(era_key, ERA_KEYS), feature.era_scores or {}), 4)
    emotion_score = round(_distribution_similarity(_one_hot_query(emotion_key, EMOTION_KEYS), feature.emotion_scores or {}), 4)
    final_score = round(
        visual_score * 0.35 +
        theme_score * 0.2 +
        era_score * 0.15 +
        emotion_score * 0.3,
        4,
    )

    ranked_components = sorted(
        (
            ("시각 유사도", visual_score),
            ("감정 일치", emotion_score),
            ("테마 일치", theme_score),
            ("시대 일치", era_score),
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    reasons = [f"{label} {score:.2f}" for label, score in ranked_components[:3]]

    return RecommendationResult(
        artwork=artwork,
        feature=feature,
        final_score=final_score,
        visual_score=visual_score,
        theme_score=theme_score,
        era_score=era_score,
        emotion_score=emotion_score,
        reasons=reasons,
    )


def latest_manifest_path() -> Path | None:
    if not MANIFEST_ROOT_DIR.exists():
        return None

    manifests = sorted(MANIFEST_ROOT_DIR.glob("artwork_catalog_manifest_*.csv"))
    return manifests[-1] if manifests else None


def load_manifest_records(path: Path | None = None) -> list[dict[str, str]]:
    manifest_path = path or latest_manifest_path()
    if manifest_path is None or not manifest_path.exists():
        return []

    with manifest_path.open("r", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def build_manifest_index(manifest_records: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    return {
        record.get("filename", "").strip(): record
        for record in manifest_records
        if record.get("filename")
    }


def sample_artwork_manifest_records(
    manifest_records: list[dict[str, str]] | None = None,
    limit: int = 50,
) -> list[dict[str, str]]:
    manifest_records = manifest_records or load_manifest_records()
    filtered = [
        record for record in manifest_records
        if record.get("filename", "").startswith("artwork2_")
    ]
    if len(filtered) <= limit:
        return filtered

    buckets: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for record in filtered:
        bucket_key = (
            _normalize_text(record.get("source")) or "unknown",
            _normalize_text(record.get("query")) or "unknown",
        )
        buckets[bucket_key].append(record)

    ordered_bucket_keys = sorted(buckets.keys())
    selected: list[dict[str, str]] = []
    bucket_indices = {key: 0 for key in ordered_bucket_keys}

    while len(selected) < limit:
        progressed = False
        for bucket_key in ordered_bucket_keys:
            bucket = buckets[bucket_key]
            index = bucket_indices[bucket_key]
            if index >= len(bucket):
                continue
            selected.append(bucket[index])
            bucket_indices[bucket_key] += 1
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            break

    return selected[:limit]


def _manifest_record_for_artwork(
    artwork: models.Artwork,
    manifest_records: list[dict[str, str]],
) -> dict[str, str] | None:
    if not manifest_records:
        return None

    expected_filename = (artwork.image_path or "").strip()
    if expected_filename:
        for record in manifest_records:
            if record.get("filename", "").strip() == expected_filename:
                return record

    expected_object_id = (artwork.source_object_id or "").strip()
    if expected_object_id:
        for record in manifest_records:
            if record.get("object_id", "").strip() == expected_object_id:
                return record

    normalized_title = _normalize_text(artwork.title)
    normalized_artist = _normalize_text(artwork.artist)
    for record in manifest_records:
        if normalized_title and normalized_title == _normalize_text(record.get("title")):
            record_artist = _normalize_text(record.get("artist"))
            if not normalized_artist or not record_artist or normalized_artist == record_artist:
                return record

    return None


def _safe_parse_year(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"(-?\d{3,4})", text)
    if not match:
        return None
    year = int(match.group(1))
    if year <= 0:
        return None
    return year


def _metadata_context_from_record(record: dict[str, str] | None) -> dict[str, str]:
    if not record:
        return {}
    return {
        "title": record.get("title") or "",
        "artist": record.get("artist") or "",
        "query": record.get("query") or "",
        "source": record.get("source") or "",
        "object_url": record.get("object_url") or "",
        "object_id": record.get("object_id") or "",
    }


def _fetch_json(url: str) -> dict[str, Any] | None:
    try:
        with urlopen(url, timeout=2) as response:
            if response.status != 200:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, ValueError):
        return None


def fetch_source_metadata(source: str | None, object_id: str | None) -> dict[str, Any] | None:
    normalized_source = _normalize_text(source)
    normalized_object_id = (object_id or "").strip()
    if not normalized_source or not normalized_object_id:
        return None

    cache_key = (normalized_source, normalized_object_id)
    if cache_key in _SOURCE_METADATA_CACHE:
        return _SOURCE_METADATA_CACHE[cache_key]

    payload = None
    if normalized_source == "met":
        payload = _fetch_json(
            f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{normalized_object_id}"
        )
    elif normalized_source == "cma":
        response = _fetch_json(
            f"https://openaccess-api.clevelandart.org/api/artworks/{normalized_object_id}"
        )
        payload = response.get("data") if response else None

    _SOURCE_METADATA_CACHE[cache_key] = payload
    return payload


def _extract_source_year(source: str | None, payload: dict[str, Any] | None) -> tuple[int | None, str | None]:
    if not source or not payload:
        return None, None

    normalized_source = _normalize_text(source)
    if normalized_source == "met":
        begin_year = _safe_parse_year(payload.get("objectBeginDate"))
        end_year = _safe_parse_year(payload.get("objectEndDate"))
        if begin_year and end_year:
            return round((begin_year + end_year) / 2), "Source API objectBeginDate/objectEndDate midpoint."
        if begin_year:
            return begin_year, "Source API objectBeginDate."
        object_date_year = _safe_parse_year(payload.get("objectDate"))
        if object_date_year:
            return object_date_year, "Source API objectDate."
        return None, None

    if normalized_source == "cma":
        creation_year = _safe_parse_year(payload.get("creation_date"))
        if creation_year:
            return creation_year, "Source API creation_date."
        date_text_year = _safe_parse_year(payload.get("date_text"))
        if date_text_year:
            return date_text_year, "Source API date_text."
        return None, None

    return None, None


def infer_recommendation_feature(
    artwork: models.Artwork,
    manifest_records: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    manifest_records = manifest_records or []
    manifest_record = _manifest_record_for_artwork(artwork, manifest_records)
    metadata_context = _metadata_context_from_record(manifest_record)
    source_metadata = fetch_source_metadata(metadata_context.get("source"), metadata_context.get("object_id"))
    source_year, source_year_reason = _extract_source_year(metadata_context.get("source"), source_metadata)

    raw_texts = [
        artwork.title,
        artwork.artist,
        artwork.main_thema,
        artwork.sub_thema,
        artwork.main_emotion,
        artwork.sub_emotion,
        artwork.era,
        artwork.source_query,
        metadata_context.get("title"),
        metadata_context.get("artist"),
        metadata_context.get("query"),
        metadata_context.get("source"),
        source_metadata.get("objectDate") if source_metadata else None,
        source_metadata.get("date_text") if source_metadata else None,
    ]

    theme_scores = _score_from_keywords(raw_texts, THEME_KEYS, THEME_KEYWORDS)
    emotion_scores = _score_from_keywords(raw_texts, EMOTION_KEYS, EMOTION_KEYWORDS)

    legacy_year = getattr(artwork, "era_year", None)
    if legacy_year == 0:
        legacy_year = None
    estimated_year = source_year or legacy_year
    estimated_year_reason = source_year_reason or "Existing artwork year retained."
    visual_summary = ""
    tags: list[str] = []
    rationale: list[str] = []
    visual_provider_name = "heuristic-visual-fallback"
    meta_provider_name = "heuristic-meta-fallback"

    image_source_path = resolve_image_path(
        artwork.image_path or (manifest_record.get("filename") if manifest_record else None)
    )

    meta_provider = _get_meta_provider()
    if meta_provider and image_source_path:
        try:
            meta_result = meta_provider.analyze_image(image_source_path, metadata_context=metadata_context)
            critique = meta_result.critique
            theme_scores = _normalized_distribution(critique.theme_scores, THEME_KEYS, theme_scores)
            emotion_scores = _normalized_distribution(critique.emotion_scores, EMOTION_KEYS, emotion_scores)
            estimated_year = _safe_parse_year(critique.estimated_year) or estimated_year
            estimated_year_reason = critique.estimated_year_reason or estimated_year_reason
            meta_provider_name = meta_result.provider_name
            if critique.title_guess:
                raw_texts.append(critique.title_guess)
            if critique.visual_summary:
                visual_summary = critique.visual_summary
                raw_texts.append(critique.visual_summary)
            tags = critique.tags or []
            rationale = critique.rationale or []
            raw_texts.extend(tags)
            raw_texts.extend(rationale)
        except Exception as exc:
            estimated_year_reason = f"AI meta fallback used after provider error: {exc.__class__.__name__}"
    elif source_year_reason:
        estimated_year_reason = source_year_reason
    elif manifest_record:
        estimated_year_reason = "Manifest metadata available, but AI year estimation was unavailable."
    else:
        estimated_year_reason = "No strong metadata source available; heuristic fallback used."

    era_scores = _infer_era_scores(raw_texts, estimated_year)
    derived_era_key = derive_era_key_from_year(estimated_year)
    derived_era_label_ko = ERA_LABELS[derived_era_key]
    metadata_source = "manifest" if manifest_record else "ai_fallback"

    visual_embedding = None
    visual_provider = _get_visual_provider()
    if visual_provider and image_source_path:
        try:
            visual_result = visual_provider.embed_image(image_source_path)
            visual_embedding = visual_result.embedding
            visual_provider_name = visual_result.provider_name
        except Exception:
            visual_embedding = None

    if visual_embedding is None:
        visual_embedding = _blend_vectors(
            _hash_to_unit_vector(" ".join(filter(None, raw_texts))),
            _hash_to_unit_vector(f"theme:{max(theme_scores, key=theme_scores.get)}"),
            _hash_to_unit_vector(f"era:{derived_era_key}"),
            _hash_to_unit_vector(f"emotion:{max(emotion_scores, key=emotion_scores.get)}"),
        )

    manifest_filename = manifest_record.get("filename") if manifest_record else None
    notes = {
        "metadata_source": metadata_source,
        "manifest_query": manifest_record.get("query") if manifest_record else None,
        "feature_mode": "manifest-first-ai-augmented",
        "mapped_theme": max(theme_scores, key=theme_scores.get),
        "mapped_emotion": max(emotion_scores, key=emotion_scores.get),
        "mapped_era": max(era_scores, key=era_scores.get),
        "estimated_year": estimated_year,
        "estimated_year_reason": estimated_year_reason,
        "derived_era_key": derived_era_key,
        "derived_era_label_ko": derived_era_label_ko,
        "visual_summary": visual_summary,
        "tags": tags,
        "rationale": rationale,
        "visual_provider": visual_provider_name,
        "meta_provider": meta_provider_name,
        "source_metadata_used": bool(source_metadata),
        "image_source_path": str(image_source_path) if image_source_path else None,
    }

    artwork_updates = {
        "title": (manifest_record.get("title") if manifest_record and manifest_record.get("title") else artwork.title),
        "artist": (manifest_record.get("artist") if manifest_record and manifest_record.get("artist") else artwork.artist),
        "image_path": manifest_filename or artwork.image_path,
        "source": (manifest_record.get("source") if manifest_record else artwork.source),
        "source_object_id": (manifest_record.get("object_id") if manifest_record else artwork.source_object_id),
        "source_query": (manifest_record.get("query") if manifest_record else artwork.source_query),
        "object_url": (manifest_record.get("object_url") if manifest_record else artwork.object_url),
        "is_public_domain": (
            str(manifest_record.get("is_public_domain", "")).strip().lower() == "true"
            if manifest_record else artwork.is_public_domain
        ),
        "era": derived_era_label_ko,
        "era_year": estimated_year or 0,
    }

    return {
        "feature_version": FEATURE_VERSION,
        "source_model": f"{visual_provider_name}+{meta_provider_name}",
        "visual_embedding": visual_embedding,
        "theme_scores": theme_scores,
        "era_scores": era_scores,
        "emotion_scores": emotion_scores,
        "recommendation_ready": True,
        "manifest_filename": manifest_filename,
        "notes": notes,
        "artwork_updates": artwork_updates,
    }


def bootstrap_artwork_seed_from_manifest_record(
    record: dict[str, str],
    artwork_id: int,
    owner_user_id: int | None = None,
) -> dict[str, Any]:
    raw_texts = [
        record.get("title"),
        record.get("artist"),
        record.get("query"),
        record.get("source"),
    ]
    theme_scores = _score_from_keywords(raw_texts, THEME_KEYS, THEME_KEYWORDS)
    emotion_scores = _score_from_keywords(raw_texts, EMOTION_KEYS, EMOTION_KEYWORDS)
    theme_key = max(theme_scores, key=theme_scores.get)
    emotion_key = max(emotion_scores, key=emotion_scores.get)

    return {
        "id": artwork_id,
        "owner_user_id": owner_user_id,
        "title": record.get("title") or f"Artwork {artwork_id}",
        "artist": record.get("artist") or None,
        "main_thema": THEME_LABELS[theme_key],
        "sub_thema": None,
        "main_emotion": EMOTION_LABELS[emotion_key],
        "sub_emotion": None,
        "era": "시대 추정 대기",
        "era_year": 0,
        "asset_folder_name": f"artwork2_sample_{artwork_id:03d}",
        "image_path": record.get("filename") or None,
        "source": record.get("source") or None,
        "source_object_id": record.get("object_id") or None,
        "source_query": record.get("query") or None,
        "object_url": record.get("object_url") or None,
        "is_public_domain": str(record.get("is_public_domain", "")).strip().lower() == "true",
    }
