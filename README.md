# Digital Twin Museum - Public Snapshot

React/Three.js museum viewer with a FastAPI backend, artwork management,
storytelling versions and optional CLIP/OpenAI/TTS integrations.

Independent, security-hardened source snapshot of Digital Twin Museum at
`711e7b3f277d8c3a752049fbc828d1f8b8712b6b`. Original contributor attribution is
retained; this snapshot makes no new license or ownership claim. The original
repository, history and visibility were not changed.

## Local development

Requires Docker Desktop with Compose, or Python 3.12 and Node.js 22.12+.

1. Copy `.env.example` to `.env` locally.
2. Generate a signing key with `python -c "import secrets; print(secrets.token_hex(32))"`
   and set `JWT_SECRET` in `.env`. Never commit it.
3. For initial administrator provisioning, set `AUTH_SEED_USERS=true` and
   `AUTH_ADMIN_PASSWORD` to a unique password of at least 12 characters. Set other
   seed passwords only for accounts you need. Empty passwords create no account.
4. Run `docker compose -f docker-compose.dev.yml up -d --build`.
5. After provisioning, set `AUTH_SEED_USERS=false`. Existing passwords and roles
   are not reset on restart. Writer/visitor accounts can register through the UI.

Frontend: <http://localhost:3000>. Backend: <http://localhost:8000/health>.
Ports bind to loopback. Compose is for local development, not Internet hosting.
Keep `PUBLIC_BASE_URL` empty for the frontend's same-origin asset proxy.
Curator self-registration is disabled; an administrator must provision access.

No production database, login sessions, `.env`, internal notes, exports,
uploaded images, generated speech or previous Git history are included. Bring
authorized assets; see [ASSETS.md](ASSETS.md). Startup creates an empty SQLite
schema. Legacy demo artworks require `LOAD_DEMO_DATA=true` and an explicitly provisioned writer.

External generation requires your own provider configuration and may incur charges.
Never place provider keys in `VITE_*` variables or client source.

## Verification

```bash
cd frontend
npm ci
npm run build
npm audit
```

```bash
python -m pip install -r backend/requirements.txt pytest httpx pip-audit
python -m pytest backend/tests -q
python -m pip_audit
```

Backend direct dependencies and frontend dependencies are pinned/locked to reviewed
versions. Also audit transitive Python dependencies on the deployment platform;
Windows checks do not certify Linux container packages. See [SECURITY.md](SECURITY.md)
and [the security review](docs/security-review.md) for scope and limitations.
