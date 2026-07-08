# Auth Hardening Verification Runbook

Last updated: 2026-07-08

## Purpose

Use this checklist before promoting MFA and login-hardening changes to staging or production. It ties the implemented API contract, Jest coverage, and manual smoke checks together so auth behavior is verified consistently.

Primary references:

- `backend/docs/api-reference.md`
- `backend/docs/api/openapi.yaml`
- `backend/tests/authcontroller.test.ts`
- `backend/tests/admincontroller.test.ts`
- `backend/tests/otpservice.test.ts`

## Automated Gate

Run from `backend/`:

```sh
npm ci
npm run build
npm test -- --runInBand
```

Expected result: build passes and auth/admin/OTP suites pass. If Testcontainers cannot start MongoDB, treat the local result as blocked and run the same gate in CI or another environment with Docker.

Recommended contract guard: add an OpenAPI validation step to backend CI, for example `npx @redocly/cli lint docs/api/openapi.yaml` or an equivalent pinned validator.

## Verification Checklist

| Area | Status | Verification steps |
|---|---|---|
| Admin authenticator MFA | Implemented | Enroll an admin, activate TOTP, confirm `/auth/login` returns `202` with `TOTP_REQUIRED`, and confirm `/auth/login/totp/verify` issues the normal session payload. |
| First-login phone OTP | Implemented | Log in as an unverified patient and doctor, confirm `OTP_REQUIRED`, verify the OTP, and confirm later login does not require OTP. |
| Lockout and throttling | Implemented | Submit invalid passwords until lockout, confirm `locked_until` is set and login returns `423`; separately exceed auth rate limits and confirm `429`. |
| Refresh rotation | Implemented | Log in, call `/auth/refresh`, confirm old access and refresh tokens are rejected and the new session works. |
| Logout and revoke | Implemented | Call `/auth/logout` and `/auth/revoke`, then confirm affected tokens fail. |
| Password expiry and history | Implemented | Confirm expired-password state appears on login and `/auth/me`; confirm password reuse is rejected on self-change and admin reset paths; confirm `password_history` stores salted hashes only. |
| Admin reset session invalidation | Implemented | Reset a user's password while that user has live sessions; confirm old access/refresh tokens fail, `invalidated_sessions` is returned, and audit metadata records the reset revocation reason. |
| Login telemetry | Implemented | Confirm matched login attempts write audit metadata with IP, normalized login ID, request ID, and outcome; confirm unknown/duplicate login IDs produce structured warning logs; confirm sensitive values are redacted from audit bodies and request URL logs. |

## Manual Smoke Sequence

1. Create disposable admin, doctor, and patient accounts.
2. Verify admin TOTP setup, activation, challenge, and verification.
3. Verify patient and doctor first-login phone OTP.
4. Verify failed-password lockout and auth throttling.
5. Verify refresh rotation and logout revocation.
6. Verify password expiry state and recent-password reuse rejection.
7. Verify admin reset invalidates sessions and returns `invalidated_sessions`.
8. Query `AuditLog` by `metadata.login_attempt.normalized_login_id` plus `metadata.login_attempt.ip_address`.

## Promotion Criteria

- `npm run build` passes.
- Auth, admin, and OTP Jest suites pass in an environment with Testcontainers support.
- OpenAPI YAML parses and CI spec validation passes once the guard is added.
- Manual smoke evidence is attached to the release ticket for auth behavior changed since the previous release.
