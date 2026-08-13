# Individual feature workflows

## Password, OTP, TOTP, and session issuance

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as Flutter app
    participant Auth as Auth controller
    participant DB as MongoDB
    participant Twilio as Twilio Verify

    User->>App: Submit login ID and password
    App->>Auth: POST /auth/login
    Auth->>DB: Load user/profile, check lockout, password, hospital, policy
    alt Doctor or patient phone verification required
        Auth->>Twilio: Start SMS verification
        Auth->>DB: Create OTP challenge bound to user, phone hash, profile and security version
        Auth-->>App: 202 OTP challenge
        App->>Auth: POST /auth/login/otp/verify
        Auth->>Twilio: Check code
        Auth->>DB: Mark phone verified and create AuthSession
    else Admin TOTP enabled
        Auth->>DB: Create TOTP login challenge
        Auth-->>App: 202 TOTP challenge
        App->>Auth: POST /auth/login/totp/verify
        Auth->>DB: Verify code, replay step, factor generation and challenge
        Auth->>DB: Create AuthSession
    else Admin enrollment required
        Auth->>DB: Create password-bound enrollment challenge
        Auth-->>App: 202 enrollment required
        App->>Auth: POST enrollment setup then activate
        Auth->>DB: Encrypt active TOTP secret and create AuthSession
    else No factor required
        Auth->>DB: Create AuthSession
    end
    Auth-->>App: Access token, opaque refresh token and session metadata
```

The Flutter OTP form uses `resend_available_at`, remaining attempts, and max resends from the challenge payload. Resend stays disabled during cooldown or after the resend budget is exhausted; verify is blocked when the challenge is expired or has no attempts left.

!!! warning "Current client integration gap"
    The enrollment branch above documents the implemented backend contract. The current Flutter login repository handles `OTP_REQUIRED` and `TOTP_REQUIRED`, but not `TOTP_ENROLLMENT_REQUIRED`; see [INC-01](../reference/inconsistencies.md#inc-01-backend-admin-enrollment-is-not-handled-by-flutter-login).

## Patient INR report upload

The Update INR form rejects empty, non-decimal, zero, and values above 20 before `POST /patient/reports`, matching `reportSchema`.

```mermaid
flowchart TD
    Select["Patient selects PDF or image and enters INR/test date"] --> Route["POST /patient/reports multipart field file"]
    Route --> Gate{"Active patient, hospital and feature access?"}
    Gate -- No --> Reject["Reject without storage write"]
    Gate -- Yes --> Validate["Validate size, declared MIME, magic bytes and metadata"]
    Validate --> Scan{"Malware scanning enabled?"}
    Scan -- Yes --> Scanner["External scanner must return clean=true"]
    Scanner --> Clean{"Clean?"}
    Clean -- No --> Reject
    Scan -- No --> Lease["Acquire patient file-operation lease"]
    Clean -- Yes --> Lease
    Lease --> Object["Write UUID-keyed object to S3-compatible bucket"]
    Object --> Asset["Create tenant-scoped FileAsset"]
    Asset --> Profile["Append INR history with file_asset_id and compatibility key"]
    Profile --> Success["Return created report"]
    Object -. later persistence failure .-> Compensate["Delete/retire object and asset"]
    Asset -. domain write failure .-> Compensate
```

## Dosage adherence and reminders

```mermaid
stateDiagram-v2
    [*] --> Scheduled
    Scheduled --> ReminderEligible: dosage due and active therapy
    ReminderEligible --> NotificationCreated: unique reminder key inserted
    NotificationCreated --> PushOutbox: delivery intent persisted
    PushOutbox --> Delivered: worker succeeds before validity deadline
    PushOutbox --> Retryable: transient provider or queue failure
    Retryable --> PushOutbox: backoff and recovery enqueue
    Retryable --> DeadLetter: max attempts reached
    ReminderEligible --> Skipped: duplicate, feature disabled, or recipient ineligible
    Scheduled --> Taken: patient records dosage
    Scheduled --> Missed: scheduled date passes without taken dose
    Missed --> Escalated: threshold within configured window reached
    Escalated --> NotificationCreated
