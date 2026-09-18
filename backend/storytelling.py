from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

import models


STORYTELLING_PROVIDER = os.getenv("STORYTELLING_PROVIDER", "openai").lower()
STORYTELLING_MODEL = os.getenv("STORYTELLING_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o"))
STORY_SENTENCE_MIN = 4
STORY_SENTENCE_MAX = 6
LEAKAGE_PATTERNS = (
    r"테마\s*일치",
    r"감정\s*일치",
    r"시각\s*유사도",
    r"선정\s*근거",
    r"score",
    r"request[_\s-]?note",
    r"global[_\s-]?note",
    r"prompt[_\s-]?json",
    r"json",
    r"keep the tone",
    r"keep the narration",
)


@dataclass(frozen=True)
class StorytellingArtifact:
    story_title: str
    story_text: str
    provider_name: str
    model_name: str
    prompt_json: dict[str, Any]
    generation_metadata_json: dict[str, Any]


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _normalize_list(values: Any, limit: int | None = None) -> list[str]:
    if not isinstance(values, list):
        return []
    items = [_clean_text(value) for value in values if _clean_text(value)]
    if limit is not None:
        items = items[:limit]
    return items


def _count_sentences(text: str) -> int:
    cleaned = _clean_text(text)
    if not cleaned:
        return 0
    pieces = [piece.strip() for piece in re.split(r"(?<=[.!?])\s+", cleaned) if piece.strip()]
    return len(pieces) if pieces else 1


def _has_story_leakage(text: str) -> bool:
    cleaned = _clean_text(text)
    if not cleaned:
        return True
    return any(re.search(pattern, cleaned, flags=re.IGNORECASE) for pattern in LEAKAGE_PATTERNS)


def _story_mode_from_profile(has_official_metadata: bool, has_reference_description: bool) -> str:
    if has_official_metadata and has_reference_description:
        return "fact-first"
    if has_official_metadata:
        return "fact-led"
    return "image-first"


def _quality_confidence(has_official_metadata: bool, has_reference_description: bool, tag_count: int) -> float:
    base = 0.5
    if has_official_metadata:
        base += 0.25
    if has_reference_description:
        base += 0.15
    if tag_count:
        base += min(0.1, tag_count * 0.02)
    return round(min(base, 0.98), 2)


def _derive_narrative_directive(request_note: str | None, global_note: str | None, score_reasons: list[str]) -> str:
    directives: list[str] = []
    if request_note:
        directives.append(_clean_text(request_note))
    if global_note:
        directives.append(_clean_text(global_note))
    if score_reasons:
        directives.append("품질 판단 참고용 내부 신호가 있음")
    if not directives:
        return "전시 설명문에 어울리는 차분한 한국어 서사"
    return " / ".join(directives[:3])


def _build_quality_signals(context: dict[str, Any], story_text: str) -> dict[str, Any]:
    fact_anchor = context.get("fact_anchor") or {}
    reference_profile = context.get("reference_profile") or {}
    creative_brief = context.get("creative_brief") or {}
    sentence_count = _count_sentences(story_text)
    has_official_metadata = bool(fact_anchor.get("has_official_metadata"))
    has_reference_description = bool(reference_profile.get("reference_description"))
    tag_count = len(reference_profile.get("tags") or [])
    mode = _clean_text(creative_brief.get("mode")) or _story_mode_from_profile(
        has_official_metadata=has_official_metadata,
        has_reference_description=has_reference_description,
    )
    confidence = _quality_confidence(has_official_metadata, has_reference_description, tag_count)
    leakage = _has_story_leakage(story_text)
    needs_review = leakage or sentence_count < STORY_SENTENCE_MIN or sentence_count > STORY_SENTENCE_MAX or not has_reference_description
    return {
        "mode": mode,
        "hasOfficialMetadata": has_official_metadata,
        "hasReferenceDescription": has_reference_description,
        "sentenceCount": sentence_count,
        "confidence": confidence,
        "needsReview": needs_review,
        "leakageDetected": leakage,
    }


