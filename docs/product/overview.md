# Project overview and problem statement

## Problem

Anticoagulation therapy requires repeated INR monitoring, dosage adherence, timely clinician review, and clear communication. Fragmented reports and informal follow-up make it difficult for a patient to know what to do next and for a doctor to see current therapy state. A hospital operator also needs tenant-scoped account, audit, notification, and policy controls without exposing one hospital's data to another.

VitaLink addresses that coordination problem with a shared clinical workflow:

1. A patient records dosage, health observations, and INR results.
2. The assigned doctor reviews the patient's record and updates dosage, instructions, reports, or the next review date.
3. Notifications, scheduled reminders, SSE, and optional push delivery communicate relevant changes.
4. Administrators manage the hospital and platform boundaries around the care workflow.

## Product objective

The implemented objective is to make anticoagulation monitoring traceable and role-appropriate while maintaining account, hospital, and file-ownership boundaries. The source does not claim automated diagnosis, autonomous dose recommendation, or replacement of clinical judgment.

## Current solution

| Layer | Implemented technology | Responsibility |
| --- | --- | --- |
| Client | Flutter/Dart | Role-aware web and mobile UI, secure token storage, API calls, notifications, local caching |
| API | Express 5/TypeScript | Validation, authentication, authorization, clinical and administrative orchestration |
| Persistence | MongoDB/Mongoose | Identities, profiles, clinical history, sessions, audit, notifications, billing, policy |
| Async and shared state | Redis/BullMQ | Notification jobs, pub/sub, shared counters, single-use stream-ticket state |
| Object storage | S3-compatible Filebase endpoint | INR reports and profile images |
| Identity factors | Twilio Verify and local TOTP service | Doctor/patient phone verification and administrator authenticator-app MFA |
| Push | Firebase Cloud Messaging | Optional device push delivery through a durable outbox |

## Explicit non-goals evidenced by the repository

- The tracked ML service is not an operational service: `ml-service/main.py` only prints a greeting, and no backend or frontend code calls it.
- Tracked `ml_pipeline` content consists of Python bytecode caches without corresponding source. It cannot be treated as a deployable dosing engine.
- No source implements automatic dosage prediction in the care path.
- No repository evidence confirms regulatory certification, a production SLO, or a disaster-recovery guarantee.

See [Open questions](../reference/open-questions.md) for evidence that is missing rather than inferred.
