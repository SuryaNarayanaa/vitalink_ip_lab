# Codex Thread Workflow: MFA and Login Hardening

This workflow coordinates the remaining MFA and login-hardening work tracked in
`IMPLEMENTATION_GAP_ANALYSIS_AND_SCALE_PLAN.md`.

## Thread Lanes

| Lane | Model | Scope | Primary outputs |
|---|---|---|---|
| Password policy | `gpt-5.5`, medium | Password expiry, password history, policy configuration, backend tests | User/auth model changes, password-change/reset enforcement, docs and plan updates |
| Reset invalidation | `gpt-5.5`, medium | Explicit session invalidation after password reset | Auth session revocation on reset, audit coverage, targeted tests |
| Login telemetry | `gpt-5.5`, low | Login-attempt telemetry keyed by IP and normalized login ID | Audit/log telemetry, redaction checks, focused tests or verification notes |
| Verification docs | `gpt-5.5`, low | Manual and CI verification checklist for the auth hardening surface | Runbook/checklist covering MFA, OTP, lockout, throttling, refresh rotation, expiry/history, reset invalidation, and telemetry |

## Merge Order

1. Merge reset invalidation first because it should reuse the existing auth-session
   model with minimal schema overlap.
2. Merge password policy second because it may touch the `User` model and password
   reset/change flows.
3. Merge login telemetry third so it can observe the final auth failure/reset paths.
4. Merge verification docs last so checklist links and status markers match the
   actual landed implementation.

## Acceptance Gate

Each thread must provide:

- A short implementation summary.
- Files changed.
- Tests or build commands run, including any Testcontainers limitation.
- Any migration or environment variable changes.
- Updates to `IMPLEMENTATION_GAP_ANALYSIS_AND_SCALE_PLAN.md` that do not overstate
  unmerged work.

The combined work is complete only when the MFA/login-hardening section can mark:

- Password expiry/history as implemented.
- Admin/session invalidation after password reset as implemented.
- Login-attempt telemetry by IP and normalized login ID as implemented or
  explicitly documented as out of scope.

## Final Verification Pass

After all thread changes are merged, run the strongest available local checks:

- `npm run build` in `backend`.
- Backend auth-related Jest tests.
- Full backend Jest suite if Docker/Testcontainers is available.
- Flutter analyzer/tests if auth UI contract changes.
- Manual API checks for login, refresh rotation, logout revocation, password reset,
  expired-password behavior, and telemetry creation.
