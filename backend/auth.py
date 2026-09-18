from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db


AUTH_BEARER = HTTPBearer(auto_error=False)
PASSWORD_HASH_ITERATIONS = 210_000
PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
if len(JWT_SECRET.encode("utf-8")) < 32 or JWT_SECRET == "dev-only-secret-change-me":
    raise RuntimeError("Set JWT_SECRET to a random secret of at least 32 bytes before starting.")
ACCESS_TOKEN_TTL_SECONDS = int(os.getenv("ACCESS_TOKEN_TTL_SECONDS", "900"))
REFRESH_TOKEN_TTL_SECONDS = int(os.getenv("REFRESH_TOKEN_TTL_SECONDS", "604800"))

DEFAULT_SEED_USERS = [
    {
        "username": "admin",
        "email": os.getenv("AUTH_ADMIN_EMAIL", "admin@digital-twin.local"),
        "password": os.getenv("AUTH_ADMIN_PASSWORD", ""),
        "display_name": os.getenv("AUTH_ADMIN_DISPLAY_NAME", "관리자"),
        "role_key": "admin",
        "plan_status": "active",
    },
    {
        "username": "curator_1",
        "email": os.getenv("AUTH_CURATOR_EMAIL", "curator_1@digital-twin.local"),
        "password": os.getenv("AUTH_CURATOR_PASSWORD", ""),
        "display_name": os.getenv("AUTH_CURATOR_DISPLAY_NAME", "큐레이터 1"),
        "role_key": "paid_curator",
        "plan_status": "active",
    },
    {
        "username": "visitor",
        "email": os.getenv("AUTH_VISITOR_EMAIL", "visitor@digital-twin.local"),
        "password": os.getenv("AUTH_VISITOR_PASSWORD", ""),
        "display_name": os.getenv("AUTH_VISITOR_DISPLAY_NAME", "관람객"),
        "role_key": "visitor",
        "plan_status": "inactive",
    },
    {
        "username": "writer_1",
        "email": os.getenv("AUTH_WRITER_EMAIL", "writer_1@digital-twin.local"),
        "password": os.getenv("AUTH_WRITER_PASSWORD", ""),
        "display_name": os.getenv("AUTH_WRITER_DISPLAY_NAME", "작가 1"),
        "role_key": "writer",
        "plan_status": "inactive",
    },
]


@dataclass(frozen=True)
class AuthPrincipal:
    user_id: int
    email: str
    display_name: str
    roles: list[str]

    @property
    def primary_role(self) -> str:
        if "admin" in self.roles:
            return "admin"
        if "paid_curator" in self.roles:
            return "paid_curator"
        if "writer" in self.roles:
            return "writer"
        return self.roles[0] if self.roles else "visitor"


def _get_user_roles(db: Session, user_id: int) -> list[str]:
    return [
        row[0]
        for row in (
            db.query(models.Role.role_key)
            .join(models.UserRole, models.UserRole.role_id == models.Role.id)
            .filter(models.UserRole.user_id == user_id)
            .order_by(models.Role.role_key.asc())
            .all()
        )
    ]


def get_user_by_email(db: Session, email: str) -> models.User | None:
    normalized_email = email.strip().lower()
    return db.query(models.User).filter(models.User.email == normalized_email).first()


def get_user_by_username(db: Session, username: str) -> models.User | None:
    normalized_username = username.strip().lower()
    return db.query(models.User).filter(models.User.username == normalized_username).first()


def get_user_by_identifier(db: Session, identifier: str) -> models.User | None:
    normalized_identifier = identifier.strip().lower()
    if not normalized_identifier:
        return None

    return (
        db.query(models.User)
        .filter(
            (models.User.username == normalized_identifier)
            | (models.User.email == normalized_identifier)
        )
        .first()
    )


def normalize_username(value: str) -> str:
    normalized = value.strip().lower()
    normalized = normalized.replace(" ", "_")
    return normalized


def _base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _base64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _json_dumps(data: dict) -> bytes:
    return json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )
    return "|".join(
        [
            PASSWORD_HASH_ALGORITHM,
            str(PASSWORD_HASH_ITERATIONS),
            _base64url_encode(salt),
            _base64url_encode(digest),
        ]
    )


def verify_password(password: str, hashed: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = hashed.split("|", 3)
    except ValueError:
        return False

    if algorithm != PASSWORD_HASH_ALGORITHM:
        return False

    iterations = int(iteration_text)
    salt = _base64url_decode(salt_text)
    expected = _base64url_decode(digest_text)
    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate, expected)


def _sign(payload: dict) -> str:
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    encoded_header = _base64url_encode(_json_dumps(header))
    encoded_payload = _base64url_encode(_json_dumps(payload))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_base64url_encode(signature)}"


