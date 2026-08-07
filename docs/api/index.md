# REST API documentation

## Contract

The canonical machine-readable contract is [OpenAPI 3.1](openapi.yaml). The backend runtime copy is `backend/docs/api/openapi.yaml`; documentation validation requires the two files to be byte-for-byte identical.

Canonical base URL:

```text
<origin>/api/v1
```

The same application router remains mounted at `<origin>/api` for legacy clients. Legacy responses include deprecation/sunset/link headers. Health endpoints (`/health/live`, `/health/ready`) and optional protected Swagger UI (`API_DOCS_PATH`, default `/docs`) are origin-level routes outside the OpenAPI server base.

### Origin-level and compatibility routes

| Method | Route | Purpose and constraints |
| --- | --- | --- |
| GET | `/` | Process/API discovery response with current and legacy base paths |
| GET | `/api` | Legacy API index with deprecation metadata |
| GET | `/api/v1` | Canonical version index; represented as `/` under the OpenAPI server base |
| GET | `/health/live` | Process liveness only |
| GET | `/health/ready` | MongoDB, Firebase, worker, and required-configuration readiness; returns 503 when not ready |
| GET/HEAD | `<API_DOCS_PATH>/` | Optional, read-only Swagger UI when `API_DOCS_ENABLED=true`; Basic authentication is mandatory in production |
| GET/HEAD | `<API_DOCS_PATH>/openapi.yaml` | Optional served contract with the same documentation access controls |
| All canonical methods | `/api/*` | Legacy alias for the `/api/v1/*` router; sunset headers apply and unmatched legacy routes return a migration-oriented 404 |

The machine-readable contract and parity count intentionally cover the canonical `/api/v1` surface once. They do not duplicate the legacy alias or mix origin-level operational endpoints into the `/api/v1` server base.

## Operation coverage

| Group | Implemented routed operations |
| --- | ---: |
| Authentication | 14 |
| Device tokens | 2 |
| Doctor | 20 |
| Patient | 19 |
| Administration | 52 |
| Statistics | 5 |
| Payment webhook | 1 |
| API version index | 1 |
| **Canonical OpenAPI total** | **114** |

The validator extracts Express method/path pairs, including chained `router.route` calls and `registerAdminRoute` declarations, normalizes `:param` to OpenAPI `{param}`, adds the version-index route, and requires exact equality with OpenAPI operations.

## Authentication

Most operations use:

```http
Authorization: Bearer <access-token>
```

Public/session-establishment operations explicitly override global OpenAPI security: login, OTP/TOTP verification and enrollment, refresh/revoke, SSE stream GETs using a ticket, and the HMAC-authenticated payment webhook. The stream-ticket POST is bearer-authenticated; the following EventSource GET uses `?ticket=` when it cannot send a header.

## Response envelope

Most controllers use:

```json
{
  "statusCode": 200,
  "message": "Human-readable result",
  "data": {},
  "success": true
}
```

Authentication and direct middleware failures can return the compatible subset `{ "success": false, "message": "..." }`. Pagination-bearing endpoints may expose pagination alongside or inside the data envelope as described per operation.

Every Express response receives `X-Request-Id`. Versioned responses receive `X-API-Version` and `X-API-Supported-Versions`. Rate-limited responses include standard limit/reset/retry headers.

## Content types

- Normal REST payloads use JSON.
- Patient report and patient/doctor profile-image endpoints use `multipart/form-data` with one `file` field.
- Notification streams return `text/event-stream`.
- The served specification returns YAML.

## Upload limits

| Endpoint class | Maximum | Declared MIME allowlist |
| --- | ---: | --- |
| INR report | 10 MiB | PDF, PNG, JPEG/JPG |
| Profile image | 5 MiB | PNG, JPEG/JPG, WEBP |

The server also performs byte-level detection and may require an external malware scanner when enabled. A declared MIME match alone is not sufficient for acceptance.

## Compatibility and retired operations

- `PUT /admin/roles/{roleKey}` is retained to return `410 Gone`; use `/admin/role-policies`.
- `/admin/users` is a compatibility administrator-account surface; V2 `/admin/admin-accounts` is preferred.
- `/admin/legacy/*` provides explicit legacy read projections.
- Patient route `op_num` values resolve through `User.login_id`; they are not `PatientProfile._id`.

## Source and validation

- Route mounts: `backend/src/app.ts` and `backend/src/routes/index.ts`.
- Request schemas: `backend/src/validators/`.
- Response behavior: `backend/src/controllers/`, services, and `ApiResponse`/error middleware.
- Contract lint: `npm run lint:openapi` from `backend/`.
- Exact route comparison: `python scripts/docs/validate_docs.py` from the repository root.
