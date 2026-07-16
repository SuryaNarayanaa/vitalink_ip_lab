# VitaLink Architecture

This document describes the system that is currently implemented in this
repository. Planned components are called out explicitly so the diagrams do not
blur production behavior with roadmap intent.

## Current Architecture

```mermaid
flowchart LR
  subgraph Clients["Client applications"]
    FlutterMobile["Flutter mobile app\nAndroid / iOS"]
    FlutterWeb["Flutter web app"]
    AdminUI["Flutter admin console"]
  end

  subgraph Edge["Deployment edge"]
    Nginx["Nginx reverse proxy\nrate limiting + SSE proxy settings"]
  end

  subgraph Runtime["EC2 / Docker runtime"]
    Blue["Express API container\nblue slot"]
    Green["Express API container\ngreen slot"]
  end

  subgraph API["Express backend"]
    Versioning["API version boundary\n/api/v1 + legacy /api"]
    Middleware["Helmet, CORS, request IDs,\nrate limits, auth, validation"]
    Auth["Auth routes\nlogin, OTP, TOTP, refresh, revoke"]
    Patient["Patient routes\nreports, profile, dosage, notifications"]
    Doctor["Doctor routes\npatients, reports, updates, notifications"]
    Admin["Admin routes\nusers, hospitals, audit, config, broadcasts"]
    Health["Health/readiness\n/, /health/live, /health/ready"]
    Docs["API docs route\noptional /docs"]
  end

  subgraph Data["Data stores"]
    Mongo["MongoDB via Mongoose\nusers, profiles, sessions,\nnotifications, audit logs, invoices"]
    Filebase["S3-compatible Filebase bucket\nreport/profile objects"]
  end

  subgraph Providers["External providers"]
    Twilio["Twilio Verify\nSMS OTP"]
  end

  subgraph Async["Async delivery"]
    Redis["Redis + BullMQ\nnotification-delivery queue"]
    Outbox["NotificationDelivery outbox\nMongoDB status + retries"]
    FCM["Firebase Cloud Messaging\nmobile push"]
    ReminderScheduler["Scheduled dosage / INR / review\nreminder jobs"]
  end

  subgraph Planned["Planned / not implemented"]
    Monitoring["Metrics, alerting,\ndashboards, SLOs"]
  end

  FlutterMobile -->|HTTPS JSON, bearer JWT| Nginx
  FlutterWeb -->|HTTPS JSON, bearer JWT| Nginx
  AdminUI -->|HTTPS JSON, bearer JWT| Nginx
  FlutterMobile <-->|SSE notification stream| Nginx
  FlutterWeb <-->|SSE notification stream| Nginx

  Nginx -->|active upstream| Blue
  Nginx -.blue/green switch.-> Green

  Blue --> Versioning
  Green --> Versioning
  Versioning --> Middleware
  Middleware --> Auth
  Middleware --> Patient
  Middleware --> Doctor
  Middleware --> Admin
  Middleware --> Health
  Middleware --> Docs

  Auth --> Mongo
  Auth -->|start/check verification| Twilio
  Patient --> Mongo
  Doctor --> Mongo
  Admin --> Mongo
  Patient -->|presigned PUT/GET helpers| Filebase
  Doctor -->|presigned GET helpers| Filebase

  Patient --> Outbox
  Doctor --> Outbox
  Outbox --> Redis
  Redis --> FCM
  Outbox -.recovery poller when Redis down.-> FCM
  ReminderScheduler --> Mongo
  ReminderScheduler --> Outbox
  Health -.future telemetry.-> Monitoring
```

## Implemented Boundaries

- Clients are Flutter applications for web, Android, and iOS. They call the
  backend over JSON APIs and keep access/refresh tokens in secure storage.
- The backend is an Express API. Versioned traffic is mounted under
  `/api/v1`; legacy `/api` routes are still mounted with deprecation headers.
- The backend uses middleware for request IDs, structured request logging,
  Helmet, CORS, body limits, timeouts, rate limiting, authentication,
  role-based authorization, validation, audit logging, and centralized error
  handling.
- MongoDB is accessed through Mongoose models for users, patient/doctor/admin
  profiles, auth sessions, OTP challenges, notifications, audit logs, hospitals,
  invoices, and system config.
- File storage uses the AWS SDK against the Filebase S3-compatible endpoint.
  Report and profile file flows use one-hour presigned PUT/GET URLs or server
  side upload helpers, and only object keys are stored with domain records.
- Twilio Verify is implemented for patient and doctor first-login phone OTP
  verification. Admin TOTP MFA is implemented separately through backend TOTP
  services.
- In-app notifications are persisted in MongoDB. Patient and doctor clients can
  connect to process-local Server-Sent Events streams for real-time notification
  delivery while the API process is alive.
- Deployment assets describe an EC2-style Docker Compose runtime with blue and
  green backend containers behind Nginx. Nginx rate limits requests and disables
  proxy buffering for SSE streams.
- Liveness is exposed at `/health/live`; readiness is exposed at
  `/health/ready` and checks the Mongoose connection state. Docker healthchecks
  use `/health/ready`.

