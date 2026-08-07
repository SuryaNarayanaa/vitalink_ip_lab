# ADR-0006: Use a MongoDB outbox with Redis/BullMQ delivery and recovery

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Clinical reminders and care updates must not disappear when Redis or Firebase is temporarily unavailable, and retries must not duplicate provider delivery or extend stale clinical messages indefinitely.

## Decision Drivers

- Durable intent before queue publication.
- Idempotency, retry, dead-letter, lease, and cancellation state.
- Clinical delivery validity deadline and recipient revalidation.
- Recovery when Redis publication fails.

## Considered Options

- Send Firebase synchronously in the HTTP/scheduler path.
- Redis/BullMQ as the only delivery record.
- MongoDB durable outbox distributed through BullMQ with recovery polling.

## Decision Outcome

Chosen option: persist `NotificationDelivery` in MongoDB, publish its ID to BullMQ best-effort, claim work with leases, record provider handoff/outcome, and recover due rows through a poller. MongoDB owns retry and terminal state; Redis distributes work.

### Consequences

- Good: Redis failure does not erase delivery intent.
- Good: idempotency and provider-handoff boundaries support retries and partial outcomes.
- Good: expired/ineligible clinical delivery can be skipped or cancelled.
- Bad: more states and recovery races require careful tests and operational monitoring.
- Bad: in-process counters are not durable cross-replica metrics.
- Bad: push is eventually consistent with the in-app notification.

## Links

- `backend/src/models/notificationdelivery.model.ts`
- `backend/src/services/notification-delivery.service.ts`
- `backend/src/jobs/notification-delivery.*`
