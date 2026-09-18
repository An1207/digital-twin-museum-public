import io
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
_runtime = tempfile.TemporaryDirectory()
os.environ["JWT_SECRET"] = secrets.token_hex(32)
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["AUTH_SEED_USERS"] = "false"
for name in ("ASSET_ROOT", "IMAGE_ROOT", "MANIFEST_ROOT"):
    os.environ[name] = str(Path(_runtime.name) / name)
os.environ["STARTUP_STATUS_FILE"] = str(Path(_runtime.name) / "status.json")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import auth
import main
import models
import asset_access
import public_seed
from security import RateLimiter, contained_path, validate_model_upload


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as session:
        auth.seed_auth_users(session)
        main.app.dependency_overrides[main.get_db] = lambda: session
        monkeypatch.setattr(main, "SessionLocal", factory)
        monkeypatch.setattr(asset_access, "SessionLocal", factory)
        main.rate_limiter.buckets.clear()
        yield session
    main.app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(db):
    return TestClient(main.app)


def make_user(db, role="writer", username=None):
    user = models.User(username=username or secrets.token_hex(6), email=secrets.token_hex(6) + "@example.test",
                       display_name="Test", password_hash=auth.hash_password(secrets.token_urlsafe(20)), status="active")
    db.add(user)
    db.flush()
    role_row = db.query(models.Role).filter_by(role_key=role).one()
    db.add(models.UserRole(user_id=user.id, role_id=role_row.id))
    db.commit()
    return user


def headers(user, role):
    return {"Authorization": "Bearer " + auth.create_access_token(user.id, [role])}


def test_no_default_accounts(db):
    assert db.query(models.User).count() == 0
    assert db.query(models.Role).count() == 4


@pytest.mark.parametrize("secret", ["", "short", "dev-only-secret-change-me"])
def test_weak_secret_refuses_startup(secret):
    env = {**os.environ, "JWT_SECRET": secret}
    result = subprocess.run([sys.executable, "-c", "import auth"], cwd=BACKEND, env=env, capture_output=True)
    assert result.returncode != 0
    assert b"Set JWT_SECRET" in result.stderr


def test_seed_never_resets_existing_user(db, monkeypatch):
    user = make_user(db, username="admin")
    user.status = "inactive"
    before = user.password_hash
    db.commit()
    monkeypatch.setenv("AUTH_SEED_USERS", "true")
    monkeypatch.setattr(auth, "DEFAULT_SEED_USERS", [{"username": "admin", "email": user.email,
        "password": secrets.token_urlsafe(24), "display_name": "Changed", "role_key": "admin", "plan_status": "active"}])
    auth.seed_auth_users(db)
    db.refresh(user)
    assert user.status == "inactive" and user.password_hash == before
    assert auth._get_user_roles(db, user.id) == ["writer"]


@pytest.mark.parametrize("token", ["bad", "a.b.c", "\u2603.x.x", "a" * 9000])
def test_invalid_token_is_401(client, token):
    # HTTP headers must be ASCII; Unicode is covered directly by the decoder.
    if not token.isascii():
        with pytest.raises(HTTPException) as exc:
            auth._verify(token)
        assert exc.value.status_code == 401
    else:
        assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_registration_cannot_grant_curator(client, db):
    password = secrets.token_urlsafe(18)
    response = client.post("/api/v1/auth/register", json={"username":"new-curator", "email":"curator@example.test",
        "password":password, "passwordConfirmation":password, "role":"curator"})
    assert response.status_code == 403
    assert db.query(models.User).count() == 0


def test_writer_register_login_and_role_routes(client):
    password = secrets.token_urlsafe(18)
    response = client.post("/api/v1/auth/register", json={"username":"writer-test", "email":"writer@example.test",
        "password":password, "passwordConfirmation":password, "role":"writer"})
    assert response.status_code == 200, response.text
    login = client.post("/api/v1/auth/login", json={"identifier":"writer-test", "password":password})
    assert login.status_code == 200
    assert login.json()["user"]["roles"] == ["writer"]
    bearer = {"Authorization":"Bearer " + login.json()["accessToken"]}
    assert client.get("/api/v1/workspace/curator", headers=bearer).status_code == 403


def test_login_throttle(client):
    for _ in range(10):
        assert client.post("/api/v1/auth/login", json={"identifier":"missing", "password":"wrong"}).status_code == 401
    response = client.post("/api/v1/auth/login", json={"identifier":"missing", "password":"wrong"})
    assert response.status_code == 429 and response.headers["retry-after"] == "60"


