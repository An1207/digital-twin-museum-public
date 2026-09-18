# Security

Report security issues privately to the repository maintainer. Do not post real
credentials, tokens, databases or personal data in public issues.

This is a reviewed source snapshot, not a guarantee that every vulnerability has
been eliminated. Compose is deliberately localhost-only. Before public hosting:

- Use HTTPS and a trusted gateway with shared rate limits, request size limits,
  account approval and provider spending caps. The process-local limiter resets on
  restart and is not a durable or distributed quota system.
- Keep JWT/provider secrets outside Git and images. Rotate previously deployed
  default credentials/signing keys and invalidate old sessions.
- Provision curator/admin roles deliberately. Public registration cannot grant
  curator access. Only owners/admins manage stories; public responses omit prompts,
  author notes and provider diagnostics.
- Keep databases and backups outside static directories. Artwork images and
  generated exhibition models remain public museum assets by design: do not upload
  confidential images. Private curator files and unpublished TTS require access
  checks. Private model previews use same-origin bearer authentication.
- GLB/glTF uploads must be self-contained. External resource URIs are rejected so
  authenticated loaders cannot forward tokens to third-party resources.
- Browser tokens still use localStorage. Harden CSP and avoid untrusted scripts;
  migrate to HttpOnly cookies with CSRF protection for production use.
- Font/model/audio assets are included at the repository owner's direction. Review
  redistribution rights independently; public visibility is not a license grant.
- Re-run dependency/container scans before deployment. Docker/Blender, paid API
  calls and full GPU inference are outside the source review's runtime checks.

The original private repository remains unchanged and retains its original risks.
This snapshot does not patch a previously running service automatically.