def _build_reference_profile(feature: models.ArtworkRecommendationFeature | None) -> dict[str, Any]:
    notes = feature.notes if feature and isinstance(feature.notes, dict) else {}
    visual_summary = _clean_text(notes.get("visual_summary"))
    derived_era_label = _clean_text(notes.get("derived_era_label_ko"))
    mapped_theme = _clean_text(notes.get("mapped_theme"))
    mapped_emotion = _clean_text(notes.get("mapped_emotion"))
    tags = _normalize_list(notes.get("tags"), limit=5)
    source_metadata_used = bool(notes.get("source_metadata_used"))
    metadata_source = _clean_text(notes.get("metadata_source"))
    return {
        "metadata_source": metadata_source or None,
        "source_metadata_used": source_metadata_used,
        "reference_description": visual_summary or None,
        "reference_era_label": derived_era_label or None,
        "reference_theme": mapped_theme or None,
        "reference_emotion": mapped_emotion or None,
        "tags": tags,
        "estimated_year": notes.get("estimated_year"),
    }


def _resolve_artwork_classification(artwork: models.Artwork, reference_profile: dict[str, Any]) -> dict[str, Any]:
    theme_map = {
        "war": "전쟁",
        "nature": "자연",
        "folk": "민속",
        "city": "도시",
        "religion": "종교",
        "portrait": "초상",
        "still_life": "정물",
        "abstract": "추상",
    }
    emotion_map = {
        "serene": "평온",
        "dynamic": "역동",
        "awe": "경이",
        "sad": "슬픔",
        "melancholy": "슬픔",
        "tense": "긴장",
        "solemn": "엄숙",
        "quiet": "고요",
    }

    reference_theme = _clean_text(reference_profile.get("reference_theme"))
    reference_emotion = _clean_text(reference_profile.get("reference_emotion"))
    source_metadata_used = bool(reference_profile.get("source_metadata_used"))
    resolved_theme = theme_map.get(reference_theme, "") or _clean_text(artwork.main_thema)
    resolved_emotion = emotion_map.get(reference_emotion, "") or _clean_text(artwork.main_emotion)
    if not source_metadata_used:
        resolved_theme = ""
        resolved_emotion = ""
    return {
        "raw_main_thema": _clean_text(artwork.main_thema) or None,
        "raw_main_emotion": _clean_text(artwork.main_emotion) or None,
        "resolved_main_thema": resolved_theme or None,
        "resolved_main_emotion": resolved_emotion or None,
        "soft_main_thema": _clean_text(artwork.main_thema) or None,
        "soft_main_emotion": _clean_text(artwork.main_emotion) or None,
        "classification_source": "feature_notes" if source_metadata_used and (reference_theme or reference_emotion) else "soft_hint_only",
    }


def build_story_context(
    artwork: models.Artwork,
    feature: models.ArtworkRecommendationFeature | None = None,
    score: models.ArtworkRecommendationScore | None = None,
    *,
    request_note: str | None = None,
    global_note: str | None = None,
) -> dict[str, Any]:
    feature_notes = feature.notes if feature and isinstance(feature.notes, dict) else {}
    score_reasons = _normalize_list(score.reasons if score else [], limit=3)
    reference_profile = _build_reference_profile(feature)
    resolved_classification = _resolve_artwork_classification(artwork, reference_profile)
    has_official_metadata = bool(reference_profile.get("reference_description")) or bool(reference_profile.get("source_metadata_used"))
    story_mode = _story_mode_from_profile(
        has_official_metadata=has_official_metadata,
        has_reference_description=bool(reference_profile.get("reference_description")),
    )

    return {
        "fact_anchor": {
            "id": artwork.id,
            "title": artwork.title,
            "artist": artwork.artist,
            "era": artwork.era,
            "era_year": artwork.era_year,
            "main_thema": resolved_classification["resolved_main_thema"],
            "main_emotion": resolved_classification["resolved_main_emotion"],
            "raw_main_thema": resolved_classification["raw_main_thema"],
            "raw_main_emotion": resolved_classification["raw_main_emotion"],
            "soft_main_thema": resolved_classification["soft_main_thema"],
            "soft_main_emotion": resolved_classification["soft_main_emotion"],
            "classification_source": resolved_classification["classification_source"],
            "sub_thema": artwork.sub_thema,
            "sub_emotion": artwork.sub_emotion,
            "source": artwork.source,
            "source_object_id": artwork.source_object_id,
            "source_query": artwork.source_query,
            "object_url": artwork.object_url,
            "image_path": artwork.image_path,
            "has_official_metadata": has_official_metadata,
        },
        "reference_profile": reference_profile,
        "creative_brief": {
            "tone": "calm exhibition narration",
            "mode": story_mode,
            "narrative_directive": _derive_narrative_directive(request_note, global_note, score_reasons),
            "sentence_count": {
                "min": STORY_SENTENCE_MIN,
                "max": STORY_SENTENCE_MAX,
            },
            "classification": resolved_classification,
        },
        "diagnostic_context": {
            "request_note": request_note,
            "global_note": global_note,
            "score_reasons": score_reasons,
            "feature_notes": feature_notes,
        },
    }


