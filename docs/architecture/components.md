# Backend component diagrams

The component diagrams are the focused Structurizr views `BackendComponents`, `AuthComponents`, `ClinicalComponents`, and `NotificationComponents` in [workspace.dsl](workspace.dsl). They are intentionally organized around implementation modules rather than hypothetical microservices.

## HTTP and security components

| Component | Implementation modules | Responsibility |
| --- | --- | --- |
| HTTP Composition Root | `app.ts`, `routes/*`, version/error/validation middleware | Global request pipeline and route mounting |
| Authentication Controllers | `auth.controller.ts`, `auth.routes.ts` | Password, OTP, TOTP, refresh, revoke, logout, password change |
| Session and Password Services | `auth-session.service.ts`, `password.service.ts`, `login-lockout.service.ts` | Revocable sessions, rotation, policy and lockout |
| Administrator Access Layer | `admin-access.service.ts`, `adminPermission.middleware.ts`, `admin-route-policy.ts` | Capability, scope and mutation enforcement |

## Clinical components

| Component | Implementation modules | Responsibility |
| --- | --- | --- |
| Patient and Doctor Controllers | `patient.controller.ts`, `doctor.controller.ts` | Clinical REST workflows and relationship checks |
| Doctor Assignment Service | `doctor-assignment.service.ts`, `hospital-access.service.ts` | Tenant eligibility, leases, fences and reassignment |
| File Asset Services | `fileasset.service.ts`, `malware-scan.service.ts`, `patient-file-purge.service.ts`, `s3-client.ts` | Upload authorization, metadata, object storage and purge |
| Clinical Reminder Schedulers | `dosage.scheduler.ts`, `clinical-reminder.scheduler.ts` | Idempotent scheduled reminders and escalation |

## Administration components

| Component | Implementation modules | Responsibility |
| --- | --- | --- |
| Administration Services | `admin.service.ts`, admin controllers | Hospitals, accounts, billing, config, audit and lifecycle |
| Role Policy Service | `admin-role-policy.service.ts` | Preview, versioned policy mutation, revision and restore |
| Administrator Account Service | `admin-account.service.ts` | Fixed-role administrator provisioning and lifecycle |
| Statistics Service | `statistics.service.ts` | Global or tenant-filtered operational analytics |

## Notification components

| Component | Implementation modules | Responsibility |
| --- | --- | --- |
| Notification Services | `notification.service.ts`, `realtime-notification.service.ts`, stream auth/ticket services | Persistence, read state, SSE and pub/sub |
| Delivery Service | `notification-delivery.service.ts` | Durable outbox creation, validity and idempotency |
| Queue/Worker/Recovery | `notification-delivery.queue.ts`, worker and recovery jobs | BullMQ publication, provider handoff, retries and recovery |
| Firebase Adapter | `firebase.config.ts`, `fcm.service.ts` | Optional Firebase initialization and multicast sends |

## Coupling constraints

- MongoDB is the durable source of truth; Redis queue publication is recoverable work distribution.
- The API remains one deployable Node process even though components are separated by modules.
- Schedulers are imported into the API process and are not a separate container.
- SSE connections are served by API processes; Redis pub/sub provides cross-process fan-out when configured.
- The tracked ML artifacts are not referenced by any component and are excluded from the runtime diagrams.
