# Application scope and stakeholders

## In scope

- Password login with patient/doctor first-login SMS OTP and administrator TOTP.
- Revocable access and rotating refresh sessions.
- Patient profile, INR report upload, report history, dosage recording and calendar, health logs, doctor updates, notification center, and profile image.
- Doctor profile, patient creation, assigned roster, patient detail, dosage and instructions, report review, next-review scheduling, reassignment, notifications, and profile image.
- Platform and hospital administration: hospitals, administrator accounts, doctor and patient accounts, lifecycle changes, credentials, fixed-role policies, billing, configuration, audit logs, analytics, notification broadcasts, and health views.
- Scheduled dosage, INR, review, and missed-dose reminders.
- In-app notification persistence, SSE delivery, device registration, optional FCM delivery, retry, recovery, and dead-letter state.
- Versioned REST API, legacy compatibility mount, health endpoints, and protected Swagger UI.
- Docker-based blue/green backend deployment and Flutter web/APK build workflows.

## Outside confirmed scope

- Clinical decision support or autonomous dose calculation.
- Appointment booking, electronic prescribing, pharmacy fulfillment, or laboratory-system integration.
- A confirmed production backup/restore service, SIEM, alert manager, on-call rota, RPO, RTO, or formal SLO.
- A named payment processor. The code integrates with a configurable HTTPS checkout provider contract.
- A confirmed live deployment topology. Source contains EC2, Render, GitHub Pages, and Vercel references.

## Direct actors

| Stakeholder | Source-backed interest | Primary surfaces |
| --- | --- | --- |
| Patient | Maintain therapy record and receive care guidance | Patient dashboard, INR reports, dosage, health logs, profile, notifications |
| Doctor | Monitor and update assigned patient care | Doctor dashboard, patient detail, reports, dosage, instructions, review date, notifications |
| Application Admin | Operate global platform controls | Hospitals, administrator accounts, access policies, global audit/analytics/billing/config/health |
| Hospital Admin | Operate one hospital | Hospital-scoped doctors, patients, assignments, audit, analytics, billing, notifications, operations health |
| System Auditor | Read global operational information | Read-only hospitals, policies, audit, analytics, billing, and system health according to persisted policy |

## Operational stakeholders implied by source

Engineering and operations are implied by GitHub Actions, EC2 deployment scripts, health endpoints, logs, migrations, and runbooks. Security and clinical-governance stakeholders are implied by audit logs, MFA, tenant checks, and clinical data handling. Their named owners, escalation contacts, and approval authority are not present in source and therefore remain open questions.

## System boundary

The VitaLink application boundary includes the Flutter client, Express API, MongoDB collections, Redis/BullMQ runtime, and checked-in deployment configuration. Twilio Verify, Firebase, Filebase/S3, a configurable payment provider, a configurable malware scanner, MongoDB hosting, and optional Loki hosting are external trust domains.
