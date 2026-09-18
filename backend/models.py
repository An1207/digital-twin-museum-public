# models.py
from datetime import datetime

from pydantic import BaseModel
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint

from database import Base  # database.py에서 만든 Base를 가져옴

class Artwork(Base):
    __tablename__ = "artworks"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, index=True)
    artist = Column(String, nullable=True)

    # 변경된 컬럼들
    main_thema = Column(String)
    sub_thema = Column(String, nullable=True)
    main_emotion = Column(String)
    sub_emotion = Column(String, nullable=True)
    
    era = Column(String)
    era_year = Column(Integer)
    asset_folder_name = Column(String)
    image_path = Column(String, nullable=True)
    source = Column(String, nullable=True)
    source_object_id = Column(String, nullable=True)
    source_query = Column(String, nullable=True)
    object_url = Column(String, nullable=True)
    is_public_domain = Column(Boolean, nullable=False, default=False)
    current_storytelling_version_id = Column(Integer, ForeignKey("artwork_storytelling_versions.id"), nullable=True, index=True)


class ArtworkOwnership(Base):
    __tablename__ = "artwork_ownerships"
    __table_args__ = (
        UniqueConstraint("artwork_id", "user_id", name="uq_artwork_ownerships_artwork_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ownership_role = Column(String, nullable=False, default="co_owner")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ArtworkRecommendationFeature(Base):
    __tablename__ = "artwork_recommendation_features"

    id = Column(Integer, primary_key=True, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, unique=True, index=True)
    feature_version = Column(String, nullable=False, default="hybrid-v1")
    source_model = Column(String, nullable=False, default="heuristic-clip-bridge-v1")
    visual_embedding = Column(JSON, nullable=False)
    theme_scores = Column(JSON, nullable=False)
    era_scores = Column(JSON, nullable=False)
    emotion_scores = Column(JSON, nullable=False)
    recommendation_ready = Column(Boolean, nullable=False, default=True)
    manifest_filename = Column(String, nullable=True)
    notes = Column(JSON, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ArtworkRecommendationScore(Base):
    __tablename__ = "artwork_recommendation_scores"
    __table_args__ = (
        UniqueConstraint(
            "artwork_id",
            "theme_option_id",
            "era_option_id",
            "emotion_option_id",
            name="uq_artwork_recommendation_scores_selection",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, index=True)
    theme_option_id = Column(Integer, nullable=False, index=True)
    era_option_id = Column(Integer, nullable=False, index=True)
    emotion_option_id = Column(Integer, nullable=False, index=True)
    score_version = Column(String, nullable=False, default="hybrid-v1-layout-v1")
    final_score = Column(Float, nullable=False, default=0.0)
    visual_score = Column(Float, nullable=False, default=0.0)
    theme_score = Column(Float, nullable=False, default=0.0)
    era_score = Column(Float, nullable=False, default=0.0)
    emotion_score = Column(Float, nullable=False, default=0.0)
    reasons = Column(JSON, nullable=False, default=list)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ArtworkGeneratedAsset(Base):
    __tablename__ = "artwork_generated_assets"
    __table_args__ = (
        UniqueConstraint("artwork_id", "asset_kind", name="uq_artwork_generated_assets_artwork_kind"),
    )

    id = Column(Integer, primary_key=True, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, index=True)
    asset_kind = Column(String, nullable=False, default="framed_glb")
    status = Column(String, nullable=False, default="ready")
    file_name = Column(String, nullable=False)
    relative_output_path = Column(String, nullable=False)
    source_image_path = Column(String, nullable=True)
    file_size_bytes = Column(Integer, nullable=True)
    notes = Column(JSON, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ArtworkStorytellingGenerationBatch(Base):
    __tablename__ = "artwork_storytelling_generation_batches"

    id = Column(Integer, primary_key=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    batch_name = Column(String, nullable=True)
    global_note = Column(String, nullable=True)
    selected_artwork_ids = Column(JSON, nullable=False)
    per_artwork_notes = Column(JSON, nullable=True)
    provider_name = Column(String, nullable=False, default="heuristic-storytelling")
    model_name = Column(String, nullable=False, default="heuristic-story-v1")
    status = Column(String, nullable=False, default="completed")
    result_count = Column(Integer, nullable=False, default=0)
    request_payload_json = Column(JSON, nullable=False)
    response_payload_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ArtworkStorytellingVersion(Base):
    __tablename__ = "artwork_storytelling_versions"
    __table_args__ = (
        UniqueConstraint("artwork_id", "version_number", name="uq_artwork_storytelling_versions_artwork_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("artwork_storytelling_generation_batches.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="published")
    story_title = Column(String, nullable=False)
    story_text = Column(Text, nullable=False)
    request_note = Column(String, nullable=True)
    global_note = Column(String, nullable=True)
    prompt_json = Column(JSON, nullable=False)
    generation_metadata_json = Column(JSON, nullable=True)
    provider_name = Column(String, nullable=False, default="heuristic-storytelling")
    model_name = Column(String, nullable=False, default="heuristic-story-v1")
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class TtsAsset(Base):
    __tablename__ = "tts_assets"
    __table_args__ = (
        UniqueConstraint(
            "storytelling_version_id",
            name="uq_tts_assets_storytelling_version",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    storytelling_version_id = Column(Integer, ForeignKey("artwork_storytelling_versions.id"), nullable=False, unique=True, index=True)
    provider_name = Column(String, nullable=False, default="minimax")
    model_name = Column(String, nullable=False, default="speech-2.8-hd")
    voice_id = Column(String, nullable=False)
    language_boost = Column(String, nullable=False, default="Korean")
    output_format = Column(String, nullable=False, default="mp3")
    status = Column(String, nullable=False, default="ready")
    audio_url = Column(String, nullable=True)
    audio_path = Column(String, nullable=True)
    trace_id = Column(String, nullable=True)
    audio_length = Column(Integer, nullable=True)
    audio_size_bytes = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    provider_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    role_key = Column(String, nullable=False, unique=True, index=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False, unique=True, index=True)
    email = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")
    last_login_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CuratorProfile(Base):
    __tablename__ = "curator_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    plan_status = Column(String, nullable=False, default="inactive")
    plan_key = Column(String, nullable=True)
    quota_story_generations_monthly = Column(Integer, nullable=False, default=0)
    quota_tts_generations_monthly = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PublishedSpace(Base):
    __tablename__ = "published_spaces"
    __table_args__ = (
        Index("ix_published_spaces_status_featured_order", "status", "is_featured", "display_order", "published_at"),
        Index("ix_published_spaces_curator_user_id", "curator_user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_key = Column(String, nullable=False, unique=True)
    curator_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    curator_display_name = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False, index=True)
    summary = Column(String, nullable=False)
    location_summary = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=False)
    thumbnail_image_path = Column(String, nullable=True)
    search_keywords = Column(Text, nullable=False, default="")
    layout_json = Column(JSON, nullable=False)
    status = Column(String, nullable=False, default="published", index=True)
    is_featured = Column(Boolean, nullable=False, default=False, index=True)
    is_default = Column(Boolean, nullable=False, default=False, index=True)
    display_order = Column(Integer, nullable=False, default=0, index=True)
    published_at = Column(DateTime, nullable=True, index=True)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CuratorSpaceFile(Base):
    __tablename__ = "curator_space_files"
    __table_args__ = (
        Index("idx_curator_space_files_owner_status", "owner_user_id", "status"),
        Index("idx_curator_space_files_owner_created_at", "owner_user_id", "created_at"),
        Index("idx_curator_space_files_space_status", "space_id", "status"),
        Index("idx_curator_space_files_space_created_at", "space_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=True, index=True)
    original_file_name = Column(String, nullable=False)
    stored_file_path = Column(String, nullable=False)
    checksum_sha256 = Column(String, nullable=False, index=True)
    file_size_bytes = Column(Integer, nullable=False)
    mime_type = Column(String, nullable=True)
    status = Column(String, nullable=False, default="ready", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class CuratorSpace(Base):
    __tablename__ = "curator_spaces"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_curator_spaces_owner_name"),
        Index("idx_curator_spaces_owner_status", "owner_user_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    thumbnail_image_path = Column(String, nullable=True)
    status = Column(String, nullable=False, default="draft", index=True)
    current_version_id = Column(Integer, ForeignKey("curator_space_versions.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class CuratorSpaceComponent(Base):
    __tablename__ = "curator_space_components"
    __table_args__ = (
        UniqueConstraint("space_id", "component_key", name="uq_curator_space_components_space_key"),
        Index("idx_curator_space_components_space_sort", "space_id", "sort_order"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=False, index=True)
    space_file_id = Column(Integer, ForeignKey("curator_space_files.id"), nullable=False, index=True)
    entity_type_id = Column(Integer, nullable=False, default=1, index=True)
    component_key = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)
    position_x = Column(Float, nullable=False)
    position_y = Column(Float, nullable=False)
    position_z = Column(Float, nullable=False)
    rotation_x = Column(Float, nullable=False, default=0.0)
    rotation_y = Column(Float, nullable=False, default=0.0)
    rotation_z = Column(Float, nullable=False, default=0.0)
    scale_x = Column(Float, nullable=False, default=1.0)
    scale_y = Column(Float, nullable=False, default=1.0)
    scale_z = Column(Float, nullable=False, default=1.0)
    sort_order = Column(Integer, nullable=False, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class ArtworkSlot(Base):
    __tablename__ = "artwork_slots"
    __table_args__ = (
        UniqueConstraint("space_id", "slot_key", name="uq_artwork_slots_space_key"),
        Index("idx_slots_space_status", "space_id", "status", "sort_order"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=False, index=True)
    entity_type_id = Column(Integer, nullable=False, default=2, index=True)
    slot_key = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    size_preset = Column(String, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    depth = Column(Float, nullable=False)
    position_x = Column(Float, nullable=False)
    position_y = Column(Float, nullable=False)
    position_z = Column(Float, nullable=False)
    rotation_x = Column(Float, nullable=False, default=0.0)
    rotation_y = Column(Float, nullable=False, default=0.0)
    rotation_z = Column(Float, nullable=False, default=0.0)
    status = Column(String, nullable=False, default="draft", index=True)
    sort_order = Column(Integer, nullable=False, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class SpaceArtworkPlacement(Base):
    __tablename__ = "space_artwork_placements"
    __table_args__ = (
        UniqueConstraint("space_id", "slot_id", name="uq_space_artwork_placements_space_slot"),
        Index("idx_space_artwork_placements_space_artwork", "space_id", "artwork_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=False, index=True)
    slot_id = Column(Integer, ForeignKey("artwork_slots.id"), nullable=False, index=True)
    artwork_id = Column(Integer, ForeignKey("artworks.id"), nullable=False, index=True)
    status = Column(String, nullable=False, default="draft", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class CuratorSpaceVersion(Base):
    __tablename__ = "curator_space_versions"
    __table_args__ = (
        Index("idx_curator_space_versions_space_created_at", "space_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    version_name = Column(String, nullable=True)
    memo = Column(Text, nullable=True)
    version_snapshot = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CuratorSpacePublicProfile(Base):
    __tablename__ = "curator_space_public_profiles"
    __table_args__ = (
        UniqueConstraint("space_id", name="uq_curator_space_public_profiles_space_id"),
        Index("idx_space_public_profiles_default_featured", "is_default", "is_featured", "display_order", "published_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    location_summary = Column(String, nullable=True)
    thumbnail_image_path = Column(String, nullable=True)
    search_keywords = Column(Text, nullable=False, default="")
    is_featured = Column(Boolean, nullable=False, default=False, index=True)
    is_default = Column(Boolean, nullable=False, default=False, index=True)
    display_order = Column(Integer, nullable=False, default=0, index=True)
    published_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class AuthRefreshToken(Base):
    __tablename__ = "auth_refresh_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_auth_refresh_tokens_token_hash"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    revoked_at = Column(DateTime, nullable=True, index=True)
    replaced_by_token_hash = Column(String, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    action = Column(String, nullable=False, index=True)
    resource_type = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=True, index=True)
    metadata_json = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class RoomMergeExperimentSnapshot(Base):
    __tablename__ = "room_merge_experiment_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    experiment_key = Column(String, nullable=False, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    session_id = Column(String, nullable=False, index=True)
    selected_key = Column(String, nullable=True)
    memo = Column(String, nullable=True)
    assembly_snapshot = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RoomMergePreset(Base):
    __tablename__ = "room_merge_presets"
    __table_args__ = (
        UniqueConstraint(
            "experiment_key",
            "owner_user_id",
            "preset_name",
            name="uq_room_merge_presets_owner_name",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    experiment_key = Column(String, nullable=False, index=True)
    space_id = Column(Integer, ForeignKey("curator_spaces.id"), nullable=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    session_id = Column(String, nullable=False, index=True)
    preset_name = Column(String, nullable=False, index=True)
    selected_key = Column(String, nullable=True)
    memo = Column(String, nullable=True)
    assembly_snapshot = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

class CurationSelectRequest(BaseModel):
    user_id: int
    thema: str      # 1. 주테마
    era: str        # 2. 시대
    emotion: str    # 3. 주 감정

class CurationLog(Base):
    __tablename__ = "curation_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer)
    # Postgres와 SQLite 로컬 개발 환경에서 모두 동작하도록 JSON으로 저장
    recommended_ids = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
