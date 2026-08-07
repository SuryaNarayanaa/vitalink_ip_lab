# Frontend–backend–database sequence diagrams

## Normal authenticated request with refresh

```mermaid
sequenceDiagram
    autonumber
    participant UI as Flutter feature
    participant Client as ApiClient
    participant API as Express middleware
    participant DB as MongoDB

    UI->>Client: Call authenticated repository method
    Client->>API: Request with bearer access token
    API->>DB: Validate JWT claims against AuthSession and User security_version
    alt Access session valid
        API->>DB: Execute authorized domain query/mutation
        API-->>Client: ApiResponse with X-Request-Id
        Client-->>UI: Normalized data
    else Access expired or rejected
        API-->>Client: 401
        Client->>API: POST /auth/refresh with opaque refresh token
        API->>DB: Atomically rotate refresh hash and access token ID
        API-->>Client: New access and refresh tokens
        Client->>API: Retry original request once
        API->>DB: Validate new session and execute
        API-->>Client: Response
    end
```

## Patient report write and doctor read

```mermaid
sequenceDiagram
    autonumber
    participant PatientUI as Patient Flutter UI
    participant API as Patient/Doctor API
    participant DB as MongoDB
    participant S3 as S3-compatible storage
    participant DoctorUI as Doctor Flutter UI

    PatientUI->>API: POST report metadata and file
    API->>DB: Validate patient, hospital, feature and file lease
    API->>S3: PutObject with UUID-derived key
    API->>DB: Create FileAsset and append INR history reference
    API-->>PatientUI: Report created
    DoctorUI->>API: GET patient reports
    API->>DB: Verify assignment, hospital and FileAsset relationship
    API->>S3: Create short-lived presigned GET
    API-->>DoctorUI: Report metadata and temporary URL
```

## Administrator mutation

```mermaid
sequenceDiagram
    autonumber
    participant UI as Admin Flutter UI
    participant API as Admin route
    participant Access as Admin access layer
    participant DB as MongoDB

    UI->>API: Mutation with bearer token
    API->>DB: Authenticate live session and ADMIN user
    API->>Access: Resolve effective access snapshot
    Access->>DB: Load admin profile and persisted role policy
    Access-->>API: role, capability set, scope, hospital, policy version
    API->>API: Require capability, scope, mutation and validate input
    API->>DB: Apply tenant/global-filtered mutation
    API->>DB: Persist audit outcome
    API-->>UI: ApiResponse or structured 403/409
```

## SSE connection from Flutter web

```mermaid
sequenceDiagram
    autonumber
    participant Web as Flutter web client
    participant API as Express API
    participant Redis as Redis or local ticket registry
    participant DB as MongoDB

    Web->>API: POST notifications/stream-ticket with bearer token
    API->>DB: Validate session, user, hospital and password policy
    API->>Redis: Register single-use 30-second ticket JTI
    API-->>Web: Signed ticket
    Web->>API: EventSource GET notifications/stream?ticket=...
    API->>Redis: Atomically consume ticket JTI
    API->>DB: Revalidate user generation and session binding
    API-->>Web: connected event and heartbeats
    API-->>Web: notification or doctor_update events
```

## Durable push delivery

```mermaid
sequenceDiagram
    autonumber
    participant Domain as Domain service or scheduler
    participant DB as MongoDB
    participant Redis as BullMQ/Redis
    participant Worker as Delivery worker
    participant FCM as Firebase

    Domain->>DB: Persist Notification
    Domain->>DB: Upsert NotificationDelivery by idempotency key
    Domain->>Redis: Publish delivery ID best-effort
    Redis->>Worker: Delivery job
    Worker->>DB: Claim processing lease and re-check validity
    Worker->>FCM: Send to active device tokens
    FCM-->>Worker: Per-token outcomes
    Worker->>DB: Save successes, deactivate invalid tokens, set terminal or retry state
    alt Redis publish failed or due row was missed
        DB-->>Worker: Recovery pass claims due outbox row
        Worker->>Redis: Republish job
    end
```
