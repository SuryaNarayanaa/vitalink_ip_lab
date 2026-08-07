# ADR-0005: Authorize stored files through tenant-scoped FileAsset metadata

## Status

Accepted — retrospective record of current implementation.

## Context and Problem Statement

Clinical reports and profile images live in object storage. Raw object keys alone are not a sufficient authorization model and make tenant ownership, integrity, compensation, and purge difficult to prove.

## Decision Drivers

- Server-authoritative tenant, owner, patient context, and purpose.
- File integrity metadata and safe object naming.
- Short-lived authorized reads.
- Compatibility/backfill for legacy key-only records.
- Compensation and irreversible purge boundaries.

## Considered Options

- Store uploads directly on the API filesystem.
- Persist raw S3 URLs/keys on profiles and reports.
- Persist S3 objects plus a tenant-scoped FileAsset authorization record.

## Decision Outcome

Chosen option: server-mediated S3-compatible storage with UUID-derived keys and `FileAsset` metadata. New reads validate domain ownership and asset hospital/owner/purpose/status before generating a presigned URL. Upload failures compensate, and legacy fallback is constrained by a coordinated cutoff.

### Consequences

- Good: object location is separated from authorization.
- Good: integrity, ownership, lifecycle, backfill, and purge are traceable.
- Bad: upload/domain persistence spans systems and needs compensation rather than one transaction.
- Bad: legacy records require controlled backfill and cutoff coordination.
- Bad: scanner protection exists only when the external scanner is enabled/configured.

## Links

- `backend/src/models/fileasset.model.ts`
- `backend/src/services/fileasset.service.ts`
- `backend/src/services/patient-file-purge.service.ts`
