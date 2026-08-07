# Incident runbook

No on-call contacts, paging system, severity policy, or regulatory notification rules are stored in the repository. Fill those organizational fields before treating this as a production-complete incident process.

## Triage sequence

1. Record start time, reporter, environment, public symptom, affected roles/tenants, and latest release/migration/config change.
2. Preserve evidence: request IDs, sanitized logs, health output, deployment status, outbox counts, and provider status. Do not copy secrets or clinical payloads into the incident channel.
3. Check `/health/live`, `/health/ready`, `/nginx-health`, container status, active slot, MongoDB, Redis, and relevant external provider state.
4. Classify impact: authentication, tenant/privacy, clinical mutation, files, notifications, billing, availability, or documentation/deployment drift.
5. Contain with the narrowest safe control: stop a rollout, rollback, disable a feature, enter maintenance mode, suspend a compromised account/hospital, revoke sessions, or disable an external integration.
6. Validate containment with an authorized non-destructive smoke test.
7. Recover, monitor for recurrence, document residual data work, and schedule a post-incident review.

## Scenario playbooks

### Service not ready

- Inspect readiness details for database, Firebase, worker, and missing configuration.
- Compare active slot and Nginx upstream; check both slot logs.
- If caused by the new release and the prior schema remains compatible, run the rollback runbook.
- Do not mark the incident resolved from `/health/live` alone.

### MongoDB or transaction failure

- Stop write-heavy recovery attempts and preserve exact sanitized error classes/request IDs.
- Confirm connection/topology and whether replica-set transactions are supported.
- Put the application in maintenance mode if clinical or tenant mutations are ambiguous.
- Reconcile affected multi-document operations before reopening writes.

### Redis/queue failure

- Expect API rate limiting/ticket/SSE behavior to degrade to documented fallbacks and push jobs to remain in MongoDB.
- Check Redis health and `redis.*`, queue publish, subscriber, worker, and recovery events.
- After Redis recovery, verify due outbox rows are republished and the dead-letter count is not growing.
- Do not extend expired clinical delivery deadlines merely to clear a backlog.

### Notification/privacy incident

- Disable `notifications_enabled` or `NOTIFICATION_DELIVERY_ENABLED` as appropriate while retaining investigation state.
- Identify notifications/outbox rows by IDs and time window without copying message bodies.
- Verify recipient eligibility, hospital scope, device ownership, cancellation, provider handoff, and validity deadline.
- Rotate/revoke affected device tokens or provider credentials when compromise is suspected.

### Suspected cross-tenant access

- Treat as a security/privacy incident. Preserve request/audit IDs and stop the affected surface.
- Identify the exact user, role, effective policy version, hospital IDs, route, and owning records.
- Revoke active sessions and suspend the account or hospital only when the containment scope is confirmed.
- Do not query or export unrelated tenant data during investigation.

### File or malware-scanner incident

- Disable the affected upload surface or enable maintenance mode.
- Preserve `FileAsset` IDs, checksums, status, owner/tenant, scanner outcome, and object keys; do not download broad patient datasets.
- Quarantine/delete only through the authorized file workflow and record compensation/purge results.
- Rotate S3/scanner credentials if exposure is suspected.

### Payment settlement anomaly

- Disable checkout configuration or route access while retaining invoices and webhook metadata.
- Validate HTTPS provider URL, HMAC configuration, event ID, timestamp skew, session, invoice, amount, currency, and idempotent settlement state.
- Reconcile with the provider outside VitaLink before changing invoice status manually.

### Audit persistence gap

- Search for `audit.persistence_failed` and `audit_recorded:false` around the request ID/time.
- Determine whether the mutation committed; do not retry it blindly.
- Reconstruct only minimal approved audit metadata from trusted operational evidence.
- Treat repeated gaps as a monitoring/storage incident.

## Recovery exit criteria

- Health and affected role workflows are stable.
- Tenant and clinical integrity are reconciled.
- Backlogs are draining without expired or ineligible delivery.
- Compromised sessions/keys/tokens are revoked or rotated.
- Every temporary feature/maintenance control has an owner and re-enable decision.
- Timeline, impact, root cause, corrective actions, documentation updates, and evidence gaps are recorded.
