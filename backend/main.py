from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import threading
import subprocess
import sys
import shutil
from datetime import datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from typing import Any, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from pathlib import Path
from starlette.exceptions import HTTPException as StarletteHTTPException

try:
    from pillow_heif import register_heif_opener
except ImportError:
    register_heif_opener = None

# 파일들 불러오기
from database import SessionLocal, engine, Base, get_db
import models
import batch_Service
import recommendation
from storytelling import generate_storytelling_artifact
from recommendation_providers import provider_runtime_status
from runtime_config import (
    ARTWORK_IMAGE_DIR,
    ASSET_ROOT_DIR,
    IMAGE_ROOT_DIR,
    MINIMAX_API_KEY,
    allowed_origins,
    asset_url,
    ensure_runtime_directories,
    public_url,
)
from startup_status import current_startup_status, write_startup_status
from security import RequestLimits, contained_path, rate_limiter, validate_model_upload
from asset_access import ProtectedAssets
from public_seed import seed_public_content
from auth import (
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    AuthPrincipal,
    create_access_token,
    create_refresh_token,
    get_current_principal,
    get_current_principal_optional,
    get_user_by_email,
    get_user_by_identifier,
    get_user_by_username,
    hash_refresh_token,
    hash_password,
    require_roles,
    seed_auth_users,
    verify_password,
    verify_refresh_token,
)

if register_heif_opener is not None:
    register_heif_opener()

app = FastAPI(title="3DGS Curation API")
logger = logging.getLogger("digital_twin_museum")


def _normalize_error_detail(detail: Any, status_code: int) -> dict[str, Any]:
    if status_code >= 500:
        return {"message": "Internal server error.", "statusCode": status_code}
    if isinstance(detail, dict):
        normalized = dict(detail)
        normalized.setdefault("message", "요청을 처리하지 못했습니다.")
        normalized.setdefault("statusCode", status_code)
        return normalized

    if isinstance(detail, list):
        return {
            "message": "Request validation failed.",
            "statusCode": status_code,
            "errors": detail,
        }

    if isinstance(detail, str) and detail.strip():
        return {
            "message": detail,
            "statusCode": status_code,
        }

    return {
        "message": "요청을 처리하지 못했습니다.",
        "statusCode": status_code,
    }


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": _normalize_error_detail(exc.detail, exc.status_code)},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": _normalize_error_detail([
            {"loc": list(error["loc"]), "type": error["type"], "msg": "Invalid value"}
            for error in exc.errors()
        ], 422)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    logger.exception("Unhandled server error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "message": "Internal server error.",
                "statusCode": 500,
            }
        },
    )

# --- Pydantic 데이터 모델 (응답 및 검증) ---
class CurationRequest(BaseModel):
    user_id: int
    final_id_list: List[int]

class LayoutRequest(BaseModel):
    themeOptionId: int
    eraOptionId: int
    emotionOptionId: int
    sessionId: Optional[str] = None

class ArtworkResponse(BaseModel):
    id: int
    ownerUserId: Optional[int] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    main_thema: str
    sub_thema: Optional[str] = None
    main_emotion: str
    sub_emotion: Optional[str] = None
    era: str
    era_year: int
    asset_folder_name: str
    image_path: Optional[str] = None
    source: Optional[str] = None
    source_object_id: Optional[str] = None
    source_query: Optional[str] = None
    object_url: Optional[str] = None
    is_public_domain: bool = False
    current_storytelling_version_id: Optional[int] = None
    current_storytelling_title: Optional[str] = None
    current_storytelling_text: Optional[str] = None
    current_storytelling_status: Optional[str] = None
    current_storytelling_generated_at: Optional[str] = None
    files: dict  # 동적으로 생성할 5개 파일의 URL 딕셔너리

    class Config:
        from_attributes = True


class ScoreBreakdown(BaseModel):
    visual: float
    theme: float
    era: float
    emotion: float
    final: float


class RecommendationMetaResponse(BaseModel):
    reasons: list[str]
    scoreBreakdown: ScoreBreakdown
    recommendationReady: bool
    recommendationSourceVersion: str


class GeneratedFramedAssetResponse(BaseModel):
    artworkId: int
    title: Optional[str] = None
    artist: Optional[str] = None
    assetFolderName: str
    imagePath: Optional[str] = None
    glbUrl: Optional[str] = None
    generatedAt: Optional[str] = None
    fileSizeBytes: Optional[int] = None
    fileName: str
    source: Optional[str] = None
    sourceObjectId: Optional[str] = None
    sourceQuery: Optional[str] = None
    objectUrl: Optional[str] = None
    notes: Optional[dict[str, Any]] = None


class StorytellingArtworkSummaryResponse(BaseModel):
    id: int
    ownerUserId: Optional[int] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    era: str
    eraYear: int
    mainThema: str
    mainEmotion: str
    imagePath: Optional[str] = None
    currentStorytellingVersionId: Optional[int] = None
    currentStorytellingTitle: Optional[str] = None
    currentStorytellingText: Optional[str] = None
    currentStorytellingStatus: Optional[str] = None
    currentStorytellingGeneratedAt: Optional[str] = None
    storyVersionCount: int = 0


class StorytellingVersionResponse(BaseModel):
    id: int
    artworkId: int
    batchId: int
    versionNumber: int
    status: str
    isCurrentRepresentative: bool = False
    storyTitle: str
    storyText: str
    requestNote: Optional[str] = None
    globalNote: Optional[str] = None
    providerName: str
    modelName: str
    promptJson: dict[str, Any]
    generationMetadataJson: Optional[dict[str, Any]] = None
    publishedAt: Optional[str] = None
    createdAt: str
    updatedAt: str


class StorytellingGenerateRequest(BaseModel):
    artworkIds: list[int] = Field(default_factory=list)
    globalNote: Optional[str] = None
    batchName: Optional[str] = None
    perArtworkNotes: dict[str, str] = Field(default_factory=dict)


class StorytellingGenerateItemResponse(BaseModel):
    artworkId: int
    version: StorytellingVersionResponse


class StorytellingBatchResponse(BaseModel):
    id: int
    batchName: Optional[str] = None
    globalNote: Optional[str] = None
    createdByUserId: int
    providerName: str
    modelName: str
    status: str
    resultCount: int
    selectedArtworkIds: list[int]
    createdAt: str
    updatedAt: str


class StorytellingGenerateResponse(BaseModel):
    status: str
    batch: StorytellingBatchResponse
    items: list[StorytellingGenerateItemResponse]


class StorytellingVersionListResponse(BaseModel):
    status: str
    count: int
    artworkId: int
    currentVersionId: Optional[int] = None
    items: list[StorytellingVersionResponse]


class StorytellingCurrentResponse(BaseModel):
    status: str
    artworkId: int
    currentVersion: Optional[StorytellingVersionResponse] = None
    ttsAssets: list[StorytellingTtsAssetResponse] = Field(default_factory=list)


class StorytellingVersionStatusUpdateRequest(BaseModel):
    status: str


class StorytellingVersionStatusUpdateResponse(BaseModel):
    status: str
    artworkId: int
    currentVersionId: Optional[int] = None
    version: StorytellingVersionResponse
    currentVersion: Optional[StorytellingVersionResponse] = None
    requestedBy: Optional[int] = None


class StorytellingVersionUpdateRequest(BaseModel):
    storyTitle: Optional[str] = None
    storyText: Optional[str] = None


class StorytellingVersionUpdateResponse(BaseModel):
    status: str
    artworkId: int
    currentVersionId: Optional[int] = None
    version: StorytellingVersionResponse
    currentVersion: Optional[StorytellingVersionResponse] = None
    requestedBy: Optional[int] = None


class StorytellingCurrentVersionUpdateRequest(BaseModel):
    versionId: Optional[int] = None


class StorytellingCurrentVersionUpdateResponse(BaseModel):
    status: str
    artworkId: int
    currentVersionId: Optional[int] = None
    version: Optional[StorytellingVersionResponse] = None
    currentVersion: Optional[StorytellingVersionResponse] = None
    requestedBy: Optional[int] = None


class StorytellingVersionDeleteResponse(BaseModel):
    status: str
    artworkId: int
    deletedVersionId: int
    currentVersionId: Optional[int] = None
    currentVersion: Optional[StorytellingVersionResponse] = None
    requestedBy: Optional[int] = None


class StorytellingTtsGenerateRequest(BaseModel):
    voiceId: Optional[str] = None
    modelName: Optional[str] = None
    languageBoost: Optional[str] = None
    forceRebuild: bool = False


class StorytellingTtsAssetResponse(BaseModel):
    id: int
    storytellingVersionId: int
    providerName: str
    modelName: str
    voiceId: str
    languageBoost: str
    outputFormat: str
    status: str
    audioUrl: Optional[str] = None
    audioPath: Optional[str] = None
    traceId: Optional[str] = None
    audioLength: Optional[int] = None
    audioSizeBytes: Optional[int] = None
    errorMessage: Optional[str] = None
    providerMetadata: Optional[dict[str, Any]] = None
    createdAt: str
    updatedAt: str


class StorytellingTtsGenerateResponse(BaseModel):
    status: str
    artworkId: int
    versionId: int
    ttsAsset: StorytellingTtsAssetResponse
    requestedVoiceId: str
    requestedModelName: str
    requestedLanguageBoost: str
    requestedBy: Optional[int] = None


class GeneratedFramedAssetListResponse(BaseModel):
    status: str
    count: int
    items: list[GeneratedFramedAssetResponse]


class AuthorArtworkResponse(GeneratedFramedAssetResponse):
    status: str


class AuthorArtworkUpdateRequest(BaseModel):
    title: str
    artist: str
    era_year: int
    main_thema: str
    main_emotion: str
    era: str


class AuthorArtworkDeleteResponse(BaseModel):
    status: str
    artworkId: int
    deletedAt: str


class RoomMergeAssemblyPieceState(BaseModel):
    position: list[float]
    rotation: list[float]


class RoomMergeAssemblySnapshotPayload(BaseModel):
    selectedKey: Optional[str] = None
    pieces: dict[str, RoomMergeAssemblyPieceState]


class RoomMergeSnapshotCreateRequest(BaseModel):
    experimentKey: str = 'glb-room-merge-experiment'
    spaceId: Optional[int] = None
    sessionId: Optional[str] = None
    selectedKey: Optional[str] = None
    memo: Optional[str] = None
    snapshot: RoomMergeAssemblySnapshotPayload


class RoomMergeExperimentSnapshotResponse(BaseModel):
    id: int
    experimentKey: str
    spaceId: Optional[int] = None
    ownerUserId: int
    sessionId: str
    selectedKey: Optional[str] = None
    memo: Optional[str] = None
    snapshot: RoomMergeAssemblySnapshotPayload
    createdAt: str
    updatedAt: str


class RoomMergeSnapshotCreateResponse(BaseModel):
    status: str
    snapshot: RoomMergeExperimentSnapshotResponse


class RoomMergeSnapshotLatestResponse(BaseModel):
    status: str
    snapshot: Optional[RoomMergeExperimentSnapshotResponse] = None


class RoomMergeSnapshotListResponse(BaseModel):
    status: str
    count: int
    items: list[RoomMergeExperimentSnapshotResponse]


class RoomMergePresetCreateRequest(BaseModel):
    experimentKey: str = 'glb-room-merge-experiment'
    spaceId: Optional[int] = None
    sessionId: Optional[str] = None
    presetName: str
    selectedKey: Optional[str] = None
    memo: Optional[str] = None
    snapshot: RoomMergeAssemblySnapshotPayload


class RoomMergePresetResponse(BaseModel):
    id: int
    experimentKey: str
    spaceId: Optional[int] = None
    ownerUserId: int
    sessionId: str
    presetName: str
    selectedKey: Optional[str] = None
    memo: Optional[str] = None
    snapshot: RoomMergeAssemblySnapshotPayload
    createdAt: str
    updatedAt: str
    deletedAt: Optional[str] = None


class RoomMergePresetListResponse(BaseModel):
    status: str
    count: int
    items: list[RoomMergePresetResponse]


class CuratorSpaceFileResponse(BaseModel):
    id: int
    ownerUserId: int
    originalFileName: str
    storedFilePath: str
    fileUrl: str
    checksumSha256: str
    fileSizeBytes: int
    mimeType: Optional[str] = None
    status: str
    createdAt: str
    updatedAt: str


class CuratorSpaceFileListResponse(BaseModel):
    status: str
    count: int
    items: list[CuratorSpaceFileResponse]


class CuratorSpaceFileDeleteResponse(BaseModel):
    status: str
    fileId: int
    deletedAt: str


class CuratorSpaceComponentPosition(BaseModel):
    x: float
    y: float
    z: float


class CuratorSpaceComponentRotation(BaseModel):
    x: float
    y: float
    z: float


class CuratorSpaceComponentScale(BaseModel):
    x: float
    y: float
    z: float


class CuratorSpaceComponentRequest(BaseModel):
    componentKey: str
    label: str
    spaceFileId: int
    position: CuratorSpaceComponentPosition
    rotation: CuratorSpaceComponentRotation = Field(default_factory=lambda: CuratorSpaceComponentRotation(x=0, y=0, z=0))
    scale: CuratorSpaceComponentScale = Field(default_factory=lambda: CuratorSpaceComponentScale(x=1, y=1, z=1))
    sortOrder: int = 0


class ArtworkSlotRequest(BaseModel):
    slotKey: str
    name: str
    sizePreset: str
    width: float
    height: float
    depth: float
    position: CuratorSpaceComponentPosition
    rotation: CuratorSpaceComponentRotation = Field(default_factory=lambda: CuratorSpaceComponentRotation(x=0, y=0, z=0))
    status: str = "draft"
    sortOrder: int = 0
    artworkId: Optional[int] = None


class CuratorSpaceCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    thumbnailImagePath: Optional[str] = None


class CuratorSpaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    thumbnailImagePath: Optional[str] = None


class CuratorSpaceComponentsSaveRequest(BaseModel):
    components: list[CuratorSpaceComponentRequest] = Field(default_factory=list)


class CuratorSpaceSlotsSaveRequest(BaseModel):
    slots: list[ArtworkSlotRequest] = Field(default_factory=list)


class CuratorSpacePublishRequest(BaseModel):
    versionName: Optional[str] = None
    memo: Optional[str] = None
    displayName: Optional[str] = None
    summary: Optional[str] = None
    locationSummary: Optional[str] = None
    thumbnailImagePath: Optional[str] = None
    searchKeywords: list[str] = Field(default_factory=list)
    isFeatured: bool = False
    isDefault: bool = False
    displayOrder: int = 0
    publishedAt: Optional[str] = None


class CuratorSpaceThumbnailUploadResponse(BaseModel):
    status: str
    thumbnailImagePath: str
    thumbnailImageUrl: str
    originalFileName: str
    fileSizeBytes: int


class CuratorSpaceComponentResponse(BaseModel): 
    id: int 
    spaceId: int 
    spaceFileId: int 
    entityTypeId: int
    componentKey: str 
    label: str
    position: CuratorSpaceComponentPosition
    rotation: CuratorSpaceComponentRotation
    scale: CuratorSpaceComponentScale
    sortOrder: int
    createdAt: str
    updatedAt: str


class ArtworkSlotResponse(BaseModel): 
    id: int 
    spaceId: int 
    entityTypeId: int
    slotKey: str 
    name: str
    sizePreset: str
    width: float
    height: float
    depth: float
    position: CuratorSpaceComponentPosition
    rotation: CuratorSpaceComponentRotation
    status: str
    sortOrder: int
    artworkId: Optional[int] = None
    createdAt: str
    updatedAt: str


class CuratorSpaceVersionResponse(BaseModel):
    id: int
    spaceId: int
    createdByUserId: int
    versionName: Optional[str] = None
    memo: Optional[str] = None
    versionSnapshot: dict[str, Any]
    createdAt: str
    updatedAt: str


class CuratorSpacePublicProfileResponse(BaseModel):
    id: int
    spaceId: int
    displayName: str
    summary: Optional[str] = None
    locationSummary: Optional[str] = None
    thumbnailImagePath: Optional[str] = None
    searchKeywords: list[str] = Field(default_factory=list)
    isFeatured: bool = False
    isDefault: bool = False
    displayOrder: int = 0
    publishedAt: Optional[str] = None
    createdAt: str
    updatedAt: str


class CuratorSpaceSummaryResponse(BaseModel):
    id: int
    ownerUserId: int
    name: str
    description: Optional[str] = None
    thumbnailImagePath: Optional[str] = None
    status: str
    currentVersionId: Optional[int] = None
    componentCount: int = 0
    slotCount: int = 0
    fileCount: int = 0
    publicProfile: Optional[CuratorSpacePublicProfileResponse] = None
    createdAt: str
    updatedAt: str


class CuratorSpaceDetailResponse(CuratorSpaceSummaryResponse):
    files: list[CuratorSpaceFileResponse] = Field(default_factory=list)
    components: list[CuratorSpaceComponentResponse] = Field(default_factory=list)
    slots: list[ArtworkSlotResponse] = Field(default_factory=list)
    versions: list[CuratorSpaceVersionResponse] = Field(default_factory=list)


class CuratorSpaceListResponse(BaseModel):
    status: str
    count: int
    items: list[CuratorSpaceSummaryResponse]


class CuratorSpaceFileListQueryResponse(BaseModel):
    status: str
    count: int
    items: list[CuratorSpaceFileResponse]


class PublishedSpaceSummaryResponse(BaseModel):
    id: int
    spaceKey: str
    title: str
    curatorUserId: int
    curatorDisplayName: str
    summary: str
    locationSummary: str
    thumbnailImagePath: Optional[str] = None
    isFeatured: bool = False
    isDefault: bool = False
    publishedAt: Optional[str] = None
    displayOrder: int = 0


class PublishedSpaceDetailResponse(PublishedSpaceSummaryResponse):
    description: str
    searchKeywords: list[str] = Field(default_factory=list)
    viewerLayout: dict[str, Any]
    pieceCount: int = 0


class PublishedSpaceListResponse(BaseModel):
    status: str
    count: int
    total: int
    page: int
    pageSize: int
    query: Optional[str] = None
    sort: str
    curator: Optional[str] = None
    location: Optional[str] = None
    featuredOnly: bool = False
    defaultOnly: bool = False
    items: list[PublishedSpaceSummaryResponse]


class CuratorWorkspaceSummaryResponse(BaseModel):
    ownedSpaces: int = 0
    ownedArtworks: int = 0
    storytellingVersions: int = 0
    ttsAssets: int = 0
    roomMergeSnapshots: int = 0
    roomMergePresets: int = 0


class CuratorWorkspaceArtworkResponse(BaseModel):
    id: int
    ownerUserId: Optional[int] = None
    title: Optional[str] = None
    artist: Optional[str] = None
    createdAt: str
    era: str
    eraYear: int
    mainThema: str
    mainEmotion: str
    imagePath: Optional[str] = None
    source: Optional[str] = None
    sourceObjectId: Optional[str] = None
    sourceQuery: Optional[str] = None
    objectUrl: Optional[str] = None
    framedGlbStatus: Optional[str] = None
    framedGlbUrl: Optional[str] = None
    framedGlbGeneratedAt: Optional[str] = None
    framedGlbNotes: Optional[dict[str, Any]] = None
    currentStory: Optional[StorytellingVersionResponse] = None
    storyVersions: list[StorytellingVersionResponse] = Field(default_factory=list)
    ttsAssets: list[StorytellingTtsAssetResponse] = Field(default_factory=list)
    storyVersionCount: int = 0


class CuratorWorkspaceSpaceResponse(BaseModel):
    id: int
    ownerUserId: int
    name: str
    description: Optional[str] = None
    status: str
    currentVersionId: Optional[int] = None
    componentCount: int = 0
    slotCount: int = 0
    fileCount: int = 0
    publicProfile: Optional[CuratorSpacePublicProfileResponse] = None
    versions: list[CuratorSpaceVersionResponse] = Field(default_factory=list)
    snapshots: list[RoomMergeExperimentSnapshotResponse] = Field(default_factory=list)
    presets: list[RoomMergePresetResponse] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class CuratorWorkspaceResponse(BaseModel):
    status: str
    user: AuthUserResponse
    summary: CuratorWorkspaceSummaryResponse
    page: int = 1
    pageSize: int = 5
    total: int = 0
    totalPages: int = 1
    ownedSpaces: list[CuratorWorkspaceSpaceResponse] = Field(default_factory=list)
    ownedArtworks: list[CuratorWorkspaceArtworkResponse] = Field(default_factory=list)
    roomMergeSnapshots: list[RoomMergeExperimentSnapshotResponse] = Field(default_factory=list)
    roomMergePresets: list[RoomMergePresetResponse] = Field(default_factory=list)


class AuthLoginRequest(BaseModel):
    identifier: str
    password: str


class AuthRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    passwordConfirmation: str
    role: str


class AuthRefreshRequest(BaseModel):
    refreshToken: str


class AuthLogoutRequest(BaseModel):
    refreshToken: str


class AuthCuratorWorkspaceResponse(BaseModel):
    planStatus: Optional[str] = None
    planKey: Optional[str] = None
    quotaStoryGenerationsMonthly: Optional[int] = None
    quotaTtsGenerationsMonthly: Optional[int] = None


class AuthUserResponse(BaseModel):
    id: int
    username: str
    email: str
    displayName: str
    roles: list[str]
    primaryRole: str
    curatorWorkspace: Optional[AuthCuratorWorkspaceResponse] = None


class AuthSessionResponse(BaseModel):
    status: str
    tokenType: str
    accessToken: str
    accessTokenExpiresIn: int
    refreshToken: str
    refreshTokenExpiresIn: int
    user: AuthUserResponse


class AuthMeResponse(BaseModel):
    status: str
    user: AuthUserResponse


def _auth_session_response(
    db: Session,
    user: models.User,
    refresh_token: str,
) -> AuthSessionResponse:
    user_payload = _auth_user_response(db, user)
    access_token = create_access_token(user.id, user_payload.roles)
    return AuthSessionResponse(
        status="success",
        tokenType="Bearer",
        accessToken=access_token,
        accessTokenExpiresIn=ACCESS_TOKEN_TTL_SECONDS,
        refreshToken=refresh_token,
        refreshTokenExpiresIn=REFRESH_TOKEN_TTL_SECONDS,
        user=user_payload,
    )

# --- CORS 및 정적 파일 마운트 ---
app.add_middleware(RequestLimits)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_runtime_directories()

app.mount(
    "/assets",
    ProtectedAssets(directory=str(ASSET_ROOT_DIR)),
    name="assets"
)
app.mount(
    "/images",
    StaticFiles(directory=str(IMAGE_ROOT_DIR)),
    name="images"
)
FRAME_GENERATOR_SCRIPT = Path(__file__).resolve().parent / "tools" / "framed_glb" / "generate_framed_glb.py"
AUTHOR_UPLOAD_SOURCE = "author_upload"
AUTHOR_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
AUTHOR_UPLOAD_FORMAT_TO_EXTENSION = {
    "JPEG": "jpg",
    "MPO": "jpg",
    "PNG": "png",
    "WEBP": "webp",
    "HEIF": "heic",
}
TTS_ASSET_DIR = ASSET_ROOT_DIR / "tts"
MINIMAX_TTS_API_BASE = os.getenv("MINIMAX_TTS_API_BASE", "https://api.minimax.io").rstrip("/")
MINIMAX_TTS_MODEL = os.getenv("MINIMAX_TTS_MODEL", "speech-2.8-hd")
MINIMAX_TTS_VOICE_ID = os.getenv("MINIMAX_TTS_VOICE_ID", "Korean_CalmGentleman")
MINIMAX_TTS_LANGUAGE_BOOST = os.getenv("MINIMAX_TTS_LANGUAGE_BOOST", "Korean")
MINIMAX_TTS_OUTPUT_FORMAT = os.getenv("MINIMAX_TTS_OUTPUT_FORMAT", "hex")
MINIMAX_TTS_AUDIO_FORMAT = os.getenv("MINIMAX_TTS_AUDIO_FORMAT", "mp3")
TTS_RENDERING_VERSION = "tts-render-v2"
LEGACY_ARTWORK_SOURCE = "met"
LEGACY_ARTWORK_OWNER_CANDIDATES = (
    ("writer_1", "writer_1@digital-twin.local"),
    ("artist", "artist@digital-twin.local"),
)
SHARED_ARTWORK_OWNER_IDENTIFIERS = (
    ("writer_1", "writer_1@digital-twin.local"),
    ("curator_1", "curator_1@digital-twin.local"),
)


def _resolve_legacy_artwork_owner_user_id(db: Session) -> int | None:
    for username, email in LEGACY_ARTWORK_OWNER_CANDIDATES:
        user = (
            db.query(models.User)
            .filter(or_(models.User.username == username, models.User.email == email))
            .order_by(models.User.id.asc())
            .first()
        )
        if user is not None:
            return user.id

    writer_role = db.query(models.Role).filter(models.Role.role_key == "writer").first()
    if writer_role is None:
        writer_role = db.query(models.Role).filter(models.Role.role_key == "writer_1").first()
    if writer_role is None:
        writer_role = db.query(models.Role).filter(models.Role.role_key == "artist").first()
        if writer_role is not None:
            writer_role.role_key = "writer"

    if writer_role is not None:
        artist_user = (
            db.query(models.User)
            .join(models.UserRole, models.UserRole.user_id == models.User.id)
            .filter(models.UserRole.role_id == writer_role.id)
            .order_by(models.User.id.asc())
            .first()
        )
        if artist_user is not None:
            return artist_user.id

    return None


def _shared_artwork_owner_user_ids(db: Session) -> list[int]:
    owner_user_ids: list[int] = []
    seen_user_ids: set[int] = set()
    for username, email in SHARED_ARTWORK_OWNER_IDENTIFIERS:
        user = get_user_by_identifier(db, username) or get_user_by_identifier(db, email)
        if user is None or user.id in seen_user_ids:
            continue
        seen_user_ids.add(user.id)
        owner_user_ids.append(user.id)
    return owner_user_ids


def _ensure_artwork_ownership(db: Session, artwork: models.Artwork) -> None:
    if artwork.owner_user_id is None:
        return

    existing_rows = (
        db.query(models.ArtworkOwnership)
        .filter(models.ArtworkOwnership.artwork_id == artwork.id)
        .order_by(models.ArtworkOwnership.id.asc())
        .all()
    )
    owner_row = None
    for row in existing_rows:
        if row.user_id == artwork.owner_user_id:
            owner_row = row
        else:
            db.delete(row)

    if owner_row is None:
        db.add(
            models.ArtworkOwnership(
                artwork_id=artwork.id,
                user_id=artwork.owner_user_id,
                ownership_role="owner",
            )
        )

    # Ownership repair must not change a work's copyright declaration.


def _backfill_shared_artwork_ownerships(db: Session) -> int:
    touched_count = 0
    for artwork in db.query(models.Artwork).order_by(models.Artwork.id.asc()).all():
        was_public = bool(artwork.is_public_domain)
        _ensure_artwork_ownership(db, artwork)
        if not was_public and artwork.is_public_domain:
            touched_count += 1
    return touched_count


def _workspace_artwork_owner_user_ids(db: Session, principal: AuthPrincipal) -> list[int]:
    if "admin" in principal.roles:
        return [
            row[0]
            for row in (
                db.query(models.User.id)
                .join(models.UserRole, models.UserRole.user_id == models.User.id)
                .join(models.Role, models.Role.id == models.UserRole.role_id)
                .filter(models.Role.role_key == "writer")
                .distinct()
                .all()
            )
        ]

    return [principal.user_id]


