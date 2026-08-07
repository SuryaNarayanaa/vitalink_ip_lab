# Schema evolution and migrations

Mongoose schema declarations are the current model source of truth. Existing MongoDB documents are not automatically rewritten when a TypeScript default changes, so compatibility and explicit migrations matter.

## Tracked migration commands

| Command | Script | Purpose/notes from source |
| --- | --- | --- |
| `migrate:assigned-doctor-ids` | `migrateAssignedDoctorIds.ts` | Normalize patient assignments to doctor `User._id` |
| `migrate:patient-hospital-ids` | `backfillPatientHospitalIds.ts` | Backfill tenant ownership; supports dry run and `--execute` |
| `migrate:inr-critical-flags` | `migrateInrCriticalFlags.ts` | Materialize INR critical flags |
| `migrate:auth-schema-defaults` | `migrateAuthSchemaDefaults.ts` | Required exact-match security generations and auth indexes; documented as idempotent |
| `migrate:doctor-update-notifications` | `migrateDoctorChangeEventsToNotifications.ts` | Convert legacy doctor change events into notifications |
| `migrate:file-assets` | `backfillFileAssets.ts` | Build/attach tenant file metadata; dry-run by default, `--execute` writes |
| `migrate:device-tokens` | `migrateDeviceTokenOwnership.ts` | Enforce one current owner per physical FCM token |
| `migrate:admin-rbac-v2` | `migrateAdminRbacV2.ts` | Seed fixed V2 policies and translate legacy permissions transactionally |

Production variants use the compiled `:prod` npm scripts. `purge:patient-files` is an irreversible, separately authorized operational workflow, not a normal migration.

## Safe change workflow

1. Back up or establish a verified restore point; the repository cannot perform or prove this step.
2. Deploy code compatible with both old and new shapes where rolling deployment requires it.
3. Run the migration in dry-run mode when supported and retain its summary.
4. Apply against the intended environment once, from the active application image or a controlled job.
5. Verify matched/modified/skipped/failed counts, uniqueness/index state, tenant ownership, and representative records.
6. Run authentication, clinical, file, notification, and administrator smoke checks affected by the migration.
7. Remove legacy compatibility only in a later release after every environment is verified.

## Required deployment ordering

- Run `migrateAuthSchemaDefaults` before relying on login, OTP, administrator MFA, or exact security-generation predicates after upgrading legacy data.
- Complete patient hospital and assigned-doctor backfills before relying on strict tenant/assignment enforcement for legacy records.
- Complete file-asset and device-token migrations before enabling their stricter ownership paths for an existing deployment.
- Complete the RBAC V2 migration before depending on persisted administrator capability policy.

The exact per-environment sequence depends on existing schema state and is an operator decision. No deployment workflow automatically runs these scripts.

## Rollback posture

Application rollback does not automatically reverse a data migration. A migration that adds compatible fields can usually remain in place while code rolls back; destructive or semantic rewrites require a separately designed reverse/restore plan. The checked-in scripts do not collectively provide a universal database rollback mechanism.
