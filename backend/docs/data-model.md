# VitaLink Data Model Documentation

Last updated: 2026-07-05

## Purpose

This document describes the current backend persistence model implemented in `backend/src/models`, the relationships between collections, the existing index footprint, the unique-key inventory, and the recommended migration policy for controlled schema evolution.

This is an implementation-aligned document, not a target-state wish list. Where the code has gaps or ambiguity, those are called out explicitly.

## Technology and Modeling Conventions

- Database: MongoDB
- ODM: Mongoose
- Primary identifiers: MongoDB `ObjectId`
- Cross-collection references: stored as `ObjectId` and resolved with Mongoose `populate`
- Audit and notification event detail: stored partly as embedded `Mixed` payloads for flexibility
- Time fields: persisted as UTC-capable MongoDB `Date`
- Embedded subdocuments: used for patient clinical history, dosage schedules, INR history, and health logs

## Entity Relationship Overview

```mermaid
erDiagram
    USER ||--|| ADMIN_PROFILE : "profile_id"
    USER ||--|| DOCTOR_PROFILE : "profile_id"
    USER ||--|| PATIENT_PROFILE : "profile_id"
    HOSPITAL ||--o{ ADMIN_PROFILE : "hospital_id"
    HOSPITAL ||--o{ DOCTOR_PROFILE : "hospital_id"
    HOSPITAL ||--o{ PATIENT_PROFILE : "hospital_id"
    HOSPITAL ||--o{ INVOICE : "hospital_id"
    USER ||--o{ NOTIFICATION : "user_id"
    USER ||--o{ AUDIT_LOG : "user_id"
    USER ||--o{ PATIENT_PROFILE : "assigned_doctor_id (doctor user)"

    USER {
        objectId _id
        string login_id UK
        string user_type
        objectId profile_id UK
        boolean is_active
        boolean must_change_password
        int failed_login_attempts
        date locked_until
        date last_login_at
    }

    ADMIN_PROFILE {
        objectId _id
        string name
        string permission
        string admin_role
        objectId hospital_id FK
    }

    DOCTOR_PROFILE {
        objectId _id
        string name
        string department
        string contact_number
        string profile_picture_url
        objectId hospital_id FK
    }

    PATIENT_PROFILE {
        objectId _id
        objectId assigned_doctor_id FK
        objectId hospital_id FK
        string account_status
        string profile_picture_url
    }

    HOSPITAL {
        objectId _id
        string code UK
        string name
        string location
        string admin_email
        string status
    }

    INVOICE {
        objectId _id
        string invoice_number UK
        objectId hospital_id FK
        string plan
        number amount
        string status
        date issued_date
        date due_date
    }

    NOTIFICATION {
        objectId _id
        objectId user_id FK
        string type
        string priority
        string title
        boolean is_read
        date read_at
        date expires_at
    }

    AUDIT_LOG {
        objectId _id
        objectId user_id FK
        string user_type
        string action
        string description
        string resource_type
        string resource_id
        boolean success
        date createdAt
    }

    SYSTEM_CONFIG {
        objectId _id
        object inr_thresholds
        number session_timeout_minutes
        object rate_limit
        map feature_flags
        boolean is_active
    }
```

## Collection Catalog

### `users`

System authentication identity for every actor in the platform.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `login_id` | string | Yes | Unique login identifier; trimmed before validation |
| `password` | string | Yes | Salted and hashed in pre-validation hook |
| `salt` | string | Yes | Per-user salt |
| `user_type` | enum | Yes | `ADMIN`, `DOCTOR`, `PATIENT` |
| `profile_id` | ObjectId | Yes | Unique reference to role-specific profile |
| `user_type_model` | string | Yes | Derived discriminator-like ref target |
| `is_active` | boolean | No | Default `true` |
| `must_change_password` | boolean | No | Default `false` |
| `failed_login_attempts` | number | No | Default `0` |
| `locked_until` | date | No | Temporary lockout marker |
| `last_login_at` | date | No | Operational telemetry |
| `last_failed_login_at` | date | No | Operational telemetry |

Security notes:

- Passwords are never returned by `toJSON()`.
- `profile_id` is a one-to-one link to the owning role profile.
- `user_type_model` is computed from `user_type` and is used by Mongoose `refPath`.

### `adminprofiles`

Administrative profile for app admins, hospital admins, and auditors.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `name` | string | No | Defaults to `Admin User` |
| `permission` | enum | No | `FULL_ACCESS`, `READ_ONLY`, `LIMITED_ACCESS` |
| `admin_role` | enum | No | `app_admin`, `hospital_admin`, `auditor` |
| `hospital_id` | ObjectId | No | Optional tenant scope for hospital admins |

