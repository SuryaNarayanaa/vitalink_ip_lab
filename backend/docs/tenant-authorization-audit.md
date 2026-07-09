# Tenant Authorization Audit

Date: 2026-07-09

This audit covers the backend route surface that reads or mutates tenant-owned clinical, user, notification, file, audit, and statistics data.

| Route/resource | Actor | Tenant rule | Result |
|---|---|---|---|
| `GET/PUT /api/patient/profile` | Patient | Authenticated patient can read or update only their own `User.profile_id`. | Enforced in controller by token user ID. |
| `GET/POST /api/patient/reports` | Patient | Authenticated patient can access only their own `PatientProfile`; uploaded object keys include hospital and patient ownership. | Enforced and hardened. |
| `POST /api/patient/profile-pic` | Patient | Authenticated patient can update only their own profile picture; object key includes hospital and user ownership. | Enforced and hardened. |
| Patient dosage, health logs, doctor updates, notifications | Patient | Authenticated patient can mutate/read only records attached to their own user/profile. | Enforced by user ID filters. |
| Patient notification stream | Patient | Token must validate as active patient session before stream registration. | Enforced. |
| `GET /api/doctors/patients*` and report reads | Doctor | Doctor must own the patient and, when hospital IDs exist, patient and doctor must share the hospital. | Hardened. |
| Doctor patient dosage, report review, review date, instructions | Doctor | Doctor must own the patient and share the same hospital when tenant metadata exists. | Hardened. |
| Doctor patient reassignment | Doctor | Current doctor must own patient; target doctor must exist in the same hospital when tenant metadata exists. | Hardened. |
| `POST /api/doctors/patients` | Doctor | Created patient inherits the creating doctor's hospital. | Hardened. |
| `GET /api/doctors/doctors` | Doctor | Doctor directory is limited to same-hospital doctors; doctors without tenant metadata only see themselves. | Hardened. |
| `GET/PUT /api/doctors/profile`, profile picture | Doctor | Doctor can access only their own profile; uploaded object key includes hospital and user ownership. | Enforced and hardened. |
| Doctor notifications and stream | Doctor | Doctor can access only notifications attached to their own user ID; stream token must validate as doctor. | Enforced. |
| Admin doctor/patient CRUD and reassignment | Admin | App admin can access all; hospital admin is limited to their hospital; auditors are read-only. | Enforced in `admin.service`, with target doctor checks hardened. |
| Admin hospital, role, billing, users | Admin | App-admin-only for global mutation; hospital admins are scoped to their hospital where reads are allowed. | Enforced in `admin.service`. |
| Admin audit logs | Admin | App admin can read all; hospital-scoped admins/auditors only see logs for users in their hospital. | Hardened. |
| Admin notification broadcast | Admin | App admin can broadcast globally; hospital admins can broadcast only to users in their hospital and cannot target outside users. | Hardened. |
| Admin batch operation and password reset | Admin | Mutating admin operations must target only same-tenant users unless app admin. | Hardened. |
| Statistics routes | Admin | App admin sees global statistics; hospital-scoped admins/auditors see counts, trends, compliance, workload, and audit summaries for their hospital only. | Hardened. |

Legacy records without `hospital_id` remain readable only through existing ownership checks or app-admin access. New doctor-created patients and new uploads carry tenant metadata going forward.
