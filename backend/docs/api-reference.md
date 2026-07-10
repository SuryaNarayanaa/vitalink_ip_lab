# VitaLink API Reference

Last updated: 2026-07-05

## Purpose

This document describes the currently implemented VitaLink backend API in a professional integration-ready format. It covers versioning, authentication, security expectations, common response patterns, pagination, file upload behavior, Server-Sent Events, and the implemented route surface.

This is a human-readable reference for the API that exists today. It complements, but does not replace, a future OpenAPI specification.

## Base URLs and Versioning

Current API version:

- `/api/v1`

Legacy compatibility base path:

- `/api`

Versioning behavior:

- `/api/v1/*` is the current versioned contract.
- `/api/*` remains available for backward compatibility.
- Legacy responses include deprecation headers and a `Link` header pointing to the successor version.

Relevant response headers:

| Header | Meaning |
|---|---|
| `X-API-Version` | Current API version returned by the server |
| `X-API-Supported-Versions` | Supported version list; currently `v1` |
| `Deprecation` | Present on legacy `/api/*` routes |
| `Sunset` | Legacy API sunset date |
| `Link` | Successor version link for legacy routes |
| `X-Request-Id` | Correlation ID for tracing and support |

## Security Model

### Authentication

- Auth mechanism: Bearer JWT
- Header: `Authorization: Bearer <token>`
- Login returns a JWT and the authenticated user object
- Most API routes require authentication
- Role-based authorization is enforced for `ADMIN`, `DOCTOR`, and `PATIENT`

### Transport and operational expectations

- Use HTTPS only outside local development
- Do not store bearer tokens in insecure client-side storage
- Do not cache presigned file URLs
- Treat `X-Request-Id` as a support and incident correlation value

### Rate limiting

The backend applies:

- a general API rate limiter on `/api/v1/*` and `/api/*`
- a stricter login limiter on `/api/v1/auth/login` and `/api/auth/login`

429 response shape is currently simpler than the standard API envelope:

```json
{
  "success": false,
  "message": "Too many requests from this IP, please try again later"
}
```

or for login:

```json
{
  "success": false,
  "message": "Too many login attempts. Please wait and try again."
}
```

### Login hardening already implemented

- per-user failed login counters
- temporary lockout window via `locked_until`
- audit events for login success, logout, and login failure

## Content Types

Standard JSON endpoints:

- `Content-Type: application/json`

File upload endpoints:

- `Content-Type: multipart/form-data`

Notification streaming endpoints:

- `Content-Type: text/event-stream`

## Common Response Envelope

Most successful and application-error responses use this structure:

```json
{
  "statusCode": 200,
  "data": {},
  "message": "Success",
  "success": true
}
```

Notes:

- `success` is derived from `statusCode < 400`
- `data` may be `null`
- some rate-limit responses and logout responses use a slightly different shape today

## Common Error Semantics

### Validation error

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "data": {
    "errors": [
      { "message": "Password must be at least 8 characters" }
    ]
  },
  "success": false
}
```

### Malformed JSON

```json
{
  "statusCode": 400,
  "message": "Malformed JSON request body",
  "data": null,
  "success": false
}
```

### Invalid object identifier / cast

```json
{
  "statusCode": 400,
  "message": "Invalid value for field",
  "data": {
    "field": "notification_id",
    "value": "bad-value"
  },
  "success": false
}
```

### Unauthorized / forbidden / locked

The API uses the following status classes in implemented flows:

- `401 Unauthorized`: invalid credentials or missing authentication
- `403 Forbidden`: inactive account, CORS rejection, or role/resource denial
- `404 Not Found`: user/profile/notification/report not found
- `409 Conflict`: duplicate login ID or ambiguous duplicate account
- `423 Locked`: login blocked during temporary account lockout
- `429 Too Many Requests`: rate limiter rejection
- `507 Insufficient Storage`: upstream file storage failure

## Date and Identifier Conventions

### Identifiers

- System primary keys are MongoDB `ObjectId`
- Patient-facing and doctor-facing route parameter `op_num` maps to the patient user's `login_id`
- Some admin endpoints accept either a database identifier or login-style identifier internally, but clients should prefer documented route parameters exactly as defined

### Dates

The API currently uses mixed date conventions:

- Some request payloads require `DD-MM-YYYY`
- Some validator paths accept ISO-style date strings
- Responses often serialize MongoDB `Date` fields as ISO timestamps

Integration guidance:

- For endpoints documented below as `DD-MM-YYYY`, send exactly that format
- Treat response timestamps as ISO 8601 unless the field is clearly described as formatted output
- Do not assume one date format across the full API surface yet

## Pagination Contract

Implemented notification pagination returns:

```json
{
  "total": 125,
  "page": 2,
  "limit": 20,
  "pages": 7,
  "hasNext": true,
  "hasPrev": true
}
```

Query conventions:

- `page`: 1-based
- `limit`: capped at 100 on implemented notification endpoints

## File Upload and Download Contract

### Patient INR report upload

- Endpoint: `POST /api/v1/patient/reports`
- Content type: `multipart/form-data`
- Form field for binary file: `file`
- Max size: 10 MB
- Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`

