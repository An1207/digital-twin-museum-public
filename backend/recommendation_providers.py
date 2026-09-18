from __future__ import annotations

import base64
import importlib.util
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field


class ProviderUnavailableError(RuntimeError):
    pass


class ArtworkCritique(BaseModel):
    title_guess: str = Field(description="Best-guess short title or subject name.")
    visual_summary: str = Field(description="One-sentence visual summary of the artwork.")
    theme_scores: dict[str, float] = Field(description="Theme scores keyed by nature, folk, city, war.")
    era_scores: dict[str, float] = Field(description="Era scores keyed by ancient, medieval, renaissance_baroque, eighteenth_nineteenth, modern_contemporary.")
    emotion_scores: dict[str, float] = Field(description="Emotion scores keyed by serene, dynamic, sadness, awe.")
    estimated_year: Optional[int] = Field(description="Estimated artwork year when inferable, otherwise null.")
    estimated_year_reason: str = Field(description="Short reason for the estimated year or why it is unknown.")
    tags: list[str] = Field(description="3 to 6 short tags.")
    rationale: list[str] = Field(description="Short reasons explaining the main emotional and contextual reading.")


@dataclass
class VisualFeatureResult:
    embedding: list[float]
    provider_name: str
    provider_mode: str


@dataclass
class MetaFeatureResult:
    critique: ArtworkCritique
    provider_name: str
    provider_mode: str


class BaseVisualProvider:
    provider_name = "base-visual"

    def embed_image(self, image_path: Path) -> VisualFeatureResult:
        raise NotImplementedError

    def embed_text(self, text: str) -> VisualFeatureResult:
        raise NotImplementedError


class BaseMetaProvider:
    provider_name = "base-meta"

    def analyze_image(self, image_path: Path, metadata_context: Optional[dict[str, Any]] = None) -> MetaFeatureResult:
        raise NotImplementedError


class LocalClipVisualProvider(BaseVisualProvider):
    provider_name = "local-clip"

    def __init__(self):
        try:
            import torch
            from PIL import Image
            from transformers import CLIPModel, CLIPProcessor
        except Exception as exc:
            raise ProviderUnavailableError(
                "Local CLIP provider requires torch, pillow, and transformers."
            ) from exc

        model_name = os.getenv("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")
        self._torch = torch
        self._image_cls = Image
        self._processor = CLIPProcessor.from_pretrained(model_name)
        self._model = CLIPModel.from_pretrained(model_name)
        self._model.eval()

    def embed_image(self, image_path: Path) -> VisualFeatureResult:
        image = self._image_cls.open(image_path).convert("RGB")
        inputs = self._processor(images=image, return_tensors="pt")
        with self._torch.no_grad():
            output = self._model.get_image_features(**inputs)
            if hasattr(output, "image_embeds"):
                features = output.image_embeds.squeeze(0)
            elif hasattr(output, "pooler_output"):
                features = output.pooler_output.squeeze(0)
            else:
                features = output.squeeze(0)

        vector = features.tolist()
        norm = sum(value * value for value in vector) ** 0.5 or 1.0
        normalized = [round(value / norm, 6) for value in vector]
        return VisualFeatureResult(
            embedding=normalized,
            provider_name=self.provider_name,
            provider_mode="live",
        )

    def embed_text(self, text: str) -> VisualFeatureResult:
        inputs = self._processor(text=[text], return_tensors="pt", padding=True)
        with self._torch.no_grad():
            output = self._model.get_text_features(**inputs)
            features = output.squeeze(0)

        vector = features.tolist()
        norm = sum(value * value for value in vector) ** 0.5 or 1.0
        normalized = [round(value / norm, 6) for value in vector]
        return VisualFeatureResult(
            embedding=normalized,
            provider_name=self.provider_name,
            provider_mode="live",
        )


