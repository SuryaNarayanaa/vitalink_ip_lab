# VitaLink engineering documentation

VitaLink is a multi-role anticoagulation monitoring application. Patients submit INR reports, track prescribed dosage and adherence, and receive care updates. Doctors manage assigned patients, review INR reports, update dosage plans, and coordinate care. Administrators manage hospitals, accounts, access policy, billing, configuration, audit history, and operational health.

This site documents the implementation on the repository's `main` branch at commit `b73965c`. It is derived from the Flutter client, Express/Mongoose backend, deployment assets, tests, workflows, environment examples, and external-service adapters. It deliberately separates checked-in behavior from recommendations and unknown live-environment facts.

## Documentation map

| Need | Start here |
| --- | --- |
| Understand the product and its boundaries | [Overview and problem](product/overview.md) |
| See a complete user journey | [End-to-end journey](workflows/end-to-end.md) |
| Understand system structure | [C4 model](architecture/c4.md) |
| Integrate with the backend | [REST API guide](api/index.md) and [OpenAPI specification](api/openapi.yaml) |
| Understand persisted data | [ER model](data/er-diagram.md) and [entity catalog](data/entities.md) |
| Review identity and access controls | [Authentication and authorization](security/authentication-and-authorization.md) |
| Deploy or recover the service | [Deployment runbook](operations/deployment-runbook.md) and [rollback runbook](operations/rollback-runbook.md) |
| See what remains unconfirmed | [Open questions](reference/open-questions.md) and [inconsistencies](reference/inconsistencies.md) |
| Reproduce documentation checks | [Validation report](reference/validation.md) |

## Confirmed implementation at a glance

- Flutter supports web, Android, and iOS from one role-aware client.
- The canonical REST base is `/api/v1`; legacy `/api` routes remain mounted with deprecation headers.
- The backend is Express 5 with TypeScript, Mongoose/MongoDB, Zod validation, revocable JWT-backed sessions, Twilio Verify OTP, administrator TOTP, persisted administrator RBAC, server-sent events, and optional Firebase push delivery.
- Redis supports shared rate limiting, stream-ticket consumption, pub/sub fan-out, and BullMQ notification delivery. The code has process-local degraded fallbacks for selected functions.
- Filebase-compatible S3 storage holds clinical reports and profile images; MongoDB `FileAsset` records are the tenant-scoped authorization anchor.
- Checked-in deployment assets describe Nginx plus blue/green API containers and Redis on an EC2-style Docker Compose host.

## Documentation status

The OpenAPI contract and model catalog are checked against source by `scripts/docs/validate_docs.py`. Mermaid, Structurizr, MkDocs, and link checks are part of the documentation workflow. Live infrastructure, backups, support ownership, compliance certification, and formal SLOs are not provable from source and remain explicitly open.
