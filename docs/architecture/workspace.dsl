workspace "VitaLink" "Source-backed C4 model for the VitaLink anticoagulation monitoring application" {
    !identifiers hierarchical

    model {
        patient = person "Patient" "Submits INR reports, records dosage and health observations, and receives care updates."
        doctor = person "Doctor" "Reviews assigned patients, reports, dosage plans, instructions, and follow-up dates."
        administrator = person "Administrator" "Operates global or hospital-scoped platform capabilities."
        operator = person "Engineering / Operations" "Builds, deploys, monitors, and recovers the checked-in runtime." "Operations"

        twilio = softwareSystem "Twilio Verify" "External SMS verification provider." "External"
        firebase = softwareSystem "Firebase Cloud Messaging" "External mobile/web push provider." "External"
        filebase = softwareSystem "S3-compatible Filebase" "External object storage for reports and profile images." "External"
        payment = softwareSystem "Configured Payment Provider" "External HTTPS checkout provider selected through environment configuration." "External"
        scanner = softwareSystem "Configured Malware Scanner" "Optional external HTTP service that must return clean=true." "External"
        loki = softwareSystem "Grafana Loki" "Optional external log aggregation endpoint." "External"

        vitalink = softwareSystem "VitaLink" "Coordinates anticoagulation monitoring and multi-tenant hospital administration." {
            flutter = container "Flutter Client" "Role-aware patient, doctor, and administrator application for web, Android, and iOS." "Flutter / Dart"
            edge = container "Nginx Edge" "Reverse proxy, edge rate limiting, forwarded headers, and SSE proxy settings." "Nginx"
            api = container "Express API" "Versioned REST API, SSE endpoints, scheduled reminders, and notification workers." "Node.js 20 / Express 5 / TypeScript" {
                http = component "HTTP Composition Root" "Request IDs, logging, Helmet, CORS, limits, versioning, routes and error handling." "Express"
                auth = component "Authentication Controllers" "Password, OTP, TOTP, refresh, revoke, logout and password-change endpoints." "TypeScript"
                sessions = component "Session and Password Services" "Persisted session validation, refresh rotation, security generations, lockout and password policy." "TypeScript"
                adminAccess = component "Administrator Access Layer" "Resolves fixed role, persisted capability policy, global/tenant scope and mutation permission." "TypeScript"
                clinical = component "Patient and Doctor Controllers" "Profiles, reports, dosage, health logs, care updates, review dates and reassignment." "TypeScript"
                files = component "File Asset Services" "Magic-byte validation, optional scanning, tenant metadata, S3 operations, presigned reads and purge." "TypeScript"
                notifications = component "Notification Services" "In-app records, stream tickets, SSE fan-out and doctor-update projections." "TypeScript"
                delivery = component "Delivery Worker and Recovery" "Durable Mongo outbox, BullMQ publication, FCM delivery, retries, expiry and dead letter." "TypeScript / BullMQ"
                administration = component "Administration Services" "Hospitals, accounts, billing, configuration, audit, statistics and lifecycle operations." "TypeScript"
                schedulers = component "Clinical Reminder Schedulers" "Idempotent dosage, INR, review and missed-dose reminder passes." "node-cron"
            }
            mongo = container "MongoDB" "Operational records, clinical data, sessions, audit logs, policies, notifications and durable delivery state." "MongoDB / Mongoose" "Database"
            redis = container "Redis and BullMQ" "Shared rate limits, single-use tickets, pub/sub and delivery jobs." "Redis 7 / BullMQ" "Database"
        }

        patient -> vitalink.flutter "Uses"
        doctor -> vitalink.flutter "Uses"
        administrator -> vitalink.flutter "Uses"
        operator -> vitalink.edge "Deploys and inspects"
        operator -> vitalink.api "Operates"

        vitalink.flutter -> vitalink.edge "Calls versioned API and opens SSE" "HTTPS/JSON + SSE"
        vitalink.edge -> vitalink.api "Proxies active deployment slot" "HTTP"
        vitalink.api -> vitalink.mongo "Reads and writes operational state" "MongoDB protocol"
        vitalink.api -> vitalink.redis "Uses counters, tickets, pub/sub and jobs" "Redis protocol"
        vitalink.api -> twilio "Starts and checks SMS verification" "HTTPS"
        vitalink.api -> firebase "Sends generic push notifications" "HTTPS"
        vitalink.api -> filebase "Stores and retrieves authorized objects" "S3 API over HTTPS"
        vitalink.api -> payment "Creates checkout sessions" "HTTPS/JSON"
        payment -> vitalink.api "Posts HMAC-signed settlement events" "HTTPS/JSON"
        vitalink.api -> scanner "Submits upload bytes when enabled" "HTTPS/JSON"
        vitalink.api -> loki "Ships sanitized logs when configured" "HTTPS"
        firebase -> vitalink.flutter "Delivers push messages" "FCM"

        vitalink.api.http -> vitalink.api.auth "Dispatches authentication routes"
        vitalink.api.http -> vitalink.api.clinical "Dispatches patient and doctor routes"
        vitalink.api.http -> vitalink.api.administration "Dispatches administrator and statistics routes"
        vitalink.api.auth -> vitalink.api.sessions "Creates and validates sessions"
        vitalink.api.auth -> twilio "Verifies phone ownership"
        vitalink.api.sessions -> vitalink.mongo "Persists sessions and reads user generations"
        vitalink.api.adminAccess -> vitalink.mongo "Loads policy and administrator scope"
        vitalink.api.administration -> vitalink.api.adminAccess "Requires capability and scope"
        vitalink.api.clinical -> vitalink.api.files "Stores and authorizes clinical files"
        vitalink.api.files -> filebase "Uses S3-compatible operations"
        vitalink.api.files -> scanner "Scans when enabled"
        vitalink.api.clinical -> vitalink.api.notifications "Creates care updates and notifications"
        vitalink.api.administration -> vitalink.api.notifications "Creates broadcasts"
        vitalink.api.schedulers -> vitalink.api.notifications "Creates idempotent reminders"
        vitalink.api.notifications -> vitalink.api.delivery "Persists push intent"
        vitalink.api.notifications -> vitalink.redis "Publishes cross-process SSE events"
        vitalink.api.delivery -> vitalink.redis "Publishes and consumes delivery jobs"
        vitalink.api.delivery -> firebase "Sends push"
        vitalink.api.auth -> vitalink.mongo "Reads identities and MFA challenges"
        vitalink.api.clinical -> vitalink.mongo "Reads and writes clinical records"
        vitalink.api.administration -> vitalink.mongo "Reads and writes administrative records"
        vitalink.api.notifications -> vitalink.mongo "Persists notifications"
        vitalink.api.delivery -> vitalink.mongo "Claims and updates durable outbox"
        vitalink.api.schedulers -> vitalink.mongo "Scans eligible patients"

        production = deploymentEnvironment "Repository-defined production" {
            ec2 = deploymentNode "EC2 host" "Checked-in target directory /opt/vitalink; live state not verified." "Linux / Docker" {
                nginxNode = deploymentNode "Nginx container" "Exposes ports 80 and 443; active config listens on HTTP." "nginx:alpine" {
                    containerInstance vitalink.edge
                }
                blueNode = deploymentNode "Blue application slot" "One deployable API slot." "node:20-alpine" {
                    containerInstance vitalink.api
                }
                greenNode = deploymentNode "Green application slot" "Inactive or previous API slot." "node:20-alpine" {
                    containerInstance vitalink.api
                }
                redisNode = deploymentNode "Redis container" "Persistent append-only Redis data volume." "redis:7-alpine" {
                    containerInstance vitalink.redis
                }
            }
            managedMongo = deploymentNode "MongoDB hosting" "Provider and topology are environment configuration." "MongoDB" {
                containerInstance vitalink.mongo
            }
            webHosting = deploymentNode "Flutter web hosting" "Source contains GitHub Pages and Vercel paths; live path is unconfirmed." "Static hosting" {
                containerInstance vitalink.flutter
            }
        }
    }

    views {
        systemContext vitalink "SystemContext" {
            include *
            autoLayout lr
            description "VitaLink users and external trust domains."
        }
        container vitalink "Containers" {
            include *
            autoLayout lr
            description "Application containers and external dependencies."
        }
        component vitalink.api "BackendComponents" {
            include *
            autoLayout lr
            description "Important backend components and dependencies."
        }
        component vitalink.api "AuthComponents" {
            include vitalink.api.http vitalink.api.auth vitalink.api.sessions vitalink.api.adminAccess vitalink.mongo vitalink.redis twilio
            autoLayout lr
            description "Authentication, session, and administrator authorization components."
        }
        component vitalink.api "ClinicalComponents" {
            include vitalink.api.http vitalink.api.clinical vitalink.api.files vitalink.api.notifications vitalink.api.schedulers vitalink.mongo vitalink.redis filebase scanner
            autoLayout lr
            description "Clinical care, file, reminder, and realtime components."
        }
        component vitalink.api "NotificationComponents" {
            include vitalink.api.notifications vitalink.api.delivery vitalink.api.schedulers vitalink.mongo vitalink.redis firebase
            autoLayout lr
            description "Notification persistence, realtime, queue, recovery, and push components."
        }
        deployment vitalink production "ProductionDeployment" {
            include *
            autoLayout lr
            description "Checked-in deployment design; not evidence of the current live topology."
        }
        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
            element "Component" {
                background #85bbf0
                color #000000
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Database" {
                shape cylinder
            }
            element "Operations" {
                background #555555
                color #ffffff
            }
        }
    }

    configuration {
        scope softwaresystem
    }
}