class OpenAIVisionMetaProvider(BaseMetaProvider):
    provider_name = "openai-gpt-4o"

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ProviderUnavailableError("OPENAI_API_KEY is missing.")
        try:
            from openai import OpenAI
        except Exception as exc:
            raise ProviderUnavailableError("openai package is not installed.") from exc

        self.model = os.getenv("OPENAI_MODEL", "gpt-4o")
        self.client = OpenAI(api_key=api_key)

    @staticmethod
    def _image_data_url(image_path: Path) -> str:
        raw = image_path.read_bytes()
        mime = "image/jpeg"
        if image_path.suffix.lower() == ".png":
            mime = "image/png"
        encoded = base64.b64encode(raw).decode("utf-8")
        return f"data:{mime};base64,{encoded}"

    def analyze_image(self, image_path: Path, metadata_context: Optional[dict[str, Any]] = None) -> MetaFeatureResult:
        metadata_context = metadata_context or {}
        metadata_lines = [
            f"- title hint: {metadata_context.get('title') or 'unknown'}",
            f"- artist hint: {metadata_context.get('artist') or 'unknown'}",
            f"- query/source hint: {metadata_context.get('query') or 'unknown'} / {metadata_context.get('source') or 'unknown'}",
            f"- object url: {metadata_context.get('object_url') or 'unknown'}",
        ]
        prompt = (
            "You are analyzing a museum artwork image for a hybrid recommendation system. "
            "Manifest metadata is a strong hint but not absolute truth. "
            "Use it to correct obvious OCR or subject issues, but if the image clearly conflicts, explain that in the reason. "
            "Return a JSON object only.\n"
            "Theme keys: nature, folk, city, war.\n"
            "Era keys: ancient, medieval, renaissance_baroque, eighteenth_nineteenth, modern_contemporary.\n"
            "Emotion keys: serene, dynamic, sadness, awe.\n"
            "First estimate a plausible year if possible, then score the year buckets consistently with that estimate. "
            "Use all keys in every score object. Scores do not need to sum exactly to 1, but should reflect relative intensity. "
            "Keep rationale concise.\n"
            "Metadata hints:\n"
            f"{chr(10).join(metadata_lines)}\n"
            "JSON shape:\n"
            "{\n"
            '  "title_guess": string,\n'
            '  "visual_summary": string,\n'
            '  "theme_scores": {"nature": number, "folk": number, "city": number, "war": number},\n'
            '  "era_scores": {"ancient": number, "medieval": number, "renaissance_baroque": number, "eighteenth_nineteenth": number, "modern_contemporary": number},\n'
            '  "emotion_scores": {"serene": number, "dynamic": number, "sadness": number, "awe": number},\n'
            '  "estimated_year": number | null,\n'
            '  "estimated_year_reason": string,\n'
            '  "tags": [string],\n'
            '  "rationale": [string]\n'
            "}"
        )

        response = self.client.responses.create(
            model=self.model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {
                            "type": "input_image",
                            "image_url": self._image_data_url(image_path),
                            "detail": "high",
                        },
                    ],
                }
            ],
            text={"format": {"type": "json_object"}},
        )
        output_text = response.output_text
        if not output_text:
            raise RuntimeError("OpenAI response did not return output text.")
        parsed = ArtworkCritique.model_validate(json.loads(output_text))

        return MetaFeatureResult(
            critique=parsed,
            provider_name=self.provider_name,
            provider_mode="live",
        )


def build_visual_provider() -> BaseVisualProvider | None:
    provider_name = os.getenv("VISUAL_PROVIDER", "clip")
    if provider_name == "clip":
        try:
            return LocalClipVisualProvider()
        except ProviderUnavailableError:
            return None
    return None


def build_meta_provider() -> BaseMetaProvider | None:
    provider_name = os.getenv("META_PROVIDER", "openai")
    if provider_name == "openai":
        try:
            return OpenAIVisionMetaProvider()
        except ProviderUnavailableError:
            return None
    return None


def provider_runtime_status() -> dict[str, Any]:
    has_openai_key = bool(os.getenv("OPENAI_API_KEY"))
    openai_pkg = importlib.util.find_spec("openai") is not None
    torch_pkg = importlib.util.find_spec("torch") is not None
    transformers_pkg = importlib.util.find_spec("transformers") is not None
    visual_provider_ready = torch_pkg and transformers_pkg
    meta_provider_ready = has_openai_key and openai_pkg

    return {
        "openaiConfigured": has_openai_key,
        "openaiPackageInstalled": openai_pkg,
        "clipAvailable": visual_provider_ready,
        "torchInstalled": torch_pkg,
        "transformersInstalled": transformers_pkg,
        "visualProviderReady": visual_provider_ready,
        "metaProviderReady": meta_provider_ready,
        "visualProviderName": "local-clip" if visual_provider_ready else None,
        "metaProviderName": "openai-gpt-4o" if meta_provider_ready else None,
    }
