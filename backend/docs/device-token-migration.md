# DeviceToken Ownership Migration

Run this migration before enabling `FCM_ENABLED=true` on an environment that may contain device-token data from the earlier per-user uniqueness model.

## Ownership policy

One physical `fcm_token` has exactly one owner. For duplicates, the migration keeps the record with the newest `last_refreshed_at`, then newest `updatedAt`, then highest ObjectId as a deterministic tie-breaker. Losing documents are deleted so MongoDB can enforce the global unique index.

## Safe rollout

1. Keep `FCM_ENABLED=false` and stop/disable device-registration traffic.
2. Back up the `devicetokens` collection.
3. Run `npm run migrate:device-tokens` and review duplicate, deletion, and index-change counts.
4. Run `npm run migrate:device-tokens -- --execute` during the registration write pause.
5. Rerun the dry run; it should report no duplicates or index changes.
6. Verify `fcm_token_1` is unique and `user_id_1_fcm_token_1` is absent.
7. Re-enable registration traffic, then set `FCM_ENABLED=true` only after Firebase credentials are configured.

The script is idempotent and fails if the final global unique index cannot be verified.