def ensure_runtime_schema():
    with engine.begin() as connection:
        artwork_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(artworks)")).fetchall()
        }
        artwork_additions = {
            "owner_user_id": "ALTER TABLE artworks ADD COLUMN owner_user_id INTEGER",
            "artist": "ALTER TABLE artworks ADD COLUMN artist VARCHAR",
            "image_path": "ALTER TABLE artworks ADD COLUMN image_path VARCHAR",
            "source": "ALTER TABLE artworks ADD COLUMN source VARCHAR",
            "source_object_id": "ALTER TABLE artworks ADD COLUMN source_object_id VARCHAR",
            "source_query": "ALTER TABLE artworks ADD COLUMN source_query VARCHAR",
            "object_url": "ALTER TABLE artworks ADD COLUMN object_url VARCHAR",
            "is_public_domain": "ALTER TABLE artworks ADD COLUMN is_public_domain BOOLEAN NOT NULL DEFAULT 0",
            "current_storytelling_version_id": "ALTER TABLE artworks ADD COLUMN current_storytelling_version_id INTEGER",
        }
        for column, statement in artwork_additions.items():
            if column not in artwork_columns:
                connection.execute(text(statement))

        artwork_index_names = {
            row[1]
            for row in connection.execute(text("PRAGMA index_list(artworks)")).fetchall()
        }
        if "idx_artworks_owner_user_id" not in artwork_index_names:
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_artworks_owner_user_id "
                "ON artworks (owner_user_id)"
            ))

        legacy_owner_row = connection.execute(text(
            "SELECT id FROM users "
            "WHERE username = 'writer_1' OR email = 'writer_1@digital-twin.local' "
            "ORDER BY id ASC LIMIT 1"
        )).fetchone()
        if legacy_owner_row is None:
            legacy_owner_row = connection.execute(text(
                "SELECT id FROM users "
                "WHERE username = 'artist' OR email = 'artist@digital-twin.local' "
                "ORDER BY id ASC LIMIT 1"
            )).fetchone()
        if legacy_owner_row is not None:
            connection.execute(text(
                "UPDATE artworks "
                "SET owner_user_id = :owner_user_id "
                "WHERE source = :source"
            ), {"owner_user_id": legacy_owner_row[0], "source": LEGACY_ARTWORK_SOURCE})

        artwork_ownership_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(artwork_ownerships)")).fetchall()
        }
        if not artwork_ownership_columns:
            connection.execute(text(
                """
                CREATE TABLE IF NOT EXISTS artwork_ownerships (
                    id INTEGER PRIMARY KEY,
                    artwork_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    ownership_role VARCHAR NOT NULL DEFAULT 'co_owner',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (artwork_id, user_id),
                    FOREIGN KEY(artwork_id) REFERENCES artworks(id),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                )
                """
            ))
        artwork_ownership_indexes = {
            row[1]
            for row in connection.execute(text("PRAGMA index_list(artwork_ownerships)")).fetchall()
        }
        if "ix_artwork_ownerships_artwork_id" not in artwork_ownership_indexes:
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_artwork_ownerships_artwork_id "
                "ON artwork_ownerships (artwork_id)"
            ))
        if "ix_artwork_ownerships_user_id" not in artwork_ownership_indexes:
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_artwork_ownerships_user_id "
                "ON artwork_ownerships (user_id)"
            ))

        curator_space_file_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(curator_space_files)")).fetchall()
        }
        if "space_id" not in curator_space_file_columns:
            connection.execute(text("ALTER TABLE curator_space_files ADD COLUMN space_id INTEGER"))

        curator_space_file_indexes = {
            row[1]
            for row in connection.execute(text("PRAGMA index_list(curator_space_files)")).fetchall()
        }
        if "idx_curator_space_files_space_status" not in curator_space_file_indexes:
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_curator_space_files_space_status "
                "ON curator_space_files (space_id, status)"
            ))
        if "idx_curator_space_files_space_created_at" not in curator_space_file_indexes:
            connection.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_curator_space_files_space_created_at "
                "ON curator_space_files (space_id, created_at)"
            ))

        curator_space_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(curator_spaces)")).fetchall()
        }
        if "thumbnail_image_path" not in curator_space_columns:
            connection.execute(text("ALTER TABLE curator_spaces ADD COLUMN thumbnail_image_path VARCHAR"))

        user_columns = {
            row[1]
            for row in connection.execute(text("PRAGMA table_info(users)")).fetchall()
        }
        if "username" not in user_columns:
            connection.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR"))

        user_rows = connection.execute(
            text("SELECT id, username, email FROM users ORDER BY id ASC")
        ).fetchall()
        taken_usernames: set[str] = set()
        for user_id, username, email in user_rows:
            if username:
                taken_usernames.add(str(username).strip().lower())

        for user_id, username, email in user_rows:
            if username:
                continue

            base_username = str(email or f"user_{user_id}").split("@", 1)[0].strip().lower()
            base_username = re.sub(r"[^a-z0-9_]+", "_", base_username)
            base_username = re.sub(r"_+", "_", base_username).strip("_") or f"user_{user_id}"
            candidate = base_username
            suffix = 1
            while candidate in taken_usernames:
                candidate = f"{base_username}_{suffix}"
                suffix += 1
            taken_usernames.add(candidate)
            connection.execute(
                text("UPDATE users SET username = :username WHERE id = :user_id"),
                {"username": candidate, "user_id": user_id},
            )

        user_indexes = {
            row[1]
            for row in connection.execute(text("PRAGMA index_list(users)")).fetchall()
        }
        if "ix_users_username" not in user_indexes:
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"))

        # Backfill legacy curator GLB files to the space(s) that reference them.
        connection.execute(text(
            """
            UPDATE curator_space_files
            SET space_id = (
                SELECT c.space_id
                FROM curator_space_components c
                WHERE c.space_file_id = curator_space_files.id
                  AND c.deleted_at IS NULL
                ORDER BY c.created_at ASC, c.id ASC
                LIMIT 1
            )
            WHERE space_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM curator_space_components c
                  WHERE c.space_file_id = curator_space_files.id
                    AND c.deleted_at IS NULL
              )
            """
        ))

        _backfill_room_merge_owner_ids(connection)

        room_merge_snapshot_info = {
            row[1]: row
            for row in connection.execute(text("PRAGMA table_info(room_merge_experiment_snapshots)")).fetchall()
        }
        if room_merge_snapshot_info and "space_id" not in room_merge_snapshot_info:
            connection.execute(text("ALTER TABLE room_merge_experiment_snapshots ADD COLUMN space_id INTEGER"))
        if room_merge_snapshot_info and room_merge_snapshot_info.get("owner_user_id", (None, None, None, 0))[3] == 0:
            _rebuild_sqlite_table(
                connection,
                "room_merge_experiment_snapshots",
                """
                CREATE TABLE room_merge_experiment_snapshots (
                    id INTEGER PRIMARY KEY,
                    experiment_key VARCHAR NOT NULL,
                    owner_user_id INTEGER NOT NULL,
                    session_id VARCHAR NOT NULL,
                    selected_key VARCHAR,
                    memo VARCHAR,
                    assembly_snapshot JSON NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(owner_user_id) REFERENCES users(id)
                )
                """,
                [
                    "id",
                    "experiment_key",
                    "owner_user_id",
                    "session_id",
                    "selected_key",
                    "memo",
                    "assembly_snapshot",
                    "created_at",
                    "updated_at",
                ],
                [
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_experiment_created_at "
                    "ON room_merge_experiment_snapshots (experiment_key, created_at DESC)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_experiment_owner_created_at "
                    "ON room_merge_experiment_snapshots (experiment_key, owner_user_id, created_at DESC)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_session_id "
                    "ON room_merge_experiment_snapshots (session_id)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_owner_user_id "
                    "ON room_merge_experiment_snapshots (owner_user_id)",
                ],
            )

        room_merge_preset_info = {
            row[1]: row
            for row in connection.execute(text("PRAGMA table_info(room_merge_presets)")).fetchall()
        }
        if room_merge_preset_info and "space_id" not in room_merge_preset_info: 
            connection.execute(text("ALTER TABLE room_merge_presets ADD COLUMN space_id INTEGER")) 
        if room_merge_preset_info and "deleted_at" not in room_merge_preset_info: 
            connection.execute(text("ALTER TABLE room_merge_presets ADD COLUMN deleted_at DATETIME")) 
        curator_space_component_info = {
            row[1]: row
            for row in connection.execute(text("PRAGMA table_info(curator_space_components)")).fetchall()
        }
        if curator_space_component_info and "entity_type_id" not in curator_space_component_info:
            connection.execute(text("ALTER TABLE curator_space_components ADD COLUMN entity_type_id INTEGER NOT NULL DEFAULT 1"))
        if curator_space_component_info:
            connection.execute(
                text("UPDATE curator_space_components SET entity_type_id = 1 WHERE entity_type_id IS NULL OR entity_type_id != 1")
            )

        artwork_slot_info = {
            row[1]: row
            for row in connection.execute(text("PRAGMA table_info(artwork_slots)")).fetchall()
        }
        if artwork_slot_info and "entity_type_id" not in artwork_slot_info:
            connection.execute(text("ALTER TABLE artwork_slots ADD COLUMN entity_type_id INTEGER NOT NULL DEFAULT 2"))
        if artwork_slot_info:
            connection.execute(
                text("UPDATE artwork_slots SET entity_type_id = 2 WHERE entity_type_id IS NULL OR entity_type_id != 2")
            )
        room_merge_preset_indexes = { 
            row[1] 
            for row in connection.execute(text("PRAGMA index_list(room_merge_presets)")).fetchall() 
        }
        if room_merge_preset_info and room_merge_preset_info.get("owner_user_id", (None, None, None, 0))[3] == 0:
            _rebuild_sqlite_table(
                connection,
                "room_merge_presets",
                """
                CREATE TABLE room_merge_presets (
                    id INTEGER PRIMARY KEY,
                    experiment_key VARCHAR NOT NULL,
                    owner_user_id INTEGER NOT NULL,
                    session_id VARCHAR NOT NULL,
                    preset_name VARCHAR NOT NULL,
                    selected_key VARCHAR,
                    memo VARCHAR,
                    assembly_snapshot JSON NOT NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at DATETIME,
                    FOREIGN KEY(owner_user_id) REFERENCES users(id)
                )
                """,
                [
                    "id",
                    "experiment_key",
                    "owner_user_id",
                    "session_id",
                    "preset_name",
                    "selected_key",
                    "memo",
                    "assembly_snapshot",
                    "created_at",
                    "updated_at",
                    "deleted_at",
                ],
                [
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_room_merge_presets_owner_name "
                    "ON room_merge_presets (experiment_key, owner_user_id, preset_name)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_experiment_key "
                    "ON room_merge_presets (experiment_key)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_experiment_owner "
                    "ON room_merge_presets (experiment_key, owner_user_id)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_session_id "
                    "ON room_merge_presets (session_id)",
                    "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_owner_user_id "
                    "ON room_merge_presets (owner_user_id)",
                ],
            )
        if "uq_room_merge_presets_experiment_name" in room_merge_preset_indexes:
            connection.execute(text("DROP INDEX IF EXISTS uq_room_merge_presets_experiment_name"))
        if "uq_room_merge_presets_session_name" in room_merge_preset_indexes:
            connection.execute(text("DROP INDEX IF EXISTS uq_room_merge_presets_session_name"))
        if "uq_room_merge_presets_owner_session_name" in room_merge_preset_indexes:
            connection.execute(text("DROP INDEX IF EXISTS uq_room_merge_presets_owner_session_name"))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS artwork_recommendation_features (
                id INTEGER PRIMARY KEY,
                artwork_id INTEGER NOT NULL UNIQUE,
                feature_version VARCHAR NOT NULL DEFAULT 'hybrid-v1',
                source_model VARCHAR NOT NULL DEFAULT 'heuristic-clip-bridge-v1',
                visual_embedding JSON NOT NULL,
                theme_scores JSON NOT NULL,
                era_scores JSON NOT NULL,
                emotion_scores JSON NOT NULL,
                recommendation_ready BOOLEAN NOT NULL DEFAULT 1,
                manifest_filename VARCHAR,
                notes JSON,
                generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(artwork_id) REFERENCES artworks(id)
            )
            """
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_artwork_recommendation_features_artwork_id "
            "ON artwork_recommendation_features (artwork_id)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS artwork_recommendation_scores (
                id INTEGER PRIMARY KEY,
                artwork_id INTEGER NOT NULL,
                theme_option_id INTEGER NOT NULL,
                era_option_id INTEGER NOT NULL,
                emotion_option_id INTEGER NOT NULL,
                score_version VARCHAR NOT NULL DEFAULT 'hybrid-v1-layout-v1',
                final_score FLOAT NOT NULL DEFAULT 0,
                visual_score FLOAT NOT NULL DEFAULT 0,
                theme_score FLOAT NOT NULL DEFAULT 0,
                era_score FLOAT NOT NULL DEFAULT 0,
                emotion_score FLOAT NOT NULL DEFAULT 0,
                reasons JSON NOT NULL,
                generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(artwork_id) REFERENCES artworks(id)
            )
            """
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_artwork_recommendation_scores_selection "
            "ON artwork_recommendation_scores (artwork_id, theme_option_id, era_option_id, emotion_option_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_recommendation_scores_selection_lookup "
            "ON artwork_recommendation_scores (theme_option_id, era_option_id, emotion_option_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_recommendation_scores_artwork_id "
            "ON artwork_recommendation_scores (artwork_id)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS artwork_generated_assets (
                id INTEGER PRIMARY KEY,
                artwork_id INTEGER NOT NULL,
                asset_kind VARCHAR NOT NULL DEFAULT 'framed_glb',
                status VARCHAR NOT NULL DEFAULT 'ready',
                file_name VARCHAR NOT NULL,
                relative_output_path VARCHAR NOT NULL,
                source_image_path VARCHAR,
                file_size_bytes INTEGER,
                notes JSON,
                generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(artwork_id) REFERENCES artworks(id)
            )
            """
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_artwork_generated_assets_artwork_kind "
            "ON artwork_generated_assets (artwork_id, asset_kind)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_generated_assets_artwork_id "
            "ON artwork_generated_assets (artwork_id)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS artwork_storytelling_generation_batches (
                id INTEGER PRIMARY KEY,
                created_by_user_id INTEGER NOT NULL,
                batch_name VARCHAR,
                global_note VARCHAR,
                selected_artwork_ids JSON NOT NULL,
                per_artwork_notes JSON,
                provider_name VARCHAR NOT NULL DEFAULT 'heuristic-storytelling',
                model_name VARCHAR NOT NULL DEFAULT 'heuristic-story-v1',
                status VARCHAR NOT NULL DEFAULT 'completed',
                result_count INTEGER NOT NULL DEFAULT 0,
                request_payload_json JSON NOT NULL,
                response_payload_json JSON,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(created_by_user_id) REFERENCES users(id)
            )
            """
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_storytelling_generation_batches_created_by "
            "ON artwork_storytelling_generation_batches (created_by_user_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_storytelling_generation_batches_created_at "
            "ON artwork_storytelling_generation_batches (created_at DESC)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS artwork_storytelling_versions (
                id INTEGER PRIMARY KEY,
                artwork_id INTEGER NOT NULL,
                batch_id INTEGER NOT NULL,
                created_by_user_id INTEGER NOT NULL,
                version_number INTEGER NOT NULL DEFAULT 1,
                status VARCHAR NOT NULL DEFAULT 'published',
                story_title VARCHAR NOT NULL,
                story_text TEXT NOT NULL,
                request_note VARCHAR,
                global_note VARCHAR,
                prompt_json JSON NOT NULL,
                generation_metadata_json JSON,
                provider_name VARCHAR NOT NULL DEFAULT 'heuristic-storytelling',
                model_name VARCHAR NOT NULL DEFAULT 'heuristic-story-v1',
                published_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(artwork_id) REFERENCES artworks(id),
                FOREIGN KEY(batch_id) REFERENCES artwork_storytelling_generation_batches(id),
                FOREIGN KEY(created_by_user_id) REFERENCES users(id)
            )
            """
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_artwork_storytelling_versions_artwork_version "
            "ON artwork_storytelling_versions (artwork_id, version_number)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_storytelling_versions_artwork_id "
            "ON artwork_storytelling_versions (artwork_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_storytelling_versions_batch_id "
            "ON artwork_storytelling_versions (batch_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_artwork_storytelling_versions_status "
            "ON artwork_storytelling_versions (status)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS room_merge_experiment_snapshots (
                id INTEGER PRIMARY KEY,
                experiment_key VARCHAR NOT NULL,
                owner_user_id INTEGER,
                session_id VARCHAR NOT NULL,
                selected_key VARCHAR,
                memo VARCHAR,
                assembly_snapshot JSON NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_experiment_created_at "
            "ON room_merge_experiment_snapshots (experiment_key, created_at DESC)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_experiment_owner_created_at "
            "ON room_merge_experiment_snapshots (experiment_key, owner_user_id, created_at DESC)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_session_id "
            "ON room_merge_experiment_snapshots (session_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_experiment_snapshots_owner_user_id "
            "ON room_merge_experiment_snapshots (owner_user_id)"
        ))
        connection.execute(text(
            """
            CREATE TABLE IF NOT EXISTS room_merge_presets (
                id INTEGER PRIMARY KEY,
                experiment_key VARCHAR NOT NULL,
                owner_user_id INTEGER,
                session_id VARCHAR NOT NULL,
                preset_name VARCHAR NOT NULL,
                selected_key VARCHAR,
                memo VARCHAR,
                assembly_snapshot JSON NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at DATETIME
            )
            """
        ))
        connection.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_room_merge_presets_owner_name "
            "ON room_merge_presets (experiment_key, owner_user_id, preset_name)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_experiment_key "
            "ON room_merge_presets (experiment_key)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_experiment_owner "
            "ON room_merge_presets (experiment_key, owner_user_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_session_id "
            "ON room_merge_presets (session_id)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_room_merge_presets_owner_user_id "
            "ON room_merge_presets (owner_user_id)"
        ))


CURATION_AXES = [
    {
        "category": "theme",
        "label": "테마",
        "options": [
            {"id": 1, "optionKey": "nature", "labelKo": "자연", "sortOrder": 1, "displayDescription": "자연과 산수 계열 작품을 우선 배치합니다", "algorithmValue": "자연"},
            {"id": 2, "optionKey": "folk", "labelKo": "민속", "sortOrder": 2, "displayDescription": "생활상과 민속 문화 계열 작품을 우선 배치합니다", "algorithmValue": "민속"},
            {"id": 3, "optionKey": "city", "labelKo": "도시", "sortOrder": 3, "displayDescription": "도시와 근대적 장면의 작품을 우선 배치합니다", "algorithmValue": "도시"},
            {"id": 4, "optionKey": "war", "labelKo": "전쟁", "sortOrder": 4, "displayDescription": "전쟁과 역사 장면의 작품을 우선 배치합니다", "algorithmValue": "전쟁"},
        ],
    },
    {
        "category": "era",
        "label": "시대",
        "options": [
            {"id": 5, "optionKey": "ancient", "labelKo": "고대", "sortOrder": 1, "displayDescription": "고대 문명과 유물 중심의 작품을 감상합니다", "algorithmValue": "고대", "yearRangeLabel": "~499"},
            {"id": 6, "optionKey": "medieval", "labelKo": "중세", "sortOrder": 2, "displayDescription": "중세 종교·왕권·장식 예술 계열 작품을 감상합니다", "algorithmValue": "중세", "yearRangeLabel": "500-1399"},
            {"id": 7, "optionKey": "renaissance_baroque", "labelKo": "르네상스·바로크", "sortOrder": 3, "displayDescription": "르네상스와 바로크 시기의 회화·조각을 감상합니다", "algorithmValue": "르네상스·바로크", "yearRangeLabel": "1400-1699"},
            {"id": 8, "optionKey": "eighteenth_nineteenth", "labelKo": "18-19세기", "sortOrder": 4, "displayDescription": "계몽기부터 인상주의 전후까지의 작품을 감상합니다", "algorithmValue": "18-19세기", "yearRangeLabel": "1700-1899"},
            {"id": 9, "optionKey": "modern_contemporary", "labelKo": "근현대", "sortOrder": 5, "displayDescription": "20세기 이후의 현대적 감각의 작품을 감상합니다", "algorithmValue": "근현대", "yearRangeLabel": "1900~"},
        ],
    },
    {
        "category": "emotion",
        "label": "감정",
        "options": [
            {"id": 10, "optionKey": "serene", "labelKo": "평온", "sortOrder": 1, "displayDescription": "고요하고 안정된 감정을 전달하는 작품", "algorithmValue": "평온"},
            {"id": 11, "optionKey": "dynamic", "labelKo": "역동", "sortOrder": 2, "displayDescription": "활기차고 긴장감 있는 작품", "algorithmValue": "역동"},
            {"id": 12, "optionKey": "sadness", "labelKo": "슬픔", "sortOrder": 3, "displayDescription": "그리움과 애잔함을 전달하는 작품", "algorithmValue": "슬픔"},
            {"id": 13, "optionKey": "awe", "labelKo": "경이", "sortOrder": 4, "displayDescription": "웅장함과 경외감을 전달하는 작품", "algorithmValue": "경이"},
        ],
    },
]

LAYOUT_SCORE_VERSION = f"{recommendation.FEATURE_VERSION}-layout-v1"
ROOM_MERGE_EXPERIMENT_KEY = "glb-room-merge-experiment"

ARTWORK_SLOT_POSITIONS = [
    {"x": -3.75, "y": 1.5, "z": 13.25, "rotationY": 3.14159},
    {"x": 3.75, "y": 1.5, "z": 13.25, "rotationY": 3.14159},
    {"x": -5.9, "y": 1.5, "z": 8.7, "rotationY": 1.5708},
    {"x": 5.9, "y": 1.5, "z": 8.7, "rotationY": -1.5708},
    {"x": -5.9, "y": 1.5, "z": 3.2, "rotationY": 1.5708},
    {"x": 5.9, "y": 1.5, "z": 3.2, "rotationY": -1.5708},
    {"x": -5.9, "y": 1.5, "z": -2.4, "rotationY": 1.5708},
    {"x": 5.9, "y": 1.5, "z": -2.4, "rotationY": -1.5708},
    {"x": -4.2, "y": 1.5, "z": -11.8, "rotationY": 0},
    {"x": 0, "y": 1.5, "z": -11.8, "rotationY": 0},
    {"x": 4.2, "y": 1.5, "z": -11.8, "rotationY": 0},
    {"x": 7.6, "y": 1.5, "z": -6.2, "rotationY": -1.5708},
]

def _position_for_slot(index: int):
    if index < len(ARTWORK_SLOT_POSITIONS):
        return ARTWORK_SLOT_POSITIONS[index]

    overflow_index = index - len(ARTWORK_SLOT_POSITIONS)
    column = overflow_index % 7
    row = overflow_index // 7
    x = -8.4 + (column * 2.8)
    z = -16.5 - (row * 2.8)

    return {
        "x": round(x, 2),
        "y": 1.5,
        "z": round(z, 2),
        "rotationY": 0,
    }

def _find_option(option_id: int, category: str):
    axis = next(axis for axis in CURATION_AXES if axis["category"] == category)
    return next((option for option in axis["options"] if option["id"] == option_id), axis["options"][0])


def _axis_options(category: str):
    axis = next(axis for axis in CURATION_AXES if axis["category"] == category)
    return axis["options"]


def _score_selection_combinations():
    return [
        (theme, era, emotion)
        for theme in _axis_options("theme")
        for era in _axis_options("era")
        for emotion in _axis_options("emotion")
    ]


def _option_payload(option: dict, category: str):
    return {
        "id": option["id"],
        "category": category,
        "optionKey": option["optionKey"],
        "labelKo": option["labelKo"],
        "yearRangeLabel": option.get("yearRangeLabel"),
    }


def _background_image_fallback() -> str | None:
    if not ARTWORK_IMAGE_DIR.exists():
        return None

    images = sorted(path.name for path in ARTWORK_IMAGE_DIR.glob("*") if path.is_file())
    return images[0] if images else None


def _resolve_frontend_image_path(artwork: models.Artwork, feature: models.ArtworkRecommendationFeature | None):
    candidates = [
        getattr(artwork, "image_path", None),
        feature.manifest_filename if feature else None,
    ]

    for candidate in candidates:
        if not candidate:
            continue
        if (ARTWORK_IMAGE_DIR / candidate).exists():
            return f"/images/artworks/{candidate}"

    fallback_name = _background_image_fallback()
    if fallback_name:
        return f"/images/artworks/{fallback_name}"

    return None


def _generated_asset_payload(asset: models.ArtworkGeneratedAsset, artwork: models.Artwork):
    relative_output_path = (asset.relative_output_path or "").lstrip("/")
    output_path = _framed_glb_output_path(asset)
    is_ready = output_path is not None and output_path.exists() and asset.status == "ready"
    version_token = (
        int(asset.updated_at.timestamp())
        if getattr(asset, "updated_at", None)
        else int(asset.generated_at.timestamp()) if getattr(asset, "generated_at", None) else None
    )
    glb_url = asset_url(relative_output_path)
    if version_token is not None:
        glb_url = f"{glb_url}?v={version_token}"

    return {
        "artworkId": artwork.id,
        "title": artwork.title,
        "artist": artwork.artist or "Unknown Artist",
        "assetFolderName": artwork.asset_folder_name,
        "imagePath": _resolve_frontend_image_path(artwork, None),
        "glbUrl": glb_url if is_ready else None,
        "generatedAt": asset.generated_at.isoformat() if is_ready and asset.generated_at else None,
        "fileSizeBytes": asset.file_size_bytes,
        "fileName": asset.file_name,
        "source": artwork.source,
        "sourceObjectId": artwork.source_object_id,
        "sourceQuery": artwork.source_query,
        "objectUrl": artwork.object_url,
        "notes": asset.notes if isinstance(asset.notes, dict) else None,
    }


def _space_search_keywords(*parts: str | None) -> str:
    tokens: list[str] = []
    for part in parts:
        if not part:
            continue
        normalized = " ".join(part.lower().replace("·", " ").replace(",", " ").split())
        if normalized:
            tokens.extend(normalized.split(" "))
    deduped = []
    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return " ".join(deduped)


def _public_space_layout_payload(
    space_key: str,
    title: str,
    curator_display_name: str,
    location_summary: str,
    artworks: list[models.Artwork],
) -> dict[str, Any]:
    placements = _placements_from_artworks(artworks)
    if not placements:
        placements = []

    return {
        "layoutType": "public_space",
        "themeOption": {
            "id": 0,
            "category": "theme",
            "optionKey": "public_space",
            "labelKo": title,
        },
        "eraOption": {
            "id": 0,
            "category": "era",
            "optionKey": "public_space",
            "labelKo": location_summary,
        },
        "emotionOption": {
            "id": 0,
            "category": "emotion",
            "optionKey": "public_space",
            "labelKo": curator_display_name,
        },
        "gallery": {
            "mapUrl": f"/gallery/public-spaces/{space_key}",
            "entrySlotNumber": 1,
        },
        "spaceMeta": {
            "spaceKey": space_key,
            "title": title,
            "curatorDisplayName": curator_display_name,
            "locationSummary": location_summary,
        },
        "placements": placements,
    }


def _published_space_summary_payload(
    space: models.PublishedSpace,
    thumbnail_image_path: str | None = None,
) -> dict[str, Any]:
    normalized_thumbnail = _normalize_storage_path(thumbnail_image_path) or _normalize_storage_path(space.thumbnail_image_path)
    return {
        "id": space.id,
        "spaceKey": space.space_key,
        "title": space.title,
        "curatorUserId": space.curator_user_id,
        "curatorDisplayName": space.curator_display_name,
        "summary": space.summary,
        "locationSummary": space.location_summary,
        "thumbnailImagePath": normalized_thumbnail,
        "isFeatured": bool(space.is_featured),
        "isDefault": bool(space.is_default),
        "publishedAt": _dt_to_iso(space.published_at),
        "displayOrder": space.display_order or 0,
    }


def _published_space_detail_payload(
    space: models.PublishedSpace,
    thumbnail_image_path: str | None = None,
) -> dict[str, Any]:
    viewer_layout = space.layout_json if isinstance(space.layout_json, dict) else {}
    piece_count = len(viewer_layout.get("placements", [])) if isinstance(viewer_layout, dict) else 0
    return {
        **_published_space_summary_payload(space, thumbnail_image_path=thumbnail_image_path),
        "description": space.description,
        "searchKeywords": [token for token in (space.search_keywords or "").split(" ") if token],
        "viewerLayout": viewer_layout,
        "pieceCount": piece_count,
    }


def _principal_is_admin(principal: AuthPrincipal) -> bool:
    return "admin" in principal.roles


def _require_space_owner_or_admin(space_owner_id: int, principal: AuthPrincipal) -> None:
    if not _principal_is_admin(principal) and space_owner_id != principal.user_id:
        raise HTTPException(status_code=403, detail="You do not have permission to access this resource.")


def _curator_space_file_payload(file: models.CuratorSpaceFile) -> dict[str, Any]:
    relative_path = file.stored_file_path.lstrip("/")
    return {
        "id": file.id,
        "ownerUserId": file.owner_user_id,
        "spaceId": file.space_id,
        "originalFileName": file.original_file_name,
        "storedFilePath": relative_path,
        "fileUrl": asset_url(relative_path),
        "checksumSha256": file.checksum_sha256,
        "fileSizeBytes": file.file_size_bytes,
        "mimeType": file.mime_type,
        "status": file.status,
        "createdAt": _dt_to_iso(file.created_at),
        "updatedAt": _dt_to_iso(file.updated_at),
    }


def _curator_space_component_payload(
    component: models.CuratorSpaceComponent,
    file: models.CuratorSpaceFile | None = None,
) -> dict[str, Any]: 
    return { 
        "id": component.id, 
        "spaceId": component.space_id, 
        "spaceFileId": component.space_file_id, 
        "entityTypeId": component.entity_type_id,
        "componentKey": component.component_key, 
        "label": component.label,
        "position": {
            "x": component.position_x,
            "y": component.position_y,
            "z": component.position_z,
        },
        "rotation": {
            "x": component.rotation_x,
            "y": component.rotation_y,
            "z": component.rotation_z,
        },
        "scale": {
            "x": component.scale_x,
            "y": component.scale_y,
            "z": component.scale_z,
        },
        "sortOrder": component.sort_order,
        "file": _curator_space_file_payload(file) if file is not None else None,
        "createdAt": _dt_to_iso(component.created_at),
        "updatedAt": _dt_to_iso(component.updated_at),
    }


def _artwork_slot_payload(slot: models.ArtworkSlot, placement_artwork_id: int | None = None) -> dict[str, Any]: 
    return { 
        "id": slot.id, 
        "spaceId": slot.space_id, 
        "entityTypeId": slot.entity_type_id,
        "slotKey": slot.slot_key, 
        "name": slot.name,
        "sizePreset": slot.size_preset,
        "width": slot.width,
        "height": slot.height,
        "depth": slot.depth,
        "position": {
            "x": slot.position_x,
            "y": slot.position_y,
            "z": slot.position_z,
        },
        "rotation": {
            "x": slot.rotation_x,
            "y": slot.rotation_y,
            "z": slot.rotation_z,
        },
        "status": slot.status,
        "sortOrder": slot.sort_order,
        "artworkId": placement_artwork_id,
        "createdAt": _dt_to_iso(slot.created_at),
        "updatedAt": _dt_to_iso(slot.updated_at),
    }


def _curator_space_public_profile_payload(profile: models.CuratorSpacePublicProfile) -> dict[str, Any]:
    return {
        "id": profile.id,
        "spaceId": profile.space_id,
        "displayName": profile.display_name,
        "summary": profile.summary,
        "locationSummary": profile.location_summary,
        "thumbnailImagePath": profile.thumbnail_image_path,
        "searchKeywords": [token for token in (profile.search_keywords or "").split(" ") if token],
        "isFeatured": bool(profile.is_featured),
        "isDefault": bool(profile.is_default),
        "displayOrder": profile.display_order,
        "publishedAt": _dt_to_iso(profile.published_at),
        "createdAt": _dt_to_iso(profile.created_at),
        "updatedAt": _dt_to_iso(profile.updated_at),
    }


def _curator_space_version_payload(version: models.CuratorSpaceVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "spaceId": version.space_id,
        "createdByUserId": version.created_by_user_id,
        "versionName": version.version_name,
        "memo": version.memo,
        "versionSnapshot": version.version_snapshot if isinstance(version.version_snapshot, dict) else {},
        "createdAt": _dt_to_iso(version.created_at),
        "updatedAt": _dt_to_iso(version.updated_at),
    }


def _curator_space_summary_payload(
    space: models.CuratorSpace,
    *,
    component_count: int,
    slot_count: int,
    file_count: int,
    public_profile: models.CuratorSpacePublicProfile | None,
) -> dict[str, Any]:
    return {
        "id": space.id,
        "ownerUserId": space.owner_user_id,
        "name": space.name,
        "description": space.description,
        "thumbnailImagePath": space.thumbnail_image_path,
        "status": space.status,
        "currentVersionId": space.current_version_id,
        "componentCount": component_count,
        "slotCount": slot_count,
        "fileCount": file_count,
        "publicProfile": _curator_space_public_profile_payload(public_profile) if public_profile else None,
        "createdAt": _dt_to_iso(space.created_at),
        "updatedAt": _dt_to_iso(space.updated_at),
    }


def _curator_space_detail_payload(
    space: models.CuratorSpace,
    files: list[models.CuratorSpaceFile],
    components: list[models.CuratorSpaceComponent],
    slots: list[models.ArtworkSlot],
    placements: list[models.SpaceArtworkPlacement] | None = None,
    versions: list[models.CuratorSpaceVersion] | None = None,
    public_profile: models.CuratorSpacePublicProfile | None = None,
) -> dict[str, Any]:
    placement_by_slot_id = {
        placement.slot_id: placement
        for placement in (placements or [])
        if placement.deleted_at is None
    }
    file_by_id = {file.id: file for file in files if file.deleted_at is None}
    return {
        **_curator_space_summary_payload(
            space,
            component_count=len([component for component in components if component.deleted_at is None]),
            slot_count=len([slot for slot in slots if slot.deleted_at is None]),
            file_count=len([file for file in files if file.deleted_at is None]),
            public_profile=public_profile,
        ),
        "files": [_curator_space_file_payload(file) for file in files if file.deleted_at is None],
        "components": [
            _curator_space_component_payload(component, file_by_id.get(component.space_file_id))
            for component in components
            if component.deleted_at is None
        ],
        "slots": [
            _artwork_slot_payload(
                slot,
                placement_by_slot_id.get(slot.id).artwork_id if slot.id in placement_by_slot_id else None,
            )
            for slot in slots
            if slot.deleted_at is None
        ],
        "versions": [_curator_space_version_payload(version) for version in (versions or [])],
    }


def _curator_space_version_snapshot_payload(
    space: models.CuratorSpace,
    files: list[models.CuratorSpaceFile],
    components: list[models.CuratorSpaceComponent],
    slots: list[models.ArtworkSlot],
    placements: list[models.SpaceArtworkPlacement],
    public_profile: models.CuratorSpacePublicProfile | None,
) -> dict[str, Any]:
    file_by_id = {file.id: file for file in files if file.deleted_at is None}
    slot_by_id = {slot.id: slot for slot in slots if slot.deleted_at is None}
    return {
        "space": {
            "id": space.id,
            "name": space.name,
            "description": space.description,
            "status": space.status,
        },
        "files": [_curator_space_file_payload(file) for file in files if file.deleted_at is None],
        "components": [
            {
                **_curator_space_component_payload(component),
                "file": _curator_space_file_payload(file_by_id[component.space_file_id]) if component.space_file_id in file_by_id else None,
            }
            for component in components
            if component.deleted_at is None
        ],
        "slots": [
            {
                **_artwork_slot_payload(slot, None),
                "artworkId": next(
                    (placement.artwork_id for placement in placements if placement.slot_id == slot.id and placement.deleted_at is None),
                    None,
                ),
            }
            for slot in slots
            if slot.deleted_at is None
        ],
        "publicProfile": _curator_space_public_profile_payload(public_profile) if public_profile else None,
    }


def _author_artwork_response(
    artwork: models.Artwork,
    asset: models.ArtworkGeneratedAsset | None,
    *,
    status: str,
):
    if asset is None:
        return {
            "status": status,
            "artworkId": artwork.id,
            "title": artwork.title,
            "artist": artwork.artist or "Unknown Artist",
            "assetFolderName": artwork.asset_folder_name,
            "imagePath": _resolve_frontend_image_path(artwork, None),
            "glbUrl": "",
            "generatedAt": None,
            "fileSizeBytes": None,
            "fileName": "",
            "source": artwork.source,
            "sourceObjectId": artwork.source_object_id,
            "sourceQuery": artwork.source_query,
            "objectUrl": artwork.object_url,
            "notes": None,
        }

    return {
        "status": status,
        **_generated_asset_payload(asset, artwork),
    }


def _dt_to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _room_merge_owner_user_id_from_session_id(session_id: str | None) -> int | None:
    if not session_id:
        return None

    normalized = session_id.strip()
    if not normalized.startswith("user-"):
        return None

    owner_text = normalized.removeprefix("user-")
    if not owner_text.isdigit():
        return None

    return int(owner_text)


def _rebuild_sqlite_table(
    connection,
    table_name: str,
    create_sql: str,
    copy_columns: list[str],
    index_sqls: list[str],
) -> None:
    legacy_table_name = f"{table_name}__legacy_migration"
    connection.execute(text(f"DROP TABLE IF EXISTS {legacy_table_name}"))
    connection.execute(text(f"ALTER TABLE {table_name} RENAME TO {legacy_table_name}"))
    connection.execute(text(create_sql))
    column_csv = ", ".join(copy_columns)
    connection.execute(
        text(
            f"INSERT INTO {table_name} ({column_csv}) "
            f"SELECT {column_csv} FROM {legacy_table_name}"
        )
    )
    connection.execute(text(f"DROP TABLE {legacy_table_name}"))
    for index_sql in index_sqls:
        connection.execute(text(index_sql))


def _backfill_room_merge_owner_ids(connection) -> None:
    for table_name in ("room_merge_experiment_snapshots", "room_merge_presets"):
        table_exists = connection.execute(
            text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
            {"table_name": table_name},
        ).fetchone()
        if table_exists is None:
            continue

        rows = connection.execute(
            text(
                f"SELECT id, session_id FROM {table_name} "
                "WHERE owner_user_id IS NULL"
            )
        ).fetchall()
        if not rows:
            continue

        for row_id, session_id in rows:
            owner_user_id = _room_merge_owner_user_id_from_session_id(session_id)
            if owner_user_id is None:
                continue

            user_exists = connection.execute(
                text("SELECT 1 FROM users WHERE id = :user_id"),
                {"user_id": owner_user_id},
            ).fetchone()
            if user_exists is None:
                continue

            connection.execute(
                text(
                    f"UPDATE {table_name} "
                    "SET owner_user_id = :owner_user_id, updated_at = CURRENT_TIMESTAMP "
                    "WHERE id = :row_id"
                ),
                {"owner_user_id": owner_user_id, "row_id": row_id},
            )

        remaining = connection.execute(
            text(
                f"SELECT COUNT(*) FROM {table_name} "
                "WHERE owner_user_id IS NULL"
            )
        ).scalar_one()
        if remaining:
            raise RuntimeError(
                f"{table_name} contains legacy rows without owner_user_id; migration is required."
            )


def seed_public_spaces(db: Session) -> None:
    curator = get_user_by_email(db, "curator_1@digital-twin.local")
    if curator is None:
        return

    artworks = db.query(models.Artwork).order_by(models.Artwork.id.asc()).all()
    if len(artworks) < 4:
        return

    seed_definitions = [
        {
            "space_key": "test-curator1-default-gallery",
            "title": "Default Exhibition",
            "summary": "큐레이터 1이 공개한 기본 관람 공간입니다.",
            "location_summary": "Seoul · North Wing · Level 1",
            "description": "가장 먼저 노출되는 디폴트 공개 공간으로, 관람객이 홈에서 바로 진입할 수 있도록 구성한 대표 공간입니다.",
            "artwork_slice": artworks[:12],
            "is_featured": True,
            "is_default": True,
            "display_order": 1,
        },
        {
            "space_key": "test-curator1-light-archive",
            "title": "Light Archive",
            "summary": "밝은 톤의 작품을 중심으로 구성한 공개 공간입니다.",
            "location_summary": "Seoul · South Wing · Level 2",
            "description": "부드러운 색감과 밝은 분위기의 작품을 우선 배치해 가볍게 둘러보기 좋은 공간입니다.",
            "artwork_slice": artworks[12:24] or artworks[:12],
            "is_featured": True,
            "is_default": False,
            "display_order": 2,
        },
        {
            "space_key": "test-curator1-quiet-gallery",
            "title": "Quiet Gallery",
            "summary": "정적인 분위기와 서사성이 강한 작품을 묶은 공간입니다.",
            "location_summary": "Busan · East Wing · Level 3",
            "description": "서사와 정서의 밀도가 높은 작품을 중심으로, 조용히 감상하는 흐름에 맞춘 공간입니다.",
            "artwork_slice": artworks[24:36] or artworks[6:18],
            "is_featured": False,
            "is_default": False,
            "display_order": 3,
        },
        {
            "space_key": "test-curator1-night-collection",  # gitleaks:allow -- public display slug, not a credential
            "title": "Night Collection",
            "summary": "밤과 그림자, 대비가 강조되는 작품들로 구성했습니다.",
            "location_summary": "Incheon · West Wing · Level 1",
            "description": "색 대비와 밀도 높은 구성이 필요한 작품들을 묶어, 약간 더 극적인 관람 경험을 목표로 한 공간입니다.",
            "artwork_slice": list(reversed(artworks[6:18])) or artworks[:12],
            "is_featured": False,
            "is_default": False,
            "display_order": 4,
        },
    ]

    existing_spaces = {
        space.space_key: space
        for space in db.query(models.PublishedSpace).all()
    }
    changed = False

    for definition in seed_definitions:
        artwork_slice = [artwork for artwork in definition["artwork_slice"] if artwork is not None]
        if not artwork_slice:
            continue

        layout = _public_space_layout_payload(
            definition["space_key"],
            definition["title"],
            curator.display_name,
            definition["location_summary"],
            artwork_slice,
        )

        thumbnail_image_path = next(
            (artwork.image_path for artwork in artwork_slice if artwork.image_path),
            None,
        )
        search_keywords = _space_search_keywords(
            definition["title"],
            definition["summary"],
            definition["location_summary"],
            definition["description"],
            curator.display_name,
            "published space",
        )

        existing = existing_spaces.get(definition["space_key"])
        if existing is None:
            db.add(
                models.PublishedSpace(
                    space_key=definition["space_key"],
                    curator_user_id=curator.id,
                    curator_display_name=curator.display_name,
                    title=definition["title"],
                    summary=definition["summary"],
                    location_summary=definition["location_summary"],
                    description=definition["description"],
                    thumbnail_image_path=thumbnail_image_path,
                    search_keywords=search_keywords,
                    layout_json=layout,
                    status="published",
                    is_featured=definition["is_featured"],
                    is_default=definition["is_default"],
                    display_order=definition["display_order"],
                    published_at=datetime.utcnow(),
                )
            )
            changed = True
            continue

        updates = {
            "curator_user_id": curator.id,
            "curator_display_name": curator.display_name,
            "title": definition["title"],
            "summary": definition["summary"],
            "location_summary": definition["location_summary"],
            "description": definition["description"],
            "thumbnail_image_path": thumbnail_image_path,
            "search_keywords": search_keywords,
            "layout_json": layout,
            "status": "published",
            "is_featured": definition["is_featured"],
            "is_default": definition["is_default"],
            "display_order": definition["display_order"],
        }
        for field, value in updates.items():
            if getattr(existing, field) != value:
                setattr(existing, field, value)
                changed = True
        if existing.published_at is None:
            existing.published_at = datetime.utcnow()
            changed = True

    test1_space = (
        db.query(models.CuratorSpace)
        .filter(models.CuratorSpace.name == "test1")
        .filter(models.CuratorSpace.deleted_at.is_(None))
        .order_by(models.CuratorSpace.id.desc())
        .first()
    )
    if test1_space is not None:
        _, test1_files, test1_components, test1_slots, test1_placements, _, _ = _load_curator_space_context(db, test1_space.id)
        if _sync_test1_space_artwork_placements(db, space=test1_space, slots=test1_slots):
            db.flush()
            _, test1_files, test1_components, test1_slots, test1_placements, _, _ = _load_curator_space_context(db, test1_space.id)
        test1_owner = db.query(models.User).filter(models.User.id == test1_space.owner_user_id).first()
        test1_curator_name = test1_owner.display_name if test1_owner else curator.display_name
        test1_title = "test1"
        test1_location = "Curator Space · Saved Product"
        test1_layout = _curator_space_viewer_layout_payload(
            db,
            space=test1_space,
            files=test1_files,
            components=test1_components,
            slots=test1_slots,
            placements=test1_placements,
            display_name=test1_title,
            curator_display_name=test1_curator_name,
            location_summary=test1_location,
        )
        if test1_layout["placements"]:
            first_artwork = test1_layout["placements"][0]["artwork"]
            thumbnail_image_path = first_artwork.get("imagePath")
            if isinstance(thumbnail_image_path, str):
                thumbnail_image_path = thumbnail_image_path.removeprefix("/images/artworks/")
            else:
                thumbnail_image_path = None
            search_keywords = _space_search_keywords(
                test1_title,
                test1_space.description,
                test1_location,
                test1_curator_name,
                "published space",
                "default viewing",
            )
            test1_key = f"curator-space-{test1_space.id}"
            existing_test1 = existing_spaces.get(test1_key) or (
                db.query(models.PublishedSpace)
                .filter(models.PublishedSpace.space_key == test1_key)
                .first()
            )
            test1_updates = {
                "curator_user_id": test1_space.owner_user_id,
                "curator_display_name": test1_curator_name,
                "title": test1_title,
                "summary": "큐레이터가 저장한 test1 공간의 기본관람 공개 버전입니다.",
                "location_summary": test1_location,
                "description": test1_space.description or "test1 공간의 슬롯 배치에 맞춰 3D 액자 작품을 감상합니다.",
                "thumbnail_image_path": thumbnail_image_path,
                "search_keywords": search_keywords,
                "layout_json": test1_layout,
                "status": "published",
                "is_featured": True,
                "is_default": False,
                "display_order": 0,
            }
            if existing_test1 is None:
                db.add(
                    models.PublishedSpace(
                        space_key=test1_key,
                        published_at=datetime.utcnow(),
                        **test1_updates,
                    )
                )
                changed = True
            else:
                for field, value in test1_updates.items():
                    if getattr(existing_test1, field) != value:
                        setattr(existing_test1, field, value)
                        changed = True
                if existing_test1.published_at is None:
                    existing_test1.published_at = datetime.utcnow()
                    changed = True

    if changed:
        db.commit()


def _storytelling_version_payload(
    version: models.ArtworkStorytellingVersion,
    *,
    current_version_id: int | None = None,
) -> dict[str, Any]:
    return {
        "id": version.id,
        "artworkId": version.artwork_id,
        "batchId": version.batch_id,
        "versionNumber": version.version_number,
        "status": version.status,
        "isCurrentRepresentative": current_version_id is not None and version.id == current_version_id,
        "storyTitle": version.story_title,
        "storyText": version.story_text,
        "requestNote": version.request_note,
        "globalNote": version.global_note,
        "providerName": version.provider_name,
        "modelName": version.model_name,
        "promptJson": version.prompt_json or {},
        "generationMetadataJson": version.generation_metadata_json,
        "publishedAt": _dt_to_iso(version.published_at),
        "createdAt": _dt_to_iso(version.created_at) or "",
        "updatedAt": _dt_to_iso(version.updated_at) or "",
    }


def _tts_asset_payload(asset: models.TtsAsset) -> dict[str, Any]:
    return {
        "id": asset.id,
        "storytellingVersionId": asset.storytelling_version_id,
        "providerName": asset.provider_name,
        "modelName": asset.model_name,
        "voiceId": asset.voice_id,
        "languageBoost": asset.language_boost,
        "outputFormat": asset.output_format,
        "status": asset.status,
        "audioUrl": asset.audio_url,
        "audioPath": asset.audio_path,
        "traceId": asset.trace_id,
        "audioLength": asset.audio_length,
        "audioSizeBytes": asset.audio_size_bytes,
        "errorMessage": asset.error_message,
        "providerMetadata": asset.provider_metadata,
        "createdAt": _dt_to_iso(asset.created_at) or "",
        "updatedAt": _dt_to_iso(asset.updated_at) or "",
    }


def _slugify_filename(value: str) -> str:
    normalized = "".join(ch if ch.isalnum() else "_" for ch in value.strip())
    normalized = "_".join(part for part in normalized.split("_") if part)
    return normalized or "tts"


def _number_to_korean(value: int) -> str:
    if value == 0:
        return "영"
    if value < 0:
        return f"마이너스 {_number_to_korean(abs(value))}"

    digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
    small_units = ["", "십", "백", "천"]
    large_units = ["", "만", "억", "조"]
    parts: list[str] = []
    chunk_index = 0

    while value > 0:
        chunk = value % 10000
        if chunk:
            chunk_parts: list[str] = []
            for position, digit_char in enumerate(f"{chunk:04d}"):
                digit = int(digit_char)
                unit_index = 3 - position
                if digit == 0:
                    continue
                if unit_index == 0:
                    chunk_parts.append(digits[digit])
                elif digit == 1:
                    chunk_parts.append(small_units[unit_index])
                else:
                    chunk_parts.append(f"{digits[digit]}{small_units[unit_index]}")
            parts.append(f"{''.join(chunk_parts)}{large_units[chunk_index]}")
        value //= 10000
        chunk_index += 1

    return "".join(reversed(parts))


def _protect_tts_phrases(text: str, phrases: list[str]) -> tuple[str, dict[str, str]]:
    protected: dict[str, str] = {}
    rendered = text
    token_index = 0

    for phrase in sorted({phrase.strip() for phrase in phrases if phrase and phrase.strip()}, key=len, reverse=True):
        token = chr(0xE000 + token_index)
        token_index += 1
        pattern_text = re.escape(phrase).replace(r"\ ", r"\s+")
        pattern = re.compile(pattern_text, flags=re.IGNORECASE)
        if not pattern.search(rendered):
            continue
        rendered = pattern.sub(token, rendered)
        protected[token] = phrase

    return rendered, protected


def _restore_tts_phrases(text: str, protected: dict[str, str]) -> str:
    rendered = text
    for token, phrase in protected.items():
        rendered = rendered.replace(token, phrase)
    return rendered


def _build_artwork_tts_glossary(artwork: models.Artwork) -> list[tuple[re.Pattern[str], Any]]:
    glossary: list[tuple[re.Pattern[str], Any]] = []

    def add(pattern: str, replacement: Any) -> None:
        glossary.append((re.compile(pattern, flags=re.IGNORECASE), replacement))

    source = (artwork.source or "").strip().lower()
    title = (artwork.title or "").strip()
    artist = (artwork.artist or "").strip()
    source_object_id = (artwork.source_object_id or "").strip()
    source_query = (artwork.source_query or "").strip()

    # 작품 개별 규칙: 현재 데이터셋에서 자주 등장하는 소스/작품명/기관명부터 우선 정규화한다.
    if artwork.id == 1:
        add(r"the true issue or\s*\"?that's what's the matter\"?", "더 트루 이슈")
        add(r"the true issue", "더 트루 이슈")
        add(r"that's what's the matter", "무엇이 문제인가")
        add(r"currier\s*&\s*ives", "커리어 앤 아이브스")

    if title:
        # 제목이 영어로만 구성된 경우는 읽기용 한국어 제목을 우선 둔다.
        if title == "The True Issue or \"Thats Whats the Matter\"" or title == 'The True Issue or "That\'s Whats the Matter"':
            add(re.escape(title), "더 트루 이슈")

    if artist:
        if artist.lower() == "currier & ives":
            add(r"currier\s*&\s*ives", "커리어 앤 아이브스")

    if source == "met":
        add(r"\bmet\b", "메트로폴리탄 미술관")
        add(r"metropolitan museum of art", "메트로폴리탄 미술관")

    if source_object_id:
        add(rf"\bno\.?\s*{re.escape(source_object_id)}\b", f"번호 {source_object_id}")

    if source_query:
        # 검색어가 영어일 경우 발화에서는 설명형 한국어로만 남긴다.
        normalized_query = source_query.replace("_", " ").strip()
        if normalized_query:
            add(re.escape(normalized_query), "작품 관련 검색어")

    # TTS 발화에서 튀는 기술 약어는 한국어 발음으로 정리한다.
    add(r"\bTTS\b", "티티에스")
    add(r"\bAI\b", "에이아이")
    add(r"\bGPT\b", "지피티")
    add(r"\bCLIP\b", "클립")
    add(r"\bAPI\b", "에이피아이")
    add(r"\bUI\b", "유아이")
    add(r"\bUX\b", "유엑스")

    # 공통 폴백: 대문자 약어와 숫자 조합은 읽기 형태를 정돈한다.
    add(r"\bUSA\b", "미국")
    add(r"\bU\.S\.\b", "미국")
    add(r"\bNo\.\s*(\d+)\b", lambda m: f"번호 {m.group(1)}")

    return glossary


def _normalize_tts_script(artwork: models.Artwork, text: str) -> str:
    rendered = text.strip()
    if not rendered:
        return rendered

    protected_phrases = [
        (artwork.title or "").strip(),
        (artwork.artist or "").strip(),
    ]
    rendered, protected_tokens = _protect_tts_phrases(rendered, protected_phrases)

    # 작품별 규칙을 먼저 적용하고, 남아 있는 영어 표기는 최소한으로 정리한다.
    for pattern, replacement in _build_artwork_tts_glossary(artwork):
        rendered = pattern.sub(replacement, rendered)

    # 범용 숫자/소수/세기 표기를 한국어 발화 형태로 변환한다.
    rendered = re.sub(
        r"(?<![A-Za-z가-힣])(?P<start>\d{1,3}(?:,\d{3})+|\d+)\s*-\s*(?P<end>\d{1,3}(?:,\d{3})+|\d+)\s*세기",
        lambda m: f"{_number_to_korean(int(m.group('start').replace(',', '')))}세기에서 {_number_to_korean(int(m.group('end').replace(',', '')))}세기",
        rendered,
    )
    rendered = re.sub(
        r"(?<![A-Za-z가-힣])(?P<number>\d{1,3}(?:,\d{3})+|\d+)\.(?P<fraction>\d+)",
        lambda m: f"{_number_to_korean(int(m.group('number').replace(',', '')))}점{''.join('영일이삼사오육칠팔구'[int(d)] for d in m.group('fraction'))}",
        rendered,
    )
    rendered = re.sub(
        r"(?<![A-Za-z가-힣])(?P<number>\d{1,3}(?:,\d{3})+|\d+)(?P<suffix>[가-힣%]+)?",
        lambda m: f"{_number_to_korean(int(m.group('number').replace(',', '')))}{m.group('suffix') or ''}",
        rendered,
    )

    # 보호한 제목/작가명 외의 영문은 제거해서 TTS가 자연스럽게 읽도록 한다.
    rendered = re.sub(r"\b[A-Za-z]{2,}\b", "", rendered)
    rendered = rendered.replace("&", " 와 ")
    rendered = re.sub(r"\s+", " ", rendered)
    rendered = re.sub(r"\s+([,.;:!?])", r"\1", rendered)
    rendered = re.sub(r"([,.;:!?])([^\s])", r"\1 \2", rendered)
    rendered = rendered.replace("  ", " ").strip()
    rendered = _restore_tts_phrases(rendered, protected_tokens)
    rendered = re.sub(r"\s+", " ", rendered).strip()
    return rendered


def _call_minimax_tts(
    text: str,
    *,
    model_name: str,
    voice_id: str,
    language_boost: str,
    output_format: str,
) -> dict[str, Any]:
    if not MINIMAX_API_KEY:
        raise HTTPException(status_code=503, detail="MINIMAX_API_KEY is not configured.")

    payload = {
        "model": model_name,
        "text": text,
        "stream": False,
        "language_boost": language_boost,
        "output_format": output_format,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1,
            "vol": 1,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": MINIMAX_TTS_AUDIO_FORMAT,
            "channel": 1,
        },
    }
    request = UrlRequest(
        f"{MINIMAX_TTS_API_BASE}/v1/t2a_v2",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {MINIMAX_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            raw_response = response.read().decode("utf-8")
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace") if exc.fp is not None else ""
        raise RuntimeError(f"MiniMax TTS request failed ({exc.code}): {raw_body or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"MiniMax TTS request failed: {exc.reason}") from exc

    try:
        response_json = json.loads(raw_response)
    except json.JSONDecodeError as exc:
        raise RuntimeError("MiniMax TTS returned invalid JSON.") from exc

    base_resp = response_json.get("base_resp") or {}
    if int(base_resp.get("status_code") or 0) != 0:
        raise RuntimeError(
            f"MiniMax TTS error: {base_resp.get('status_msg') or 'unknown error'}"
        )

    return response_json


def _store_tts_asset(
    db: Session,
    version: models.ArtworkStorytellingVersion,
    *,
    provider_name: str,
    model_name: str,
    voice_id: str,
    language_boost: str,
    output_format: str,
    rendered_text: str | None = None,
    provider_response: dict[str, Any] | None = None,
    audio_bytes: bytes | None = None,
    status: str = "ready",
    error_message: str | None = None,
) -> models.TtsAsset:
    asset = (
        db.query(models.TtsAsset)
        .filter(models.TtsAsset.storytelling_version_id == version.id)
        .first()
    )
    if asset is None:
        asset = models.TtsAsset(
            storytelling_version_id=version.id,
            provider_name=provider_name,
            model_name=model_name,
            voice_id=voice_id,
            language_boost=language_boost,
            output_format=output_format,
            status=status,
        )
        db.add(asset)
        db.flush()

    asset.provider_name = provider_name
    asset.model_name = model_name
    asset.voice_id = voice_id
    asset.language_boost = language_boost
    asset.output_format = output_format
    asset.status = status
    asset.trace_id = (provider_response or {}).get("trace_id")
    extra_info = (provider_response or {}).get("extra_info") or {}
    asset.audio_length = extra_info.get("audio_length")
    asset.audio_size_bytes = extra_info.get("audio_size")
    asset.provider_metadata = {
        **(provider_response or {}),
        "tts_rendering_version": TTS_RENDERING_VERSION,
        "tts_preprocessing_version": TTS_RENDERING_VERSION,
        "tts_preprocessed_text": rendered_text,
        "tts_rendered_text": rendered_text,
        "tts_original_text": version.story_text,
    }
    asset.error_message = error_message

    if audio_bytes is not None and status == "ready":
        asset_dir = TTS_ASSET_DIR / f"storytelling_version_{version.id}"
        asset_dir.mkdir(parents=True, exist_ok=True)
        audio_file_name = f"{_slugify_filename(voice_id)}_{_slugify_filename(model_name)}.{MINIMAX_TTS_AUDIO_FORMAT}"
        audio_path = asset_dir / audio_file_name
        audio_path.write_bytes(audio_bytes)
        relative_output_path = f"tts/storytelling_version_{version.id}/{audio_file_name}"
        asset.audio_path = relative_output_path
        asset.audio_url = asset_url(relative_output_path)
    else:
        asset.audio_path = None
        asset.audio_url = None

    return asset


def _storytelling_summary_payload(
    artwork: models.Artwork,
    current_version: models.ArtworkStorytellingVersion | None,
    version_count: int,
) -> dict[str, Any]:
    return {
        "id": artwork.id,
        "ownerUserId": artwork.owner_user_id,
        "title": artwork.title,
        "artist": artwork.artist,
        "era": artwork.era,
        "eraYear": artwork.era_year,
        "mainThema": artwork.main_thema,
        "mainEmotion": artwork.main_emotion,
        "imagePath": artwork.image_path,
        "currentStorytellingVersionId": current_version.id if current_version else artwork.current_storytelling_version_id,
        "currentStorytellingTitle": current_version.story_title if current_version else None,
        "currentStorytellingText": current_version.story_text if current_version else None,
        "currentStorytellingStatus": current_version.status if current_version else None,
        "currentStorytellingGeneratedAt": _dt_to_iso(current_version.created_at) if current_version else None,
        "storyVersionCount": version_count,
    }


def _load_current_storytelling_version(
    db: Session,
    artwork: models.Artwork,
) -> models.ArtworkStorytellingVersion | None:
    if artwork.current_storytelling_version_id is not None:
        current = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.id == artwork.current_storytelling_version_id)
            .first()
        )
        if current is not None and current.status == "published":
            return current

    return (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .filter(models.ArtworkStorytellingVersion.status == "published")
        .order_by(models.ArtworkStorytellingVersion.version_number.desc())
        .first()
    )


def _storytelling_current_version_for_artwork(
    db: Session,
    artwork: models.Artwork,
) -> models.ArtworkStorytellingVersion | None:
    current_version = _load_current_storytelling_version(db, artwork)
    if current_version is not None:
        return current_version

    artwork.current_storytelling_version_id = None
    return None


def _cleanup_tts_asset_files(asset: models.TtsAsset) -> None:
    relative_path = (asset.audio_path or "").strip()
    if not relative_path:
        return

    audio_path = contained_path(ASSET_ROOT_DIR, relative_path.lstrip("/"))
    try:
        audio_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("failed to delete TTS file path=%s", audio_path)

    parent_dir = audio_path.parent
    try:
        if parent_dir.exists() and not any(parent_dir.iterdir()):
            parent_dir.rmdir()
    except OSError:
        logger.debug("failed to remove empty TTS directory path=%s", parent_dir)


def _cleanup_author_artwork_files(artwork: models.Artwork) -> None:
    image_name = (artwork.image_path or "").strip()
    if image_name:
        image_path = contained_path(ARTWORK_IMAGE_DIR, image_name)
        try:
            image_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("failed to delete author artwork image path=%s", image_path)

    asset_dir = contained_path(ASSET_ROOT_DIR, artwork.asset_folder_name)
    if asset_dir.exists():
        try:
            shutil.rmtree(asset_dir)
        except OSError:
            logger.warning("failed to delete author artwork asset dir path=%s", asset_dir)


def _require_author_artwork_owner(principal: AuthPrincipal, artwork: models.Artwork) -> None:
    if artwork.owner_user_id != principal.user_id:
        raise HTTPException(status_code=403, detail="해당 작품을 수정할 권한이 없습니다.")


def _normalize_storytelling_status(value: str) -> str:
    normalized = value.strip().lower()
    allowed = {"draft", "reviewed", "published", "archived"}
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="status must be one of draft, reviewed, published, archived.")
    return normalized


def _can_manage_storytelling(principal: AuthPrincipal, artwork: models.Artwork) -> bool:
    if "admin" in principal.roles:
        return True
    return artwork.owner_user_id == principal.user_id


def _require_storytelling_access(principal: AuthPrincipal, artwork: models.Artwork) -> None:
    if not _can_manage_storytelling(principal, artwork):
        raise HTTPException(status_code=403, detail="해당 작품의 Storytelling을 관리할 권한이 없습니다.")


def _load_public_storytelling_current(db: Session, artwork: models.Artwork, *, public: bool = True) -> dict[str, Any]:
    version = None
    if artwork.current_storytelling_version_id is not None:
        version = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.id == artwork.current_storytelling_version_id)
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .filter(models.ArtworkStorytellingVersion.status == "published")
            .first()
        )
    if version is None:
        version = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .filter(models.ArtworkStorytellingVersion.status == "published")
            .order_by(models.ArtworkStorytellingVersion.version_number.desc())
            .first()
        )

    tts_assets = (
        db.query(models.TtsAsset)
        .join(
            models.ArtworkStorytellingVersion,
            models.ArtworkStorytellingVersion.id == models.TtsAsset.storytelling_version_id,
        )
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .filter(models.ArtworkStorytellingVersion.status == "published")
        .order_by(
            models.TtsAsset.created_at.desc(),
            models.TtsAsset.id.desc(),
        )
        .all()
    )

    version_payload = _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id) if version else None
    tts_payloads = [_tts_asset_payload(asset) for asset in tts_assets]
    if public:
        if version_payload:
            for key in ("requestNote", "globalNote", "generationMetadataJson"):
                version_payload[key] = None
            version_payload["promptJson"] = {}
        for payload in tts_payloads:
            for key in ("audioPath", "traceId", "providerMetadata", "errorMessage"):
                payload[key] = None
    return {
        "status": "success",
        "artworkId": artwork.id,
        "currentVersion": version_payload,
        "ttsAssets": tts_payloads,
    }


def _next_artwork_id(db: Session) -> int:
    current_max = db.query(func.max(models.Artwork.id)).scalar()
    return int(current_max or 0) + 1


def _validate_non_empty(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail=f"{field_name} is required.")
    return normalized


def _validate_era_year(value: int) -> int:
    if value < 0 or value > 3000:
        raise HTTPException(status_code=400, detail="era_year must be between 0 and 3000.")
    return value


async def _read_and_validate_upload_image(image: UploadFile) -> tuple[bytes, str]:
    content_type = (image.content_type or "").lower().strip()
    logger.info(
        "author upload received filename=%s content_type=%s",
        image.filename,
        content_type or "<empty>",
    )
    # Browsers and OS integrations do not agree on upload MIME aliases for the
    # same image bytes. Gate only on obvious non-image uploads here, then let
    # Pillow verify the actual format below.
    if content_type and not (
        content_type.startswith("image/") or content_type == "application/octet-stream"
    ):
        logger.warning(
            "author upload rejected before decode filename=%s content_type=%s reason=non-image-content-type",
            image.filename,
            content_type,
        )
        raise HTTPException(status_code=400, detail="Uploaded file must be an image.")

    raw_bytes = await image.read(AUTHOR_UPLOAD_MAX_BYTES + 1)
    if not raw_bytes:
        logger.warning("author upload rejected filename=%s reason=empty-file", image.filename)
        raise HTTPException(status_code=400, detail="Image file is empty.")
    if len(raw_bytes) > AUTHOR_UPLOAD_MAX_BYTES:
        logger.warning(
            "author upload rejected filename=%s size_bytes=%s reason=file-too-large",
            image.filename,
            len(raw_bytes),
        )
        raise HTTPException(status_code=400, detail="Image file must be 10MB or smaller.")

    try:
        with Image.open(BytesIO(raw_bytes)) as opened_image:
            image_format = opened_image.format
            normalized_image = ImageOps.exif_transpose(opened_image)
            if normalized_image.mode not in ("RGB", "RGBA"):
                normalized_image = normalized_image.convert("RGB")
            output_buffer = BytesIO()
            if image_format in {"JPEG", "MPO"}:
                if normalized_image.mode == "RGBA":
                    normalized_image = normalized_image.convert("RGB")
                normalized_image.save(output_buffer, format="JPEG", quality=95, optimize=True)
            elif image_format == "PNG":
                normalized_image.save(output_buffer, format="PNG", optimize=True)
            elif image_format == "WEBP":
                normalized_image.save(output_buffer, format="WEBP", quality=95)
            elif image_format == "HEIF":
                if normalized_image.mode == "RGBA":
                    normalized_image = normalized_image.convert("RGB")
                normalized_image.save(output_buffer, format="JPEG", quality=95, optimize=True)
            else:
                logger.warning(
                    "author upload rejected filename=%s detected_format=%s reason=unsupported-decoded-format",
                    image.filename,
                    image_format,
                )
                raise HTTPException(status_code=400, detail="Only JPEG, PNG, WEBP, and HEIC images are supported.")
            normalized_bytes = output_buffer.getvalue()
    except (UnidentifiedImageError, OSError) as exc:
        logger.warning(
            "author upload rejected filename=%s content_type=%s reason=invalid-image error=%s",
            image.filename,
            content_type or "<empty>",
            exc,
        )
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.") from exc

    extension = AUTHOR_UPLOAD_FORMAT_TO_EXTENSION.get(image_format or "")
    if extension is None:
        logger.warning(
            "author upload rejected filename=%s detected_format=%s reason=missing-extension-mapping",
            image.filename,
            image_format,
        )
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WEBP, and HEIC images are supported.")

    if len(normalized_bytes) > AUTHOR_UPLOAD_MAX_BYTES:
        logger.warning(
            "author upload rejected filename=%s normalized_size_bytes=%s reason=normalized-file-too-large",
            image.filename,
            len(normalized_bytes),
        )
        raise HTTPException(status_code=400, detail="Normalized image file must be 10MB or smaller.")

    return normalized_bytes, extension


def _failed_generated_asset_record(
    db: Session,
    artwork: models.Artwork,
    image_file_name: str,
    message: str,
) -> models.ArtworkGeneratedAsset:
    record = (
        db.query(models.ArtworkGeneratedAsset)
        .filter(
            models.ArtworkGeneratedAsset.artwork_id == artwork.id,
            models.ArtworkGeneratedAsset.asset_kind == "framed_glb",
        )
        .first()
    )
    relative_output_path = f"{artwork.asset_folder_name}/framed_artwork.glb"
    source_image_path = str((ARTWORK_IMAGE_DIR / image_file_name).resolve())
    payload = {
        "status": "failed",
        "file_name": "framed_artwork.glb",
        "relative_output_path": relative_output_path,
        "source_image_path": source_image_path,
        "file_size_bytes": None,
        "notes": {"error": message},
    }

    if record is None:
        record = models.ArtworkGeneratedAsset(
            artwork_id=artwork.id,
            asset_kind="framed_glb",
            **payload,
        )
        db.add(record)
    else:
        for key, value in payload.items():
            setattr(record, key, value)

    db.commit()
    db.refresh(record)
    return record


def _upsert_framed_glb_asset_record(
    db: Session,
    artwork: models.Artwork,
    *,
    status: str,
    image_file_name: str | None = None,
    notes: dict[str, Any] | None = None,
) -> models.ArtworkGeneratedAsset:
    record = _framed_glb_asset_record(db, artwork.id)
    file_name = "framed_artwork.glb"
    relative_output_path = f"{artwork.asset_folder_name}/{file_name}"
    source_image_name = image_file_name or _artwork_source_image_file_name(artwork)
    source_image_path = str((ARTWORK_IMAGE_DIR / source_image_name).resolve())
    file_size_bytes = None
    output_path = ASSET_ROOT_DIR / relative_output_path
    if status == "ready" and output_path.exists():
        file_size_bytes = output_path.stat().st_size

    payload = {
        "status": status,
        "file_name": file_name,
        "relative_output_path": relative_output_path,
        "source_image_path": source_image_path,
        "file_size_bytes": file_size_bytes,
        "notes": notes or {},
    }

    if record is None:
        record = models.ArtworkGeneratedAsset(
            artwork_id=artwork.id,
            asset_kind="framed_glb",
            generated_at=datetime.utcnow(),
            **payload,
        )
        db.add(record)
    else:
        for key, value in payload.items():
            setattr(record, key, value)
        record.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(record)
    return record


def _artwork_source_image_file_name(artwork: models.Artwork) -> str:
    if artwork.image_path:
        return Path(artwork.image_path).name
    return f"{artwork.asset_folder_name}.jpg"


def _framed_glb_asset_record(
    db: Session,
    artwork_id: int,
) -> models.ArtworkGeneratedAsset | None:
    return (
        db.query(models.ArtworkGeneratedAsset)
        .filter(models.ArtworkGeneratedAsset.artwork_id == artwork_id)
        .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
        .first()
    )


def _framed_glb_output_path(asset: models.ArtworkGeneratedAsset | None) -> Path | None:
    if asset is None or not asset.relative_output_path:
        return None

    relative_path = asset.relative_output_path.lstrip("/")
    if not relative_path:
        return None

    return ASSET_ROOT_DIR / relative_path


def _should_regenerate_framed_glb_asset(asset: models.ArtworkGeneratedAsset | None) -> bool:
    if asset is None:
        return True
    if asset.status != "ready":
        return True

    output_path = _framed_glb_output_path(asset)
    return output_path is None or not output_path.exists()


_GLB_STALE_GENERATING_MINUTES = 15


def _ensure_framed_glb_asset(db: Session, artwork: models.Artwork) -> models.ArtworkGeneratedAsset:
    existing_asset = _framed_glb_asset_record(db, artwork.id)
    if existing_asset is not None and existing_asset.status in {"queued", "generating"}:
        # Allow the background job to finish unless it has been stuck for too long.
        updated = getattr(existing_asset, "updated_at", None) or getattr(existing_asset, "generated_at", None)
        stale = updated is None or (datetime.utcnow() - updated).total_seconds() > _GLB_STALE_GENERATING_MINUTES * 60
        if not stale:
            return existing_asset
        # Stale generating record — fall through to re-run synchronously.
        logger.warning(
            "GLB asset stuck in %s for >%dm; re-running synchronously artwork_id=%s",
            existing_asset.status,
            _GLB_STALE_GENERATING_MINUTES,
            artwork.id,
        )
    if not _should_regenerate_framed_glb_asset(existing_asset):
        assert existing_asset is not None
        return existing_asset

    try:
        _run_frame_generation_script(artwork.id)
    except Exception as exc:
        failed_record = _failed_generated_asset_record(db, artwork, _artwork_source_image_file_name(artwork), str(exc))
        raise HTTPException(
            status_code=500,
            detail={
                "message": f"Framed GLB generation failed: {exc}",
                "artworkId": artwork.id,
                "status": failed_record.status,
            },
        ) from exc

    db.expire_all()
    generated_asset = _framed_glb_asset_record(db, artwork.id)
    if generated_asset is None or generated_asset.status != "ready":
        raise HTTPException(status_code=500, detail="GLB generation did not produce a ready asset.")

    return generated_asset


_AUTHOR_ARTWORK_GENERATION_JOBS: set[int] = set()
_AUTHOR_ARTWORK_GENERATION_JOBS_LOCK = threading.Lock()


def _start_author_artwork_generation_job(artwork_id: int) -> bool:
    with _AUTHOR_ARTWORK_GENERATION_JOBS_LOCK:
        if artwork_id in _AUTHOR_ARTWORK_GENERATION_JOBS:
            return False
        _AUTHOR_ARTWORK_GENERATION_JOBS.add(artwork_id)

    thread = threading.Thread(
        target=_author_artwork_generation_worker,
        args=(artwork_id,),
        daemon=True,
        name=f"author-artwork-generate-{artwork_id}",
    )
    thread.start()
    return True


def _finish_author_artwork_generation_job(artwork_id: int) -> None:
    with _AUTHOR_ARTWORK_GENERATION_JOBS_LOCK:
        _AUTHOR_ARTWORK_GENERATION_JOBS.discard(artwork_id)


def _author_artwork_generation_worker(artwork_id: int) -> None:
    db = SessionLocal()
    try:
        artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
        if artwork is None:
            logger.warning("author artwork generation skipped: artwork not found artwork_id=%s", artwork_id)
            return

        source_image_name = _artwork_source_image_file_name(artwork)
        _upsert_framed_glb_asset_record(
            db,
            artwork,
            status="generating",
            image_file_name=source_image_name,
            notes={"stage": "generating"},
        )

        try:
            _run_frame_generation_script(artwork.id)
        except Exception as exc:
            logger.exception("author artwork GLB generation failed artwork_id=%s", artwork.id)
            _failed_generated_asset_record(db, artwork, source_image_name, str(exc))
            return

        db.expire_all()
        generated_asset = _framed_glb_asset_record(db, artwork.id)
        if generated_asset is None or generated_asset.status != "ready":
            _failed_generated_asset_record(
                db,
                artwork,
                source_image_name,
                "GLB generation completed but ready asset was not persisted.",
            )
            logger.error("author artwork generation finished without ready asset artwork_id=%s", artwork.id)
            return

        # Double-check the GLB file actually exists on disk.
        # The subprocess may update the DB to "ready" even when the file was not created
        # (e.g. Blender operator silently cancelled).
        glb_path = _framed_glb_output_path(generated_asset)
        if glb_path is None or not glb_path.exists():
            _failed_generated_asset_record(
                db,
                artwork,
                source_image_name,
                "GLB file missing on disk after generation reported ready.",
            )
            logger.error(
                "author artwork GLB file missing after ready status artwork_id=%s path=%s",
                artwork.id,
                glb_path,
            )
            return

        refresh_recommendation_features(db, force=True, artwork_ids={artwork.id})
        refresh_recommendation_layout_scores(db, force=True, artwork_ids={artwork.id})
    finally:
        db.close()
        _finish_author_artwork_generation_job(artwork_id)


def _run_frame_generation_script(artwork_id: int) -> None:
    command = [sys.executable, str(FRAME_GENERATOR_SCRIPT), "--artwork-id", str(artwork_id)]
    result = subprocess.run(
        command,
        cwd=Path(__file__).resolve().parent.parent,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        stdout = result.stdout.strip()
        detail = stderr or stdout or "Framed GLB generation failed."
        raise RuntimeError(detail)


def _recommendation_meta(
    feature: models.ArtworkRecommendationFeature | None,
    recommendation_result: recommendation.RecommendationResult | None,
    precomputed_score: models.ArtworkRecommendationScore | None = None,
):
    estimated_year_reason = None
    if feature and isinstance(feature.notes, dict):
        estimated_year_reason = feature.notes.get("estimated_year_reason")

    if precomputed_score and feature:
        return {
            "reasons": precomputed_score.reasons or [],
            "scoreBreakdown": {
                "visual": precomputed_score.visual_score,
                "theme": precomputed_score.theme_score,
                "era": precomputed_score.era_score,
                "emotion": precomputed_score.emotion_score,
                "final": precomputed_score.final_score,
            },
            "estimatedYearReason": estimated_year_reason,
            "recommendationReady": bool(feature.recommendation_ready),
            "recommendationSourceVersion": precomputed_score.score_version,
        }

    if recommendation_result and feature:
        return {
            "reasons": recommendation_result.reasons,
            "scoreBreakdown": {
                "visual": recommendation_result.visual_score,
                "theme": recommendation_result.theme_score,
                "era": recommendation_result.era_score,
                "emotion": recommendation_result.emotion_score,
                "final": recommendation_result.final_score,
            },
            "estimatedYearReason": estimated_year_reason,
            "recommendationReady": bool(feature.recommendation_ready),
            "recommendationSourceVersion": feature.feature_version,
        }

    if feature:
        return {
            "reasons": ["추천 피처 준비 완료"],
            "scoreBreakdown": {
                "visual": 0.0,
                "theme": 0.0,
                "era": 0.0,
                "emotion": 0.0,
                "final": 0.0,
            },
            "estimatedYearReason": estimated_year_reason,
            "recommendationReady": bool(feature.recommendation_ready),
            "recommendationSourceVersion": feature.feature_version,
        }

    return {
        "reasons": ["추천 피처 미생성"],
        "scoreBreakdown": {
            "visual": 0.0,
            "theme": 0.0,
            "era": 0.0,
            "emotion": 0.0,
            "final": 0.0,
        },
        "estimatedYearReason": None,
        "recommendationReady": False,
        "recommendationSourceVersion": recommendation.FEATURE_VERSION,
    }


def _provider_meta_from_feature(feature: models.ArtworkRecommendationFeature | None):
    notes = feature.notes if feature and isinstance(feature.notes, dict) else {}
    return {
        "visualProvider": notes.get("visual_provider"),
        "metaProvider": notes.get("meta_provider"),
        "metadataSource": notes.get("metadata_source"),
    }


def _framed_asset_url(asset: models.ArtworkGeneratedAsset | None) -> str | None:
    if asset is None:
        return None

    relative_output_path = (asset.relative_output_path or "").lstrip("/")
    if not relative_output_path:
        return None

    version_token = (
        int(asset.updated_at.timestamp())
        if getattr(asset, "updated_at", None)
        else int(asset.generated_at.timestamp()) if getattr(asset, "generated_at", None) else None
    )
    glb_url = asset_url(relative_output_path)
    if version_token is not None:
        glb_url = f"{glb_url}?v={version_token}"
    return glb_url


def _is_ready_framed_glb_asset(asset: models.ArtworkGeneratedAsset | None) -> bool:
    if asset is None or asset.status != "ready":
        return False
    output_path = _framed_glb_output_path(asset)
    return output_path is not None and output_path.exists()


def _artwork_to_frontend(
    artwork: models.Artwork,
    feature: models.ArtworkRecommendationFeature | None = None,
    recommendation_result: recommendation.RecommendationResult | None = None,
    precomputed_score: models.ArtworkRecommendationScore | None = None,
    framed_asset: models.ArtworkGeneratedAsset | None = None,
):
    estimated_year = artwork.era_year if artwork.era_year != 0 else None
    if feature and isinstance(feature.notes, dict):
        estimated_year = feature.notes.get("estimated_year") or estimated_year

    return {
        "id": str(artwork.id),
        "ownerUserId": artwork.owner_user_id,
        "title": artwork.title,
        "artist": artwork.artist or "Unknown Artist",
        "originPeriod": artwork.era,
        "eraYear": artwork.era_year,
        "estimatedYear": estimated_year,
        "yearDisplay": recommendation.format_year_display(
            estimated_year,
            estimated=(estimated_year is not None and estimated_year == artwork.era_year and bool(feature and isinstance(feature.notes, dict) and feature.notes.get("estimated_year_reason"))),
        ),
        "descriptionDefault": (
            f"{artwork.main_thema} / {artwork.main_emotion}"
            f"{' / 보조테마 ' + artwork.sub_thema if artwork.sub_thema else ''}"
            f"{' / 보조감정 ' + artwork.sub_emotion if artwork.sub_emotion else ''}"
        ),
        "imagePath": _resolve_frontend_image_path(artwork, feature),
        "framedGlbUrl": _framed_asset_url(framed_asset),
        "source": artwork.source,
        "sourceObjectId": artwork.source_object_id,
        "sourceQuery": artwork.source_query,
        "objectUrl": artwork.object_url,
        "providerMeta": _provider_meta_from_feature(feature),
        **_recommendation_meta(feature, recommendation_result, precomputed_score),
    }


def _placements_from_artworks(
    artworks: list[models.Artwork],
    feature_map: dict[int, models.ArtworkRecommendationFeature] | None = None,
    recommendation_map: dict[int, recommendation.RecommendationResult] | None = None,
    score_map: dict[int, models.ArtworkRecommendationScore] | None = None,
):
    feature_map = feature_map or {}
    recommendation_map = recommendation_map or {}
    score_map = score_map or {}
    return [
        {
            "slotNumber": index + 1,
            "artwork": _artwork_to_frontend(
                artwork,
                feature_map.get(artwork.id),
                recommendation_map.get(artwork.id),
                score_map.get(artwork.id),
            ),
            "position": _position_for_slot(index),
            "sortValue": index + 1,
        }
        for index, artwork in enumerate(artworks)
    ]


def _ready_framed_assets_by_artwork_id(
    db: Session,
    artwork_ids: set[int] | None = None,
) -> dict[int, models.ArtworkGeneratedAsset]:
    query = (
        db.query(models.ArtworkGeneratedAsset)
        .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
        .filter(models.ArtworkGeneratedAsset.status == "ready")
    )
    if artwork_ids is not None:
        if not artwork_ids:
            return {}
        query = query.filter(models.ArtworkGeneratedAsset.artwork_id.in_(artwork_ids))

    return {
        asset.artwork_id: asset
        for asset in query.order_by(
            models.ArtworkGeneratedAsset.generated_at.desc(),
            models.ArtworkGeneratedAsset.artwork_id.asc(),
        ).all()
        if _is_ready_framed_glb_asset(asset)
    }


def _ordered_ready_framed_artwork_rows(
    db: Session,
    exclude_artwork_ids: set[int] | None = None,
) -> list[tuple[models.Artwork, models.ArtworkGeneratedAsset]]:
    exclude_artwork_ids = exclude_artwork_ids or set()
    query = (
        db.query(models.Artwork, models.ArtworkGeneratedAsset)
        .join(models.ArtworkGeneratedAsset, models.ArtworkGeneratedAsset.artwork_id == models.Artwork.id)
        .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
        .filter(models.ArtworkGeneratedAsset.status == "ready")
    )
    if exclude_artwork_ids:
        query = query.filter(~models.Artwork.id.in_(exclude_artwork_ids))

    return [
        (artwork, asset)
        for artwork, asset in query.order_by(models.Artwork.id.asc()).all()
        if _is_ready_framed_glb_asset(asset)
    ]


def _latest_room_merge_snapshot_for_space(
    db: Session,
    *,
    space_id: int,
) -> models.RoomMergeExperimentSnapshot | None:
    return (
        db.query(models.RoomMergeExperimentSnapshot)
        .filter(models.RoomMergeExperimentSnapshot.space_id == space_id)
        .filter(models.RoomMergeExperimentSnapshot.experiment_key == ROOM_MERGE_EXPERIMENT_KEY)
        .order_by(
            models.RoomMergeExperimentSnapshot.created_at.desc(),
            models.RoomMergeExperimentSnapshot.id.desc(),
        )
        .first()
    )


def _room_merge_snapshot_components_payload(
    *,
    space: models.CuratorSpace,
    files: list[models.CuratorSpaceFile],
    snapshot: models.RoomMergeExperimentSnapshot,
) -> list[dict[str, Any]]:
    file_by_id = {file.id: file for file in files if file.deleted_at is None}
    payload = snapshot.assembly_snapshot if isinstance(snapshot.assembly_snapshot, dict) else {}
    pieces = payload.get("pieces", {}) if isinstance(payload, dict) else {}
    if not isinstance(pieces, dict):
        return []

    components: list[dict[str, Any]] = []
    for sort_order, file in enumerate(sorted(file_by_id.values(), key=lambda item: item.id)):
        piece_key = f"file-{file.id}"
        piece_state = pieces.get(piece_key)
        if not isinstance(piece_state, dict):
            continue

        position = piece_state.get("position")
        rotation = piece_state.get("rotation")
        if not (isinstance(position, list) and len(position) == 3 and isinstance(rotation, list) and len(rotation) == 3):
            continue

        components.append(
            {
                "id": file.id,
                "spaceId": space.id,
                "spaceFileId": file.id,
                "entityTypeId": 1,
                "componentKey": piece_key,
                "label": file.original_file_name,
                "position": {
                    "x": position[0],
                    "y": position[1],
                    "z": position[2],
                },
                "rotation": {
                    "x": rotation[0],
                    "y": rotation[1],
                    "z": rotation[2],
                },
                "scale": {
                    "x": 1,
                    "y": 1,
                    "z": 1,
                },
                "sortOrder": sort_order,
                "file": _curator_space_file_payload(file),
            }
        )

    return components


def _sync_test1_space_artwork_placements(
    db: Session,
    *,
    space: models.CuratorSpace,
    slots: list[models.ArtworkSlot],
) -> bool:
    active_slots = sorted(
        [slot for slot in slots if slot.deleted_at is None],
        key=lambda slot: (slot.sort_order or 0, slot.id or 0),
    )
    if not active_slots:
        return False

    ready_rows = _ordered_ready_framed_artwork_rows(db)
    if not ready_rows:
        return False

    desired_rows = list(zip(active_slots, ready_rows, strict=False))
    if not desired_rows:
        return False

    slot_order_by_id = {
        slot.id: (slot.sort_order or 0, slot.id or 0)
        for slot in active_slots
    }
    existing_rows = (
        db.query(models.SpaceArtworkPlacement)
        .filter(models.SpaceArtworkPlacement.space_id == space.id)
        .filter(models.SpaceArtworkPlacement.deleted_at.is_(None))
        .order_by(models.SpaceArtworkPlacement.slot_id.asc(), models.SpaceArtworkPlacement.id.asc())
        .all()
    )

    existing_signature = sorted(
        [(row.slot_id, row.artwork_id, row.status) for row in existing_rows],
        key=lambda item: slot_order_by_id.get(item[0], (0, item[0])),
    )
    desired_signature = [(slot.id, artwork.id, slot.status) for slot, (artwork, _) in desired_rows]
    if existing_signature == desired_signature:
        return False

    db.query(models.SpaceArtworkPlacement).filter(models.SpaceArtworkPlacement.space_id == space.id).delete()

    db.add_all(
        [
            models.SpaceArtworkPlacement(
                space_id=space.id,
                slot_id=slot.id,
                artwork_id=artwork.id,
                status=slot.status,
            )
            for slot, (artwork, _) in desired_rows
        ]
    )
    return True


def _curator_space_viewer_layout_payload(
    db: Session,
    *,
    space: models.CuratorSpace,
    files: list[models.CuratorSpaceFile],
    components: list[models.CuratorSpaceComponent],
    slots: list[models.ArtworkSlot],
    placements: list[models.SpaceArtworkPlacement],
    display_name: str,
    curator_display_name: str,
    location_summary: str,
) -> dict[str, Any]:
    file_by_id = {file.id: file for file in files if file.deleted_at is None}
    active_slots = sorted(
        [slot for slot in slots if slot.deleted_at is None],
        key=lambda slot: (slot.sort_order or 0, slot.id or 0),
    )
    placement_by_slot_id = {
        placement.slot_id: placement
        for placement in placements
        if placement.deleted_at is None
    }
    explicit_artwork_ids = [
        placement.artwork_id
        for slot in active_slots
        if (placement := placement_by_slot_id.get(slot.id)) is not None
    ]
    explicit_asset_by_artwork_id = _ready_framed_assets_by_artwork_id(db, set(explicit_artwork_ids))
    explicit_artworks_by_id = {
        artwork.id: artwork
        for artwork in db.query(models.Artwork).filter(models.Artwork.id.in_(explicit_artwork_ids)).all()
    } if explicit_artwork_ids else {}
    fallback_rows = _ordered_ready_framed_artwork_rows(db, set(explicit_artwork_ids))
    fallback_index = 0
    room_merge_snapshot = _latest_room_merge_snapshot_for_space(db, space_id=space.id)

    layout_placements: list[dict[str, Any]] = []
    if room_merge_snapshot is not None:
        space_components = _room_merge_snapshot_components_payload(
            space=space,
            files=files,
            snapshot=room_merge_snapshot,
        )
    else:
        space_components = [
            _curator_space_component_payload(component, file_by_id.get(component.space_file_id))
            for component in sorted(
                [component for component in components if component.deleted_at is None],
                key=lambda component: (component.sort_order or 0, component.id or 0),
            )
        ]
    visible_slot_index = 1
    for slot in active_slots:
        placement = placement_by_slot_id.get(slot.id)
        artwork: models.Artwork | None = None
        framed_asset: models.ArtworkGeneratedAsset | None = None
        if placement is not None:
            artwork = explicit_artworks_by_id.get(placement.artwork_id)
            framed_asset = explicit_asset_by_artwork_id.get(placement.artwork_id)

        if artwork is None or framed_asset is None:
            if fallback_index >= len(fallback_rows):
                break
            artwork, framed_asset = fallback_rows[fallback_index]
            fallback_index += 1

        layout_placements.append(
            {
                "slotNumber": visible_slot_index,
                "slotKey": slot.slot_key,
                "slotSize": {
                    "width": slot.width,
                    "height": slot.height,
                    "depth": slot.depth,
                },
                "artwork": _artwork_to_frontend(artwork, framed_asset=framed_asset),
                "position": {
                    "x": slot.position_x,
                    "y": slot.position_y,
                    "z": slot.position_z,
                    "rotation": {
                        "x": slot.rotation_x,
                        "y": slot.rotation_y,
                        "z": slot.rotation_z,
                    },
                    "rotationY": slot.rotation_y,
                },
                "sortValue": visible_slot_index,
            }
        )
        visible_slot_index += 1

    return {
        "layoutType": "public_space",
        "themeOption": {
            "id": 0,
            "category": "theme",
            "optionKey": "curator_space",
            "labelKo": display_name,
        },
        "eraOption": {
            "id": 0,
            "category": "era",
            "optionKey": "curator_space",
            "labelKo": location_summary,
        },
        "emotionOption": {
            "id": 0,
            "category": "emotion",
            "optionKey": "curator_space",
            "labelKo": curator_display_name,
        },
        "gallery": {
            "mapUrl": f"/gallery/curator-spaces/{space.id}",
            "entrySlotNumber": 1,
        },
        "spaceMeta": {
            "spaceKey": f"curator-space-{space.id}",
            "title": display_name,
            "curatorDisplayName": curator_display_name,
            "locationSummary": location_summary,
        },
        "spaceComponents": space_components,
        "placements": layout_placements,
    }


def refresh_recommendation_features(
    db: Session,
    force: bool = False,
    artwork_ids: set[int] | None = None,
):
    manifest_records = recommendation.load_manifest_records()
    artwork_query = db.query(models.Artwork)
    if artwork_ids:
        artwork_query = artwork_query.filter(models.Artwork.id.in_(sorted(artwork_ids)))
    artworks = artwork_query.all()
    if not artworks:
        return

    feature_query = db.query(models.ArtworkRecommendationFeature)
    if artwork_ids:
        feature_query = feature_query.filter(
            models.ArtworkRecommendationFeature.artwork_id.in_(sorted(artwork_ids))
        )
    existing_features = {
        feature.artwork_id: feature
        for feature in feature_query.all()
    }

    changed = False
    required_note_keys = {
        "metadata_source",
        "estimated_year",
        "estimated_year_reason",
        "derived_era_key",
        "derived_era_label_ko",
        "visual_provider",
        "meta_provider",
    }
    for artwork in artworks:
        feature = existing_features.get(artwork.id)
        if not force and feature is not None:
            notes = feature.notes or {}
            is_current_feature = (
                feature.feature_version == recommendation.FEATURE_VERSION
                and feature.recommendation_ready
                and bool(feature.visual_embedding)
                and required_note_keys.issubset(notes.keys())
            )
            if is_current_feature:
                continue

        payload = recommendation.infer_recommendation_feature(artwork, manifest_records)
        artwork_updates = payload.get("artwork_updates") or {}
        for field, value in artwork_updates.items():
            if getattr(artwork, field) != value:
                setattr(artwork, field, value)
                changed = True
        if feature is None:
            feature_payload = {key: value for key, value in payload.items() if key != "artwork_updates"}
            db.add(models.ArtworkRecommendationFeature(artwork_id=artwork.id, **feature_payload))
            changed = True
            continue

        if force or any([
            feature.feature_version != payload["feature_version"],
            feature.source_model != payload["source_model"],
            feature.visual_embedding != payload["visual_embedding"],
            feature.theme_scores != payload["theme_scores"],
            feature.era_scores != payload["era_scores"],
            feature.emotion_scores != payload["emotion_scores"],
            feature.recommendation_ready != payload["recommendation_ready"],
            feature.manifest_filename != payload["manifest_filename"],
            feature.notes != payload["notes"],
        ]):
            feature.feature_version = payload["feature_version"]
            feature.source_model = payload["source_model"]
            feature.visual_embedding = payload["visual_embedding"]
            feature.theme_scores = payload["theme_scores"]
            feature.era_scores = payload["era_scores"]
            feature.emotion_scores = payload["emotion_scores"]
            feature.recommendation_ready = payload["recommendation_ready"]
            feature.manifest_filename = payload["manifest_filename"]
            feature.notes = payload["notes"]
            changed = True

    if changed:
        db.commit()


def refresh_recommendation_layout_scores(
    db: Session,
    force: bool = False,
    artwork_ids: set[int] | None = None,
    selection_ids: list[tuple[int, int, int]] | None = None,
):
    artwork_query = db.query(models.Artwork)
    if artwork_ids:
        artwork_query = artwork_query.filter(models.Artwork.id.in_(sorted(artwork_ids)))
    artworks = artwork_query.all()
    if not artworks:
        return

    feature_query = db.query(models.ArtworkRecommendationFeature).filter(
        models.ArtworkRecommendationFeature.recommendation_ready.is_(True)
    )
    if artwork_ids:
        feature_query = feature_query.filter(
            models.ArtworkRecommendationFeature.artwork_id.in_(sorted(artwork_ids))
        )
    features = {
        feature.artwork_id: feature
        for feature in feature_query.all()
    }
    if not features:
        return

    existing_score_query = db.query(models.ArtworkRecommendationScore)
    if artwork_ids:
        existing_score_query = existing_score_query.filter(
            models.ArtworkRecommendationScore.artwork_id.in_(sorted(artwork_ids))
        )
    existing_scores = {
        (
            score.artwork_id,
            score.theme_option_id,
            score.era_option_id,
            score.emotion_option_id,
        ): score
        for score in existing_score_query.all()
    }

    artworks_by_id = {artwork.id: artwork for artwork in artworks}
    expected_keys: set[tuple[int, int, int, int]] = set()
    visual_query_cache: dict[tuple[str, str, str], list[float]] = {}
    changed = False

    selection_lookup = {
        (theme["id"], era["id"], emotion["id"])
        for theme, era, emotion in _score_selection_combinations()
    }
    if selection_ids:
        selection_lookup = {
            selection
            for selection in selection_ids
            if selection in selection_lookup
        }

    selections = [
        (theme, era, emotion)
        for theme, era, emotion in _score_selection_combinations()
        if (theme["id"], era["id"], emotion["id"]) in selection_lookup
    ]

    for theme, era, emotion in selections:
        query_key = (theme["optionKey"], era["optionKey"], emotion["optionKey"])
        visual_query = visual_query_cache.get(query_key)
        if visual_query is None:
            visual_query = recommendation.build_visual_query(*query_key)
            visual_query_cache[query_key] = visual_query

        for artwork_id, feature in features.items():
            artwork = artworks_by_id.get(artwork_id)
            if artwork is None:
                continue

            score_result = recommendation.score_artwork_with_visual_query(
                artwork,
                feature,
                theme_key=theme["optionKey"],
                era_key=era["optionKey"],
                emotion_key=emotion["optionKey"],
                visual_query=visual_query,
            )
            row_key = (artwork.id, theme["id"], era["id"], emotion["id"])
            expected_keys.add(row_key)
            score = existing_scores.get(row_key)

            if score is None:
                db.add(models.ArtworkRecommendationScore(
                    artwork_id=artwork.id,
                    theme_option_id=theme["id"],
                    era_option_id=era["id"],
                    emotion_option_id=emotion["id"],
                    score_version=LAYOUT_SCORE_VERSION,
                    final_score=score_result.final_score,
                    visual_score=score_result.visual_score,
                    theme_score=score_result.theme_score,
                    era_score=score_result.era_score,
                    emotion_score=score_result.emotion_score,
                    reasons=score_result.reasons,
                    generated_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                ))
                changed = True
                continue

            if force or any([
                score.score_version != LAYOUT_SCORE_VERSION,
                score.final_score != score_result.final_score,
                score.visual_score != score_result.visual_score,
                score.theme_score != score_result.theme_score,
                score.era_score != score_result.era_score,
                score.emotion_score != score_result.emotion_score,
                score.reasons != score_result.reasons,
            ]):
                score.score_version = LAYOUT_SCORE_VERSION
                score.final_score = score_result.final_score
                score.visual_score = score_result.visual_score
                score.theme_score = score_result.theme_score
                score.era_score = score_result.era_score
                score.emotion_score = score_result.emotion_score
                score.reasons = score_result.reasons
                score.updated_at = datetime.utcnow()
                changed = True

    stale_scores = [
        score for key, score in existing_scores.items()
        if key not in expected_keys
    ]
    for score in stale_scores:
        db.delete(score)
        changed = True

    if changed:
        db.commit()


def ensure_layout_scores_for_selection(
    db: Session,
    theme_id: int,
    era_id: int,
    emotion_id: int,
) -> int:
    ready_feature_count = (
        db.query(models.ArtworkRecommendationFeature)
        .filter(models.ArtworkRecommendationFeature.recommendation_ready.is_(True))
        .count()
    )
    cached_score_count = (
        db.query(models.ArtworkRecommendationScore)
        .filter(models.ArtworkRecommendationScore.theme_option_id == theme_id)
        .filter(models.ArtworkRecommendationScore.era_option_id == era_id)
        .filter(models.ArtworkRecommendationScore.emotion_option_id == emotion_id)
        .count()
    )

    if cached_score_count >= ready_feature_count and ready_feature_count > 0:
        return cached_score_count

    refresh_recommendation_layout_scores(
        db,
        force=False,
        selection_ids=[(theme_id, era_id, emotion_id)],
    )
    return (
        db.query(models.ArtworkRecommendationScore)
        .filter(models.ArtworkRecommendationScore.theme_option_id == theme_id)
        .filter(models.ArtworkRecommendationScore.era_option_id == era_id)
        .filter(models.ArtworkRecommendationScore.emotion_option_id == emotion_id)
        .count()
    )

def _layout_response(
    db: Session,
    theme_id: int = 1,
    era_id: int = 6,
    emotion_id: int = 10,
    use_algorithm: bool = False,
    persist_log: bool = True,
    log_user_id: int | None = None,
):
    theme = _find_option(theme_id, "theme")
    era = _find_option(era_id, "era")
    emotion = _find_option(emotion_id, "emotion")
    artworks = db.query(models.Artwork).all()
    features = {
        feature.artwork_id: feature
        for feature in db.query(models.ArtworkRecommendationFeature).all()
    }
    recommendation_map: dict[int, recommendation.RecommendationResult] = {}
    score_map: dict[int, models.ArtworkRecommendationScore] = {}

    if use_algorithm:
        ensure_layout_scores_for_selection(db, theme_id, era_id, emotion_id)
        score_rows = (
            db.query(models.ArtworkRecommendationScore)
            .filter(models.ArtworkRecommendationScore.theme_option_id == theme_id)
            .filter(models.ArtworkRecommendationScore.era_option_id == era_id)
            .filter(models.ArtworkRecommendationScore.emotion_option_id == emotion_id)
            .order_by(
                models.ArtworkRecommendationScore.final_score.desc(),
                models.ArtworkRecommendationScore.emotion_score.desc(),
                models.ArtworkRecommendationScore.visual_score.desc(),
            )
            .all()
        )
        score_map = {
            score.artwork_id: score
            for score in score_rows
        }
        artwork_by_id = {artwork.id: artwork for artwork in artworks}
        sorted_artworks = [
            artwork_by_id[score.artwork_id]
            for score in score_rows
            if score.artwork_id in artwork_by_id
        ]
        fallback_artworks: list[models.Artwork] = []
        for artwork in artworks:
            if artwork.id not in score_map:
                fallback_artworks.append(artwork)

        if fallback_artworks:
            algorithm_request = SimpleNamespace(
                thema=theme["algorithmValue"],
                era=era["algorithmValue"],
                emotion=emotion["algorithmValue"],
            )
            fallback_ids = batch_Service.run_curation_algorithm(algorithm_request, fallback_artworks)
            fallback_by_id = {artwork.id: artwork for artwork in fallback_artworks}
            sorted_artworks.extend(
                fallback_by_id[artwork_id]
                for artwork_id in fallback_ids
                if artwork_id in fallback_by_id
            )

        sorted_artworks = sorted_artworks[:50]
        sorted_ids = [artwork.id for artwork in sorted_artworks]

        if persist_log and log_user_id is not None:
            db.add(models.CurationLog(
                user_id=log_user_id,
                recommended_ids=sorted_ids,
            ))
            db.commit()
    else:
        sorted_artworks = sorted(artworks, key=lambda artwork: (artwork.era_year, artwork.id))

    if use_algorithm:
        theme_payload = _option_payload(theme, "theme")
        era_payload = _option_payload(era, "era")
        emotion_payload = _option_payload(emotion, "emotion")
    else:
        theme_payload = {"id": 0, "category": "theme", "optionKey": "default", "labelKo": "전체"}
        era_payload = {"id": 0, "category": "era", "optionKey": "default", "labelKo": "전체"}
        emotion_payload = {"id": 0, "category": "emotion", "optionKey": "default", "labelKo": "전체"}

    return {
        "layoutType": "combined_options",
        "themeOption": theme_payload,
        "eraOption": era_payload,
        "emotionOption": emotion_payload,
        "gallery": {"mapUrl": "/gallery/backend", "entrySlotNumber": 1},
        "placements": _placements_from_artworks(sorted_artworks, features, recommendation_map, score_map),
    }


def _debug_results_response(
    db: Session,
    theme_id: int,
    era_id: int,
    emotion_id: int,
):
    layout = _layout_response(
        db,
        theme_id=theme_id,
        era_id=era_id,
        emotion_id=emotion_id,
        use_algorithm=True,
        persist_log=False,
    )
    provider_status = provider_runtime_status()
    return {
        "status": "success",
        "featureVersion": recommendation.FEATURE_VERSION,
        "selection": {
            "themeOption": layout["themeOption"],
            "eraOption": layout["eraOption"],
            "emotionOption": layout["emotionOption"],
        },
        "providerStatus": provider_status,
        "totalCount": len(layout["placements"]),
        "items": [
            {
                "slotNumber": placement["slotNumber"],
                "sortValue": placement["sortValue"],
                **placement["artwork"],
            }
            for placement in layout["placements"]
        ],
    }


def _generated_framed_assets_response(db: Session):
    rows = (
        db.query(models.ArtworkGeneratedAsset, models.Artwork)
        .join(models.Artwork, models.Artwork.id == models.ArtworkGeneratedAsset.artwork_id)
        .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
        .filter(models.ArtworkGeneratedAsset.status == "ready")
        .order_by(
            models.ArtworkGeneratedAsset.generated_at.desc(),
            models.ArtworkGeneratedAsset.artwork_id.desc(),
        )
        .all()
    )

    items = []
    for asset, artwork in rows:
        payload = _generated_asset_payload(asset, artwork)
        if payload["glbUrl"] is not None:
            items.append(payload)

    return {
        "status": "success",
        "count": len(items),
        "items": items,
    }


def _room_merge_snapshot_response(snapshot: models.RoomMergeExperimentSnapshot) -> RoomMergeExperimentSnapshotResponse:
    payload = snapshot.assembly_snapshot if isinstance(snapshot.assembly_snapshot, dict) else {}
    selected_key = payload.get("selectedKey") if isinstance(payload, dict) else None

    return RoomMergeExperimentSnapshotResponse(
        id=snapshot.id,
        experimentKey=snapshot.experiment_key,
        spaceId=snapshot.space_id,
        ownerUserId=snapshot.owner_user_id,
        sessionId=snapshot.session_id,
        selectedKey=snapshot.selected_key or selected_key,
        memo=snapshot.memo,
        snapshot=RoomMergeAssemblySnapshotPayload(
            selectedKey=payload.get("selectedKey") if isinstance(payload, dict) else snapshot.selected_key,
            pieces=payload.get("pieces", {}) if isinstance(payload, dict) else {},
        ),
        createdAt=snapshot.created_at.isoformat() if snapshot.created_at else "",
        updatedAt=snapshot.updated_at.isoformat() if snapshot.updated_at else "",
    )


def _room_merge_preset_response(snapshot: models.RoomMergePreset) -> RoomMergePresetResponse:
    payload = snapshot.assembly_snapshot if isinstance(snapshot.assembly_snapshot, dict) else {}
    selected_key = payload.get("selectedKey") if isinstance(payload, dict) else None

    return RoomMergePresetResponse(
        id=snapshot.id,
        experimentKey=snapshot.experiment_key,
        spaceId=snapshot.space_id,
        ownerUserId=snapshot.owner_user_id,
        sessionId=snapshot.session_id,
        presetName=snapshot.preset_name,
        selectedKey=snapshot.selected_key or selected_key,
        memo=snapshot.memo,
        snapshot=RoomMergeAssemblySnapshotPayload(
            selectedKey=payload.get("selectedKey") if isinstance(payload, dict) else snapshot.selected_key,
            pieces=payload.get("pieces", {}) if isinstance(payload, dict) else {},
        ),
        createdAt=snapshot.created_at.isoformat() if snapshot.created_at else "",
        updatedAt=snapshot.updated_at.isoformat() if snapshot.updated_at else "",
        deletedAt=snapshot.deleted_at.isoformat() if getattr(snapshot, "deleted_at", None) else None,
    )


def _auth_user_response(db: Session, user: models.User) -> AuthUserResponse:
    roles = [
        row[0]
        for row in (
            db.query(models.Role.role_key)
            .join(models.UserRole, models.UserRole.role_id == models.Role.id)
            .filter(models.UserRole.user_id == user.id)
            .order_by(models.Role.role_key.asc())
            .all()
        )
    ]
    profile = (
        db.query(models.CuratorProfile)
        .filter(models.CuratorProfile.user_id == user.id)
        .first()
    )
    curator_profile = None
    if profile is not None:
        curator_profile = AuthCuratorWorkspaceResponse(
            planStatus=profile.plan_status,
            planKey=profile.plan_key,
            quotaStoryGenerationsMonthly=profile.quota_story_generations_monthly,
            quotaTtsGenerationsMonthly=profile.quota_tts_generations_monthly,
        )

    primary_role = "visitor"
    if "admin" in roles:
        primary_role = "admin"
    elif "paid_curator" in roles:
        primary_role = "paid_curator"
    elif "writer" in roles:
        primary_role = "writer"
    elif roles:
        primary_role = roles[0]

    return AuthUserResponse(
        id=user.id,
        username=getattr(user, "username", user.email.split("@", 1)[0]),
        email=user.email,
        displayName=user.display_name,
        roles=roles or ["visitor"],
        primaryRole=primary_role,
        curatorWorkspace=curator_profile,
    )


def _curator_workspace_artwork_payload(
    db: Session,
    artwork: models.Artwork,
    framed_asset: models.ArtworkGeneratedAsset | None = None,
) -> dict[str, Any]:
    framed_asset = framed_asset or _framed_glb_asset_record(db, artwork.id)
    versions = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .order_by(
            models.ArtworkStorytellingVersion.created_at.desc(),
            models.ArtworkStorytellingVersion.version_number.desc(),
            models.ArtworkStorytellingVersion.id.desc(),
        )
        .all()
    )
    version_payloads = [_storytelling_version_payload(version) for version in versions]
    current_version = _load_current_storytelling_version(db, artwork)
    tts_assets = (
        db.query(models.TtsAsset)
        .join(
            models.ArtworkStorytellingVersion,
            models.ArtworkStorytellingVersion.id == models.TtsAsset.storytelling_version_id,
        )
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .order_by(
            models.TtsAsset.created_at.desc(),
            models.TtsAsset.id.desc(),
        )
        .all()
    )
    return {
        "id": artwork.id,
        "ownerUserId": artwork.owner_user_id,
        "title": artwork.title,
        "artist": artwork.artist,
        "createdAt": _dt_to_iso(framed_asset.generated_at) if _is_ready_framed_glb_asset(framed_asset) else "",
        "era": artwork.era,
        "eraYear": artwork.era_year,
        "mainThema": artwork.main_thema,
        "mainEmotion": artwork.main_emotion,
        "imagePath": _resolve_frontend_image_path(artwork, None),
        "source": artwork.source,
        "sourceObjectId": artwork.source_object_id,
        "sourceQuery": artwork.source_query,
        "objectUrl": artwork.object_url,
        "framedGlbStatus": (
            framed_asset.status
            if framed_asset is not None and framed_asset.status != "ready"
            else "ready"
            if _is_ready_framed_glb_asset(framed_asset)
            else "missing"
        ),
        "framedGlbUrl": _framed_asset_url(framed_asset) if _is_ready_framed_glb_asset(framed_asset) else None,
        "framedGlbGeneratedAt": _dt_to_iso(framed_asset.generated_at) if _is_ready_framed_glb_asset(framed_asset) else None,
        "framedGlbNotes": framed_asset.notes if framed_asset is not None and isinstance(framed_asset.notes, dict) else None,
        "currentStory": _storytelling_version_payload(current_version) if current_version else None,
        "storyVersions": version_payloads,
        "ttsAssets": [_tts_asset_payload(asset) for asset in tts_assets],
        "storyVersionCount": len(version_payloads),
    }


def _curator_workspace_space_payload(
    db: Session,
    space: models.CuratorSpace,
) -> dict[str, Any]:
    loaded_space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space.id)
    snapshots = (
        db.query(models.RoomMergeExperimentSnapshot)
        .filter(models.RoomMergeExperimentSnapshot.owner_user_id == space.owner_user_id)
        .filter(models.RoomMergeExperimentSnapshot.space_id == space.id)
        .order_by(
            models.RoomMergeExperimentSnapshot.created_at.desc(),
            models.RoomMergeExperimentSnapshot.id.desc(),
        )
        .all()
    )
    presets = (
        db.query(models.RoomMergePreset)
        .filter(models.RoomMergePreset.owner_user_id == space.owner_user_id)
        .filter(models.RoomMergePreset.space_id == space.id)
        .order_by(
            models.RoomMergePreset.created_at.desc(),
            models.RoomMergePreset.id.desc(),
        )
        .all()
    )
    return {
        "id": loaded_space.id,
        "ownerUserId": loaded_space.owner_user_id,
        "name": loaded_space.name,
        "description": loaded_space.description,
        "status": loaded_space.status,
        "currentVersionId": loaded_space.current_version_id,
        "componentCount": len([component for component in components if component.deleted_at is None]),
        "slotCount": len([slot for slot in slots if slot.deleted_at is None]),
        "fileCount": len([file for file in files if file.deleted_at is None]),
        "publicProfile": _curator_space_public_profile_payload(public_profile) if public_profile else None,
        "versions": [_curator_space_version_payload(version) for version in versions if version is not None],
        "snapshots": [_room_merge_snapshot_response(snapshot) for snapshot in snapshots],
        "presets": [_room_merge_preset_response(preset) for preset in presets],
        "createdAt": _dt_to_iso(loaded_space.created_at) or "",
        "updatedAt": _dt_to_iso(loaded_space.updated_at) or "",
    }


def _curator_workspace_response(
    db: Session,
    principal: AuthPrincipal,
    page: int = 1,
    page_size: int = 5,
) -> CuratorWorkspaceResponse:
    user = db.query(models.User).filter(models.User.id == principal.user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Current user not found.")

    safe_page = max(page, 1)
    safe_page_size = max(1, min(page_size, 5))

    owned_spaces = (
        db.query(models.CuratorSpace)
        .filter(models.CuratorSpace.owner_user_id == principal.user_id)
        .filter(models.CuratorSpace.deleted_at.is_(None))
        .order_by(models.CuratorSpace.updated_at.desc(), models.CuratorSpace.id.desc())
        .all()
    )
    artwork_query = db.query(models.Artwork)
    if "admin" not in principal.roles:
        artwork_query = artwork_query.filter(models.Artwork.owner_user_id == principal.user_id)
    total_owned_artworks = artwork_query.count()
    total_pages = max(1, (total_owned_artworks + safe_page_size - 1) // safe_page_size)
    safe_page = min(safe_page, total_pages)
    owned_artworks = (
        artwork_query.order_by(models.Artwork.id.desc())
        .offset((safe_page - 1) * safe_page_size)
        .limit(safe_page_size)
        .all()
    )
    framed_asset_map = {}
    owned_artwork_ids = [artwork.id for artwork in owned_artworks]
    if owned_artwork_ids:
        framed_asset_map = {
            asset.artwork_id: asset
            for asset in (
                db.query(models.ArtworkGeneratedAsset)
                .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
                .filter(models.ArtworkGeneratedAsset.artwork_id.in_(owned_artwork_ids))
                .all()
            )
        }
    room_merge_snapshots = (
        db.query(models.RoomMergeExperimentSnapshot)
        .filter(models.RoomMergeExperimentSnapshot.owner_user_id == principal.user_id)
        .order_by(
            models.RoomMergeExperimentSnapshot.created_at.desc(),
            models.RoomMergeExperimentSnapshot.id.desc(),
        )
        .all()
    )
    room_merge_presets = (
        db.query(models.RoomMergePreset)
        .filter(models.RoomMergePreset.owner_user_id == principal.user_id)
        .filter(models.RoomMergePreset.deleted_at.is_(None))
        .order_by(
            models.RoomMergePreset.created_at.desc(),
            models.RoomMergePreset.id.desc(),
        )
        .all()
    )

    space_items = [_curator_workspace_space_payload(db, space) for space in owned_spaces]
    artwork_items = [
        _curator_workspace_artwork_payload(db, artwork, framed_asset=framed_asset_map.get(artwork.id))
        for artwork in owned_artworks
    ]
    story_version_query = db.query(func.count(models.ArtworkStorytellingVersion.id)).join(
        models.Artwork,
        models.Artwork.id == models.ArtworkStorytellingVersion.artwork_id,
    )
    if "admin" not in principal.roles:
        story_version_query = story_version_query.filter(models.Artwork.owner_user_id == principal.user_id)
    total_story_versions = story_version_query.scalar() or 0
    tts_asset_query = (
        db.query(func.count(models.TtsAsset.id))
        .join(
            models.ArtworkStorytellingVersion,
            models.ArtworkStorytellingVersion.id == models.TtsAsset.storytelling_version_id,
        )
        .join(models.Artwork, models.Artwork.id == models.ArtworkStorytellingVersion.artwork_id)
    )
    if "admin" not in principal.roles:
        tts_asset_query = tts_asset_query.filter(models.Artwork.owner_user_id == principal.user_id)
    total_tts_assets = tts_asset_query.scalar() or 0

    return CuratorWorkspaceResponse(
        status="success",
        user=_auth_user_response(db, user),
        summary=CuratorWorkspaceSummaryResponse(
            ownedSpaces=len(space_items),
            ownedArtworks=total_owned_artworks,
            storytellingVersions=total_story_versions,
            ttsAssets=total_tts_assets,
            roomMergeSnapshots=len(room_merge_snapshots),
            roomMergePresets=len(room_merge_presets),
        ),
        page=safe_page,
        pageSize=safe_page_size,
        total=total_owned_artworks,
        totalPages=total_pages,
        ownedSpaces=space_items,
        ownedArtworks=artwork_items,
        roomMergeSnapshots=[_room_merge_snapshot_response(snapshot) for snapshot in room_merge_snapshots],
        roomMergePresets=[_room_merge_preset_response(preset) for preset in room_merge_presets],
    )


def _record_audit_log(
    db: Session,
    *,
    actor_user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    db.add(
        models.AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata_json=metadata_json,
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
        )
    )


def _record_audit_log_best_effort(
    *,
    actor_user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    request: Request | None = None,
) -> None:
    audit_db = SessionLocal()
    try:
        audit_db.add(
            models.AuditLog(
                actor_user_id=actor_user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                metadata_json=metadata_json,
                ip_address=request.client.host if request and request.client else None,
                user_agent=request.headers.get("user-agent") if request else None,
            )
        )
        audit_db.commit()
    except Exception:
        audit_db.rollback()
        logger.warning(
            "audit log write failed action=%s resource_type=%s resource_id=%s",
            action,
            resource_type,
            resource_id,
            exc_info=True,
        )
    finally:
        audit_db.close()


# ==========================================
# 1. 자동 데이터 로드 (JSON 기반으로 완벽 수정)
# ==========================================
def init_db():
    db = SessionLocal()
    try:
        # DB에 데이터가 이미 있는지 확인
        if db.query(models.Artwork).count() > 0:
            print("--- [INFO] DB에 데이터가 이미 존재합니다. 초기화를 건너뜁니다. ---")
            return

        file_path = os.getenv(
            "ARTWORK_DATA_FILE",
            os.path.join(os.path.dirname(__file__), "data", "artworks_seed.txt")
        )
        
        if not os.path.exists(file_path):
            print(f"--- [ERROR] 파일을 찾을 수 없습니다: {file_path} ---")
            return

        print(f"--- [START] {file_path}에서 TXT 데이터를 로드 중... ---")
        
        with open(file_path, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f) # 첫 줄을 헤더로 인식
            count = 0
            owner_user_id = _resolve_legacy_artwork_owner_user_id(db)
            if owner_user_id is None:
                print("--- [ERROR] legacy artwork owner user를 찾지 못했습니다. ---")
                return
            
            for row in reader:
                #핵심: txt 파일에서 값이 없어서 빈 문자열('')로 들어오면 None으로 변환
                sub_thema_val = row.get('sub_thema', '').strip()
                sub_emotion_val = row.get('sub_emotion', '').strip()
                
                artwork = models.Artwork(
                    id=int(row['id']),
                    title=row['title'],
                    artist=row.get('artist', 'Legacy Seed Artwork'),
                    main_thema=row['main_thema'].strip(),
                    sub_thema=sub_thema_val if sub_thema_val else None,
                    main_emotion=row['main_emotion'].strip(),
                    sub_emotion=sub_emotion_val if sub_emotion_val else None,
                    era=row['era'].strip(),
                    era_year=int(row['era_year']),
                    # asset_folder_name이 txt에 있다면 row['asset_folder_name']을 쓰고, 
                    # 없다면 임시로 아래처럼 자동 생성할 수 있습니다.
                    asset_folder_name=row.get('asset_folder_name', f"asset_{row['id']}"),
                    image_path=row.get('image_path') or None,
                    source=row.get('source') or 'seed',
                    source_object_id=row.get('source_object_id') or str(row['id']),
                    source_query=row.get('source_query') or None,
                    object_url=row.get('object_url') or None,
                    is_public_domain=(row.get('is_public_domain', 'false').strip().lower() == 'true'),
                    owner_user_id=owner_user_id,
                )
                db.add(artwork)
                count += 1
            
            db.commit()
            print(f"--- [SUCCESS] {count}개의 데이터를 성공적으로 로드했습니다! ---")
            
    except Exception as e:
        print(f"--- [ERROR] 데이터 로드 중 오류 발생: {e} ---")
        db.rollback()
    finally:
        db.close()

# FastAPI 시작 시 실행되는 이벤트
@app.on_event("startup")
async def startup_event():
    write_startup_status(25, "runtime", "Preparing runtime directories")
    ensure_runtime_directories()
    write_startup_status(30, "schema", "Creating base schema")
    models.Base.metadata.create_all(bind=engine)
    write_startup_status(35, "schema", "Ensuring runtime schema")
    ensure_runtime_schema()

    write_startup_status(45, "auth-seed", "Checking auth seed data")
    auth_db = SessionLocal()
    try:
        seed_auth_users(auth_db)
    finally:
        auth_db.close()

    write_startup_status(55, "seed", "Checking seed data")
    if os.getenv("LOAD_DEMO_DATA", "false").lower() == "true":
        init_db()
        content_db = SessionLocal()
        try:
            owner_user_id = _resolve_legacy_artwork_owner_user_id(content_db)
            if owner_user_id is not None:
                imported = seed_public_content(content_db, owner_user_id, ASSET_ROOT_DIR)
                logger.info("public content seed imported: %s", imported)
        finally:
            content_db.close()

    write_startup_status(58, "ownership", "Backfilling shared artwork ownership")
    ownership_db = SessionLocal()
    try:
        _backfill_shared_artwork_ownerships(ownership_db)
        ownership_db.commit()
    except Exception as exc:
        ownership_db.rollback()
        logger.exception("failed to backfill shared artwork ownership: %s", exc)
    finally:
        ownership_db.close()

    write_startup_status(60, "public-spaces", "Checking public space seed data")
    public_space_db = SessionLocal()
    try:
        if os.getenv("LOAD_DEMO_DATA", "false").lower() == "true":
            seed_public_spaces(public_space_db)
    finally:
        public_space_db.close()

    db = SessionLocal()
    try:
        write_startup_status(75, "features", "Refreshing recommendation features")
        refresh_recommendation_features(db, force=False)

        write_startup_status(92, "layout-scores", "Precomputing layout score cache")
        refresh_recommendation_layout_scores(db, force=False)
    finally:
        db.close()

    write_startup_status(100, "ready", "Backend startup complete", ready=True)

@app.get("/health")
def health_check():
    return {"status": "ok", "startup": current_startup_status()}


@app.get("/startup-status")
def startup_status():
    status = current_startup_status()
    return {
        "status": "ready" if status.get("ready") else "starting",
        **status,
    }


@app.post("/api/v1/auth/login", response_model=AuthSessionResponse)
def auth_login(
    request: AuthLoginRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    rate_limiter.check(("login", http_request.client.host if http_request.client else "unknown"), 10)
    identifier = request.identifier.strip().lower()
    if len(identifier) > 254 or len(request.password) > 256:
        raise HTTPException(status_code=400, detail="Invalid credentials.")
    if not identifier or not request.password:
        raise HTTPException(status_code=400, detail="아이디 또는 이메일과 비밀번호를 입력해 주세요.")

    user = get_user_by_identifier(db, identifier)
    if user is None or user.deleted_at is not None or user.status != "active":
        raise HTTPException(status_code=401, detail="아이디, 이메일 또는 비밀번호가 올바르지 않습니다.")

    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="아이디, 이메일 또는 비밀번호가 올바르지 않습니다.")

    refresh_token, _ = create_refresh_token(user.id)
    refresh_record = models.AuthRefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
    )
    user.last_login_at = datetime.utcnow()
    db.add(refresh_record)

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("auth login failed user_id=%s", user.id)
        raise HTTPException(status_code=500, detail="Failed to create auth session.") from exc

    db.refresh(user)
    _record_audit_log_best_effort(
        actor_user_id=user.id,
        action="auth.login",
        resource_type="user",
        resource_id=str(user.id),
        metadata_json={"email": user.email},
        request=http_request,
    )
    return _auth_session_response(db, user, refresh_token)


@app.post("/api/v1/auth/register", response_model=AuthSessionResponse)
def auth_register(
    request: AuthRegisterRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    rate_limiter.check(("register", http_request.client.host if http_request.client else "unknown"), 5, 3600)
    if not 12 <= len(request.password) <= 256:
        raise HTTPException(status_code=400, detail="Password must contain 12 to 256 characters.")
    if len(request.username) > 64 or len(request.email) > 254:
        raise HTTPException(status_code=400, detail="Username or email is too long.")
    if request.role.strip().lower() == "curator":
        raise HTTPException(status_code=403, detail="Curator access requires administrator provisioning.")
    username = request.username.strip().lower()
    email = request.email.strip().lower()
    password = request.password
    password_confirmation = request.passwordConfirmation
    role = request.role.strip().lower()

    if not username or not email or not password or not password_confirmation or not role:
        raise HTTPException(status_code=400, detail="아이디, 이메일, 비밀번호, 비밀번호 확인, 역할을 모두 입력해 주세요.")

    if password != password_confirmation:
        raise HTTPException(status_code=400, detail="비밀번호와 비밀번호 확인이 일치하지 않습니다.")

    if role not in {"visitor", "curator", "writer"}:
        raise HTTPException(status_code=400, detail="회원가입은 관람객, 큐레이터 또는 작가만 가능합니다.")

    if get_user_by_username(db, username) is not None:
        raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")
    if get_user_by_email(db, email) is not None:
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")

    if role == "visitor":
        role_key = "visitor"
    elif role == "curator":
        role_key = "paid_curator"
    else:
        role_key = "writer"
    role_record = db.query(models.Role).filter(models.Role.role_key == role_key).first()
    if role_record is None:
        raise HTTPException(status_code=500, detail="역할 시드 데이터가 준비되지 않았습니다.")

    user = models.User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        display_name=request.username.strip(),
        status="active",
    )
    db.add(user)
    db.flush()
    db.add(models.UserRole(user_id=user.id, role_id=role_record.id))

    if role == "curator":
        db.add(
            models.CuratorProfile(
                user_id=user.id,
                plan_status="active",
                plan_key="self-service",
                quota_story_generations_monthly=9999,
                quota_tts_generations_monthly=9999,
            )
        )

    refresh_token, _ = create_refresh_token(user.id)
    refresh_record = models.AuthRefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
    )
    user.last_login_at = datetime.utcnow()
    db.add(refresh_record)

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("auth register failed username=%s", username)
        raise HTTPException(status_code=500, detail="회원가입 계정을 생성하지 못했습니다.") from exc

    db.refresh(user)
    _record_audit_log_best_effort(
        actor_user_id=user.id,
        action="auth.register",
        resource_type="user",
        resource_id=str(user.id),
        metadata_json={"email": user.email, "role": role},
        request=http_request,
    )
    return _auth_session_response(db, user, refresh_token)


@app.post("/api/v1/auth/refresh", response_model=AuthSessionResponse)
def auth_refresh(
    request: AuthRefreshRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    refresh_token = request.refreshToken.strip()
    if not refresh_token:
        raise HTTPException(status_code=400, detail="refreshToken is required.")

    refresh_record, payload = verify_refresh_token(refresh_token, db)
    user_id = int(payload["sub"])
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None or user.deleted_at is not None or user.status != "active":
        raise HTTPException(status_code=401, detail="User is inactive.")

    new_refresh_token, _ = create_refresh_token(user.id)
    new_refresh_record = models.AuthRefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(new_refresh_token),
        expires_at=datetime.utcnow() + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
    )
    refresh_record.revoked_at = datetime.utcnow()
    refresh_record.replaced_by_token_hash = new_refresh_record.token_hash
    refresh_record.last_used_at = datetime.utcnow()
    db.add(new_refresh_record)
    _record_audit_log(
        db,
        actor_user_id=user.id,
        action="auth.refresh",
        resource_type="user",
        resource_id=str(user.id),
        metadata_json={"rotation": True},
        request=http_request,
    )

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("auth refresh failed user_id=%s", user.id)
        raise HTTPException(status_code=500, detail="Failed to refresh auth session.") from exc

    db.refresh(user)
    return _auth_session_response(db, user, new_refresh_token)


@app.post("/api/v1/auth/logout")
def auth_logout(
    request: AuthLogoutRequest,
    http_request: Request,
    db: Session = Depends(get_db),
):
    refresh_token = request.refreshToken.strip()
    if not refresh_token:
        raise HTTPException(status_code=400, detail="refreshToken is required.")

    refresh_record, payload = verify_refresh_token(refresh_token, db)
    user_id = int(payload["sub"])
    refresh_record.revoked_at = datetime.utcnow()
    refresh_record.last_used_at = datetime.utcnow()
    _record_audit_log(
        db,
        actor_user_id=user_id,
        action="auth.logout",
        resource_type="user",
        resource_id=str(user_id),
        metadata_json={"rotation": False},
        request=http_request,
    )

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("auth logout failed user_id=%s", user_id)
        raise HTTPException(status_code=500, detail="Failed to revoke auth session.") from exc

    return {"status": "success"}


@app.get("/api/v1/auth/me", response_model=AuthMeResponse)
def auth_me(principal: AuthPrincipal = Depends(get_current_principal), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == principal.user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    return {
        "status": "success",
        "user": _auth_user_response(db, user),
    }


@app.get("/api/v1/workspace/curator", response_model=CuratorWorkspaceResponse)
def get_curator_workspace(
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
    page: int = 1,
    pageSize: int = 5,
):
    return _curator_workspace_response(db, principal, page=page, page_size=pageSize)


@app.get("/api/v1/workspace/writer", response_model=CuratorWorkspaceResponse)
def get_writer_workspace(
    principal: AuthPrincipal = Depends(require_roles("admin", "writer")),
    db: Session = Depends(get_db),
    page: int = 1,
    pageSize: int = 5,
):
    return _curator_workspace_response(db, principal, page=page, page_size=pageSize)


CURATOR_SPACE_FILE_EXTENSIONS = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}
CURATOR_SPACE_ALLOWED_MIME_TYPES = {
    "model/gltf-binary",
    "model/gltf+json",
    "application/octet-stream",
    "binary/octet-stream",
}
CURATOR_SPACE_THUMBNAIL_MAX_BYTES = AUTHOR_UPLOAD_MAX_BYTES
CURATOR_SPACE_THUMBNAIL_SOURCE = "curator_space_thumbnail"
CURATOR_SPACE_STATUS_VALUES = {"draft", "reviewed", "published", "archived"}
ARTWORK_SLOT_SIZE_PRESETS = {
    "small": (1.2, 0.9, 0.12),
    "medium": (1.6, 1.2, 0.14),
    "large": (2.0, 1.5, 0.16),
}


def _curator_space_storage_dir(owner_user_id: int) -> Path:
    storage_dir = ASSET_ROOT_DIR / "curator-space-files" / str(owner_user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def _curator_space_thumbnail_storage_dir(owner_user_id: int) -> Path:
    storage_dir = ASSET_ROOT_DIR / "curator-space-thumbnails" / str(owner_user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    return storage_dir


def _curator_space_file_path(owner_user_id: int, original_name: str) -> tuple[str, Path]:
    suffix = Path(original_name).suffix.lower()
    if suffix not in CURATOR_SPACE_FILE_EXTENSIONS:
        suffix = ".glb"
    stored_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}-{hashlib.sha1(original_name.encode('utf-8')).hexdigest()[:12]}{suffix}"
    relative_path = f"curator-space-files/{owner_user_id}/{stored_name}"
    return relative_path, _curator_space_storage_dir(owner_user_id) / stored_name


def _curator_space_thumbnail_path(owner_user_id: int, original_name: str, extension: str) -> tuple[str, Path]:
    normalized_extension = extension if extension.startswith(".") else f".{extension}"
    stored_name = (
        f"{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}-"
        f"{hashlib.sha1(original_name.encode('utf-8')).hexdigest()[:12]}"
        f"{normalized_extension}"
    )
    relative_path = f"curator-space-thumbnails/{owner_user_id}/{stored_name}"
    return relative_path, _curator_space_thumbnail_storage_dir(owner_user_id) / stored_name


def _normalize_storage_path(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _thumbnail_image_paths_from_viewer_layout(viewer_layout: dict[str, Any] | None) -> list[str]:
    if not isinstance(viewer_layout, dict):
        return []

    placements = viewer_layout.get("placements", [])
    thumbnail_paths: list[str] = []
    seen_paths: set[str] = set()
    for placement in placements:
        if not isinstance(placement, dict):
            continue
        artwork = placement.get("artwork")
        if not isinstance(artwork, dict):
            continue
        image_path = artwork.get("imagePath")
        if not isinstance(image_path, str):
            continue
        normalized_path = image_path.strip()
        if not normalized_path or normalized_path in seen_paths:
            continue
        seen_paths.add(normalized_path)
        thumbnail_paths.append(normalized_path)
        if len(thumbnail_paths) >= 4:
            break
    return thumbnail_paths


def _public_artwork_image_paths(db: Session) -> list[str]:
    paths: list[str] = []
    seen_paths: set[str] = set()
    artworks = (
        db.query(models.Artwork)
        .filter(models.Artwork.image_path.isnot(None))
        .order_by(models.Artwork.is_public_domain.desc(), models.Artwork.id.asc())
        .all()
    )
    for artwork in artworks:
        image_path = _normalize_storage_path(artwork.image_path)
        if not image_path or image_path in seen_paths:
            continue
        seen_paths.add(image_path)
        paths.append(image_path)
    return paths


def _published_space_thumbnail_candidates(
    space: models.PublishedSpace,
    public_artwork_image_paths: list[str],
) -> list[str]:
    explicit_thumbnail = _normalize_storage_path(space.thumbnail_image_path)
    layout_thumbnail_paths = _thumbnail_image_paths_from_viewer_layout(
        space.layout_json if isinstance(space.layout_json, dict) else None
    )

    thumbnail_paths: list[str] = []
    seen_paths: set[str] = set()

    if explicit_thumbnail:
        thumbnail_paths.append(explicit_thumbnail)
        seen_paths.add(explicit_thumbnail)

    for image_path in layout_thumbnail_paths:
        if image_path in seen_paths:
            continue
        seen_paths.add(image_path)
        thumbnail_paths.append(image_path)
        if len(thumbnail_paths) >= 6:
            break

    for image_path in public_artwork_image_paths:
        if image_path in seen_paths:
            continue
        seen_paths.add(image_path)
        thumbnail_paths.append(image_path)
        if len(thumbnail_paths) >= 10:
            break

    return thumbnail_paths


def _assign_published_space_thumbnails(
    spaces: list[models.PublishedSpace],
    public_artwork_image_paths: list[str],
) -> dict[int, str | None]:
    assigned_paths: dict[int, str | None] = {}
    used_paths: set[str] = set()

    for space in spaces:
        candidates = _published_space_thumbnail_candidates(space, public_artwork_image_paths)
        chosen_path: str | None = None
        for candidate in candidates:
            if candidate in used_paths:
                continue
            chosen_path = candidate
            break

        if chosen_path is None and candidates:
            chosen_path = candidates[0]

        if chosen_path:
            used_paths.add(chosen_path)
        assigned_paths[space.id] = chosen_path

    return assigned_paths


def _load_curator_space_context(db: Session, space_id: int):
    space = db.query(models.CuratorSpace).filter(models.CuratorSpace.id == space_id).first()
    if space is None:
        raise HTTPException(status_code=404, detail="Curator space not found.")

    files = (
        db.query(models.CuratorSpaceFile)
        .filter(models.CuratorSpaceFile.space_id == space.id)
        .filter(models.CuratorSpaceFile.deleted_at.is_(None))
        .order_by(models.CuratorSpaceFile.created_at.desc(), models.CuratorSpaceFile.id.desc())
        .all()
    )
    components = (
        db.query(models.CuratorSpaceComponent)
        .filter(models.CuratorSpaceComponent.space_id == space.id)
        .order_by(models.CuratorSpaceComponent.sort_order.asc(), models.CuratorSpaceComponent.id.asc())
        .all()
    )
    slots = (
        db.query(models.ArtworkSlot)
        .filter(models.ArtworkSlot.space_id == space.id)
        .order_by(models.ArtworkSlot.sort_order.asc(), models.ArtworkSlot.id.asc())
        .all()
    )
    placements = (
        db.query(models.SpaceArtworkPlacement)
        .filter(models.SpaceArtworkPlacement.space_id == space.id)
        .order_by(models.SpaceArtworkPlacement.created_at.asc(), models.SpaceArtworkPlacement.id.asc())
        .all()
    )
    versions = (
        db.query(models.CuratorSpaceVersion)
        .filter(models.CuratorSpaceVersion.space_id == space.id)
        .order_by(models.CuratorSpaceVersion.created_at.desc(), models.CuratorSpaceVersion.id.desc())
        .all()
    )
    public_profile = (
        db.query(models.CuratorSpacePublicProfile)
        .filter(models.CuratorSpacePublicProfile.space_id == space.id)
        .first()
    )
    return space, files, components, slots, placements, versions, public_profile


def _validate_space_access(space: models.CuratorSpace, principal: AuthPrincipal) -> None:
    _require_space_owner_or_admin(space.owner_user_id, principal)


def _parse_iso_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.utcnow()
    normalized = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.utcnow()


@app.post("/api/v1/curator/spaces/{space_id}/files", response_model=CuratorSpaceFileResponse)
def create_curator_space_file(
    space_id: int,
    file: UploadFile = File(...),
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, _, _, _, _, _, _ = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    original_name = (file.filename or "").strip() or "upload.glb"
    suffix = Path(original_name).suffix.lower()
    if suffix not in CURATOR_SPACE_FILE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only GLB/GLTF files are allowed.")

    declared_content_type = (file.content_type or "").strip().lower()
    if declared_content_type and declared_content_type not in CURATOR_SPACE_ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported mime type.")

    max_bytes = 50 * 1024 * 1024
    raw = file.file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail="Space file must be 50MB or smaller.")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    validate_model_upload(raw, suffix)
    checksum = hashlib.sha256(raw).hexdigest()
    relative_path, storage_path = _curator_space_file_path(principal.user_id, original_name)
    with storage_path.open("wb") as handle:
        handle.write(raw)

    record = models.CuratorSpaceFile(
        owner_user_id=principal.user_id,
        space_id=space.id,
        original_file_name=original_name,
        stored_file_path=relative_path,
        checksum_sha256=checksum,
        file_size_bytes=len(raw),
        mime_type=file.content_type or CURATOR_SPACE_FILE_EXTENSIONS.get(suffix),
        status="ready",
    )
    try:
        db.add(record)
        db.flush()
        _record_audit_log(
            db,
            actor_user_id=principal.user_id,
            action="curator.space_file.create",
            resource_type="curator_space_file",
            resource_id=str(record.id),
            metadata_json={"originalFileName": original_name, "storedFilePath": relative_path},
        )
        db.commit()
        db.refresh(record)
    except Exception as exc:
        db.rollback()
        storage_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to store curator space file.") from exc

    return _curator_space_file_payload(record)


@app.post("/api/v1/curator/space-thumbnails", response_model=CuratorSpaceThumbnailUploadResponse)
async def upload_curator_space_thumbnail(
    image: UploadFile = File(...),
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
):
    original_name = (image.filename or "").strip() or "thumbnail.jpg"
    normalized_bytes, extension = await _read_and_validate_upload_image(image)
    if len(normalized_bytes) > CURATOR_SPACE_THUMBNAIL_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Thumbnail image must be 10MB or smaller.")

    relative_path, storage_path = _curator_space_thumbnail_path(principal.user_id, original_name, extension)
    try:
        with storage_path.open("wb") as handle:
            handle.write(normalized_bytes)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to store thumbnail image.") from exc

    return {
        "status": "success",
        "thumbnailImagePath": relative_path,
        "thumbnailImageUrl": asset_url(relative_path),
        "originalFileName": original_name,
        "fileSizeBytes": len(normalized_bytes),
    }


@app.get("/api/v1/curator/spaces/{space_id}/files", response_model=CuratorSpaceFileListResponse)
def list_curator_space_files(
    space_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, _, _, _, _, _ = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)
    return {
        "status": "success",
        "count": len(files),
        "items": [_curator_space_file_payload(file) for file in files],
    }


@app.delete("/api/v1/curator/spaces/{space_id}/files/{file_id}", response_model=CuratorSpaceFileDeleteResponse)
def delete_curator_space_file(
    space_id: int,
    file_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, _, _, _, _ = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    file = (
        db.query(models.CuratorSpaceFile)
        .filter(models.CuratorSpaceFile.id == file_id)
        .filter(models.CuratorSpaceFile.space_id == space.id)
        .first()
    )
    if file is None or file.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Curator space file not found.")

    in_use = (
        db.query(models.CuratorSpaceComponent.id)
        .filter(models.CuratorSpaceComponent.space_file_id == file.id)
        .filter(models.CuratorSpaceComponent.space_id == space.id)
        .filter(models.CuratorSpaceComponent.deleted_at.is_(None))
        .first()
    )
    if in_use is not None:
        raise HTTPException(status_code=409, detail="This GLB file is currently used by a space component.")

    deleted_at = datetime.utcnow()
    file.deleted_at = deleted_at
    file.updated_at = deleted_at
    relative_path = file.stored_file_path.lstrip("/")
    storage_path = ASSET_ROOT_DIR / relative_path
    try:
        storage_path.unlink(missing_ok=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to remove GLB file from storage.") from exc

    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space_file.delete",
        resource_type="curator_space_file",
        resource_id=str(file.id),
        metadata_json={"originalFileName": file.original_file_name, "deletedAt": deleted_at.isoformat()},
    )

    db.commit()

    return {
        "status": "success",
        "fileId": file.id,
        "deletedAt": deleted_at.isoformat(),
    }


@app.post("/api/v1/curator/spaces", response_model=CuratorSpaceDetailResponse)
def create_curator_space(
    request: CuratorSpaceCreateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Space name is required.")

    duplicate = (
        db.query(models.CuratorSpace)
        .filter(models.CuratorSpace.owner_user_id == principal.user_id)
        .filter(models.CuratorSpace.name == name)
        .filter(models.CuratorSpace.deleted_at.is_(None))
        .first()
    )
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Space name already exists.")

    space = models.CuratorSpace(
        owner_user_id=principal.user_id,
        name=name,
        description=request.description.strip() if request.description else None,
        thumbnail_image_path=_normalize_storage_path(request.thumbnailImagePath),
        status="draft",
    )

    db.add(space)
    db.flush()
    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.create",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"name": space.name},
    )
    db.commit()
    db.refresh(space)

    files, components, slots, placements, versions, public_profile = [], [], [], [], [], None
    return _curator_space_detail_payload(space, files, components, slots, placements, versions, public_profile)


@app.put("/api/v1/curator/spaces/{space_id}", response_model=CuratorSpaceDetailResponse)
def update_curator_space(
    space_id: int,
    request: CuratorSpaceUpdateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    if request.name is not None:
        next_name = request.name.strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="Space name cannot be empty.")
        duplicate = (
            db.query(models.CuratorSpace)
            .filter(models.CuratorSpace.owner_user_id == space.owner_user_id)
            .filter(models.CuratorSpace.name == next_name)
            .filter(models.CuratorSpace.id != space.id)
            .filter(models.CuratorSpace.deleted_at.is_(None))
            .first()
        )
        if duplicate is not None:
            raise HTTPException(status_code=400, detail="Space name already exists.")
        space.name = next_name

    if request.description is not None:
        space.description = request.description.strip() or None

    if request.thumbnailImagePath is not None:
        space.thumbnail_image_path = _normalize_storage_path(request.thumbnailImagePath)

    if request.status is not None:
        normalized_status = request.status.strip().lower()
        if normalized_status not in CURATOR_SPACE_STATUS_VALUES:
            raise HTTPException(status_code=400, detail="Invalid space status.")
        space.status = normalized_status

    space.updated_at = datetime.utcnow()
    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.update",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"name": space.name, "status": space.status},
    )
    db.commit()

    return _curator_space_detail_payload(space, files, components, slots, placements, versions, public_profile)


@app.delete("/api/v1/curator/spaces/{space_id}")
def delete_curator_space(
    space_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    if space.deleted_at is not None:
        return {
            "status": "success",
            "spaceId": space.id,
            "deletedAt": space.deleted_at.isoformat(),
        }

    deleted_at = datetime.utcnow()
    original_name = space.name
    space.name = f"{space.name}__deleted__{space.id}__{deleted_at.strftime('%Y%m%d%H%M%S')}"
    space.deleted_at = deleted_at
    space.updated_at = deleted_at

    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.delete",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"name": original_name, "deletedAt": deleted_at.isoformat()},
    )
    db.commit()

    return {
        "status": "success",
        "spaceId": space.id,
        "deletedAt": deleted_at.isoformat(),
    }


@app.get("/api/v1/curator/spaces", response_model=CuratorSpaceListResponse)
def list_curator_spaces(
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    query = db.query(models.CuratorSpace).filter(models.CuratorSpace.deleted_at.is_(None))
    if not _principal_is_admin(principal):
        query = query.filter(models.CuratorSpace.owner_user_id == principal.user_id)
    spaces = query.order_by(models.CuratorSpace.updated_at.desc(), models.CuratorSpace.id.desc()).all()
    items = []
    for space in spaces:
        _, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space.id)
        items.append(
            _curator_space_summary_payload(
                space,
                component_count=len(components),
                slot_count=len(slots),
                file_count=len(files),
                public_profile=public_profile,
            )
        )
    return {
        "status": "success",
        "count": len(items),
        "items": items,
    }


@app.get("/api/v1/curator/spaces/{space_id}", response_model=CuratorSpaceDetailResponse)
def get_curator_space(
    space_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)
    return _curator_space_detail_payload(space, files, components, slots, placements, versions, public_profile)


@app.put("/api/v1/curator/spaces/{space_id}/components", response_model=CuratorSpaceDetailResponse)
def save_curator_space_components(
    space_id: int,
    request: CuratorSpaceComponentsSaveRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    file_by_id = {file.id: file for file in files}
    existing_keys: set[str] = set()
    new_components: list[models.CuratorSpaceComponent] = []
    for index, item in enumerate(request.components):
        component_key = item.componentKey.strip()
        label = item.label.strip()
        space_file_id = item.spaceFileId
        if not component_key or not label:
            raise HTTPException(status_code=400, detail="componentKey and label are required.")
        if component_key in existing_keys:
            raise HTTPException(status_code=400, detail="Duplicate componentKey.")
        existing_keys.add(component_key)
        file_record = file_by_id.get(space_file_id)
        if file_record is None:
            raise HTTPException(status_code=400, detail="Invalid spaceFileId.")

        new_components.append( 
            models.CuratorSpaceComponent( 
                space_id=space.id, 
                space_file_id=space_file_id, 
                entity_type_id=1,
                component_key=component_key, 
                label=label,
                position_x=item.position.x,
                position_y=item.position.y,
                position_z=item.position.z,
                rotation_x=item.rotation.x,
                rotation_y=item.rotation.y,
                rotation_z=item.rotation.z,
                scale_x=item.scale.x,
                scale_y=item.scale.y,
                scale_z=item.scale.z,
                sort_order=item.sortOrder if item.sortOrder is not None else index,
            )
        )

    db.query(models.CuratorSpaceComponent).filter(models.CuratorSpaceComponent.space_id == space.id).delete()
    db.add_all(new_components)
    db.flush()

    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.components.save",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"componentCount": len(new_components)},
    )

    db.commit()

    return _curator_space_detail_payload(
        *_load_curator_space_context(db, space.id)
    )


@app.put("/api/v1/curator/spaces/{space_id}/slots", response_model=CuratorSpaceDetailResponse)
def save_curator_space_slots(
    space_id: int,
    request: CuratorSpaceSlotsSaveRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    raw_slots = request.slots
    if len(raw_slots) > 50:
        raise HTTPException(status_code=400, detail="Slot count cannot exceed 50.")

    slot_keys: set[str] = set()
    artwork_slots: list[models.ArtworkSlot] = []
    placement_rows: list[models.SpaceArtworkPlacement] = []

    for index, item in enumerate(raw_slots):
        slot_key = item.slotKey.strip()
        name = item.name.strip()
        size_preset = item.sizePreset.strip().lower()
        if not slot_key or not name:
            raise HTTPException(status_code=400, detail="slotKey and name are required.")
        if slot_key in slot_keys:
            raise HTTPException(status_code=400, detail="Duplicate slotKey.")
        if size_preset not in ARTWORK_SLOT_SIZE_PRESETS:
            raise HTTPException(status_code=400, detail="Invalid sizePreset.")
        slot_keys.add(slot_key)
        artwork_id = item.artworkId
        if artwork_id is not None:
            artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
            if artwork is None:
                raise HTTPException(status_code=400, detail=f"Invalid artworkId: {artwork_id}")
        artwork_slots.append( 
            models.ArtworkSlot( 
                space_id=space.id, 
                entity_type_id=2,
                slot_key=slot_key, 
                name=name,
                size_preset=size_preset,
                width=item.width,
                height=item.height,
                depth=item.depth,
                position_x=item.position.x,
                position_y=item.position.y,
                position_z=item.position.z,
                rotation_x=item.rotation.x,
                rotation_y=item.rotation.y,
                rotation_z=item.rotation.z,
                status=item.status,
                sort_order=item.sortOrder if item.sortOrder is not None else index,
            )
        )

    db.query(models.SpaceArtworkPlacement).filter(models.SpaceArtworkPlacement.space_id == space.id).delete()
    db.query(models.ArtworkSlot).filter(models.ArtworkSlot.space_id == space.id).delete()
    db.add_all(artwork_slots)
    db.flush()

    slot_by_key = {slot.slot_key: slot for slot in artwork_slots}
    for item in raw_slots:
        artwork_id = item.artworkId
        if artwork_id is None:
            continue
        slot = slot_by_key.get(item.slotKey.strip())
        if slot is None:
            continue
        placement_rows.append(
            models.SpaceArtworkPlacement(
                space_id=space.id,
                slot_id=slot.id,
                artwork_id=artwork_id,
                status=item.status,
            )
        )

    db.add_all(placement_rows)

    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.slots.save",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"slotCount": len(artwork_slots), "placementCount": len(placement_rows)},
    )

    db.commit()

    return _curator_space_detail_payload(
        *_load_curator_space_context(db, space.id)
    )


@app.post("/api/v1/curator/spaces/{space_id}/publish", response_model=CuratorSpaceDetailResponse)
def publish_curator_space(
    space_id: int,
    request: CuratorSpacePublishRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
):
    space, files, components, slots, placements, versions, existing_public_profile = _load_curator_space_context(db, space_id)
    _validate_space_access(space, principal)

    display_name = (request.displayName or space.name).strip()
    summary = (request.summary or space.description or "").strip() or None
    location_summary = (request.locationSummary or "Curator Space").strip()
    search_keywords = _space_search_keywords(
        display_name,
        summary,
        location_summary,
        space.name,
        space.description,
    )
    if request.searchKeywords:
        search_keywords = _space_search_keywords(search_keywords, " ".join(request.searchKeywords))

    version_snapshot = _curator_space_version_snapshot_payload(
        space,
        files,
        components,
        slots,
        placements,
        existing_public_profile,
    )
    version = models.CuratorSpaceVersion(
        space_id=space.id,
        created_by_user_id=principal.user_id,
        version_name=request.versionName or f"Published {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        memo=request.memo,
        version_snapshot=version_snapshot,
    )
    db.add(version)
    db.flush()

    if existing_public_profile is None:
        public_profile = models.CuratorSpacePublicProfile(
            space_id=space.id,
            display_name=display_name,
            summary=summary,
            location_summary=location_summary,
            thumbnail_image_path=request.thumbnailImagePath,
            search_keywords=search_keywords,
            is_featured=request.isFeatured,
            is_default=request.isDefault,
            display_order=request.displayOrder,
            published_at=_parse_iso_datetime(request.publishedAt),
        )
        db.add(public_profile)
    else:
        public_profile = existing_public_profile
        public_profile.display_name = display_name
        public_profile.summary = summary
        public_profile.location_summary = location_summary
        public_profile.thumbnail_image_path = request.thumbnailImagePath
        public_profile.search_keywords = search_keywords
        public_profile.is_featured = request.isFeatured
        public_profile.is_default = request.isDefault
        public_profile.display_order = request.displayOrder
        public_profile.published_at = _parse_iso_datetime(request.publishedAt) if request.publishedAt else (public_profile.published_at or datetime.utcnow())
        public_profile.updated_at = datetime.utcnow()

    if request.isDefault:
        db.query(models.CuratorSpacePublicProfile).filter(
            models.CuratorSpacePublicProfile.space_id != space.id,
            models.CuratorSpacePublicProfile.is_default.is_(True),
        ).update(
            {models.CuratorSpacePublicProfile.is_default: False, models.CuratorSpacePublicProfile.updated_at: datetime.utcnow()},
            synchronize_session=False,
        )
        db.query(models.PublishedSpace).filter(
            models.PublishedSpace.space_key != f"curator-space-{space.id}",
            models.PublishedSpace.is_default.is_(True),
        ).update(
            {models.PublishedSpace.is_default: False, models.PublishedSpace.updated_at: datetime.utcnow()},
            synchronize_session=False,
        )

    viewer_layout = _curator_space_viewer_layout_payload(
        db,
        space=space,
        files=files,
        components=components,
        slots=slots,
        placements=placements,
        display_name=display_name,
        curator_display_name=principal.display_name,
        location_summary=location_summary,
    )
    layout_thumbnail_paths = _thumbnail_image_paths_from_viewer_layout(viewer_layout)
    requested_thumbnail_path = _normalize_storage_path(request.thumbnailImagePath)
    existing_thumbnail_path = _normalize_storage_path(existing_public_profile.thumbnail_image_path) if existing_public_profile else None
    draft_thumbnail_path = _normalize_storage_path(space.thumbnail_image_path)
    effective_thumbnail_path = (
        requested_thumbnail_path
        or existing_thumbnail_path
        or draft_thumbnail_path
        or (layout_thumbnail_paths[0] if layout_thumbnail_paths else None)
    )

    published_space = (
        db.query(models.PublishedSpace)
        .filter(models.PublishedSpace.space_key == f"curator-space-{space.id}")
        .first()
    )
    if published_space is None:
        published_space = models.PublishedSpace(
            space_key=f"curator-space-{space.id}",
            curator_user_id=space.owner_user_id,
            curator_display_name=principal.display_name,
            title=display_name,
            summary=summary or display_name,
            location_summary=location_summary,
            description=space.description or summary or display_name,
            thumbnail_image_path=effective_thumbnail_path,
            search_keywords=search_keywords,
            layout_json=viewer_layout,
            status="published",
            is_featured=request.isFeatured,
            is_default=request.isDefault,
            display_order=request.displayOrder,
            published_at=public_profile.published_at if public_profile else datetime.utcnow(),
        )
        db.add(published_space)
    else:
        published_space.curator_user_id = space.owner_user_id
        published_space.curator_display_name = principal.display_name
        published_space.title = display_name
        published_space.summary = summary or display_name
        published_space.location_summary = location_summary
        published_space.description = space.description or summary or display_name
        published_space.thumbnail_image_path = effective_thumbnail_path
        published_space.search_keywords = search_keywords
        published_space.layout_json = viewer_layout
        published_space.status = "published"
        published_space.is_featured = request.isFeatured
        published_space.is_default = request.isDefault
        published_space.display_order = request.displayOrder
        published_space.published_at = public_profile.published_at if public_profile else datetime.utcnow()
        published_space.updated_at = datetime.utcnow()

    space.status = "published"
    space.thumbnail_image_path = requested_thumbnail_path or draft_thumbnail_path or effective_thumbnail_path
    space.current_version_id = version.id
    space.updated_at = datetime.utcnow()

    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="curator.space.publish",
        resource_type="curator_space",
        resource_id=str(space.id),
        metadata_json={"publishedSpaceKey": f"curator-space-{space.id}", "versionId": version.id},
    )

    db.commit()
    db.refresh(space)

    return _curator_space_detail_payload(
        *_load_curator_space_context(db, space.id)
    )


@app.get("/api/v1/curation/options")
def get_curation_options():
    return {"axes": CURATION_AXES}

@app.get("/api/v1/curation/default")
def get_default_layout(db: Session = Depends(get_db)):
    return _layout_response(db)

@app.post("/api/v1/curation/layouts")
def get_layout(
    request: LayoutRequest,
    principal: AuthPrincipal | None = Depends(get_current_principal_optional),
    db: Session = Depends(get_db),
):
    return _layout_response(
        db,
        theme_id=request.themeOptionId,
        era_id=request.eraOptionId,
        emotion_id=request.emotionOptionId,
        use_algorithm=True,
        persist_log=principal is not None,
        log_user_id=principal.user_id if principal is not None else None,
    )


@app.get("/api/v1/spaces/published", response_model=PublishedSpaceListResponse)
def list_published_spaces(
    query: str | None = None,
    curator: str | None = None,
    location: str | None = None,
    featuredOnly: bool = False,
    defaultOnly: bool = False,
    sort: str = "featured",
    limit: int = 24,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    page_size = max(1, min(limit, 48))
    safe_offset = max(0, offset)

    space_query = db.query(models.PublishedSpace).filter(models.PublishedSpace.status == "published")
    if defaultOnly:
        space_query = space_query.filter(models.PublishedSpace.is_default.is_(True))
    if featuredOnly:
        space_query = space_query.filter(models.PublishedSpace.is_featured.is_(True))

    if query:
        normalized_query = f"%{'%'.join(query.strip().lower().split())}%"
        query_filters = [
            func.lower(models.PublishedSpace.space_key).like(normalized_query),
            func.lower(models.PublishedSpace.title).like(normalized_query),
            func.lower(models.PublishedSpace.summary).like(normalized_query),
            func.lower(models.PublishedSpace.description).like(normalized_query),
            func.lower(models.PublishedSpace.location_summary).like(normalized_query),
            func.lower(models.PublishedSpace.curator_display_name).like(normalized_query),
            func.lower(models.PublishedSpace.search_keywords).like(normalized_query),
        ]
        space_query = space_query.filter(or_(*query_filters))

    if curator:
        normalized_curator = f"%{'%'.join(curator.strip().lower().split())}%"
        space_query = space_query.filter(func.lower(models.PublishedSpace.curator_display_name).like(normalized_curator))

    if location:
        normalized_location = f"%{'%'.join(location.strip().lower().split())}%"
        space_query = space_query.filter(func.lower(models.PublishedSpace.location_summary).like(normalized_location))

    normalized_sort = sort.strip().lower()
    if normalized_sort == "newest":
        ordered_query = space_query.order_by(
            models.PublishedSpace.published_at.desc().nullslast(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.id.desc(),
        )
    elif normalized_sort == "title":
        ordered_query = space_query.order_by(
            models.PublishedSpace.title.asc(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.id.asc(),
        )
    elif normalized_sort == "curator":
        ordered_query = space_query.order_by(
            models.PublishedSpace.curator_display_name.asc(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.id.asc(),
        )
    else:
        ordered_query = space_query.order_by(
            models.PublishedSpace.is_default.desc(),
            models.PublishedSpace.is_featured.desc(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.published_at.desc().nullslast(),
            models.PublishedSpace.id.desc(),
        )

    all_spaces = ordered_query.all()
    thumbnail_image_paths = _public_artwork_image_paths(db)
    thumbnail_map = _assign_published_space_thumbnails(all_spaces, thumbnail_image_paths)
    total = len(all_spaces)
    spaces = all_spaces[safe_offset : safe_offset + page_size]
    return {
        "status": "success",
        "count": len(spaces),
        "total": total,
        "page": (safe_offset // page_size) + 1,
        "pageSize": page_size,
        "query": query,
        "sort": normalized_sort,
        "curator": curator,
        "location": location,
        "featuredOnly": featuredOnly,
        "defaultOnly": defaultOnly,
        "items": [
            _published_space_summary_payload(space, thumbnail_image_path=thumbnail_map.get(space.id))
            for space in spaces
        ],
    }


@app.get("/api/v1/spaces/published/default", response_model=PublishedSpaceDetailResponse)
def get_default_published_space(db: Session = Depends(get_db)):
    spaces = (
        db.query(models.PublishedSpace)
        .filter(models.PublishedSpace.status == "published")
        .order_by(
            models.PublishedSpace.is_default.desc(),
            models.PublishedSpace.is_featured.desc(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.published_at.desc().nullslast(),
            models.PublishedSpace.id.desc(),
        )
        .all()
    )
    if not spaces:
        raise HTTPException(status_code=404, detail="Published space not found.")

    thumbnail_map = _assign_published_space_thumbnails(spaces, _public_artwork_image_paths(db))
    space = spaces[0]
    return _published_space_detail_payload(space, thumbnail_image_path=thumbnail_map.get(space.id))


@app.get("/api/v1/spaces/published/{space_id}", response_model=PublishedSpaceDetailResponse)
def get_published_space(space_id: int, db: Session = Depends(get_db)):
    spaces = (
        db.query(models.PublishedSpace)
        .filter(models.PublishedSpace.status == "published")
        .order_by(
            models.PublishedSpace.is_default.desc(),
            models.PublishedSpace.is_featured.desc(),
            models.PublishedSpace.display_order.asc(),
            models.PublishedSpace.published_at.desc().nullslast(),
            models.PublishedSpace.id.desc(),
        )
        .all()
    )
    thumbnail_map = _assign_published_space_thumbnails(spaces, _public_artwork_image_paths(db))
    space = next(
        (
            candidate
            for candidate in spaces
            if candidate.id == space_id
        ),
        None,
    )
    if space is None:
        raise HTTPException(status_code=404, detail="Published space not found.")

    return _published_space_detail_payload(space, thumbnail_image_path=thumbnail_map.get(space.id))


@app.post("/api/v1/recommendation/features/rebuild")
def rebuild_recommendation_features(
    principal: AuthPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    refresh_recommendation_features(db, force=True)
    refresh_recommendation_layout_scores(db, force=True)
    feature_count = db.query(models.ArtworkRecommendationFeature).count()
    score_count = db.query(models.ArtworkRecommendationScore).count()
    return {
        "status": "success",
        "featureCount": feature_count,
        "layoutScoreCount": score_count,
        "featureVersion": recommendation.FEATURE_VERSION,
        "layoutScoreVersion": LAYOUT_SCORE_VERSION,
        "requestedBy": principal.user_id,
    }


@app.get("/api/v1/recommendation/features/status")
def recommendation_feature_status(db: Session = Depends(get_db), principal: AuthPrincipal = Depends(require_roles("admin"))):
    feature_count = db.query(models.ArtworkRecommendationFeature).count()
    ready_count = db.query(models.ArtworkRecommendationFeature).filter(
        models.ArtworkRecommendationFeature.recommendation_ready.is_(True)
    ).count()
    score_count = db.query(models.ArtworkRecommendationScore).count()
    manifest_path = recommendation.latest_manifest_path()
    provider_status = provider_runtime_status()
    return {
        "status": "success",
        "featureCount": feature_count,
        "readyCount": ready_count,
        "layoutScoreCount": score_count,
        "featureVersion": recommendation.FEATURE_VERSION,
        "layoutScoreVersion": LAYOUT_SCORE_VERSION,
        "manifestPath": str(manifest_path) if manifest_path else None,
        **provider_status,
    }


@app.get("/api/v1/recommendation/debug-results")
def recommendation_debug_results(
    themeOptionId: int = 1,
    eraOptionId: int = 8,
    emotionOptionId: int = 10,
    principal: AuthPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    return _debug_results_response(
        db,
        theme_id=themeOptionId,
        era_id=eraOptionId,
        emotion_id=emotionOptionId,
    )


@app.get("/api/v1/debug/room-merge/snapshots/latest", response_model=RoomMergeSnapshotLatestResponse)
def get_latest_room_merge_snapshot(
    experimentKey: str = 'glb-room-merge-experiment',
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    query = db.query(models.RoomMergeExperimentSnapshot).filter(
        models.RoomMergeExperimentSnapshot.experiment_key == experimentKey,
        models.RoomMergeExperimentSnapshot.owner_user_id == principal.user_id,
    )
    snapshot = query.order_by(
        models.RoomMergeExperimentSnapshot.created_at.desc(),
        models.RoomMergeExperimentSnapshot.id.desc(),
    ).first()

    return {
        "status": "success",
        "snapshot": _room_merge_snapshot_response(snapshot) if snapshot else None,
    }


@app.get("/api/v1/debug/room-merge/snapshots", response_model=RoomMergeSnapshotListResponse)
def list_room_merge_snapshots(
    experimentKey: str = 'glb-room-merge-experiment',
    limit: int = 12,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 50))
    query = db.query(models.RoomMergeExperimentSnapshot).filter(
        models.RoomMergeExperimentSnapshot.experiment_key == experimentKey,
        models.RoomMergeExperimentSnapshot.owner_user_id == principal.user_id,
    )
    snapshots = query.order_by(
        models.RoomMergeExperimentSnapshot.created_at.desc(),
        models.RoomMergeExperimentSnapshot.id.desc(),
    ).limit(safe_limit).all()

    items = [_room_merge_snapshot_response(snapshot) for snapshot in snapshots]
    return {
        "status": "success",
        "count": len(items),
        "items": items,
    }


@app.get("/api/v1/debug/room-merge/presets", response_model=RoomMergePresetListResponse)
def list_room_merge_presets(
    experimentKey: str = 'glb-room-merge-experiment',
    limit: int = 20,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    safe_limit = max(1, min(limit, 50))
    query = db.query(models.RoomMergePreset).filter(
        models.RoomMergePreset.experiment_key == experimentKey,
        models.RoomMergePreset.owner_user_id == principal.user_id,
        models.RoomMergePreset.deleted_at.is_(None),
    )
    presets = query.order_by(
        models.RoomMergePreset.updated_at.desc(),
        models.RoomMergePreset.id.desc(),
    ).limit(safe_limit).all()

    items = [_room_merge_preset_response(preset) for preset in presets]
    return {
        "status": "success",
        "count": len(items),
        "items": items,
    }


@app.get("/api/v1/debug/room-merge/presets/{preset_id}", response_model=RoomMergePresetResponse)
def get_room_merge_preset(
    preset_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    preset = (
        db.query(models.RoomMergePreset)
        .filter(models.RoomMergePreset.id == preset_id)
        .filter(models.RoomMergePreset.owner_user_id == principal.user_id)
        .filter(models.RoomMergePreset.deleted_at.is_(None))
        .first()
    )
    if preset is None:
        raise HTTPException(status_code=404, detail="Room merge preset not found.")

    return _room_merge_preset_response(preset)


@app.post("/api/v1/debug/room-merge/snapshots", response_model=RoomMergeSnapshotCreateResponse)
def create_room_merge_snapshot(
    request: RoomMergeSnapshotCreateRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    if request.spaceId is not None:
        space, *_ = _load_curator_space_context(db, request.spaceId)
        _validate_space_access(space, principal)
    session_id = (request.sessionId or "").strip() or f"user-{principal.user_id}"

    snapshot_record = models.RoomMergeExperimentSnapshot(
        experiment_key=request.experimentKey,
        space_id=request.spaceId,
        owner_user_id=principal.user_id,
        session_id=session_id,
        selected_key=request.selectedKey,
        memo=request.memo,
        assembly_snapshot=request.snapshot.model_dump(),
    )

    try:
        db.add(snapshot_record)
        db.commit()
        db.refresh(snapshot_record)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "room merge snapshot save failed experiment_key=%s session_id=%s",
            request.experimentKey,
            session_id,
        )
        raise HTTPException(status_code=500, detail="Failed to save room merge snapshot.") from exc

    return {
        "status": "success",
        "snapshot": _room_merge_snapshot_response(snapshot_record),
    }


@app.post("/api/v1/debug/room-merge/presets", response_model=RoomMergePresetResponse)
def upsert_room_merge_preset(
    request: RoomMergePresetCreateRequest,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    if request.spaceId is not None:
        space, *_ = _load_curator_space_context(db, request.spaceId)
        _validate_space_access(space, principal)
    session_id = (request.sessionId or "").strip() or f"user-{principal.user_id}"
    preset_name = request.presetName.strip()
    if not preset_name:
        raise HTTPException(status_code=400, detail="presetName is required.")

    existing = (
        db.query(models.RoomMergePreset)
        .filter(models.RoomMergePreset.experiment_key == request.experimentKey)
        .filter(models.RoomMergePreset.owner_user_id == principal.user_id)
        .filter(models.RoomMergePreset.preset_name == preset_name)
        .first()
    )

    payload = request.snapshot.model_dump()

    try:
        if existing is None:
            existing = models.RoomMergePreset(
                experiment_key=request.experimentKey,
                space_id=request.spaceId,
                owner_user_id=principal.user_id,
                session_id=session_id,
                preset_name=preset_name,
                selected_key=request.selectedKey,
                memo=request.memo,
                assembly_snapshot=payload,
            )
            db.add(existing)
        else:
            existing.owner_user_id = principal.user_id
            existing.space_id = request.spaceId
            existing.session_id = session_id
            existing.selected_key = request.selectedKey
            existing.memo = request.memo
            existing.assembly_snapshot = payload
            existing.deleted_at = None
            existing.updated_at = datetime.utcnow()

        db.flush()
        _record_audit_log(
            db,
            actor_user_id=principal.user_id,
            action="room_merge.preset.save",
            resource_type="room_merge_preset",
            resource_id=str(existing.id),
            metadata_json={
                "experimentKey": request.experimentKey,
                "presetName": preset_name,
                "spaceId": request.spaceId,
            },
        )
        db.commit()
        db.refresh(existing)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "room merge preset save failed experiment_key=%s session_id=%s preset_name=%s",
            request.experimentKey,
            session_id,
            preset_name,
        )
        raise HTTPException(status_code=500, detail="Failed to save room merge preset.") from exc

    return _room_merge_preset_response(existing)


@app.delete("/api/v1/debug/room-merge/presets/{preset_id}")
def delete_room_merge_preset(
    preset_id: int,
    principal: AuthPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
):
    preset = (
        db.query(models.RoomMergePreset)
        .filter(models.RoomMergePreset.id == preset_id)
        .filter(models.RoomMergePreset.owner_user_id == principal.user_id)
        .filter(models.RoomMergePreset.deleted_at.is_(None))
        .first()
    )
    if preset is None:
        raise HTTPException(status_code=404, detail="Room merge preset not found.")

    preset.deleted_at = datetime.utcnow()
    preset.updated_at = datetime.utcnow()
    _record_audit_log(
        db,
        actor_user_id=principal.user_id,
        action="room_merge.preset.delete",
        resource_type="room_merge_preset",
        resource_id=str(preset.id),
        metadata_json={
            "experimentKey": preset.experiment_key,
            "presetName": preset.preset_name,
            "spaceId": preset.space_id,
        },
    )

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete room merge preset.") from exc

    return {
        "status": "success",
        "presetId": preset.id,
        "deletedAt": preset.deleted_at.isoformat() if preset.deleted_at else None,
    }


@app.get("/api/v1/generated-assets/framed-glb", response_model=GeneratedFramedAssetListResponse)
def get_generated_framed_glb_assets(db: Session = Depends(get_db)):
    return _generated_framed_assets_response(db)


@app.post("/api/v1/author/artworks/{artwork_id}/framed-glb", response_model=AuthorArtworkResponse)
def ensure_author_artwork_framed_glb(
    artwork_id: int,
    principal: AuthPrincipal = Depends(require_roles("writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_author_artwork_owner(principal, artwork)

    asset = _ensure_framed_glb_asset(db, artwork)
    return _author_artwork_response(artwork, asset, status=asset.status)


@app.get("/api/v1/storytelling/artworks")
def list_storytelling_artworks(
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
    query: str = "",
    limit: int = 50,
    offset: int = 0,
):
    normalized_query = query.strip()
    artwork_query = db.query(models.Artwork)
    if "admin" not in principal.roles and "paid_curator" not in principal.roles:
        artwork_query = artwork_query.filter(models.Artwork.owner_user_id == principal.user_id)
    if normalized_query:
        like_query = f"%{normalized_query}%"
        artwork_query = artwork_query.filter(
            (models.Artwork.title.ilike(like_query)) |
            (models.Artwork.artist.ilike(like_query)) |
            (models.Artwork.era.ilike(like_query))
        )

    total_count = artwork_query.count()
    artworks = (
        artwork_query
        .order_by(models.Artwork.id.asc())
        .offset(max(offset, 0))
        .limit(max(1, min(limit, 100)))
        .all()
    )
    artwork_ids = [artwork.id for artwork in artworks]
    version_counts = {}
    if artwork_ids:
        version_counts = dict(
            db.query(
                models.ArtworkStorytellingVersion.artwork_id,
                func.count(models.ArtworkStorytellingVersion.id),
            )
            .filter(models.ArtworkStorytellingVersion.artwork_id.in_(artwork_ids))
            .group_by(models.ArtworkStorytellingVersion.artwork_id)
            .all()
        )
    current_versions = {}
    if artwork_ids:
        for version in (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.artwork_id.in_(artwork_ids))
            .filter(models.ArtworkStorytellingVersion.status == "published")
            .order_by(models.ArtworkStorytellingVersion.artwork_id.asc(), models.ArtworkStorytellingVersion.version_number.desc())
            .all()
        ):
            current_versions.setdefault(version.artwork_id, version)

    return {
        "status": "success",
        "count": total_count,
        "requestedBy": principal.user_id,
        "items": [
            _storytelling_summary_payload(
                artwork,
                current_versions.get(artwork.id),
                int(version_counts.get(artwork.id, 0)),
            )
            for artwork in artworks
        ],
    }


@app.get("/api/v1/storytelling/artworks/{artwork_id}/current", response_model=StorytellingCurrentResponse)
def get_storytelling_current(
    artwork_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)
    return _load_public_storytelling_current(db, artwork, public=False)


@app.get("/api/v1/public/storytelling/artworks/{artwork_id}/current", response_model=StorytellingCurrentResponse)
def get_public_storytelling_current(
    artwork_id: int,
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")

    return _load_public_storytelling_current(db, artwork)


@app.get("/api/v1/storytelling/artworks/{artwork_id}/versions", response_model=StorytellingVersionListResponse)
def list_storytelling_versions(
    artwork_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
    limit: int = 10,
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    versions = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .order_by(models.ArtworkStorytellingVersion.version_number.desc())
        .limit(max(1, min(limit, 50)))
        .all()
    )
    return {
        "status": "success",
        "artworkId": artwork.id,
        "currentVersionId": artwork.current_storytelling_version_id,
        "count": len(versions),
        "requestedBy": principal.user_id,
        "items": [
            _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id)
            for version in versions
        ],
    }


@app.post("/api/v1/storytelling/generate", response_model=StorytellingGenerateResponse)
def generate_storytelling(
    request: StorytellingGenerateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    rate_limiter.check(("story", principal.user_id), 10, 3600)
    artwork_ids = list(dict.fromkeys(request.artworkIds))
    if not artwork_ids:
        raise HTTPException(status_code=400, detail="At least one artworkId is required.")
    if len(artwork_ids) > 10:
        raise HTTPException(status_code=400, detail="You can generate storytelling for up to 10 artworks at a time.")

    artwork_query = db.query(models.Artwork).filter(models.Artwork.id.in_(artwork_ids))
    if "admin" not in principal.roles:
        artwork_query = artwork_query.filter(models.Artwork.owner_user_id == principal.user_id)

    artworks = artwork_query.order_by(models.Artwork.id.asc()).all()
    if len(artworks) != len(artwork_ids):
        found_ids = {artwork.id for artwork in artworks}
        missing_ids = [artwork_id for artwork_id in artwork_ids if artwork_id not in found_ids]
        raise HTTPException(status_code=404, detail={"message": "Some artworks were not found.", "missingArtworkIds": missing_ids})

    feature_rows = (
        db.query(models.ArtworkRecommendationFeature)
        .filter(models.ArtworkRecommendationFeature.artwork_id.in_(artwork_ids))
        .all()
    )
    score_rows = (
        db.query(models.ArtworkRecommendationScore)
        .filter(models.ArtworkRecommendationScore.artwork_id.in_(artwork_ids))
        .order_by(models.ArtworkRecommendationScore.generated_at.desc())
        .all()
    )
    feature_map = {row.artwork_id: row for row in feature_rows}
    score_map: dict[int, models.ArtworkRecommendationScore] = {}
    for row in score_rows:
        score_map.setdefault(row.artwork_id, row)

    batch = models.ArtworkStorytellingGenerationBatch(
        created_by_user_id=principal.user_id,
        batch_name=(request.batchName or "").strip() or None,
        global_note=(request.globalNote or "").strip() or None,
        selected_artwork_ids=artwork_ids,
        per_artwork_notes=request.perArtworkNotes or {},
        provider_name="openai" if os.getenv("OPENAI_API_KEY") else "heuristic-storytelling",
        model_name=os.getenv("STORYTELLING_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o")) if os.getenv("OPENAI_API_KEY") else "heuristic-story-v1",
        status="completed",
        result_count=len(artworks),
        request_payload_json={
            "artworkIds": artwork_ids,
            "batchName": request.batchName,
            "globalNote": request.globalNote,
            "perArtworkNotes": request.perArtworkNotes,
        },
    )
    db.add(batch)
    db.flush()

    generated_items: list[dict[str, Any]] = []
    response_payload: list[dict[str, Any]] = []

    for artwork in artworks:
        existing_max_version = (
            db.query(func.max(models.ArtworkStorytellingVersion.version_number))
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .scalar()
        )
        next_version_number = int(existing_max_version or 0) + 1
        request_note = (request.perArtworkNotes or {}).get(str(artwork.id)) or None
        artifact = generate_storytelling_artifact(
            artwork,
            feature=feature_map.get(artwork.id),
            score=score_map.get(artwork.id),
            request_note=request_note,
            global_note=request.globalNote,
        )
        version = models.ArtworkStorytellingVersion(
            artwork_id=artwork.id,
            batch_id=batch.id,
            created_by_user_id=principal.user_id,
            version_number=next_version_number,
            status="published",
            story_title=artifact.story_title,
            story_text=artifact.story_text,
            request_note=request_note,
            global_note=request.globalNote,
            prompt_json=artifact.prompt_json,
            generation_metadata_json=artifact.generation_metadata_json,
            provider_name=artifact.provider_name,
            model_name=artifact.model_name,
            published_at=datetime.utcnow(),
        )
        db.add(version)
        db.flush()
        artwork.current_storytelling_version_id = version.id
        response_payload.append({
            "artworkId": artwork.id,
            "version": _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id),
        })

    batch.response_payload_json = response_payload
    db.commit()
    db.refresh(batch)

    return {
        "status": "success",
        "batch": {
            "id": batch.id,
            "batchName": batch.batch_name,
            "globalNote": batch.global_note,
            "createdByUserId": batch.created_by_user_id,
            "providerName": batch.provider_name,
            "modelName": batch.model_name,
            "status": batch.status,
            "resultCount": batch.result_count,
            "selectedArtworkIds": batch.selected_artwork_ids,
            "createdAt": _dt_to_iso(batch.created_at) or "",
            "updatedAt": _dt_to_iso(batch.updated_at) or "",
        },
        "items": response_payload,
    }


@app.post("/api/v1/storytelling/versions/{version_id}/status", response_model=StorytellingVersionStatusUpdateResponse)
def update_storytelling_version_status(
    version_id: int,
    request: StorytellingVersionStatusUpdateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    version = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.id == version_id)
        .first()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="해당 버전을 찾을 수 없습니다.")

    artwork = (
        db.query(models.Artwork)
        .filter(models.Artwork.id == version.artwork_id)
        .first()
    )
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    next_status = _normalize_storytelling_status(request.status)
    version.status = next_status
    if next_status == "published":
        version.published_at = version.published_at or datetime.utcnow()
        artwork.current_storytelling_version_id = version.id
    elif artwork.current_storytelling_version_id == version.id:
        latest_published = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .filter(models.ArtworkStorytellingVersion.status == "published")
            .order_by(models.ArtworkStorytellingVersion.version_number.desc())
            .first()
        )
        artwork.current_storytelling_version_id = latest_published.id if latest_published else None

    try:
        db.commit()
        db.refresh(version)
        db.refresh(artwork)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "storytelling status update failed version_id=%s artwork_id=%s status=%s",
            version_id,
            artwork.id,
            next_status,
        )
        raise HTTPException(status_code=500, detail="Failed to update storytelling version status.") from exc

    current_version = _load_current_storytelling_version(db, artwork)
    return {
        "status": "success",
        "artworkId": artwork.id,
        "currentVersionId": artwork.current_storytelling_version_id,
        "version": _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id),
        "currentVersion": _storytelling_version_payload(current_version, current_version_id=artwork.current_storytelling_version_id) if current_version else None,
        "requestedBy": principal.user_id,
    }


@app.patch("/api/v1/storytelling/versions/{version_id}", response_model=StorytellingVersionUpdateResponse)
def update_storytelling_version(
    version_id: int,
    request: StorytellingVersionUpdateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    version = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.id == version_id)
        .first()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="해당 버전을 찾을 수 없습니다.")

    artwork = (
        db.query(models.Artwork)
        .filter(models.Artwork.id == version.artwork_id)
        .first()
    )
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    title_changed = False
    text_changed = False

    if request.storyTitle is not None:
        normalized_title = request.storyTitle.strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail="storyTitle cannot be empty.")
        if normalized_title != version.story_title:
            version.story_title = normalized_title
            title_changed = True

    if request.storyText is not None:
        normalized_text = request.storyText.strip()
        if not normalized_text:
            raise HTTPException(status_code=400, detail="storyText cannot be empty.")
        if normalized_text != version.story_text:
            version.story_text = normalized_text
            text_changed = True

    if text_changed:
        existing_asset = (
            db.query(models.TtsAsset)
            .filter(models.TtsAsset.storytelling_version_id == version.id)
            .first()
        )
        if existing_asset is not None:
            _cleanup_tts_asset_files(existing_asset)
            db.delete(existing_asset)

    try:
        db.commit()
        db.refresh(version)
        db.refresh(artwork)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "storytelling version update failed version_id=%s artwork_id=%s",
            version_id,
            artwork.id,
        )
        raise HTTPException(status_code=500, detail="Failed to update storytelling version.") from exc

    current_version = _load_current_storytelling_version(db, artwork)
    return {
        "status": "success",
        "artworkId": artwork.id,
        "currentVersionId": artwork.current_storytelling_version_id,
        "version": _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id),
        "currentVersion": _storytelling_version_payload(current_version, current_version_id=artwork.current_storytelling_version_id) if current_version else None,
        "requestedBy": principal.user_id,
    }


@app.patch("/api/v1/storytelling/artworks/{artwork_id}/current-version", response_model=StorytellingCurrentVersionUpdateResponse)
def update_storytelling_current_version(
    artwork_id: int,
    request: StorytellingCurrentVersionUpdateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    version: models.ArtworkStorytellingVersion | None = None
    if request.versionId is not None:
        version = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.id == request.versionId)
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .first()
        )
        if version is None:
            raise HTTPException(status_code=404, detail="해당 버전을 찾을 수 없습니다.")
        if version.status != "published":
            raise HTTPException(status_code=409, detail="대표본은 published 상태의 버전만 지정할 수 있습니다.")
        artwork.current_storytelling_version_id = version.id
    else:
        artwork.current_storytelling_version_id = None

    try:
        db.commit()
        db.refresh(artwork)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "storytelling representative update failed artwork_id=%s version_id=%s",
            artwork.id,
            request.versionId,
        )
        raise HTTPException(status_code=500, detail="Failed to update current storytelling version.") from exc

    current_version = _load_current_storytelling_version(db, artwork)
    return {
        "status": "success",
        "artworkId": artwork.id,
        "currentVersionId": artwork.current_storytelling_version_id,
        "version": _storytelling_version_payload(version, current_version_id=artwork.current_storytelling_version_id) if version else None,
        "currentVersion": _storytelling_version_payload(current_version, current_version_id=artwork.current_storytelling_version_id) if current_version else None,
        "requestedBy": principal.user_id,
    }


@app.delete("/api/v1/storytelling/versions/{version_id}", response_model=StorytellingVersionDeleteResponse)
def delete_storytelling_version(
    version_id: int,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    version = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.id == version_id)
        .first()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="해당 버전을 찾을 수 없습니다.")

    artwork = (
        db.query(models.Artwork)
        .filter(models.Artwork.id == version.artwork_id)
        .first()
    )
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    existing_asset = (
        db.query(models.TtsAsset)
        .filter(models.TtsAsset.storytelling_version_id == version.id)
        .first()
    )
    if existing_asset is not None:
        _cleanup_tts_asset_files(existing_asset)
        db.delete(existing_asset)

    was_representative = artwork.current_storytelling_version_id == version.id
    deleted_version_id = version.id
    db.delete(version)
    db.flush()

    if was_representative:
        latest_published = (
            db.query(models.ArtworkStorytellingVersion)
            .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
            .filter(models.ArtworkStorytellingVersion.status == "published")
            .order_by(models.ArtworkStorytellingVersion.version_number.desc(), models.ArtworkStorytellingVersion.id.desc())
            .first()
        )
        artwork.current_storytelling_version_id = latest_published.id if latest_published else None

    try:
        db.commit()
        db.refresh(artwork)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "storytelling version delete failed version_id=%s artwork_id=%s",
            version_id,
            artwork.id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete storytelling version.") from exc

    current_version = _load_current_storytelling_version(db, artwork)
    return {
        "status": "success",
        "artworkId": artwork.id,
        "deletedVersionId": deleted_version_id,
        "currentVersionId": artwork.current_storytelling_version_id,
        "currentVersion": _storytelling_version_payload(current_version, current_version_id=artwork.current_storytelling_version_id) if current_version else None,
        "requestedBy": principal.user_id,
    }


@app.post("/api/v1/storytelling/versions/{version_id}/tts", response_model=StorytellingTtsGenerateResponse)
def generate_storytelling_tts(
    version_id: int,
    request: StorytellingTtsGenerateRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator", "writer")),
    db: Session = Depends(get_db),
):
    rate_limiter.check(("tts", principal.user_id), 10, 3600)
    version = (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.id == version_id)
        .first()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="해당 스토리 버전을 찾을 수 없습니다.")

    artwork = (
        db.query(models.Artwork)
        .filter(models.Artwork.id == version.artwork_id)
        .first()
    )
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_storytelling_access(principal, artwork)

    if version.status != "published":
        raise HTTPException(status_code=409, detail="TTS는 published story version에만 생성할 수 있습니다.")

    voice_id = (request.voiceId or MINIMAX_TTS_VOICE_ID).strip() or MINIMAX_TTS_VOICE_ID
    model_name = (request.modelName or MINIMAX_TTS_MODEL).strip() or MINIMAX_TTS_MODEL
    language_boost = (request.languageBoost or MINIMAX_TTS_LANGUAGE_BOOST).strip() or MINIMAX_TTS_LANGUAGE_BOOST
    rendered_text = _normalize_tts_script(artwork, version.story_text)

    existing_asset = (
        db.query(models.TtsAsset)
        .filter(models.TtsAsset.storytelling_version_id == version.id)
        .first()
    )
    if (
        existing_asset is not None
        and existing_asset.status == "ready"
        and not request.forceRebuild
        and existing_asset.voice_id == voice_id
        and existing_asset.model_name == model_name
        and existing_asset.language_boost == language_boost
        and (existing_asset.provider_metadata or {}).get("tts_rendering_version") == TTS_RENDERING_VERSION
        and (existing_asset.provider_metadata or {}).get("tts_rendered_text") == rendered_text
    ):
        return {
            "status": "success",
            "artworkId": artwork.id,
            "versionId": version.id,
            "ttsAsset": _tts_asset_payload(existing_asset),
            "requestedVoiceId": voice_id,
            "requestedModelName": model_name,
            "requestedLanguageBoost": language_boost,
            "requestedBy": principal.user_id,
        }

    provider_response: dict[str, Any] | None = None
    audio_bytes: bytes | None = None
    status = "ready"
    error_message: str | None = None

    try:
        provider_response = _call_minimax_tts(
            rendered_text,
            model_name=model_name,
            voice_id=voice_id,
            language_boost=language_boost,
            output_format=MINIMAX_TTS_OUTPUT_FORMAT,
        )
        audio_hex = ((provider_response.get("data") or {}).get("audio") or "").strip()
        if not audio_hex:
            raise RuntimeError("MiniMax TTS response did not include audio data.")
        audio_bytes = bytes.fromhex(audio_hex)
    except Exception as exc:
        status = "failed"
        error_message = "TTS provider request failed. Check server logs."
        logger.exception("storytelling tts generation failed version_id=%s artwork_id=%s", version.id, artwork.id)

    asset = _store_tts_asset(
        db,
        version,
        provider_name="minimax",
        model_name=model_name,
        voice_id=voice_id,
        language_boost=language_boost,
        output_format=MINIMAX_TTS_OUTPUT_FORMAT,
        rendered_text=rendered_text,
        provider_response=provider_response,
        audio_bytes=audio_bytes,
        status=status,
        error_message=error_message,
    )

    try:
        db.commit()
        db.refresh(asset)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save TTS asset.") from exc

    response_status = "success" if asset.status == "ready" else "failed"
    return {
        "status": response_status,
        "artworkId": artwork.id,
        "versionId": version.id,
        "ttsAsset": _tts_asset_payload(asset),
        "requestedVoiceId": voice_id,
        "requestedModelName": model_name,
        "requestedLanguageBoost": language_boost,
        "requestedBy": principal.user_id,
    }


@app.post("/api/v1/author/artworks", response_model=AuthorArtworkResponse)
async def create_author_artwork(
    image: UploadFile = File(...),
    title: str = Form(...),
    artist: str = Form(...),
    era_year: int = Form(...),
    main_thema: str = Form(...),
    main_emotion: str = Form(...),
    era: str = Form(...),
    principal: AuthPrincipal = Depends(require_roles("writer")),
    db: Session = Depends(get_db),
):
    normalized_title = _validate_non_empty(title, "title")
    normalized_artist = _validate_non_empty(artist, "artist")
    normalized_main_thema = _validate_non_empty(main_thema, "main_thema")
    normalized_main_emotion = _validate_non_empty(main_emotion, "main_emotion")
    normalized_era = _validate_non_empty(era, "era")
    normalized_era_year = _validate_era_year(era_year)
    raw_bytes, extension = await _read_and_validate_upload_image(image)

    artwork_id = _next_artwork_id(db)
    asset_folder_name = f"author_upload_{artwork_id}"
    image_file_name = f"{asset_folder_name}.{extension}"
    output_image_path = ARTWORK_IMAGE_DIR / image_file_name
    output_image_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        output_image_path.write_bytes(raw_bytes)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save upload image: {exc}") from exc

    artwork = models.Artwork(
        id=artwork_id,
        owner_user_id=principal.user_id,
        title=normalized_title,
        artist=normalized_artist,
        main_thema=normalized_main_thema,
        sub_thema=None,
        main_emotion=normalized_main_emotion,
        sub_emotion=None,
        era=normalized_era,
        era_year=normalized_era_year,
        asset_folder_name=asset_folder_name,
        image_path=image_file_name,
        source=AUTHOR_UPLOAD_SOURCE,
        source_object_id=str(artwork_id),
        source_query=None,
        object_url=None,
        is_public_domain=False,
    )
    db.add(artwork)
    db.flush()
    _ensure_artwork_ownership(db, artwork)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        output_image_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to create artwork record: {exc}") from exc
    db.refresh(artwork)

    try:
        asset = _upsert_framed_glb_asset_record(
            db,
            artwork,
            status="queued",
            image_file_name=image_file_name,
            notes={"stage": "queued"},
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create framed GLB job record: {exc}") from exc

    try:
        if not _start_author_artwork_generation_job(artwork.id):
            logger.info("author artwork generation job already running artwork_id=%s", artwork.id)
    except Exception as exc:
        failed_record = _failed_generated_asset_record(db, artwork, image_file_name, str(exc))
        raise HTTPException(
            status_code=500,
            detail={
                "message": f"Failed to start framed GLB generation: {exc}",
                "artworkId": artwork.id,
                "status": failed_record.status,
            },
        ) from exc

    return _author_artwork_response(artwork, asset, status=asset.status)


@app.get("/api/v1/author/artworks/{artwork_id}", response_model=AuthorArtworkResponse)
def get_author_artwork_status(
    artwork_id: int,
    principal: AuthPrincipal = Depends(require_roles("writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_author_artwork_owner(principal, artwork)

    asset = (
        db.query(models.ArtworkGeneratedAsset)
        .filter(
            models.ArtworkGeneratedAsset.artwork_id == artwork.id,
            models.ArtworkGeneratedAsset.asset_kind == "framed_glb",
        )
        .first()
    )
    if asset is None:
        status = "uploaded"
    elif _is_ready_framed_glb_asset(asset):
        status = asset.status
    elif asset.status == "failed":
        status = "failed"
    else:
        status = "generating"
    return _author_artwork_response(artwork, asset, status=status)


@app.patch("/api/v1/author/artworks/{artwork_id}", response_model=AuthorArtworkResponse)
def update_author_artwork(
    artwork_id: int,
    request: AuthorArtworkUpdateRequest,
    principal: AuthPrincipal = Depends(require_roles("writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_author_artwork_owner(principal, artwork)

    artwork.title = _validate_non_empty(request.title, "title")
    artwork.artist = _validate_non_empty(request.artist, "artist")
    artwork.era_year = _validate_era_year(request.era_year)
    artwork.main_thema = _validate_non_empty(request.main_thema, "main_thema")
    artwork.main_emotion = _validate_non_empty(request.main_emotion, "main_emotion")
    artwork.era = _validate_non_empty(request.era, "era")
    artwork.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(artwork)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update artwork record: {exc}") from exc

    asset = (
        db.query(models.ArtworkGeneratedAsset)
        .filter(models.ArtworkGeneratedAsset.artwork_id == artwork.id)
        .filter(models.ArtworkGeneratedAsset.asset_kind == "framed_glb")
        .first()
    )
    status = asset.status if asset is not None else "uploaded"
    return _author_artwork_response(artwork, asset, status=status)


@app.delete("/api/v1/author/artworks/{artwork_id}", response_model=AuthorArtworkDeleteResponse)
def delete_author_artwork(
    artwork_id: int,
    principal: AuthPrincipal = Depends(require_roles("writer")),
    db: Session = Depends(get_db),
):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    if artwork is None:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")
    _require_author_artwork_owner(principal, artwork)

    existing_asset = (
        db.query(models.ArtworkGeneratedAsset)
        .filter(models.ArtworkGeneratedAsset.artwork_id == artwork.id)
        .first()
    )
    if existing_asset is not None:
        db.delete(existing_asset)

    db.query(models.ArtworkRecommendationScore).filter(models.ArtworkRecommendationScore.artwork_id == artwork.id).delete(synchronize_session=False)
    db.query(models.ArtworkRecommendationFeature).filter(models.ArtworkRecommendationFeature.artwork_id == artwork.id).delete(synchronize_session=False)

    for version in (
        db.query(models.ArtworkStorytellingVersion)
        .filter(models.ArtworkStorytellingVersion.artwork_id == artwork.id)
        .all()
    ):
        tts_asset = (
            db.query(models.TtsAsset)
            .filter(models.TtsAsset.storytelling_version_id == version.id)
            .first()
        )
        if tts_asset is not None:
            _cleanup_tts_asset_files(tts_asset)
            db.delete(tts_asset)
        db.delete(version)

    db.query(models.ArtworkOwnership).filter(models.ArtworkOwnership.artwork_id == artwork.id).delete(synchronize_session=False)
    db.delete(artwork)

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete artwork record: {exc}") from exc

    _cleanup_author_artwork_files(artwork)
    return {
        "status": "success",
        "artworkId": artwork.id,
        "deletedAt": datetime.utcnow().isoformat(),
    }

@app.get("/api/v1/artworks")
def list_artworks(db: Session = Depends(get_db), limit: int = 50):
    bounded_limit = max(1, min(limit, 200))
    artworks = db.query(models.Artwork).order_by(models.Artwork.id.asc()).limit(bounded_limit).all()
    return {
        "status": "success",
        "count": len(artworks),
        "data": [
            {
                "id": artwork.id,
                "title": artwork.title,
                "artist": artwork.artist,
                "main_thema": artwork.main_thema,
                "sub_thema": artwork.sub_thema,
                "main_emotion": artwork.main_emotion,
                "sub_emotion": artwork.sub_emotion,
                "era": artwork.era,
                "era_year": artwork.era_year,
                "asset_folder_name": artwork.asset_folder_name,
                "image_path": artwork.image_path,
                "source": artwork.source,
                "source_object_id": artwork.source_object_id,
                "source_query": artwork.source_query,
                "object_url": artwork.object_url,
                "is_public_domain": artwork.is_public_domain,
                "current_storytelling_version_id": artwork.current_storytelling_version_id,
            }
            for artwork in artworks
        ],
    }

# ==========================================
# 2. 단일 작품 상세 정보 조회
# ==========================================
@app.get("/api/v1/artworks/{artwork_id}", response_model=ArtworkResponse)
def get_artwork(artwork_id: int, db: Session = Depends(get_db)):
    artwork = db.query(models.Artwork).filter(models.Artwork.id == artwork_id).first()
    
    if not artwork:
        raise HTTPException(status_code=404, detail="해당 작품을 찾을 수 없습니다.")

    current_story_version = _load_current_storytelling_version(db, artwork)

    base_path = public_url(f"/assets/{artwork.asset_folder_name}")
    files_dict = {
        "point_cloud": f"{base_path}/point_cloud.ply",
        "cameras": f"{base_path}/cameras.json",
        "cfg_args": f"{base_path}/cfg_args.json",
        "exposure": f"{base_path}/exposure.json",
        "input_ply": f"{base_path}/input.ply"
    }

    return {
        "id": artwork.id,
        "title": artwork.title,
        "artist": artwork.artist,
        "main_thema": artwork.main_thema,
        "sub_thema": artwork.sub_thema,
        "main_emotion": artwork.main_emotion,
        "sub_emotion": artwork.sub_emotion,
        "era": artwork.era,
        "era_year": artwork.era_year,
        "asset_folder_name": artwork.asset_folder_name,
        "image_path": artwork.image_path,
        "source": artwork.source,
        "source_object_id": artwork.source_object_id,
        "source_query": artwork.source_query,
        "object_url": artwork.object_url,
        "is_public_domain": artwork.is_public_domain,
        "current_storytelling_version_id": current_story_version.id if current_story_version else artwork.current_storytelling_version_id,
        "current_storytelling_title": current_story_version.story_title if current_story_version else None,
        "current_storytelling_text": current_story_version.story_text if current_story_version else None,
        "current_storytelling_status": current_story_version.status if current_story_version else None,
        "current_storytelling_generated_at": _dt_to_iso(current_story_version.created_at) if current_story_version else None,
        "files": files_dict
    }

# ==========================================
# 3. 배치 알고리즘 실행 엔드포인트
# ==========================================
@app.post("/api/v1/curation/select")
async def select_theme_and_request_layout(
    request: models.CurationSelectRequest,
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db)
):
    try:
        # DB에서 전체 작품 객체를 리스트로 가져옴
        artworks = db.query(models.Artwork).all()
        print(f"조회된 작품 개수: {len(artworks)}") 
        
        # 새롭게 짠 배치 알고리즘에 Pydantic 요청 객체와 DB 리스트를 그대로 던짐
        final_id_list = batch_Service.run_curation_algorithm(request, artworks)

        new_log = models.CurationLog(
            user_id=principal.user_id,
            recommended_ids=final_id_list
        )
        db.add(new_log)
        db.commit()

        return {
            "status": "completed",
            "user_id": principal.user_id,
            "final_id_list": final_id_list
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"배치 작업 오류: {str(e)}")

# ==========================================
# 4. 저장된 로그 보기
# ==========================================
@app.get("/api/v1/curation/logs")
def get_curation_logs(
    principal: AuthPrincipal = Depends(require_roles("admin", "paid_curator")),
    db: Session = Depends(get_db),
    limit: int = 10,
):
    try:
        query = db.query(models.CurationLog)
        if "admin" not in principal.roles:
            query = query.filter(models.CurationLog.user_id == principal.user_id)
        logs = query.order_by(models.CurationLog.created_at.desc()).limit(max(1, min(limit, 100))).all()
        return {
            "status": "success",
            "message": f"최근 {limit}개의 저장된 로그를 불러왔습니다.",
            "requestedBy": principal.user_id,
            "data": logs,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"로그 조회 오류: {str(e)}")