Additional body fields:

- `inr_value`
- `test_date`

Behavior:

- The server verifies PDF, PNG, or JPEG magic bytes and rejects a declared MIME/content mismatch before storage upload
- The server computes SHA-256 and uses a UUID object-key filename with the detected safe extension
- File metadata and tenant/owner scope are persisted in `fileassets`; `inr_history.file_asset_id` references that record
- `inr_history.file_url` temporarily retains the object key for rolling migration compatibility
- Read APIs authorize new files through the active tenant-scoped asset record, then replace the stored key with a presigned download URL
- Records without `file_asset_id` use an isolated legacy fallback after the owning report/profile has already been authorized
- That fallback is allowed only for references created before the immutable `FILE_ASSET_LEGACY_CUTOFF_AT` deployment boundary

### Patient profile picture upload

- Endpoint: `POST /api/v1/patient/profile-pic`
- Max size: 5 MB
- Allowed MIME types: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`

### Doctor profile picture upload

- Endpoint: `POST /api/v1/doctors/profile-pic`
- Max size: 5 MB
- Allowed MIME types: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`

Security notes:

- Presigned URLs are generated at read time
- Clients should not persist presigned URLs as durable identifiers
- File size, route MIME allowlists, byte signatures, and MIME/content agreement are enforced
- Object keys supplied by clients are never used as authorization to generate a signed URL
- Admin create/update APIs do not accept profile-picture object keys; authenticated multipart upload endpoints are the only current write path
- A failed owning-document write triggers object deletion and marks the metadata record deleted; cleanup failures are retained with `FAILED` status

### FileAsset rollout order

`FILE_ASSET_LEGACY_CUTOFF_AT` is mandatory in staging and production and must be a finite ISO timestamp with a timezone. It is not a retention date; it is the coordinated instant after which no key-only application instance may accept an upload.

1. Choose a cutover instant late enough to deploy the FileAsset-capable version and drain every older instance.
2. Configure the same `FILE_ASSET_LEGACY_CUTOFF_AT` value on every new instance before startup.
3. Run `npm run migrate:file-assets` and resolve every dry-run storage/signature/ownership failure.
4. Deploy the new instances, then stop routing traffic to key-only instances before the configured instant.
5. Run `npm run migrate:file-assets -- --execute`, verify created/attached/failure counts, and rerun until no eligible references remain unattached.

If the rollout cannot guarantee that older writers are drained before the planned instant, move the configured cutoff forward consistently before starting the new deployment. Never reuse the example or development default as a production value.

## Server-Sent Events

Implemented SSE endpoints:

- `GET /api/v1/patient/notifications/stream`
- `GET /api/v1/doctors/notifications/stream`

Authentication:

- Bearer token in `Authorization` header, or
- `token` query parameter

Operational guidance:

- Prefer header-based auth where possible
- Treat query-string token usage as a compatibility mechanism
- Reconnect with backoff on connection drops

## Endpoint Reference

Examples below use the versioned base path `/api/v1`. Equivalent legacy `/api/*` routes exist unless otherwise noted.

### Service and API discovery

#### `GET /`

Returns basic service metadata and current API version pointers.

#### `GET /api`

Returns the legacy API index and deprecation metadata.

#### `GET /api/v1`

Returns the current API version index and top-level route groups.

#### `GET /health/live`

Liveness probe.

#### `GET /health/ready`

Readiness probe. Returns `503` if the MongoDB connection is not ready.

## Authentication

### `POST /api/v1/auth/login`

Authenticate a user and create a revocable session with a bearer access token and refresh token.

Request body:

```json
{
  "login_id": "patient001",
  "password": "StrongPassword!1"
}
```

Success response:

```json
{
  "statusCode": 200,
  "message": "User logged in successfully",
  "data": {
    "token": "<jwt>",
    "refresh_token": "<opaque-refresh-token>",
    "session": {
      "session_id": "6890...",
      "refresh_expires_at": "2026-08-06T12:00:00.000Z"
    },
    "user": {
      "_id": "6870...",
      "login_id": "patient001",
      "user_type": "PATIENT",
      "profile_id": {}
    }
  },
  "success": true
}
```