### `doctorprofiles`

Clinical provider profile linked one-to-one with a `users` record.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `name` | string | Yes | Doctor display name |
| `department` | string | No | Defaults to `Cardiology` |
| `contact_number` | string | No | Stored as free-form string |
| `profile_picture_url` | string | No | Stores object key, later resolved to presigned URL |
| `hospital_id` | ObjectId | No | Tenant ownership anchor |

### `patientprofiles`

Primary clinical and operational patient record.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `assigned_doctor_id` | ObjectId | No | References doctor `users._id`, not `doctorprofiles._id` |
| `hospital_id` | ObjectId | No | Tenant ownership anchor |
| `demographics` | object | Partly | Contains patient and next-of-kin data |
| `medical_config` | object | No | Care-plan state and thresholds |
| `medical_history` | array | No | Embedded condition history |
| `weekly_dosage` | object | No | Embedded dosage schedule by weekday |
| `inr_history` | array | No | Embedded report/event history |
| `health_logs` | array | No | Embedded self-reported health updates |
| `account_status` | enum | No | `Active`, `Discharged`, `Deceased` |
| `profile_picture_url` | string | No | Stores object key, later resolved to presigned URL |

Embedded structures:

`demographics`

| Field | Type | Notes |
|---|---|---|
| `name` | string | Required |
| `age` | number | Optional |
| `gender` | enum | `Male`, `Female`, `Other` |
| `phone` | string | Optional |
| `next_of_kin.name` | string | Optional |
| `next_of_kin.relation` | string | Optional |
| `next_of_kin.phone` | string | Optional |

`medical_config`

| Field | Type | Notes |
|---|---|---|
| `diagnosis` | string | Optional |
| `therapy_drug` | string | Optional |
| `therapy_start_date` | date | Optional |
| `target_inr.min` | number | Default `2.0` |
| `target_inr.max` | number | Default `3.0` |
| `next_review_date` | date | Optional |
| `instructions` | string[] | Optional |
| `taken_doses` | date[] | Optional |

`weekly_dosage`

- Seven numeric weekday fields: `monday` through `sunday`
- Stored as an embedded object with `_id: false`

`inr_history`

| Field | Type | Notes |
|---|---|---|
| `test_date` | date | Required |
| `uploaded_at` | date | Defaults to current time |
| `inr_value` | number | Required |
| `is_critical` | boolean | Default `false` |
| `file_url` | string | S3-compatible object key |
| `notes` | string | Doctor-added note |

`health_logs`

| Field | Type | Notes |
|---|---|---|
| `date` | date | Defaults to current time |
| `type` | enum | Validator-driven value set |
| `description` | string | Required |
| `feedback` | string/boolean-ish | Code currently defaults this field to `false`, which is a schema inconsistency to fix |

Important implementation note:

- Doctor and admin flows use patient `login_id` as an `op_num` route identifier. That identifier is not stored on `patientprofiles`; it is the patient's `users.login_id`. This should be treated as a contract rule in API integrations.

### `hospitals`

Tenant anchor for hospital-scoped administration, doctors, and patients.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `code` | string | Yes | Unique, trimmed, uppercased |
| `name` | string | Yes | Hospital name |
| `location` | string | Yes | Geographic/site descriptor |
| `admin_email` | string | Yes | Lowercased contact email; not unique today |
| `status` | enum | No | `active`, `suspended`, `inactive` |
| `metadata` | mixed | No | Free-form extension field |

### `invoices`

Billing record for hospital plans and payment state.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `invoice_number` | string | Yes | Unique business identifier |
| `hospital_id` | ObjectId | Yes | Invoice tenant |
| `plan` | string | Yes | Plan label |
| `amount` | number | Yes | Non-negative |
| `status` | enum | No | `Pending`, `Paid`, `Overdue` |
| `issued_date` | date | No | Defaults to current time |
| `due_date` | date | Yes | Due date |
| `payment_metadata` | mixed | No | Payment provider data |

### `notifications`

Persisted in-app notification store used by both standard notifications and doctor-change events.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `user_id` | ObjectId | Yes | Notification recipient |
| `type` | enum | Yes | Includes `DOCTOR_UPDATE`, `GENERAL`, `SYSTEM_ANNOUNCEMENT`, etc. |
| `priority` | enum | No | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `title` | string | Yes | Short headline |
| `message` | string | Yes | Message body |
| `data` | mixed | No | Optional structured metadata |
| `is_read` | boolean | No | Default `false` |
| `read_at` | date | No | Read timestamp |
| `action_url` | string | No | Optional deep link |
| `expires_at` | date | No | Used by TTL auto-expiry index |