def _fallback_story(context: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    artwork = context["fact_anchor"]
    reference_profile = context.get("reference_profile") or {}
    creative_brief = context.get("creative_brief") or {}
    title = _clean_text(artwork.get("title")) or f"작품 {artwork.get('id')}"
    artist = _clean_text(artwork.get("artist")) or "작가 미상"
    era = _clean_text(artwork.get("era")) or "알 수 없는 시대"
    year = artwork.get("era_year")
    year_text = str(year) if year is not None and _clean_text(year) else "미상"
    thema = _clean_text(artwork.get("main_thema")) or ""
    emotion = _clean_text(artwork.get("main_emotion")) or ""
    reference_description = _clean_text(reference_profile.get("reference_description"))
    reference_era_label = _clean_text(reference_profile.get("reference_era_label"))
    tags = _normalize_list(reference_profile.get("tags"), limit=3)
    mode = _clean_text(creative_brief.get("mode")) or "image-first"

    opening: str
    if reference_description:
        opening = f"{title}은 {reference_description}"
        if reference_era_label:
            opening += f". 이 작품은 {reference_era_label}의 감각을 바탕으로 읽을 수 있다"
        else:
            opening += f". {artist}의 {era} 맥락 안에서 작품을 바라보면"
        opening = opening.rstrip(".") + "."
    else:
        opening = f"{title}은 {artist}의 {era} 작품으로, {year_text}년 전후의 분위기를 담고 있다."

    if mode == "fact-first" and thema and emotion:
        middle = f"공식 정보가 주는 배경 위에서 보면, 화면의 {thema} 요소와 {emotion}의 정서가 서사의 중심을 이룬다."
    elif mode == "fact-led" and thema and emotion:
        middle = f"작품의 시대적 배경과 작가 정보는 이 장면을 이해하는 첫 번째 단서가 되고, {thema}의 흐름이 감정의 결을 만든다."
    else:
        middle = "이미지 자체를 따라가면 색감, 구도, 질감이 먼저 시선을 끌고, 작품은 특정한 이야기보다 인상과 분위기로 관람객에게 다가온다."

    if reference_description:
        detail = f"참조 설명이 있는 경우에는 이 작품이 보여주는 핵심 장면과 태도에 집중할 수 있다."
    else:
        detail = f"참조 설명이 없을 때는 형태, 색감, 구도, 표정 같은 시각 단서를 통해 의미를 해석해야 한다."

    if tags:
        tag_text = f"이 작품을 설명하는 단서는 {'·'.join(tags[:3])}에서도 확인된다."
    else:
        tag_text = f"이 작품은 관람자가 작품의 맥락을 직접 읽어내도록 여백을 남긴다."

    closing = (
        f"결국 관람자는 이 작품 앞에서 {era}라는 시간의 층위와 {emotion}의 분위기를 함께 느끼며, 작품이 남긴 인상을 자신만의 해석으로 완성하게 된다."
    )

    story_text = " ".join([opening, middle, detail, tag_text, closing])

    return title, story_text, {
        "highlights": [
            f"{thema} 중심 해석" if thema else "이미지 기반 해석",
            f"{emotion} 분위기 강조" if emotion else "색감과 구도 강조",
            f"{era} 시기 맥락",
        ],
        "qualitySignals": {
            "mode": mode,
            "hasOfficialMetadata": bool(artwork.get("has_official_metadata")),
            "confidence": _quality_confidence(
                bool(artwork.get("has_official_metadata")),
                bool(reference_description),
                len(tags),
            ),
            "needsReview": not bool(reference_description) or not bool(artwork.get("has_official_metadata")),
        },
        "factAnchor": artwork,
        "creativeBrief": creative_brief,
        "assumptions": [
            "이미지와 기본 메타를 바탕으로 전시 해설 톤을 유지했다.",
            "내부 점수와 요청 문구는 본문에 노출하지 않았다.",
        ],
    }


def _build_prompt(context: dict[str, Any]) -> list[dict[str, str]]:
    fact_anchor = context["fact_anchor"]
    reference_profile = context.get("reference_profile") or {}
    creative_brief = context.get("creative_brief") or {}
    diagnostic_context = context.get("diagnostic_context") or {}
    fact_anchor_payload = dict(fact_anchor)
    creative_brief_payload = dict(creative_brief)
    if fact_anchor.get("classification_source") == "soft_hint_only":
        for key in ("main_thema", "main_emotion", "raw_main_thema", "raw_main_emotion", "soft_main_thema", "soft_main_emotion"):
            fact_anchor_payload.pop(key, None)
        creative_brief_payload.pop("classification", None)
    payload = {
        "factAnchor": fact_anchor_payload,
        "referenceProfile": reference_profile,
        "creativeBrief": creative_brief_payload,
        "diagnosticContext": {
            "narrativeDirective": creative_brief_payload.get("narrative_directive"),
            "noteMode": "internal-only",
        },
    }
    system_prompt = (
        "너는 미술관 전시를 위한 전문 스토리텔러다. "
        "반말, 이모지, 과장된 마케팅 문구를 쓰지 말고, "
        "관람객이 이해하기 쉬운 한국어 이야기 형식으로 작성한다. "
        "출력은 반드시 JSON 객체 하나만 반환해야 한다. "
        "반드시 storyTitle, storyText, highlights, assumptions, factAnchor, creativeBrief, qualitySignals 키를 포함하라. "
        "storyText는 4~6문장 정도의 자연스러운 서사로 작성하고, 내부 점수나 요청 메모, JSON 설명을 본문에 쓰지 말라. "
        "factAnchor에는 제공된 사실만 간단히 정리하고, creativeBrief에는 그 사실을 해석하는 시각만 담아라. "
        "diagnosticContext는 내부 검사용이므로 storyText에 절대 반영하지 말고, 본문은 factAnchor와 referenceProfile 중심으로만 작성하라."
    )
    user_prompt = (
        "다음 작품 정보와 해석 지시를 바탕으로 스토리텔링을 작성해줘.\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def generate_storytelling_artifact(
    artwork: models.Artwork,
    *,
    feature: models.ArtworkRecommendationFeature | None = None,
    score: models.ArtworkRecommendationScore | None = None,
    request_note: str | None = None,
    global_note: str | None = None,
) -> StorytellingArtifact:
    context = build_story_context(
        artwork,
        feature,
        score,
        request_note=request_note,
        global_note=global_note,
    )

    if STORYTELLING_PROVIDER == "openai" and os.getenv("OPENAI_API_KEY"):
        try:
            client = OpenAI()
            response = client.chat.completions.create(
                model=STORYTELLING_MODEL,
                temperature=0.45,
                response_format={"type": "json_object"},
                messages=_build_prompt(context),
            )
            content = response.choices[0].message.content or "{}"
            payload = json.loads(content)
            story_title = _clean_text(payload.get("storyTitle")) or _clean_text(artwork.title) or f"작품 {artwork.id}"
            story_text = _clean_text(payload.get("storyText"))
            if not story_text or _has_story_leakage(story_text) or not (STORY_SENTENCE_MIN <= _count_sentences(story_text) <= STORY_SENTENCE_MAX):
                raise ValueError("Empty story text")
            highlights = _normalize_list(payload.get("highlights"), limit=5)
            assumptions = _normalize_list(payload.get("assumptions"), limit=3)
            quality_signals = payload.get("qualitySignals")
            if not isinstance(quality_signals, dict):
                quality_signals = {}
            return StorytellingArtifact(
                story_title=story_title,
                story_text=story_text,
                provider_name="openai",
                model_name=STORYTELLING_MODEL,
                prompt_json=context,
                generation_metadata_json={
                    "highlights": highlights,
                    "assumptions": assumptions,
                    "qualitySignals": _build_quality_signals(context, story_text),
                    "modelQualitySignals": quality_signals,
                    "structuredOutput": payload,
                    "provider": "openai",
                    "model": STORYTELLING_MODEL,
                },
            )
        except Exception:
            pass

    story_title, story_text, metadata = _fallback_story(context)
    return StorytellingArtifact(
        story_title=story_title,
        story_text=story_text,
        provider_name="heuristic-storytelling",
        model_name="heuristic-story-v1",
        prompt_json=context,
        generation_metadata_json={
            **metadata,
            "qualitySignals": _build_quality_signals(context, story_text),
            "provider": "heuristic-storytelling",
            "model": "heuristic-story-v1",
        },
    )
