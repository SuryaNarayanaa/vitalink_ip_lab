flutter run -d web-server --web-hostname 127.0.0.1 --web-port 7357


flutter build web --dart-define=API_BASE_URL=https://vitalink-uimf.onrender.com --dart-define=API_PATH_PREFIX=/api/v1
cd build/web
vercel --prod

flutter build apk --release --dart-define=API_BASE_URL=https://vitalink-uimf.onrender.com --dart-define=API_PATH_PREFIX=/api/v1

# frontend

Vitalink Flutter client for INR monitoring at PSG Medical Institute.

## Getting Started

This project is a Flutter application for patients, doctors, and admins.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Folder Structure

```text
frontend/
├── analysis_options.yaml
├── pubspec.yaml
├── README.md
│
├── android/                  # Android project files
├── ios/                      # iOS project files
├── web/                      # Web assets (index.html, manifest, icons)
├── assets/                   # Images, icons, onboarding art
├── test/                     # Flutter widget/unit tests
│
└── lib/                      # Application source
    ├── main.dart             # App entry point
    │
    ├── app/                  # App shell and routing
    │
    ├── core/
    │   ├── auth/             # Session bootstrap, route guards, expiry
    │   ├── constants/        # Static values (colors, strings)
    │   ├── di/               # Dependencies and theme
    │   ├── network/          # API client
    │   ├── query/            # Query keys (admin/doctor/patient)
    │   ├── storage/          # Secure storage
    │   └── widgets/          # Shared UI (admin/doctor/patient/common)
    │
    ├── features/             # Role-based feature modules
    │   ├── admin/            # Console, analytics, config, management
    │   ├── doctor/           # Dashboard, patients, reports
    │   ├── login/            # Auth flows
    │   ├── notifications/    # Notification center
    │   ├── onboarding/       # First-run onboarding
    │   └── patient/          # Dashboard, dosage, INR, profile
    │
    └── services/             # Patient service, push, realtime
```