Security notes:

- login ID is trimmed before lookup
- duplicate accounts for the same login ID are treated as a conflict
- locked accounts return `423 Locked`
- patients and doctors with unverified registered phones receive a first-login SMS OTP challenge instead of a token
- admins never use SMS/email OTP; when authenticator-app MFA is enabled, password login returns `202 Accepted` with `auth_status: "TOTP_REQUIRED"` and no token
- in development/test, an un-enrolled admin may log in to bootstrap enrollment; in staging/production, un-enrolled admin login fails closed unless MFA has been provisioned
- refresh tokens are stored only as hashes server-side

### `POST /api/v1/auth/login/totp/verify`

Verify an admin authenticator-app login challenge and issue the normal session payload.

Request body:

```json
{
  "challenge_id": "6890...",
  "code": "<6-digit-code>"
}
```

Notes:

- only admin authenticator-app challenges are accepted
- TOTP codes are rate-limited by challenge attempts and the challenge expires quickly
- a verified challenge cannot be replayed

### `POST /api/v1/auth/refresh`

Rotate a valid refresh token and issue a new access token. The previous access token and refresh token for that session are no longer accepted after a successful refresh.

### `POST /api/v1/auth/revoke`

Revoke the session associated with a refresh token. The endpoint is idempotent and does not disclose whether the refresh token matched a live session.

### `POST /api/v1/auth/admin/mfa/totp/setup`

Authenticated admin endpoint that starts authenticator-app enrollment. The response contains the one-time setup secret and `otpauth_url` for QR-code generation by a future client UI. The stored pending secret is encrypted.

### `POST /api/v1/auth/admin/mfa/totp/activate`

Authenticated admin endpoint that verifies a setup TOTP code and enables authenticator-app MFA for future admin logins.

### `POST /api/v1/auth/logout`

Authenticated logout acknowledgment that revokes the current session.

Notes:

- The current access token is rejected after logout
- Client applications must discard local access and refresh tokens

### `GET /api/v1/auth/me`

Returns the authenticated user with populated profile data.

The sanitized user payload includes password-policy state for clients:

- `must_change_password`
- `password_expired`
- `password_changed_at`
- `password_expires_at`
- `password_policy.expiry_days`
- `password_policy.history_count`

### `POST /api/v1/auth/change-password`

Change the authenticated user password.

Request body:

```json
{
  "current_password": "Current!1",
  "new_password": "NewStrong!2"
}
```

Rules:

- minimum length 8
- must contain uppercase, lowercase, digit, and special character
- new password must differ from current password
- new password cannot match the current password or the configured recent password history

Successful changes clear `must_change_password`, revoke all active sessions for the user, and return the updated password expiry state plus `invalidated_sessions`. Existing access tokens and refresh tokens for that user, including the token used for the change request, are rejected after the success response; clients must discard local tokens and require a fresh login.

## Patient API

### `GET /api/v1/patient/profile`

Returns patient profile data plus doctor update summary.

Response data includes:

- `patient`
- `doctor_updates.unread_count`
- `doctor_updates.latest`

### `PUT /api/v1/patient/profile`

Updates editable patient profile fields.

Supported body sections:

- `demographics`
- `medical_history`
- `medical_config`

Implementation note:

- only a subset of nested `medical_config` fields is currently handled explicitly in the controller

### `GET /api/v1/patient/reports`

Returns patient clinical reporting state:

- `inr_history`
- `health_logs`
- `weekly_dosage`
- `medical_config`

Where an uploaded file exists, the API attempts to replace the stored object key with a presigned download URL.

### `POST /api/v1/patient/reports`

Submit INR result and optional report file.

Multipart fields:

- `file`: optional
- `inr_value`: required
- `test_date`: required

Request rules:

- `test_date` must be `DD-MM-YYYY`
- `inr_value` must parse to a valid number

Behavior:

- critical INR classification is calculated from `SystemConfig` thresholds
- report is appended to embedded `inr_history`

### `GET /api/v1/patient/missed-doses`

Calculates missed doses using:

- `medical_config.therapy_start_date`
- `weekly_dosage`
- `medical_config.taken_doses`

Response data:

- `recent_missed_doses`
- `missed_doses`

### `GET /api/v1/patient/dosage-calendar`

Returns computed dosage calendar data.

Query parameters:

- `months`: optional, range effectively clamped to `1..6`
- `start_date`: optional `DD-MM-YYYY`

Response data:

- `calendar_data`
- `date_range`
- `therapy_start`

### `POST /api/v1/patient/dosage`

Marks a scheduled dose as taken.

Request body:

```json
{
  "date": "05-07-2026"
}
```

Behavior:

- rejects duplicate dose marking for the same calendar date
- appends normalized date to `medical_config.taken_doses`

### `POST /api/v1/patient/health-logs`

Creates or replaces a health log entry by `type`.

Request body:

- `type`
- `description`

Behavior:

- removes any existing log of the same type
- appends a fresh log with current timestamp

### `POST /api/v1/patient/profile-pic`

Uploads patient profile image.

### Doctor updates for patients

#### `GET /api/v1/patient/doctor-updates/summary`

Returns:

- `unread_count`
- `latest`

#### `GET /api/v1/patient/doctor-updates`

Query parameters:

- `unread_only`: optional `true|false`
- `limit`: optional, clamped to `1..100`

Returns doctor-change notifications transformed into a simplified event shape.

#### `PATCH /api/v1/patient/doctor-updates/:event_id/read`

Marks a single doctor update event as read.

#### `PATCH /api/v1/patient/doctor-updates/read-all`

Marks all unread doctor update events as read.

### Patient notifications

#### `GET /api/v1/patient/notifications`

Query parameters:

- `page`
- `limit`
- `is_read`

Response data:

- `notifications`
- `pagination`
- `unread_count`

#### `PATCH /api/v1/patient/notifications/:notification_id/read`

Marks one notification as read.

#### `PATCH /api/v1/patient/notifications/read-all`

Marks all unread notifications as read.

#### `GET /api/v1/patient/notifications/stream`

Opens SSE stream for real-time notification delivery.

## Doctor API

### `GET /api/v1/doctors/profile`

Returns doctor profile and `patients_count`.

Profile image is returned as a presigned URL when available.

### `PUT /api/v1/doctors/profile`

Updates:

- `name`
- `department`
- `contact_number` (10 digits; changing it resets phone verification to `PENDING`)

### `POST /api/v1/doctors/profile-pic`

Uploads doctor profile image.

### `GET /api/v1/doctors/doctors`

Returns all doctors visible to the authenticated doctor flow.

### Patient management by doctor

#### `GET /api/v1/doctors/patients`

Returns the authenticated doctor's patients.

Implementation detail:

- the controller resolves patient `login_id` values and injects them into the returned profile objects

#### `GET /api/v1/doctors/patients/:op_num`

Returns one owned patient by OP number.

#### `POST /api/v1/doctors/patients`

Creates a patient under the authenticated doctor.

Request body fields include:

- `name`
- `op_num`
- `age`
- `gender`
- `contact_no`
- `target_inr_min`
- `target_inr_max`
- `therapy`
- `therapy_start_date`
- `prescription`
- `medical_history`
- `kin_name`
- `kin_relation`
- `kin_contact_number`

Behavior:

- creates `patientprofiles` document
- creates linked `users` record
- initializes patient phone verification as `PENDING`
- currently uses `contact_no` as the initial temporary password

#### `PATCH /api/v1/doctors/patients/:op_num/reassign`

Request body:

```json
{
  "new_doctor_id": "doctor-login-or-id"
}
```

Behavior:

- updates `assigned_doctor_id`
- generates a patient doctor-update notification

#### `PUT /api/v1/doctors/patients/:op_num/dosage`

Updates weekly dosage.

Request body:

```json
{
  "prescription": {
    "monday": 1,
    "tuesday": 1,
    "wednesday": 0,
    "thursday": 1,
    "friday": 1,
    "saturday": 0,
    "sunday": 0
  }
}
```

#### `GET /api/v1/doctors/patients/:op_num/reports`

Returns the patient's embedded `inr_history` with presigned URLs where possible.

#### `GET /api/v1/doctors/patients/:op_num/reports/:report_id`

Returns one report with a presigned file URL.

#### `PUT /api/v1/doctors/patients/:op_num/reports/:report_id`

Updates doctor annotation fields on a report.

Request body:

- `notes`
- `is_critical`

#### `PUT /api/v1/doctors/patients/:op_num/config`

Updates `medical_config.next_review_date`.

Request body:

```json
{
  "date": "05-07-2026"
}
```

#### `PUT /api/v1/doctors/patients/:op_num/instructions`

Updates `medical_config.instructions`.

Request body:

```json
{
  "instructions": [
    "Take medication after dinner",
    "Repeat INR test next week"
  ]
}
```

### Doctor notifications

#### `GET /api/v1/doctors/notifications`

Returns paginated notifications for the authenticated doctor.

#### `PATCH /api/v1/doctors/notifications/:notification_id/read`

Marks one notification as read.

#### `PATCH /api/v1/doctors/notifications/read-all`

Marks all unread notifications as read.

