# Functional requirements

These requirements describe behavior implemented by current routes, controllers, services, models, and Flutter surfaces. Identifiers are documentation anchors rather than external regulatory requirement IDs.

## Identity and session

| ID | Requirement | Evidence area |
| --- | --- | --- |
| FR-AUTH-01 | The system shall authenticate active users by `login_id` and password and apply account lockout policy. | Auth controller, login-lockout and password services |
| FR-AUTH-02 | The system shall require first-login phone OTP for eligible doctor and patient accounts whose registered primary phone is pending verification. | OTP/Twilio services and challenge model |
| FR-AUTH-03 | The system shall require authenticator-app TOTP for administrators and support password-bound enrollment when production/staging policy prevents an unenrolled admin from obtaining a session. | Auth routes and admin TOTP service |
| FR-AUTH-04 | The system shall issue revocable access sessions and opaque rotating refresh tokens, detect reuse of rotated refresh tokens, and invalidate sessions at password/MFA/account security boundaries. | AuthSession model and service |
| FR-AUTH-05 | The client shall restore a stored session, enforce role-aware navigation, refresh an expired access token once, and clear confirmed-invalid sessions. | Flutter session bootstrap, guards, API client, secure storage |

## Patient care

| ID | Requirement |
| --- | --- |
| FR-PAT-01 | A patient shall view and update permitted profile fields and a profile image. |
| FR-PAT-02 | A patient shall upload a PDF or image INR report with test metadata and view authorized report history and temporary download URLs. |
| FR-PAT-03 | A patient shall record a scheduled dose, view missed doses, and view a dosage calendar. |
| FR-PAT-04 | A patient shall record typed health logs such as side effects, illness, lifestyle, or other medication observations. |
| FR-PAT-05 | A patient shall view doctor updates and notifications, retrieve unread counts, and mark one or all entries read. |
| FR-PAT-06 | A patient client shall receive eligible real-time notification events through an authenticated SSE stream. |

## Doctor care

| ID | Requirement |
| --- | --- |
| FR-DOC-01 | A doctor shall view an assigned patient roster and patient details only within the enforced doctor/patient relationship and hospital boundary. |
| FR-DOC-02 | A doctor shall create patient accounts, subject to role and tenant validation. |
| FR-DOC-03 | A doctor shall update a patient's weekly dosage, care instructions, and next review date. |
| FR-DOC-04 | A doctor shall review an authorized patient's report and update report notes/state. |
| FR-DOC-05 | A doctor shall reassign an eligible patient to another eligible doctor with concurrency and tenant checks. |
| FR-DOC-06 | A doctor shall view/update the doctor profile and profile image. |
| FR-DOC-07 | A doctor shall receive, list, count, and acknowledge notifications through REST and SSE. |

## Administration

| ID | Requirement |
| --- | --- |
| FR-ADM-01 | The platform shall resolve an administrator's effective role, capabilities, scope, hospital, and policy version for every protected administrative surface. |
| FR-ADM-02 | An authorized global administrator shall manage hospitals and fixed administrator accounts. |
| FR-ADM-03 | An authorized tenant administrator shall manage doctor and patient accounts, status, credentials, and assignments only within the assigned hospital. |
| FR-ADM-04 | Authorized administrators shall inspect scoped audit logs and non-clinical operational statistics. |
| FR-ADM-05 | Authorized administrators shall inspect or update global system configuration according to capability and mutation policy. |
| FR-ADM-06 | Authorized administrators shall broadcast notifications globally or within one hospital according to scope. |
| FR-ADM-07 | Authorized administrators shall list/generate invoices or initiate tenant checkout according to distinct billing capabilities. |
| FR-ADM-08 | Editable fixed-role policies shall support preview, optimistic version checks, update, immutable revision history, restore preview, and restore. |
| FR-ADM-09 | Application Admin policy shall remain protected; System Auditor mutations shall fail closed. |

## Files, notifications, and operations

| ID | Requirement |
| --- | --- |
| FR-OPS-01 | Uploads shall enforce file-size, MIME allowlist, byte detection, optional fail-closed malware scanning, tenant ownership metadata, and compensating cleanup. |
| FR-OPS-02 | Scheduled reminder creation shall be idempotent per recipient and due window and shall honor account, hospital, feature-flag, and clinical validity boundaries. |
| FR-OPS-03 | Push intent shall be persisted before best-effort queue publication and shall support retries, recovery, expiry, cancellation, and dead-letter state. |
| FR-OPS-04 | The service shall expose liveness and readiness endpoints and optional protected API documentation. |
| FR-OPS-05 | The versioned API shall expose `/api/v1`; the legacy `/api` mount shall return deprecation and sunset metadata. |

## Traceability

REST operations are enumerated in [OpenAPI](../api/openapi.yaml). Major user flows are diagrammed in [feature workflows](../workflows/features.md). Source locations and inspection scope are recorded in [source evidence](../reference/source-evidence.md).
