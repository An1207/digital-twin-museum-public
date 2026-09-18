FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    blender \
    ca-certificates \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    # numpy for Blender's system Python (glTF-2.0 exporter addon dependency).
    # The apt Blender links against the system python3 (e.g. 3.13), which is
    # separate from the python:3.11 interpreter used by the FastAPI app.
    # python3-numpy installs to /usr/lib/python3/dist-packages/ — accessible
    # to all system python3.x versions including the one Blender uses.
    python3-numpy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/requirements.txt /tmp/requirements.txt
RUN grep -vE '^torch([<>=].*)?$' /tmp/requirements.txt > /tmp/requirements.docker.txt \
    && pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.0 \
    && pip install -r /tmp/requirements.docker.txt

COPY backend /app/backend
COPY database /seed/database
COPY backend/local_assets /seed/assets
RUN mkdir -p /runtime/sqlite
COPY deploy/backend-entrypoint.sh /app/deploy/backend-entrypoint.sh

RUN chmod +x /app/deploy/backend-entrypoint.sh

ENV DATABASE_URL=sqlite:////runtime/sqlite/local_3dgs.db \
    ASSET_ROOT=/runtime/assets \
    IMAGE_ROOT=/runtime/database/images \
    MANIFEST_ROOT=/runtime/database/metadata/manifests \
    STARTUP_STATUS_FILE=/runtime/startup-status.json \
    PYTHONPATH=/app/backend

EXPOSE 8000

ENTRYPOINT ["/app/deploy/backend-entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