#### `GET /api/v1/doctors/notifications/stream`

Opens SSE stream for real-time notification delivery.

## Admin API

All admin routes require:

- authentication
- `ADMIN` role

The admin router also applies audit middleware to all routes under `/api/v1/admin`.

### Role management

- `GET /api/v1/admin/roles`
- `PUT /api/v1/admin/roles/:roleKey`

### Hospital management

- `GET /api/v1/admin/hospitals`
- `POST /api/v1/admin/hospitals`
- `GET /api/v1/admin/hospitals/:id`
- `PUT /api/v1/admin/hospitals/:id`
- `PATCH /api/v1/admin/hospitals/:id/status`
- `DELETE /api/v1/admin/hospitals/:id`

### Billing

- `GET /api/v1/admin/billing/invoices`
- `POST /api/v1/admin/billing/invoices`
- `POST /api/v1/admin/billing/checkout/:invoiceId`

### User management

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `PUT /api/v1/admin/users/:id`
- `POST /api/v1/admin/users/reset-password`
- `POST /api/v1/admin/users/batch`

Password resets mark the target user `must_change_password=true`, enforce password history, revoke the target user's active sessions, and return `invalidated_sessions`. Existing target-user access tokens and refresh tokens are rejected after a successful reset. The reset audit entry includes session-invalidation metadata.

Account-disable operations revoke the disabled user's active sessions. This includes admin user status changes, doctor/patient deactivation endpoints, and batch `deactivate`; action responses that already carry operation metadata include `invalidated_sessions`.

### Doctor administration

- `POST /api/v1/admin/doctors`
- `GET /api/v1/admin/doctors`
- `PUT /api/v1/admin/doctors/:id`
- `DELETE /api/v1/admin/doctors/:id`

Create doctor request body:

- `login_id`
- `password`
- `name`
- optional `department`
- `contact_number` (required, 10 digits)
- optional `profile_picture_url`
- optional `hospital_id` or `hospital`

### Patient administration

- `POST /api/v1/admin/patients`
- `GET /api/v1/admin/patients`
- `PUT /api/v1/admin/patients/:id`
- `DELETE /api/v1/admin/patients/:id`
- `PUT /api/v1/admin/reassign/:op_num`

Create patient request body:

- `login_id`
- `password`
- `assigned_doctor_id`
- `demographics`
- optional `medical_config`
- optional `hospital_id` or `hospital`

### Audit and configuration

- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/config`
- `PUT /api/v1/admin/config`
- `GET /api/v1/admin/system/health`

### Notification broadcast

`POST /api/v1/admin/notifications/broadcast`

Request body:

```json
{
  "title": "System maintenance",
  "message": "The system will be read-only from 10 PM to 10:15 PM UTC.",
  "target": "ALL",
  "priority": "HIGH"
}
```

Valid `target` values:

- `ALL`
- `DOCTORS`
- `PATIENTS`
- `SPECIFIC`

When `target` is `SPECIFIC`, `user_ids` is required.

## Statistics API

All statistics routes require authentication and currently authorize admin access.

- `GET /api/v1/statistics/admin`
- `GET /api/v1/statistics/trends`
- `GET /api/v1/statistics/compliance`
- `GET /api/v1/statistics/workload`
- `GET /api/v1/statistics/period`

Supported query parameters:

- `GET /trends`: optional `period` in `7d | 30d | 90d | 1y`
- `GET /period`: optional `start_date`, `end_date`, with end date required to be greater than or equal to start date when both are provided

## Secure Integration Guidance

### Required client behavior

- Always call `/api/v1/*` for new integrations
- Send bearer tokens only over HTTPS
- Capture and log `X-Request-Id` on client error telemetry
- Respect `429` responses with exponential backoff
- Refresh inbox and summary views after write actions that affect notifications
- Treat report and profile image URLs as short-lived signed URLs

### Things clients should not assume

- Do not assume every response uses identical envelope shape
- Do not assume all date inputs accept ISO format
- Do not assume OP number is a dedicated patient profile field
- Do not assume presigned URLs remain valid after page reload or long idle periods

## Known Contract Gaps

- Response schemas are consistent in spirit, but not fully normalized across logout and rate-limit handlers
- Date input formats are mixed across endpoints
- SSE authentication supports query-token fallback, which should be minimized over time
- FileAsset metadata is internal; no standalone client-facing file-management resource exists yet

## Recommended Next Steps

- keep `openapi.yaml` synchronized with route and validator changes
- normalize all responses to the standard envelope
- standardize date input on ISO 8601 or a single explicit business format
- add machine-readable auth, pagination, and SSE sections to a published API contract
