# ADR-0003: Combine JWT access tokens with persisted revocable sessions

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Purely stateless JWTs cannot immediately enforce logout, account disablement, password/MFA reset, hospital suspension, or refresh-token reuse. Fully opaque access tokens add a different client/server contract. VitaLink needs bearer interoperability and server-authoritative session state.

## Decision Drivers

- Immediate revocation and credential-generation boundaries.
- Rotating refresh tokens and reuse detection.
- Account, hospital, role, and password-policy checks on every request.
- Flutter automatic refresh support.

## Considered Options

- Stateless access and refresh JWTs.
- Opaque access and refresh tokens.
- JWT access token bound to persisted session plus opaque refresh token.

## Decision Outcome

Chosen option: a signed JWT access token carries user, session, and access-token IDs; every protected request validates it against `AuthSession` and current `User.security_version`. Refresh tokens are random opaque values stored only as hashes and rotated atomically. Prior hashes support family-reuse detection.

### Consequences

- Good: logout, resets, deactivation, reuse, expiry, and hospital state fail closed.
- Good: clients retain the standard bearer-token request shape.
- Bad: every authenticated request requires database access.
- Bad: session availability depends on MongoDB.
- Bad: JWT algorithm acceptance is not explicitly pinned in current utilities.

## Links

- `backend/src/services/auth-session.service.ts`
- `backend/src/middlewares/authProvider.middleware.ts`
- [Authentication design](../security/authentication-and-authorization.md)
