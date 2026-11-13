# MongoDB, GCP databases and object storage

Research date: 2026-10-28. Status: evaluation, not an approved migration. Findings combine inspected local source with provider documentation. No production database, cloud account, workload or bill was inspected.

## Recommendation

For moving VitaLink onto GCP with the least application change, shortlist **MongoDB Atlas hosted on Google Cloud plus Google Cloud Storage for files**. Atlas remains MongoDB-managed even when hosted on GCP.

If the requirement is to replace MongoDB with a Google-managed database, shortlist **Cloud SQL PostgreSQL plus Cloud Storage**. PostgreSQL fits the related hospitals, identities, assignments, invoices and audit records. It requires a persistence rewrite and data conversion.

Firestore Enterprise with MongoDB compatibility deserves an isolated proof of concept, but unsupported partial indexes block an unchanged schema migration. Cloud Storage holds files; it cannot replace the database's queries, transactions and constraints. See the [Cloud Storage overview](https://docs.cloud.google.com/storage/docs/introduction).

## Current implementation requirements

The source exports 20 Mongoose models through `backend/src/models/index.ts`.

| Observed behavior | Source | Migration requirement |
| --- | --- | --- |
| Embedded clinical histories and ObjectId references | `backend/src/models/patientprofile.model.ts`, `backend/src/models/index.ts` | Preserve IDs, nested entry IDs, dates and history ordering |
| Account and policy transactions | `backend/src/services/admin-account.service.ts`, `backend/src/services/admin-role-policy.service.ts` | Preserve rollback, concurrency guards and audit consistency |
| Aggregation joins and collection unions | `backend/src/services/statistics.service.ts` | Verify full query pipelines and tenant filtering |
| Partial unique indexes | `backend/src/models/systemconfig.model.ts`, `backend/src/models/invoice.model.ts` | Preserve one active configuration and applicable hospital/billing-period uniqueness |
| Unique, sparse and TTL indexes | Session, challenge and notification models | Preserve idempotency, nullable-key semantics and retention; keep expiry rejection independent of asynchronous cleanup |
| Clinical objects in Filebase S3, with FileAsset authorization records | `backend/src/config/s3-client.ts`, `backend/src/utils/fileUpload.ts`, `backend/src/services/fileasset.service.ts` | Migrate bytes separately; preserve ownership, checksums and compensation |
| Branding bytes in MongoDB | `backend/src/models/brandasset.model.ts` | Decide separately whether to move branding objects; preserve their public URLs |

Redis/BullMQ remains a separate dependency. Changing the operational database does not replace queue and coordination behavior described in the [deployment documentation](../architecture/deployment.md).

## Database options

Effort and suitability are engineering judgments based on the inspected implementation, not benchmarks or delivery estimates.

| Option | Capability | Relative migration effort | VitaLink assessment |
| --- | --- | --- | --- |
| MongoDB Atlas on GCP | Existing engine on managed Google Cloud infrastructure | Low compared with changing engines; networking, tier, backups and rehearsal still needed | Best near-term hosting move |
| Firestore Enterprise, MongoDB-compatible mode | Google-managed serverless document store using MongoDB APIs | Medium or higher; index redesign and behavior tests | Conditional proof of concept |
| Cloud SQL PostgreSQL | Managed relational database | High; replace Mongoose queries and convert documents | Preferred candidate when replacing MongoDB |
| AlloyDB PostgreSQL | Managed PostgreSQL-compatible service for demanding workloads | High; same data-model rewrite and separate sizing | Consider if PostgreSQL benchmarks justify it |
| Firestore Native mode | Documents with client SDKs, offline and realtime support | High; replace persistence APIs and reassess query/security design | Consider for a deliberate Firebase-oriented redesign |
| Spanner | Distributed database with relational capabilities and horizontal scale | Very high | No inspected scale evidence justifies starting here |
| Bigtable | Wide-column storage for large datasets | Very high; poor fit for current cross-record invariants | Possible future telemetry store |
| Self-managed MongoDB/PostgreSQL on Compute Engine or GKE | Control over database configuration | Engine-dependent code work, high operational responsibility | Requires owners for patching, replication, backup and restore |

