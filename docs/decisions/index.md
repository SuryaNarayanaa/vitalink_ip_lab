# Architecture Decision Records

These records use MADR headings. They document important decisions already embodied in source; they do not claim the original decision date or meeting history.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-versioned-rest-api.md) | Accepted, retrospective | Canonical `/api/v1` with temporary legacy `/api` mount |
| [0002](0002-mongodb-mongoose.md) | Accepted, retrospective | MongoDB/Mongoose operational persistence |
| [0003](0003-revocable-jwt-sessions.md) | Accepted, retrospective | JWT access plus persisted revocable sessions and rotating opaque refresh tokens |
| [0004](0004-persisted-admin-rbac.md) | Accepted, retrospective | Fixed administrator roles with persisted capability policy |
| [0005](0005-tenant-scoped-file-assets.md) | Accepted, retrospective | Server-mediated S3 storage with tenant-scoped FileAsset metadata |
| [0006](0006-durable-notification-delivery.md) | Accepted, retrospective | MongoDB outbox with Redis/BullMQ delivery and recovery |
| [0007](0007-blue-green-deployment.md) | Accepted for checked-in EC2 path | Nginx blue-green API slots on Docker Compose |
| [0008](0008-single-use-sse-tickets.md) | Accepted, retrospective | Short-lived, single-use, session-bound SSE tickets for EventSource |

Future architecture changes should add a new decision or explicitly supersede an existing record. Historical accepted records should not be rewritten to imply a decision was never made.
