# ADR-0004: Use fixed administrator roles with persisted V2 capability policies

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Global platform operations, hospital operations, and independent read-only oversight require different scopes. Legacy permission maps do not safely express global versus tenant authority or mutation constraints.

## Decision Drivers

- Stable role semantics for Application Admin, Hospital Admin, and System Auditor.
- Namespaced global/tenant capabilities.
- Hard read-only auditor and protected recovery administrator.
- Preview, version conflict, history, restore, and route-policy coverage.

## Considered Options

- Hard-coded role checks only.
- Arbitrary user-defined roles.
- Fixed roles with persisted allowlisted capability maps.

## Decision Outcome

Chosen option: fixed role keys with complete, allowlisted V2 capability documents. Route registration declares capability, scope, mutation, and surface together. Updates use optimistic versions and append immutable revisions in a transaction. Doctor and Patient authorization remains separate and non-editable.

### Consequences

- Good: auditable policy changes without permitting arbitrary scope combinations.
- Good: route-policy tests can detect unguarded administrator surfaces.
- Good: tenant and mutation checks are explicit.
- Bad: policy availability depends on a successful RBAC migration and valid documents.
- Bad: fixed roles limit customization by design.
- Bad: legacy role endpoints remain compatibility debt.

## Links

- `backend/src/constants/admin-capabilities.ts`
- `backend/src/authorization/admin-route-policy.ts`
- [Roles and permissions](../security/roles-and-permissions.md)
