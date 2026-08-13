# Complete end-to-end application workflow

## User journey

```mermaid
flowchart TD
    Start["Launch Flutter client"] --> Bootstrap["Restore secure session and onboarding state"]
    Bootstrap --> Session{"Valid stored session?"}
    Session -- No --> Login["Enter login ID and password"]
    Login --> Factor{"Additional factor required?"}
    Factor -- "Patient or Doctor OTP" --> SMS["Verify Twilio SMS code"]
    Factor -- "Admin TOTP" --> TOTP["Verify or enroll authenticator"]
    Factor -- No --> Tokens["Receive access and rotating refresh tokens"]
    SMS --> Tokens
    TOTP --> Tokens
    Session -- Yes --> Role
    Tokens --> Password{"Password change required?"}
    Password -- Yes --> Change["Change password and invalidate old sessions"]
    Change --> Role{"User role"}
    Password -- No --> Role
    Role -- Patient --> Patient["Patient dashboard"]
    Role -- Doctor --> Doctor["Doctor dashboard"]
    Role -- Admin --> Admin["Capability-scoped admin console"]

    Patient --> PActions["Submit INR, record dose/health, view updates"]
    Doctor --> DActions["Review patients, reports, dosage and instructions"]
    Admin --> AActions["Operate hospitals, accounts, policy and health"]

    PActions --> Persist["Express validates authorization and writes MongoDB"]
    DActions --> Persist
    AActions --> Persist
    Persist --> Notify["Persist in-app notification and optional push outbox"]
    Notify --> SSE["Publish eligible SSE event"]
    Notify --> Queue["Best-effort BullMQ publish via Redis"]
    Queue --> FCM["Firebase push delivery with retry/recovery"]
    SSE --> Patient
    SSE --> Doctor
    FCM --> Patient
    FCM --> Doctor
```

## Authentication state

```mermaid
stateDiagram-v2
    [*] --> SignedOut
    SignedOut --> PasswordAccepted: valid credentials
    SignedOut --> Locked: failure threshold reached
    Locked --> SignedOut: lock window elapsed
    PasswordAccepted --> OtpPending: doctor or patient phone pending
    PasswordAccepted --> TotpPending: admin factor enabled
    PasswordAccepted --> EnrollmentPending: admin factor required but unenrolled
    PasswordAccepted --> ActiveSession: no additional factor
    OtpPending --> ActiveSession: OTP verified
    TotpPending --> ActiveSession: TOTP verified
    EnrollmentPending --> ActiveSession: pending factor activated
    ActiveSession --> ActiveSession: access refresh rotates refresh token
    ActiveSession --> PasswordChangeRequired: password policy boundary
    PasswordChangeRequired --> SignedOut: password changed and sessions invalidated
    ActiveSession --> Revoked: logout, reset, disable, reuse, or security generation change
    Revoked --> SignedOut
```

The enrollment transition is completed in Flutter login: `TOTP_ENROLLMENT_REQUIRED` loads `POST /auth/login/totp/enroll/setup` material and `POST /auth/login/totp/enroll/activate` issues the session after a valid authenticator code. Mid-session password expiry keeps the refresh session and is surfaced by the same `PasswordChangeRequired` state after `GET /auth/me`.

## Care coordination sequence

```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant Client as Flutter client
    participant API as Express API
    participant DB as MongoDB
    participant Storage as S3-compatible storage
    actor Doctor

    Patient->>Client: Enter INR metadata and select report
    Client->>API: POST /api/v1/patient/reports (multipart)
    API->>API: Authenticate patient and validate file/metadata
    API->>Storage: Store verified object
    API->>DB: Persist FileAsset and INR history reference
    API-->>Client: Created report
    Doctor->>API: GET assigned patient reports
    API->>DB: Verify assignment and hospital, load report
    API-->>Doctor: Report metadata and authorized temporary URL
    Doctor->>API: PUT report review or care update
    API->>DB: Persist clinical update and notification
    API-->>Client: SSE notification when connected
    Patient->>Client: Review doctor update
    Client->>API: PATCH notification or doctor update as read
    API->>DB: Persist read state
```

## Failure and recovery behavior

- A confirmed invalid refresh token clears the local session; transient refresh failures are surfaced without treating them as logout.
- A failed upload is compensated by retiring/deleting the object or marking its `FileAsset` failed, depending on the failure boundary.
- Redis failure does not erase a persisted push intent. MongoDB outbox rows remain available for the recovery poller.
- Reminder keys and delivery idempotency keys suppress duplicate work across retries.
- Hospital suspension, account deactivation, assignment conflict, expired clinical validity, or changed security generation fails protected work closed.