## Key Data Flows

### Login, OTP, and Session Flow

```mermaid
sequenceDiagram
  autonumber
  participant Client as Flutter client
  participant API as Express /api/v1/auth
  participant DB as MongoDB
  participant Twilio as Twilio Verify

  Client->>API: POST /login with credentials
  API->>DB: Load user, password hash, status, MFA flags
  alt First-login phone OTP required
    API->>Twilio: Start verification for registered phone
    API->>DB: Store OTP challenge/session state
    API-->>Client: OTP challenge response
    Client->>API: POST /login/otp/verify with code
    API->>Twilio: Check verification code
    API->>DB: Mark phone verified and create auth session
    API-->>Client: Access token, refresh token, user session
  else Admin TOTP required
    API-->>Client: TOTP challenge response
    Client->>API: POST /login/totp/verify
    API->>DB: Validate TOTP challenge and create auth session
    API-->>Client: Access token, refresh token, user session
  else Normal login
    API->>DB: Create auth session
    API-->>Client: Access token, refresh token, user session
  end
  Client->>API: Authenticated API calls with bearer access token
  Client->>API: POST /refresh with refresh token when needed
  API->>DB: Rotate/validate auth session
  API-->>Client: New access and refresh tokens
```

### Report Upload and Review Flow

```mermaid
sequenceDiagram
  autonumber
  participant Patient as Patient app
  participant API as Express patient API
  participant S3 as Filebase S3-compatible bucket
  participant DB as MongoDB
  participant Doctor as Doctor app

  Patient->>API: POST /api/v1/patient/reports with report metadata + file
  API->>API: Validate patient auth, mime type, and size
  API->>S3: Upload via presigned PUT helper
  S3-->>API: Stored object key
  API->>DB: Save report record and object key
  API-->>Patient: Created report response

  Doctor->>API: GET /api/v1/doctors/patients/{op_num}/reports
  API->>DB: Fetch assigned patient reports
  API-->>Doctor: Report metadata
  Doctor->>API: GET /api/v1/doctors/patients/{op_num}/reports/{report_id}
  API->>DB: Check assignment and load report key
  API->>S3: Generate presigned download URL
  API-->>Doctor: Report details with temporary download URL
  Doctor->>API: PUT report review/status update
  API->>DB: Persist review status/instructions
  API->>DB: Persist patient notification
  API-->>Patient: SSE doctor_update or notification event when connected
```

### Notification Flow

```mermaid
sequenceDiagram
  autonumber
  participant AdminDoctor as Admin or Doctor action
  participant API as Express API
  participant DB as MongoDB
  participant Stream as In-process SSE registry
  participant Queue as BullMQ / Redis
  participant Worker as Delivery worker
  participant Client as Flutter patient/doctor client
  participant FCM as Firebase Cloud Messaging

  Client->>API: GET notifications/stream
  API->>Stream: Register response by user id
  Stream-->>Client: connected event + heartbeat pings

  AdminDoctor->>API: Broadcast, reassignment, dosage, report, or review update
  API->>DB: Insert in-app notification
  API->>Stream: Publish event to connected user streams
  Stream-->>Client: notification or doctor_update event
  API->>DB: Insert NotificationDelivery outbox row (PENDING)
  API->>Queue: Best-effort enqueue delivery job
  Note over API,Queue: HTTP returns success even if queue or FCM is down
  Queue->>Worker: deliver(job)
  Worker->>DB: Claim delivery (PROCESSING)
  Worker->>FCM: sendEachForMulticast
  alt success
    Worker->>DB: SUCCEEDED + provider_message_id
  else transient failure
    Worker->>DB: FAILED_RETRYABLE + next_attempt_at
    Worker->>Queue: re-enqueue with exponential backoff
  else exhausted retries
    Worker->>DB: DEAD_LETTER + sanitized last_error
  end
  Client->>API: GET notifications / mark read
  API->>DB: Query or update notification read state
```

## Operational Notes

- Request logs are emitted through Morgan into the backend logger with sensitive
  query parameters redacted and an `X-Request-Id` attached to each response.
- Nginx and Docker use json-file logging with size and file-count limits in the
  checked-in deployment compose file.
- Readiness is tied to MongoDB connectivity, so a container can be live but not
  ready while Mongoose is disconnected.
- SSE streams are currently process-local. In a multi-container deployment,
  clients must stay connected to the active upstream process that owns their
  stream; cross-process fanout is a future queue/pub-sub concern.
- Firebase Cloud Messaging is integrated behind `FCM_ENABLED`. Doctor-update
  pushes are written to a durable `NotificationDelivery` outbox and processed by
  a BullMQ worker when `REDIS_URL` is set. Mongo owns attempts, backoff,
  dead-letter state, and retention TTL. If Redis is unavailable the outbox row
  remains queryable and a recovery poller drains due rows best-effort.
- Monitoring dashboards, alerting, and SLO reporting remain roadmap items.
  In-process delivery counters and structured logs (`notification_delivery.*`)
  provide baseline operational visibility.