```

## Doctor review and care-plan update

```mermaid
flowchart LR
    Roster["GET assigned patients"] --> Detail["Open patient detail"]
    Detail --> Authz["Re-check assignment, hospital and account state"]
    Authz --> Reports["View report history and temporary file URL"]
    Authz --> Dosage["Update weekly dosage"]
    Authz --> Instructions["Update care instructions"]
    Authz --> Review["Update next review date"]
    Authz --> Reassign["Reassign to eligible same-hospital doctor"]
    Reports --> Event["Persist doctor update/notification"]
    Dosage --> Event
    Instructions --> Event
    Review --> Event
    Reassign --> Event
    Event --> Patient["Patient reads update through REST, SSE, or optional push"]
```

## Hospital and account lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Suspending: authorized suspension
    Suspending --> Suspended: membership writes fenced, accounts disabled, sessions revoked
    Suspending --> Suspending: interrupted transition remains resumable
    Suspended --> Activating: authorized reactivation
    Activating --> Active: membership/accounts reconciled
    Activating --> Activating: interrupted transition remains resumable
    Active --> Inactive: authorized deactivation path
```

Hospital lifecycle uses a lease and monotonic generation. Doctor lifecycle and patient assignment use related leases/fences so stale workers cannot safely resume after losing ownership.

## Administrator role-policy change

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant UI as Admin console
    participant API as Role-policy API
    participant DB as MongoDB transaction

    UI->>API: GET policy and current version
    API-->>UI: Fixed role, allowlist map and policy_version
    Admin->>UI: Change editable capability switches
    UI->>API: POST preview with expected_version
    API->>API: Validate role allowlist, mutation/read rules and protected invariants
    API-->>UI: Added/removed capabilities and affected account count
    UI->>API: PUT update with expected_version and reason
    API->>DB: Atomically compare version, update policy and append immutable revision
    alt Version is stale
        API-->>UI: 409 conflict with current policy
    else Update succeeds
        API-->>UI: New policy and incremented version
    end
```

## Notification delivery

```mermaid
flowchart TD
    Domain["Clinical or administrative event"] --> InApp["Persist Notification"]
    InApp --> Realtime["Publish to eligible SSE streams"]
    InApp --> Intent{"Push required?"}
    Intent -- No --> Done["REST/in-app delivery only"]
    Intent -- Yes --> Outbox["Upsert NotificationDelivery by idempotency key"]
    Outbox --> Queue["Publish delivery ID to BullMQ"]
    Queue --> Claim["Worker claims Mongo lease"]
    Claim --> Valid{"Recipient and clinical validity still valid?"}
    Valid -- No --> Skip["SKIPPED"]
    Valid -- Yes --> FCM["Send generic push through Firebase"]
    FCM --> Result{"Provider outcome"}
    Result -- Success --> Succeeded["SUCCEEDED"]
    Result -- Transient --> Retry["FAILED_RETRYABLE with next_attempt_at"]
    Result -- Permanent or exhausted --> Dead["DEAD_LETTER"]
    Retry --> Recovery["Worker/recovery poller republishes due row"]
    Recovery --> Claim
```

## Billing checkout and settlement

```mermaid
sequenceDiagram
    autonumber
    actor HospitalAdmin
    participant API as Billing API
    participant DB as Invoice collection
    participant Provider as Configured HTTPS payment provider

    HospitalAdmin->>API: POST /admin/billing/checkout/{invoiceId}
    API->>DB: Verify tenant invoice, capability and unpaid state
    API->>DB: Reserve unique checkout session metadata
    API->>Provider: Create checkout with server-owned amount and invoice
    Provider-->>API: checkout_url
    API->>DB: Mark reserved session open and store URL
    API-->>HospitalAdmin: Checkout session details
    Provider->>API: POST /webhooks/payment with event, timestamp and HMAC
    API->>API: Verify skew, signature, amount, currency and session
    API->>DB: Idempotently mark session settled and invoice paid
    API-->>Provider: Settlement acknowledged
```

The provider brand and live endpoint are configuration, not source-backed facts.

## Runtime configuration and feature flags

```mermaid
flowchart LR
    Admin["Authorized Application Admin"] --> API["GET/PUT /admin/config"]
    API --> Active["Single active SystemConfig document"]
    Active --> Cache["Configuration service cache"]
    Cache --> Middleware["Maintenance and registration enforcement"]
    Cache --> Reminders["Notification feature eligibility"]
    Cache --> Sessions["Session timeout calculation"]
    API --> Audit["Audit CONFIG_UPDATE outcome"]
```
