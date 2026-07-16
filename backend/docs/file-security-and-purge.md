# Upload malware scanning and patient file purge

## Malware scan hook

All backend file paths use the shared tracked-upload workflow. When `MALWARE_SCAN_ENABLED=true`, it validates the file signature, computes its SHA-256 checksum, and calls the scanner before creating an object key or presigned S3 upload. After scanning, it persists a `PENDING` FileAsset intent before the PUT; ambiguous provider outcomes and process crashes therefore remain discoverable by purge/recovery.

The scanner receives an HTTP `POST` with the raw bytes as `application/octet-stream` and these headers:

| Header | Value |
| --- | --- |
| `X-File-Name` | URL-encoded original filename |
| `X-Detected-Mime` | Server-detected MIME type |
| `X-File-Size` | Byte count |
| `X-Content-SHA256` | SHA-256 of the exact submitted buffer |
| `Authorization` | `Bearer <MALWARE_SCAN_AUTH_TOKEN>` when configured |

The response must be JSON containing a boolean `clean` field:

```json
{"clean": true}
```

The enabled hook is fail-closed. A detection, timeout, connection failure, non-2xx response, oversized response, malformed JSON, or missing boolean verdict rejects the upload before storage. Scanner errors are not treated as clean results. The URL must be absolute HTTPS. Scanner reachability is deliberately not a readiness dependency; a transient scanner outage leaves the API available but causes uploads to fail closed.

Production configuration:

```dotenv
MALWARE_SCAN_ENABLED=true
MALWARE_SCAN_URL=https://scanner.internal.example/scan
MALWARE_SCAN_AUTH_TOKEN=<secret>
MALWARE_SCAN_TIMEOUT_MS=10000
```

Keep the scanner endpoint private, authenticate it, restrict egress, and avoid logging file bytes, tokens, filenames, or scanner payloads. `/health/ready` reports `MALWARE_SCAN_URL` as missing when the hook is enabled in staging or production.

## Patient file purge workflow

Patient deactivation and file purge are intentionally separate. `DELETE /api/v1/admin/patients/:id` discharges and disables the account; it does not erase retained clinical records or files.

The file purge command is a mandatory storage-cleanup step for an independently authorized patient-data purge:

```bash
cd backend

# Preview counts only; no object keys or patient data are printed.
npm run purge:patient-files -- --patient=<login-id-or-object-id>

# Irreversibly delete objects and FileAsset metadata.
npm run purge:patient-files -- --patient=<login-id-or-object-id> --execute
```

The production build exposes the equivalent `purge:patient-files:prod` command. Run it only after the retention/legal-hold process has authorized data erasure and the patient is `Discharged` or `Deceased` with an inactive user account.

The workflow:

1. Rejects active patients.
2. Removes expired upload leases and atomically acquires a renewable purge execution ID only when no live upload or purge execution remains.
3. Deletes every version and delete marker of each patient-owned tracked object, including retryable `FAILED` assets.
4. Deletes legacy profile/report keys that have no `FileAsset` reference.
5. Reconciles that no non-deleted owned asset remains.
6. Deletes `FileAsset` metadata only after all object deletions succeed.
7. Marks the profile `COMPLETE`; on any error it marks `FAILED` and retains metadata for retry.

Version enumeration and version-specific deletion are idempotent, so rerunning a failed command is safe, including when an earlier attempt deleted an object but crashed before persisting progress. The storage identity therefore needs `s3:ListBucketVersions`, `s3:DeleteObject`, and `s3:DeleteObjectVersion` permissions for the configured bucket. The higher-level patient record purge must abort unless this command completes successfully. It must also write its own authorized audit record and apply the approved policy to database, audit, billing, and backup data; those broader governance decisions are not implied by this file-only command.

Patient upload endpoints acquire renewable leases before scanning and assert them before storage key creation, after the object PUT, before FileAsset creation, and through the owning-record commit. Purge cannot start while a live lease exists, and once purge begins no new patient upload lease can be acquired. A request that loses its lease after PUT deletes the untracked object before failing.
