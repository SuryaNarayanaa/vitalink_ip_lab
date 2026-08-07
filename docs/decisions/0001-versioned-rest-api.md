# ADR-0001: Use a versioned REST API with a legacy compatibility mount

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Flutter clients need a stable API contract while existing clients may still call unversioned `/api` paths. How should the backend evolve routes without silently breaking deployed clients?

## Decision Drivers

- Explicit compatibility boundary for compiled mobile/web clients.
- Machine-readable OpenAPI contract.
- Observable deprecation and sunset metadata.
- One implementation rather than duplicated v1/legacy controllers.

## Considered Options

- Replace `/api` immediately with `/api/v1`.
- Mount the same router under `/api/v1` and deprecated `/api`.
- Maintain separate legacy and v1 implementations.

## Decision Outcome

Chosen option: mount one router under canonical `/api/v1` and legacy `/api`. Versioned responses expose version headers; legacy responses also expose `Deprecation`, `Sunset`, and `Link`. The OpenAPI server base describes `/api/v1`.

### Consequences

- Good: one behavior implementation and an explicit client migration path.
- Good: route/OpenAPI parity can be validated mechanically.
- Bad: legacy traffic extends compatibility/security testing and must eventually be removed.
- Bad: a configurable sunset date is metadata, not automatic route removal.

## Links

- `backend/src/app.ts`
- `backend/src/middlewares/apiVersion.middleware.ts`
- [REST API guide](../api/index.md)