### `auditlogs`

Security and operational audit trail for admin and authentication activity.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `user_id` | ObjectId | Yes | Actor |
| `user_type` | string | Yes | Actor type |
| `action` | enum | Yes | Includes login, logout, reset, reassignment, config updates, etc. |
| `description` | string | Yes | Human-readable event summary |
| `resource_type` | string | No | Logical resource name |
| `resource_id` | string | No | Logical resource identifier |
| `previous_data` | mixed | No | Before-state snapshot |
| `new_data` | mixed | No | After-state snapshot |
| `ip_address` | string | No | Source IP |
| `user_agent` | string | No | Client user agent |
| `success` | boolean | No | Default `true` |
| `error_message` | string | No | Failure detail |
| `metadata` | mixed | No | Additional structured context |

### `systemconfigs`

Operational runtime configuration collection.

Key fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `inr_thresholds.critical_low` | number | No | Default `1.5` |
| `inr_thresholds.critical_high` | number | No | Default `4.5` |
| `session_timeout_minutes` | number | No | Default `30` |
| `rate_limit.max_requests` | number | No | Default `100` |
| `rate_limit.window_minutes` | number | No | Default `15` |
| `feature_flags` | map<boolean> | No | Runtime feature toggles |
| `is_active` | boolean | No | Active config selector |

## Unique Key Inventory

The following uniqueness guarantees exist in the current implementation.

| Collection | Field(s) | Constraint Type | Business Meaning |
|---|---|---|---|
| `users` | `login_id` | Unique index | One login identity per username/OP number/email-style identifier |
| `users` | `profile_id` | Unique index | One authentication account per role profile |
| `hospitals` | `code` | Unique index | One tenant code per hospital |
| `invoices` | `invoice_number` | Unique index | One billing identifier per invoice |

Current gaps:

- `hospitals.admin_email` is required but not unique.
- No explicit unique identifier exists for uploaded files beyond object-key generation logic.
- No unique patient business key exists inside `patientprofiles`; operational uniqueness depends on `users.login_id`.

## Index Strategy

### Existing indexes implemented in code

| Collection | Index | Purpose |
|---|---|---|
| `users` | `{ login_id: 1 }` unique | Login lookup and uniqueness |
| `users` | `{ profile_id: 1 }` unique | One-to-one profile mapping |
| `users` | `{ locked_until: 1 }` | Lockout-state inspection |
| `adminprofiles` | `{ admin_role: 1 }` | Role-based admin filtering |
| `doctorprofiles` | `{ hospital_id: 1 }` | Tenant-scoped doctor filtering |
| `patientprofiles` | `{ assigned_doctor_id: 1 }` | Doctor-owned patient queries |
| `patientprofiles` | `{ hospital_id: 1 }` | Tenant-scoped patient queries |
| `hospitals` | `{ status: 1, createdAt: -1 }` | Status-filtered hospital listing |
| `hospitals` | `{ location: 1 }` | Location filtering |
| `invoices` | `{ hospital_id: 1 }` | Tenant-scoped invoice queries |
| `invoices` | `{ status: 1, due_date: 1 }` | Billing aging and collections workflows |
| `notifications` | `{ expires_at: 1 }` TTL | Automatic expiry removal |
| `notifications` | `{ user_id: 1, is_read: 1, createdAt: -1 }` | Inbox pagination and unread filtering |
| `auditlogs` | `{ user_id: 1, createdAt: -1 }` | Actor timeline lookups |
| `auditlogs` | `{ action: 1, createdAt: -1 }` | Action-type investigations |
| `auditlogs` | `{ resource_type: 1, resource_id: 1 }` | Resource audit tracing |
| `auditlogs` | `{ success: 1, createdAt: -1 }` | Failure and anomaly review |

### How the current indexes support the application

- Authentication relies on unique `users.login_id`.
- Doctor dashboards rely on `patientprofiles.assigned_doctor_id`.
- Multi-tenant admin workflows rely on `hospital_id` indexes in doctor, patient, and invoice collections.
- Notifications rely on `user_id + is_read + createdAt` for paginated inbox views and unread counts.
- Notification expiry is automatically enforced by MongoDB TTL on `expires_at`.
- Audit investigations can pivot by actor, action type, resource, or success/failure.

### Recommended next indexes

The following are not yet implemented, but should be considered before scale-out:

| Collection | Proposed Index | Reason |
|---|---|---|
| `users` | `{ user_type: 1, is_active: 1 }` | Faster user-admin listing and broadcast targeting |
| `patientprofiles` | `{ hospital_id: 1, assigned_doctor_id: 1 }` | Common tenant + doctor access pattern |
| `patientprofiles` | `{ account_status: 1, hospital_id: 1 }` | Status-based operational filtering |
| `notifications` | `{ user_id: 1, createdAt: -1 }` | Read-agnostic inbox scans |
| `auditlogs` | `{ createdAt: -1 }` | Time-bounded export and retention operations |
| `hospitals` | `{ admin_email: 1 }` | Faster admin lookups and potential future uniqueness |

Index governance guidance:

- Every new index should have a documented query it serves.
- Avoid indexing deeply embedded, high-churn arrays unless query evidence justifies it.
- Re-check index selectivity once real production traffic is available.

## Data Classification and Sensitivity

### High-sensitivity fields

These should be treated as PHI/PII or security-sensitive data:

- `users.password`
- `users.salt`
- `users.login_id` when it represents a patient OP number or personal login
- `doctorprofiles.contact_number`
- `patientprofiles.demographics.*`
- `patientprofiles.demographics.next_of_kin.*`
- `patientprofiles.medical_config.*`
- `patientprofiles.medical_history`
- `patientprofiles.inr_history`
- `patientprofiles.health_logs`
- `notifications.message` and `notifications.data` when they contain clinical context
- `auditlogs.previous_data`, `auditlogs.new_data`, `auditlogs.metadata`
- `hospitals.admin_email`

### Operational handling expectations

- Do not log raw passwords, salts, tokens, or presigned URLs.
- Avoid returning full audit payload snapshots to low-privilege clients.
- Treat object storage keys as sensitive metadata because they map to patient artifacts.

## Referential Integrity Rules

MongoDB does not enforce foreign keys natively, so the application layer must preserve these invariants:

- Every `users.profile_id` must reference exactly one role-specific profile.
- `patientprofiles.assigned_doctor_id` must reference a doctor user record, not a doctor profile record.
- Tenant-bound profiles should reference a valid `hospitals._id`.
- `notifications.user_id` and `auditlogs.user_id` should always point to an existing user unless a deliberate retention/archive policy says otherwise.

Deletion policy expectations:

- Prefer soft deactivation at the `users.is_active` layer over hard deletion.
- Do not hard-delete profiles without a documented cascade strategy for audit, notifications, and file objects.

## Migration Policy

### Current state

The repository currently uses script-based migrations in `backend/src/scripts` rather than a formal migration framework. Existing examples include:

- `migrateAssignedDoctorIds.ts`
- `migrateDoctorChangeEventsToNotifications.ts`
- `migrateInrCriticalFlags.ts`

This is workable for a small system, but it needs operating rules.

### Required migration standard

1. All schema or data migrations must be forward-only and idempotent where practical.
2. Every migration must have:
   - purpose
   - affected collections
   - preconditions
   - rollback posture
   - verification query
3. Destructive data rewrites must run only after a backup or restore point is confirmed.
4. Application code should support a safe compatibility window during rolling deployment whenever possible.
5. Migrations touching tenant or clinical data must emit an auditable execution record.

### Recommended migration workflow

1. Add code that is backward-compatible with both old and new document shapes.
2. Deploy the compatible application version.
3. Run the migration script in a controlled environment.
4. Verify document counts, null rates, and sample records.
5. Remove legacy compatibility code only after verification succeeds in all environments.

### Naming convention

Use a timestamped, intent-revealing filename pattern:

- `YYYYMMDDHHMM-description.ts`

Example:

- `202607051030-backfill-hospital-id-on-patient-profiles.ts`

### Migration template requirements

Each migration script should include:

- dry-run support where feasible
- structured logging
- batch processing for large collections
- explicit exit code behavior
- post-run summary with `matched`, `modified`, `failed`, and `skipped`

## Known Gaps and Risks

- No formal ERD or schema registry existed before this document.
- The `health_logs.feedback` field has a type/default inconsistency and should be normalized.
- Patient business identity is split between `users.login_id` and `patientprofiles._id`, which increases integration ambiguity.
- No dedicated file metadata collection exists yet; file references are embedded as storage keys inside profile documents.
- No retention indexes exist for audit data, file data, or inactive patient archival.
- Tenant scoping is implemented in service logic, but not all collections encode tenant context strongly enough for future large-scale analytics and exports.

## Recommended Next Artifacts

- `backend/docs/schema-change-checklist.md`
- `backend/docs/retention-and-purge-policy.md`
- `backend/docs/file-asset-model-proposal.md`
- machine-readable OpenAPI contract linked to the data model sections that reference API payloads
