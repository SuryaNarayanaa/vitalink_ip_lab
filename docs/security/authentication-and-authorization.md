# Authentication and authorization design

## Identity model

Every actor has a `User` identity and one role-specific profile. `user_type` is `ADMIN`, `DOCTOR`, or `PATIENT`; `profile_id` uses a Mongoose `refPath`. Account activity, hospital state, password policy, persisted session state, and `security_version` all participate in authorization.

## Password authentication

- Passwords are salted and hashed in a Mongoose pre-validation hook using the backend password utilities.
- Current input policy requires at least eight characters with uppercase, lowercase, digit, and special character.
- Recent salted hashes are retained in hidden password history; the configured default history count is five.
- Password expiry defaults to 90 days; forced/expired password state limits allowed routes to identity and password/MFA recovery surfaces.
- Failed credentials update per-account lockout state. Defaults are five failures and a 15-minute lock window.
- Login endpoints also use IP rate limiting outside development/test.

## Multi-factor paths

### Doctor and patient phone OTP

When the primary phone's verification status is `PENDING`, password acceptance creates a challenge bound to the user, role, profile, phone hash, and current security generation. Twilio Verify sends/checks the SMS code. Attempts, resend limits, cooldown, expiry, provider reservation, and terminal retention are persisted.

Changing a primary phone resets verification to `PENDING`; a new OTP is required. The source does not implement an OTP bypass for test accounts.

### Administrator TOTP

Administrator secrets are generated locally and encrypted at rest with `ADMIN_TOTP_ENCRYPTION_KEY`. Pending and active secret material use separate encrypted slots. Challenges bind the account security generation and factor generation, and the last verified time step provides a replay boundary.

Production/staging policy can require an unenrolled administrator to complete password-bound setup and activation before a session is issued. Authenticated setup/status/activate endpoints support normal account-security management.

## Session design

1. Successful authentication creates an `AuthSession` document.
2. The access token is a shared-secret-signed JWT containing user ID/type, session ID, and access token ID.
3. The refresh token is a 48-byte opaque random value. Only its SHA-256 hash is stored.
4. Every protected request verifies the JWT and then checks the current user, exact active session, security generation, access/absolute expiry, role, account state, hospital state, and password policy.
5. Refresh rotates both the access token ID and refresh hash atomically. Reuse of a previous hash revokes the current family.
6. Logout, credential change/reset, MFA reset, account disablement, and security-version changes revoke or invalidate sessions.

The code does not explicitly pin a JWT algorithm in `jwt.sign`/`jwt.verify`; that is recorded as a recommended hardening item rather than described as an implemented pin.

## Role and relationship authorization

- `authenticate` establishes a request-scoped user snapshot.
- `AllowPatient`, `AllowDoctor`, or `authorize([ADMIN])` enforce coarse role boundaries.
- Patient services restrict access to the current user's profile.
- Doctor services enforce assignment and same-hospital eligibility for patient data.
- Administrator routes resolve persisted V2 capabilities and scope, then require global/tenant and mutation policy.
- Files are authorized through the owning domain record plus `FileAsset` owner, tenant, purpose, status, and patient context.
- SSE accepts either a bearer header or a 30-second single-use ticket bound to user, role, session, access token ID, and security generation.

## Client token handling

Flutter uses `flutter_secure_storage` through `SecureStorage`. The API client adds bearer tokens, serializes concurrent refresh through one pending future, rotates stored tokens only if the local session generation is unchanged, retries the original request once, and redirects to login only for confirmed invalid/revoked session outcomes.

Browser `EventSource` cannot add an Authorization header, so Flutter web obtains a short-lived stream ticket before opening the SSE URL. Query logging redacts `ticket`, and Nginx logs `$uri` rather than `$request_uri`.
