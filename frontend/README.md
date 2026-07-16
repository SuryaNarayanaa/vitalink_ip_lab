flutter run -d web-server --web-hostname 127.0.0.1 --web-port 7357


flutter build web --dart-define=API_BASE_URL=https://vitalink-uimf.onrender.com --dart-define=API_PATH_PREFIX=/api/v1
cd build/web
vercel --prod

flutter build apk --release --dart-define=API_BASE_URL=https://vitalink-uimf.onrender.com --dart-define=API_PATH_PREFIX=/api/v1

# frontend

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

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
├── linux/                    # Linux runner
├── macos/                    # macOS runner
├── web/                      # Web assets (index.html, manifest, icons)
├── windows/                  # Windows runner
├── test/                     # Flutter widget/unit tests
│
└── lib/                      # Application source
    ├── main.dart             # App entry point
    │
    ├── app/                  # App-level setup (routing, theme, etc.)
    │
    ├── core/
    │   ├── constants/        # Static values (colors, strings, assets)
    │   ├── utils/            # Helpers and utilities
    │   └── widgets/          # Reusable UI components
    │
    ├── features/             # Feature modules
    │   ├── home/
    │   └── login/
    │
    ├── models/               # Data models
    └── services/             # API clients and service layer
```
