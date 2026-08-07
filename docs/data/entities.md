# Entity and collection catalog

The catalog covers every Mongoose model exported by `backend/src/models/index.ts`. HTML markers are intentional: the entity-coverage validator compares them with implemented model names.

## Identities and profiles

<!-- model: User -->
### `User` / `users`

Authentication identity for every role. Key fields are unique `login_id`, hashed `password` and per-user `salt`, `user_type`, unique role-specific `profile_id`, active/security/password/lockout state, doctor-operation lease/fence, password history, and encrypted administrator TOTP state. Timestamps are enabled. Indexes cover login/profile uniqueness and `locked_until`.

<!-- model: AdminProfile -->
### `AdminProfile` / `adminprofiles`

Administrator identity projection with `name`, compatibility `permission`, fixed `admin_role`, and optional indexed `hospital_id`. A Hospital Admin requires tenant scope at the service layer; Application Admin and Auditor are global.

<!-- model: DoctorProfile -->
### `DoctorProfile` / `doctorprofiles`

Doctor name, department, primary contact, phone verification state, profile-image object key and `FileAsset` reference, hospital, and lifecycle fence. The hospital and phone/account relationship is revalidated by services rather than inferred from this document alone.

<!-- model: PatientProfile -->
### `PatientProfile` / `patientprofiles`

Primary clinical document. It embeds demographics and next of kin, medical configuration, medical history, seven-day dosage schedule, INR history, health logs, account/assignment-conflict state, profile-image metadata, file-operation leases, and purge progress. References include `hospital_id`, assigned doctor `User._id`, and file assets. `login_id`/OP number remains on `User`, not this profile.

## Authentication and delivery factors

<!-- model: AuthSession -->
### `AuthSession` / `authsessions`

Revocable session family with user/type/security generation, unique access token ID, unique current refresh hash, hidden refresh-hash history for reuse detection, sliding access expiry, absolute refresh expiry, revocation metadata, IP/user-agent, and usage time. TTL removes rows at `expires_at`.

<!-- model: OtpChallenge -->
### `OtpChallenge` / `otpchallenges`

Doctor/patient first-login SMS verification challenge. It binds the password-authenticated user, role, profile, security generation, hashed phone, provider state, attempts, resend reservations, expiry, terminal status, and later `purge_at`. TTL retention is 30 days by default.

<!-- model: AdminMfaChallenge -->
### `AdminMfaChallenge` / `adminmfachallenges`

Administrator authenticator challenge bound to factor and user security generations. It records expiry, attempts, outcome, verification time, metadata, and a later 30-day default purge boundary.

<!-- model: DeviceToken -->
### `DeviceToken` / `devicetokens`

Current ownership of an FCM token, platform (`android`, `ios`, `web`), optional app version, active state, and refresh time. `fcm_token` is globally unique; registration transfers the physical token to its current user.

## Tenancy, files, and billing

<!-- model: Hospital -->
### `Hospital` / `hospitals`

Tenant anchor with unique uppercase code, name, location, admin email, status, accepting-assignment flag, explicit lifecycle state, generation, lease, and extensible metadata. Status/time and location indexes support administrative queries.

<!-- model: FileAsset -->
### `FileAsset` / `fileassets`

Authorization and integrity metadata for S3 objects: hospital, owner, optional patient context, purpose, provider, bucket/key, original name, detected MIME, byte size, SHA-256, status, creator, failure/deletion, and future retention eligibility. `(bucket, object_key)` is unique and tenant/owner/patient lookup indexes are present.

<!-- model: Invoice -->
### `Invoice` / `invoices`

Hospital billing document with unique invoice number, `YYYY-MM` billing period, plan, non-negative amount, status, issue/due dates, and provider/session metadata. A partial unique `(hospital_id, billing_period)` index makes generation idempotent for migrated records.

## Notifications and audit

<!-- model: Notification -->
### `Notification` / `notifications`

In-app user notification with type, priority, title/message/data, read state, action URL, optional idempotent `reminder_key`, push intent/cancellation markers, clinical delivery validity, and optional expiry. TTL, user inbox, reminder uniqueness, and outbox-repair indexes are defined.

<!-- model: NotificationDelivery -->
### `NotificationDelivery` / `notificationdeliveries`

Durable push outbox linked to notification and user. It stores channel/provider/recipient policy, status, attempts/backoff, worker and recovery leases, irreversible provider handoff, per-device successes, sanitized error, unique idempotency key, generic provider payload, clinical validity, and retention expiry.

<!-- model: AuditLog -->
### `AuditLog` / `auditlogs`

Actor, role, enumerated action, description, resource, before/after data, request metadata, success and sanitized failure detail. Compound indexes support actor, action, resource, outcome, and normalized-login/IP investigation. No TTL is defined.

## Authorization and runtime configuration

<!-- model: AdminRolePolicy -->
### `AdminRolePolicy` / `adminrolepolicies`

One document per fixed administrator role. It holds a fully validated namespaced capability object, protected flag, schema version, optimistic `policy_version`, updater, and reason. `role_key` is unique/immutable and the Application Admin policy must remain protected.

<!-- model: AdminRolePolicyRevision -->
### `AdminRolePolicyRevision` / `adminrolepolicyrevisions`

Append-only before/after capability snapshot with consecutive versions, actor, reason, affected active account count, request correlation ID, and optional restored-from revision. `(role_key, new_policy_version)` is unique; update middleware rejects modifications.

<!-- model: RoleDefinition -->
### `RoleDefinition` / `roledefinitions`

Legacy role catalog containing unique role key, label, color, and permission map. Read compatibility remains; the legacy write endpoint is retired and returns `410 Gone` in favor of V2 policies.

<!-- model: SystemConfig -->
### `SystemConfig` / `systemconfigs`

One active runtime configuration with INR critical thresholds, session timeout, compatibility rate-limit settings, and feature flags (`maintenance_mode`, `patient_registration_enabled`, `notifications_enabled`). A partial unique index permits only one active document.

## Native collection

### `system_counters`

`admin.service.ts` directly accesses this collection to allocate hospital codes atomically. Documents have a string `_id` such as `hospital_code` and numeric `value`. It is intentionally not part of the Mongoose model marker comparison.

## Embedded patient structures

| Structure | Important fields |
| --- | --- |
| Demographics | name, bounded integer age, gender, phone verification, next of kin |
| Medical configuration | diagnosis, therapy drug/start, target INR min/max, next review, instructions, taken-dose dates |
| Medical history | diagnosis and duration value/unit |
| Weekly dosage | Monday through Sunday non-negative finite numbers |
| INR history | test/upload dates, INR value, critical flag, storage key/FileAsset, notes |
| Health logs | date, enumerated type, description, feedback |
| Assignment conflict | detected time, attempted/previous doctor and bounded reason |
| File lifecycle | short upload leases and durable purge state/execution/lease/error |

## Retention implemented in schemas

| Collection | Implemented TTL |
| --- | --- |
| `authsessions` | `expires_at` |
| `otpchallenges` | `purge_at` |
| `adminmfachallenges` | `purge_at` |
| `notifications` | optional `expires_at` |
| `notificationdeliveries` | required `expires_at` based on configured retention days |

Audit logs, file assets, inactive users/profiles, policy revisions, invoices, and hospitals have no schema TTL. Their retention requirements are unconfirmed.