Provider references: [Atlas](https://www.mongodb.com/docs/atlas/reference/cloud-providers/), [Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/introduction), [AlloyDB](https://docs.cloud.google.com/alloydb/docs/overview), [Firestore Native](https://docs.cloud.google.com/firestore/native/docs/overview), [Spanner](https://cloud.google.com/spanner), [Bigtable](https://docs.cloud.google.com/bigtable/docs/overview).

Outside Google-managed services, [Supabase](https://supabase.com/docs/guides/database/overview) and [Neon](https://neon.com/docs/introduction) are PostgreSQL alternatives. Both still require the core MongoDB-to-PostgreSQL rewrite. Evaluate their surrounding auth/storage products separately from the existing backend, and confirm region, networking, recovery and plan limits.

## Firestore compatibility findings

Google lists Mongoose and Node drivers 5.x/6.x in its [supported tools and drivers](https://docs.cloud.google.com/firestore/mongodb-compatibility/docs/supported-data-types-drivers). The installed tree has Mongoose 8.24.4 using driver 6.20.0, plus a direct driver 7.6.0 dependency. The latter is outside the listed versions. No direct driver import was found under `backend/src` in the scoped search. This is local dependency evidence, not production inventory or tested compatibility.

The [7.0 feature matrix](https://docs.cloud.google.com/firestore/mongodb-compatibility/docs/supported-features-70) and [8.0 matrix](https://docs.cloud.google.com/firestore/mongodb-compatibility/docs/supported-features-80) list unique, sparse and TTL indexes as supported, and partial indexes as unsupported. VitaLink uses partial uniqueness for active SystemConfig documents and hospital/billing-period invoices. Removing these indexes would remove concurrency protection. Possible replacements include uniquely keyed active-config records and invoice-period claim records, committed transactionally. These designs are proposed and untested.

[Behavior differences](https://docs.cloud.google.com/firestore/mongodb-compatibility/docs/behavior-differences) include disabled retryable writes, different errors, explicit multikey index configuration and different default indexing. Connection settings require `retryWrites=false`. Transactions are supported, but conflict/retry behavior, duplicate-key handling, `_id` sorting and pagination need integration tests.

The [location list](https://docs.cloud.google.com/firestore/mongodb-compatibility/docs/locations) includes Mumbai and Delhi. Choose against actual backend location and data-location requirements. A database's provisioned location cannot change in place. No suitable deployment region or contractual controls were established here.

## PostgreSQL migration design

Proposed tables include hospitals, users, profiles, assignments, invoices, audit events, sessions, challenges, notifications, deliveries and file assets. INR entries and health logs are candidates for child tables. JSONB can retain bounded flexible presentation/configuration values.

PostgreSQL supports [partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html), including conditional uniqueness. Map each rule deliberately, including absent versus null fields. Replace TTL indexes with scheduled cleanup while keeping expiry checks. Preserve password hashes, session revocation versions, token identifiers and tenant authorization.

Keep REST contracts stable where practical, with an ID mapping if needed. Replace Mongoose validation/hooks, populated references, array updates, aggregation pipelines and migration scripts. Copying MongoDB JSON into JSONB alone does not complete this work.

## Cloud Storage migration

Implement an adapter for uploads, authorized download URLs, deletes and object generations. The current client hardcodes Filebase's endpoint and uses S3 version-list/delete commands. An endpoint change alone is not proven sufficient.

Retain FileAsset hospital/owner/purpose/status checks, content validation, malware-scan integration, SHA-256 reconciliation and cleanup after failed uploads. Prefer runtime service-account identity for a native GCP integration. Clinical files remain private; branding currently has a separate public-serving policy.

Reconcile purge with versioning, retention and [soft delete](https://docs.cloud.google.com/storage/docs/soft-delete). New buckets normally receive seven-day soft delete unless overridden by applicable settings. A successful delete must not be reported as immediate irreversible erasure without checking retained generations and policy. No live bucket was inspected.

## Cost assessment

No defensible monthly total is available without workload and region measurements. Compare equivalent availability, backup and recovery settings.

| Service | Main cost inputs |
| --- | --- |
| Atlas | Provider/region, tier, storage, backups and transfer; [configuration costs](https://www.mongodb.com/docs/atlas/billing/cluster-configuration-costs/) |
| Firestore Enterprise | Read units in 4 KiB tranches, write units in 1 KiB tranches, indexes/storage, transfer and recovery; [pricing](https://cloud.google.com/firestore/enterprise/pricing) |
| Cloud SQL | Provisioned CPU/RAM, HA, storage, backups, replicas and networking; [pricing](https://cloud.google.com/sql/pricing) |
| Cloud Storage | Bytes/class, operations, transfer, applicable retrieval fees and retained copies; [pricing](https://cloud.google.com/storage/pricing) |

Measure patient reads, growing history updates, dashboard queries and downloads. API request count alone cannot price Firestore. Collect DB/index size, daily read/write volume, peak concurrency, file size/count, monthly downloads and retention. Include migration engineering and operations in the comparison.

## Proposed evaluation and cutover

1. Establish the objective: GCP hosting, Google-managed services, lower cost or relational redesign. Inventory actual deployments, indexes, volumes, recovery objectives and downtime tolerance.
2. Rehearse Atlas-on-GCP and Cloud Storage on synthetic or approved de-identified data. Prototype PostgreSQL or Firestore separately if replacing MongoDB is required.
3. Verify login/revocation, OTP/MFA expiry, tenant isolation, concurrent assignments, invoice uniqueness, policy rollback/audit, notification idempotency, pagination and file purge. Reconcile counts, relationships, timestamps, clinical entries and checksums.
4. Benchmark representative histories/concurrency and calculate regional costs. Restore a backup into isolation and record observed recovery time and data loss window.
5. Select a target after evaluation. Create a superseding MADR for [ADR-0002](../decisions/0002-mongodb-mongoose.md) if changing engines, and revisit [ADR-0005](../decisions/0005-tenant-scoped-file-assets.md) for storage integration changes.
6. Plan a controlled write pause, final delta copy and reconciliation. Define rollback before target writes start. Returning after new writes requires data reconciliation, not only a connection-string reset. Separate database and file cutovers where feasible.

See [open questions](open-questions.md#gcp-database-and-storage-evaluation-2026-10-28) for unconfirmed inputs. No migration, provisioning or architectural acceptance occurred during this research.
