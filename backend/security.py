"""Small process-local safeguards; use a shared gateway limiter for multi-worker deployments."""
from collections import OrderedDict, deque
from pathlib import Path
from threading import Lock
from time import monotonic
import asyncio
import json
import struct
from tempfile import SpooledTemporaryFile

from fastapi import HTTPException
from starlette.responses import JSONResponse


class RateLimiter:
    def __init__(self, max_keys=10000):
        self.buckets = OrderedDict()
        self.lock = Lock()
        self.max_keys = max_keys

    def check(self, key, limit, window=60):
        now = monotonic()
        with self.lock:
            bucket = self.buckets.setdefault(key, deque())
            self.buckets.move_to_end(key)
            while bucket and bucket[0] <= now - window:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(status_code=429, detail="Too many requests. Try again later.", headers={"Retry-After": str(window)})
            bucket.append(now)
            while len(self.buckets) > self.max_keys:
                self.buckets.popitem(last=False)


rate_limiter = RateLimiter()


def validate_model_upload(raw: bytes, suffix: str) -> None:
    try:
        if suffix == ".glb":
            if len(raw) < 20:
                raise ValueError("Truncated GLB")
            magic, version, length, json_length, chunk_type = struct.unpack_from("<4sIIII", raw)
            if magic != b"glTF" or version != 2 or length != len(raw) or chunk_type != 0x4E4F534A or json_length > len(raw) - 20:
                raise ValueError("Invalid GLB")
            payload = json.loads(raw[20:20 + json_length])
        else:
            payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("asset", {}).get("version") != "2.0":
            raise ValueError("Invalid glTF")
        pending = [payload]
        while pending:
            value = pending.pop()
            if isinstance(value, dict):
                for key, child in value.items():
                    # Authenticated loaders must never forward credentials to external resources.
                    if key == "uri" and (not isinstance(child, str) or not child.startswith("data:")):
                        raise ValueError("External resources are not permitted")
                    pending.append(child)
            elif isinstance(value, list):
                pending.extend(value)
    except (ValueError, TypeError, AttributeError, RecursionError, UnicodeError, struct.error) as exc:
        raise HTTPException(status_code=400, detail="Upload a valid self-contained GLB or glTF 2.0 file.") from exc


def contained_path(root: Path, relative: str) -> Path:
    root = root.resolve()
    target = (root / relative).resolve()
    if target == root or not target.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Invalid storage path.")
    return target


class RequestLimits:
    """Bound chunked and Content-Length bodies before multipart parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        multipart = headers.get(b"content-type", b"").lower().startswith(b"multipart/form-data")
        limit = 52 * 1024 * 1024 if multipart else 1024 * 1024
        try:
            client = scope.get("client") or ("unknown", 0)
            rate_limiter.check(("write", client[0]), 60)
            try:
                declared = int(headers.get(b"content-length", b"0"))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid Content-Length.")
            if declared < 0 or declared > limit:
                raise HTTPException(status_code=413, detail="Request body too large.")
            with SpooledTemporaryFile(max_size=1024 * 1024) as body:
                total, started = 0, monotonic()
                while True:
                    remaining = 60 - (monotonic() - started)
                    if remaining <= 0:
                        raise HTTPException(status_code=408, detail="Upload timed out.")
                    try:
                        message = await asyncio.wait_for(receive(), timeout=min(15, remaining))
                    except asyncio.TimeoutError:
                        raise HTTPException(status_code=408, detail="Upload timed out.")
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(status_code=413, detail="Request body too large.")
                    body.write(chunk)
                    if not message.get("more_body", False):
                        break
                body.seek(0)
                finished = False

                async def replay():
                    nonlocal finished
                    if finished:
                        return await receive()
                    chunk = body.read(65536)
                    finished = body.tell() >= total
                    return {"type":"http.request", "body":chunk, "more_body":not finished}

                return await self.app(scope, replay, send)
        except HTTPException as exc:
            response = JSONResponse({"detail": {"message":exc.detail}}, status_code=exc.status_code, headers=exc.headers)
            await response(scope, receive, send)