def _verify(token: str) -> dict:
    if len(token) > 8192:
        raise HTTPException(status_code=401, detail="Invalid token.")
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
        header = json.loads(_base64url_decode(encoded_header))
        payload = json.loads(_base64url_decode(encoded_payload))
        signature = _base64url_decode(encoded_signature)
        if not isinstance(header, dict) or header.get("alg") != JWT_ALGORITHM or header.get("typ") != "JWT":
            raise ValueError("Invalid header")
        if not isinstance(payload, dict):
            raise ValueError("Invalid payload")
        if int(payload.get("sub", "0")) <= 0:
            raise ValueError("Invalid subject")
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    except (ValueError, TypeError, UnicodeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc

    expected_signature = hmac.new(
        JWT_SECRET.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected_signature, signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    exp = payload.get("exp")
    if type(exp) is not int or exp <= int(_now_utc().timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired.")

    return payload


def create_access_token(user_id: int, roles: Iterable[str]) -> str:
    now = int(_now_utc().timestamp())
    payload = {
        "sub": str(user_id),
        "roles": list(roles),
        "token_type": "access",
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL_SECONDS,
        "jti": secrets.token_urlsafe(16),
    }
    return _sign(payload)


def create_refresh_token(user_id: int) -> tuple[str, str]:
    now = int(_now_utc().timestamp())
    payload = {
        "sub": str(user_id),
        "token_type": "refresh",
        "iat": now,
        "exp": now + REFRESH_TOKEN_TTL_SECONDS,
        "jti": secrets.token_urlsafe(16),
    }
    signed = _sign(payload)
    return signed, payload["jti"]


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(AUTH_BEARER),
    db: Session = Depends(get_db),
) -> AuthPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    payload = _verify(credentials.credentials)
    if payload.get("token_type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type.")

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject.") from exc

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None or user.status != "active" or getattr(user, "deleted_at", None) is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is inactive.")

    roles = _get_user_roles(db, user_id)
    return AuthPrincipal(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=roles or ["visitor"],
    )


def get_current_principal_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(AUTH_BEARER),
    db: Session = Depends(get_db),
) -> AuthPrincipal | None:
    if credentials is None:
        return None
    return get_current_principal(credentials, db)


def require_roles(*allowed_roles: str):
    def dependency(principal: AuthPrincipal = Depends(get_current_principal)) -> AuthPrincipal:
        if "admin" in principal.roles:
            return principal
        if not any(role in principal.roles for role in allowed_roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this resource.")
        return principal

    return dependency


def verify_refresh_token(token: str, db: Session) -> tuple[models.AuthRefreshToken, dict]:
    payload = _verify(token)
    if payload.get("token_type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type.")

    token_hash = hash_refresh_token(token)
    record = (
        db.query(models.AuthRefreshToken)
        .filter(models.AuthRefreshToken.token_hash == token_hash)
        .first()
    )
    if record is None or record.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is revoked.")

    if record.expires_at and record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token has expired.")

    return record, payload


def seed_auth_users(db: Session) -> None:
    legacy_roles = [
        db.query(models.Role).filter(models.Role.role_key == "artist").first(),
        db.query(models.Role).filter(models.Role.role_key == "writer_1").first(),
    ]
    writer_role = db.query(models.Role).filter(models.Role.role_key == "writer").first()
    for legacy_role in legacy_roles:
        if legacy_role is None:
            continue
        if writer_role is not None:
            legacy_user_roles = (
                db.query(models.UserRole)
                .filter(models.UserRole.role_id == legacy_role.id)
                .order_by(models.UserRole.id.asc())
                .all()
            )
            for user_role in legacy_user_roles:
                already_has_writer_role = (
                    db.query(models.UserRole)
                    .filter(models.UserRole.user_id == user_role.user_id)
                    .filter(models.UserRole.role_id == writer_role.id)
                    .first()
                )
                if already_has_writer_role is None:
                    user_role.role_id = writer_role.id
                else:
                    db.delete(user_role)
            db.delete(legacy_role)
        else:
            legacy_role.role_key = "writer"
            writer_role = legacy_role

    db.flush()

    roles = {
        "admin": None,
        "paid_curator": None,
        "visitor": None,
        "writer": None,
    }
    for role_key in roles:
        if role_key == "writer" and writer_role is not None:
            roles[role_key] = writer_role
            continue
        role = db.query(models.Role).filter(models.Role.role_key == role_key).first()
        if role is None:
            role = models.Role(role_key=role_key, description=f"Seed role {role_key}")
            db.add(role)
            db.flush()
        roles[role_key] = role

    for seed in DEFAULT_SEED_USERS if os.getenv("AUTH_SEED_USERS", "false").lower() == "true" else []:
        if not seed["password"]:
            continue
        if len(seed["password"]) < 12:
            raise RuntimeError("Seed passwords must be at least 12 characters.")
        normalized_username = normalize_username(seed["username"])
        normalized_email = seed["email"].strip().lower()
        user = get_user_by_email(db, normalized_email) or get_user_by_username(db, normalized_username)
        if user is None:
            user = models.User(
                username=normalized_username,
                email=normalized_email,
                password_hash=hash_password(seed["password"]),
                display_name=seed["display_name"],
                status="active",
            )
            db.add(user)
            db.flush()
        else:
            # Startup must not reset credentials, reactivate users, or grant roles.
            continue

        role = roles[seed["role_key"]]
        existing_user_role = (
            db.query(models.UserRole)
            .filter(models.UserRole.user_id == user.id)
            .filter(models.UserRole.role_id == role.id)
            .first()
        )
        if existing_user_role is None:
            db.add(models.UserRole(user_id=user.id, role_id=role.id))

        if seed["role_key"] in {"admin", "paid_curator"}:
            profile = (
                db.query(models.CuratorProfile)
                .filter(models.CuratorProfile.user_id == user.id)
                .first()
            )
            if profile is None:
                db.add(
                    models.CuratorProfile(
                        user_id=user.id,
                        plan_status=seed["plan_status"],
                        plan_key="seed-local",
                        quota_story_generations_monthly=9999,
                        quota_tts_generations_monthly=9999,
                    )
                )
            else:
                profile.plan_status = seed["plan_status"]
                profile.plan_key = profile.plan_key or "seed-local"
                profile.quota_story_generations_monthly = max(profile.quota_story_generations_monthly, 9999)
                profile.quota_tts_generations_monthly = max(profile.quota_tts_generations_monthly, 9999)

    db.commit()
