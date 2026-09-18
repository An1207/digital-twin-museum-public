# Public Snapshot Security Review

Review target: source snapshot at commit
`711e7b3f277d8c3a752049fbc828d1f8b8712b6b`.

This document records the main risks found while preparing a separate public
repository. It is not a penetration-test report or a guarantee of security.

## Changes made

- Removed default and startup-reset credentials. JWT signing now requires a
  non-default secret of at least 32 bytes, and account seeding is opt-in.
- Disabled curator self-registration and tightened owner/admin checks on
  storytelling, room-merge, diagnostics and curation-log endpoints.
- Replaced unrestricted private-asset serving with authorization-aware access
  for curator-space files and unpublished TTS assets.
- Added upload size, model-format, path-containment and request-rate checks.
  glTF uploads must be self-contained and cannot reference external resources.
- Removed private prompt context, provider metadata, filesystem paths and
  unpublished versions from public storytelling responses.
- Disabled demo data by default and removed production databases, environment
  files, account data, internal prompts, exports, internal documents and old Git
  history. Published stories and pre-generated media are imported from an
  allowlisted seed that contains no authentication or provider credentials.
- Updated and pinned frontend/backend dependencies. Automated dependency and
  secret scanning is configured for the public repository.

## Verification performed

- Backend security and startup tests on a new empty database.
- Production frontend TypeScript/Vite build and `npm audit`.
- Python dependency import checks, `pip check` and `pip-audit`.
- Gitleaks scan of the public snapshot before publication.

## Residual risks

- The included rate limiter is per process. Internet deployments need a shared
  gateway or datastore-backed limiter, TLS, request limits and monitoring.
- Browser access tokens remain in local storage. A hardened production design
  should use short-lived tokens and secure, HttpOnly session cookies where
  practical, together with a reviewed CSP.
- The application has no confidential-artwork draft workflow. Do not place
  private images in the public image root.
- External OpenAI, TTS, object-storage, Blender and production database paths
  require separate integration and threat-model testing.
- Asset manifests are provenance hints, not a license grant. Confirm rights for
  every image and model before distribution.
- The original private repository and any deployments made from it are not
  changed by this snapshot. Rotate any credential that may have been exposed
  outside version control and patch running services independently.

Report suspected vulnerabilities privately as described in
[`SECURITY.md`](../SECURITY.md).
