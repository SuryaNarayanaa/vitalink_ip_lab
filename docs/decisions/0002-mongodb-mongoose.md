# ADR-0002: Use MongoDB and Mongoose for operational persistence

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

VitaLink stores identities, role profiles, embedded clinical timelines, sessions, audit, policy history, notifications, and billing. The application needs flexible nested clinical documents plus indexes, references, transactions, TTL, and optimistic/concurrency controls.

## Decision Drivers

- Embedded patient dosage, INR, health, and configuration structures.
- ObjectId relationships across role profiles and tenants.
- Unique/partial/TTL indexes and transaction support.
- TypeScript schema/model integration.

## Considered Options

- MongoDB with Mongoose.
- Relational database with normalized tables.
- Multiple specialized persistence stores.

## Decision Outcome

Chosen option: MongoDB as the operational source of truth with Mongoose models. Patient clinical history is embedded; identities, profiles, sessions, files, notifications, policies, audit, hospitals, and invoices use separate collections and explicit references.

### Consequences

- Good: document structures align with current clinical aggregates.
- Good: TTL, unique indexes, transactions, leases, and atomic updates support current workflows.
- Bad: tenant ownership and cross-collection invariants require disciplined service checks and migrations.
- Bad: transactions require a suitable MongoDB replica-set topology.
- Bad: business identity spans `User.login_id` and profile ObjectIds.

## Links

- `backend/src/models/`
- [ER model](../data/er-diagram.md)
- [Schema evolution](../data/schema-evolution.md)
