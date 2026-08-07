# ADR-0008: Use short-lived single-use tickets for browser SSE authentication

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Browser `EventSource` cannot attach a bearer Authorization header. Putting the normal long-lived access token in a query string increases replay and logging exposure.

## Decision Drivers

- Browser compatibility.
- Very short exposure window.
- Single-use replay control.
- Binding to the authenticated session and credential generation.
- Query redaction at application and edge logs.

## Considered Options

- Put the access JWT in the SSE query string.
- Use cookies for SSE authentication.
- Exchange the bearer token for a short-lived, single-use stream ticket.

## Decision Outcome

Chosen option: authenticated clients request a 30-second signed ticket containing user, role, purpose, JTI, session ID, access-token ID, and security generation. Redis atomically stores/consumes the JTI; a process-local map is the degraded fallback. Stream setup revalidates the user, session, hospital, and password policy.

### Consequences

- Good: normal access tokens are not placed in browser SSE URLs.
- Good: replay and post-revocation use are constrained.
- Good: Nginx/application log configuration omits or redacts the ticket.
- Bad: Redis-unavailable degraded single-use state is per process.
- Bad: ticket exchange adds one request before SSE connection/reconnection.

## Links

- `backend/src/services/notification-stream-ticket.service.ts`
- `backend/src/services/notification-stream-auth.service.ts`
- `frontend/lib/services/realtime/notification_stream_client_web.dart`
