# API Versioning and Hardening

## Canonical API Path

The canonical API base path is:

```text
/api/v1
```

The legacy `/api` base path is kept as a compatibility alias for older clients. Legacy responses include:

- `Deprecation: true`
- `Sunset: <LEGACY_API_SUNSET_DATE>`
- `Link: </api/v1>; rel="successor-version"`

New clients should use `/api/v1` only.

## Versioning Rules

- Do not introduce breaking changes inside an existing API version.
- Additive fields are allowed in the current version.
- Removing fields, changing response shapes, changing auth behavior, or changing validation semantics requires a new version.
- Keep old versions mounted until the published sunset date.
- Add new route groups under the versioned router first, then expose compatibility aliases only when needed.

## Current Hardening Controls

- Version headers on every API response.
- Configurable JSON body size limit.
- Configurable request/response timeout.
- Configurable CORS allow-list in production.
- Global API rate limit.
- Stricter login rate limit.
- Failed-login counters and temporary account lockout.
- Auth audit records for known-user login, logout, and failed login attempts.
- JSON 404 responses for unknown API paths.
- Clean JSON errors for malformed or oversized request bodies.

## Important Environment Variables

```text
API_VERSION=v1
LEGACY_API_SUNSET_DATE=2026-10-01
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
JSON_BODY_LIMIT=1mb
REQUEST_TIMEOUT_MS=30000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=200
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX_REQUESTS=20
MAX_FAILED_LOGIN_ATTEMPTS=5
ACCOUNT_LOCKOUT_MINUTES=15
TRUST_PROXY=1
```