def test_curator_cannot_edit_another_artwork(client, db):
    owner = make_user(db)
    curator = make_user(db, "paid_curator")
    artwork = models.Artwork(owner_user_id=owner.id, title="Private", asset_folder_name="test")
    db.add(artwork)
    db.commit()
    response = client.post("/api/v1/storytelling/generate", headers=headers(curator,"paid_curator"), json={"artworkIds":[artwork.id]})
    assert response.status_code == 404
    assert db.query(models.ArtworkStorytellingVersion).count() == 0


def test_private_story_notes_not_public(client, db):
    owner = make_user(db)
    artwork = models.Artwork(owner_user_id=owner.id, title="Test", asset_folder_name="test")
    db.add(artwork)
    db.flush()
    batch = models.ArtworkStorytellingGenerationBatch(created_by_user_id=owner.id, selected_artwork_ids=[artwork.id], request_payload_json={})
    db.add(batch)
    db.flush()
    versions = []
    for number, status in enumerate(["published", "draft"], 1):
        version = models.ArtworkStorytellingVersion(artwork_id=artwork.id, batch_id=batch.id, created_by_user_id=owner.id,
            version_number=number, status=status, story_title="Story", story_text="Public story", request_note="private-note",
            global_note="private-global", prompt_json={"private":"prompt"}, generation_metadata_json={"internal":"metadata"})
        db.add(version)
        db.flush()
        db.add(models.TtsAsset(storytelling_version_id=version.id, voice_id="test", audio_path="internal-file", provider_metadata={"internal":True}))
        versions.append(version)
    artwork.current_storytelling_version_id = versions[0].id
    db.commit()
    response = client.get(f"/api/v1/public/storytelling/artworks/{artwork.id}/current")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["currentVersion"]["storyText"] == "Public story"
    assert payload["currentVersion"]["promptJson"] == {}
    assert payload["currentVersion"]["requestNote"] is None
    assert len(payload["ttsAssets"]) == 1
    assert payload["ttsAssets"][0]["audioPath"] is None
    assert payload["ttsAssets"][0]["providerMetadata"] is None


def test_curator_logs_scoped(client, db):
    first, second = make_user(db,"paid_curator"), make_user(db,"paid_curator")
    db.add_all([models.CurationLog(user_id=first.id,recommended_ids=[1]), models.CurationLog(user_id=second.id,recommended_ids=[2])])
    db.commit()
    response = client.get("/api/v1/curation/logs", headers=headers(first,"paid_curator"))
    assert response.status_code == 200
    assert [row["user_id"] for row in response.json()["data"]] == [first.id]


@pytest.mark.parametrize("relative", ["../outside", ".", "sub/../../outside"])
def test_storage_escape_blocked(tmp_path, relative):
    with pytest.raises(HTTPException):
        contained_path(tmp_path, relative)


def test_limiter_bounded():
    limiter = RateLimiter(max_keys=2)
    for key in range(10):
        limiter.check(key, 1)
    assert len(limiter.buckets) == 2
    with pytest.raises(HTTPException):
        limiter.check(9, 1)


def test_diagnostics_require_admin(client):
    assert client.get("/api/v1/recommendation/features/status").status_code == 401
    assert client.get("/api/v1/recommendation/debug-results").status_code == 401


def test_private_asset_direct_url_denied(client):
    assert client.get("/assets/curator-space-files/1/private.glb").status_code == 404
    assert client.get("/assets/tts/private.mp3").status_code == 404
    assert client.get("/assets/.env").status_code == 404


def test_validation_never_echoes_password(client):
    marker = secrets.token_hex(10)
    response = client.post("/api/v1/auth/login", json={"identifier":"writer", "password":{"secret":marker}})
    assert response.status_code == 422
    assert marker not in response.text


def test_oversize_json_rejected(client):
    response = client.post("/api/v1/auth/login", content=b"x" * (1024 * 1024 + 1), headers={"Content-Type":"application/json"})
    assert response.status_code == 413


def test_chunked_oversize_json_rejected(client):
    response = client.post("/api/v1/auth/login", content=iter([b"x" * 600000, b"y" * 600000]), headers={"Content-Type":"application/json"})
    assert response.status_code == 413


@pytest.mark.parametrize("raw", [b'{}', b'{"asset":{"version":"2.0"},"buffers":[{"uri":"https://example.test/steal"}]}', b'{"asset":{"version":"2.0"},"images":[{"uri":"../private.png"}]}'])
def test_external_model_resources_rejected(raw):
    with pytest.raises(HTTPException):
        validate_model_upload(raw, ".gltf")


def test_self_contained_model_accepted():
    validate_model_upload(b'{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AA=="}]}', ".gltf")


def test_arbitrary_file_not_accepted_as_glb():
    with pytest.raises(HTTPException):
        validate_model_upload(b"<html>not a model</html>", ".glb")


def test_private_model_owner_and_publication(client, db):
    owner = make_user(db, "paid_curator")
    other = make_user(db, "paid_curator")
    space = models.CuratorSpace(owner_user_id=owner.id, name="Private room", status="draft")
    db.add(space)
    db.commit()
    response = client.post(f"/api/v1/curator/spaces/{space.id}/files", headers=headers(owner,"paid_curator"),
        files={"file":("room.gltf", b'{"asset":{"version":"2.0"}}', "model/gltf+json")})
    assert response.status_code == 200, response.text
    url = response.json()["fileUrl"]
    assert client.get(url).status_code == 404
    assert client.get(url, headers=headers(other,"paid_curator")).status_code == 404
    assert client.get(url, headers=headers(owner,"paid_curator")).status_code == 200
    assert client.get(url.replace("curator-space-files", "CURATOR-SPACE-FILES")).status_code == 404
    space.status = "published"
    db.commit()
    assert client.get(url).status_code == 200


def test_owner_story_generation_still_saves(client, db, monkeypatch):
    owner = make_user(db)
    artwork = models.Artwork(owner_user_id=owner.id, title="Test", asset_folder_name="test")
    db.add(artwork)
    db.commit()
    monkeypatch.setattr(main, "generate_storytelling_artifact", lambda *args, **kwargs: SimpleNamespace(
        story_title="Test story", story_text="Generated text", prompt_json={}, generation_metadata_json={},
        provider_name="test", model_name="test"))
    response = client.post("/api/v1/storytelling/generate", headers=headers(owner,"writer"), json={"artworkIds":[artwork.id]})
    assert response.status_code == 200, response.text
    version = db.query(models.ArtworkStorytellingVersion).one()
    assert version.story_text == "Generated text" and version.status == "published"
    assert artwork.current_storytelling_version_id == version.id


def test_public_artwork_list_does_not_expose_owner_id(client, db):
    owner = make_user(db)
    artwork = models.Artwork(owner_user_id=owner.id, title="Public", asset_folder_name="public")
    db.add(artwork)
    db.commit()

    response = client.get("/api/v1/artworks?limit=5000")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["title"] == "Public"
    assert "owner_user_id" not in payload["data"][0]


def test_public_content_seed_imports_only_sanitized_fields(db, tmp_path):
    owner = make_user(db)
    audio_path = tmp_path / "assets" / "tts" / "storytelling_version_10" / "sample.mp3"
    audio_path.parent.mkdir(parents=True)
    audio_path.write_bytes(b"ID3-public-audio")
    seed_path = tmp_path / "public-content.json"
    seed_path.write_text(
        """{
          "schemaVersion": 1,
          "artworks": [{
            "id": 7, "title": "Public work", "artist": "Artist",
            "assetFolderName": "public-work", "isPublicDomain": true,
            "currentStorytellingVersionId": 10
          }],
          "stories": [{
            "id": 10, "artworkId": 7, "versionNumber": 1,
            "storyTitle": "Public story", "storyText": "Safe published text."
          }],
          "ttsAssets": [{
            "storytellingVersionId": 10, "voiceId": "voice",
            "audioPath": "tts/storytelling_version_10/sample.mp3",
            "audioSizeBytes": 16
          }]
        }""",
        encoding="utf-8",
    )

    counts = public_seed.seed_public_content(db, owner.id, tmp_path / "assets", seed_path)
    assert counts == {"artworks": 1, "stories": 1, "tts": 1}
    artwork = db.get(models.Artwork, 7)
    version = db.get(models.ArtworkStorytellingVersion, 10)
    tts = db.query(models.TtsAsset).filter_by(storytelling_version_id=10).one()
    assert artwork.current_storytelling_version_id == version.id
    assert version.prompt_json == {}
    assert version.request_note is None and version.generation_metadata_json is None
    assert tts.trace_id is None and tts.provider_metadata is None
    assert tts.audio_url == "/assets/tts/storytelling_version_10/sample.mp3"


def test_bundled_public_content_seed_matches_bundled_audio(db):
    owner = make_user(db)
    counts = public_seed.seed_public_content(
        db,
        owner.id,
        BACKEND / "local_assets",
        BACKEND / "data" / "public_content_seed.json",
    )
    assert counts == {"artworks": 53, "stories": 108, "tts": 50}
    assert db.query(models.Artwork).count() == 53
    assert db.query(models.ArtworkStorytellingVersion).count() == 108
    assert db.query(models.TtsAsset).count() == 50
    assert all(row.prompt_json == {} for row in db.query(models.ArtworkStorytellingVersion).all())


def test_startup_from_empty_database(db, monkeypatch):
    monkeypatch.setattr(main, "engine", db.get_bind())
    monkeypatch.setenv("LOAD_DEMO_DATA", "false")
    with TestClient(main.app) as running:
        response = running.get("/health")
        assert response.status_code == 200
        assert response.json()["startup"]["ready"] is True
    assert db.query(models.User).count() == 0
