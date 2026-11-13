# VitaLink

VitaLink helps patients and care teams manage anticoagulation follow-up. Patients submit INR reports and track prescribed doses. Doctors review reports and update dose plans for assigned patients. Administrators manage hospital accounts, permissions, and platform settings.

## Repository layout

| Path | Contents |
| --- | --- |
| [`frontend/`](frontend/) | Flutter client for web, Android, and iOS |
| [`backend/`](backend/) | Node.js 24 and TypeScript API built with Express, Mongoose, and MongoDB |
| [`deploy/`](deploy/) | Docker Compose, Nginx, and deployment scripts for an EC2 host |
| [`docs/`](docs/) | Product workflows, architecture, API contract, and operations runbooks |
| [`infra/`](infra/) | Infrastructure and deployment guide |

## Run locally

Install Node.js 24, Docker with Compose, and Flutter. [Frontend CI](.github/workflows/frontend-ci.yml) pins the Flutter version used for checks.

From the repository root in PowerShell, install the application dependencies.

```powershell
npm.cmd ci --prefix backend
Push-Location frontend
flutter pub get
Pop-Location
```

Follow the [local development runbook](docs/operations/local-development-runbook.md) to start an isolated MongoDB replica set, build and run the backend on port `3000`, and start Flutter web on port `7357`. The runbook sets process-level overrides for `backend/.env`, which can contain shared service settings. Local demo credentials are stored per machine in the ignored `LOCAL_DEV_CREDENTIALS.md` file.

The client calls the versioned REST API at `/api/v1`. For local web builds, set `API_BASE_URL=http://127.0.0.1:3000` and `API_PATH_PREFIX=/api/v1` with Flutter's `--dart-define` flags. Use the [frontend README](frontend/README.md) for client build commands and the [environment guide](docs/environments.md) for configuration.

## Checks

- Backend commands from `backend/` are `npm run build` and `npm test`. Database integration tests use Docker through Testcontainers.
- Client commands from `frontend/` are `flutter analyze` and `flutter test`.
- For documentation, install `requirements-docs.txt` with pip, then run `python scripts/docs/validate_docs.py` and `mkdocs build --strict` from the repository root. See the [validation guide](docs/reference/validation.md) for contract and diagram checks.

## Documentation and deployment

- [Engineering documentation](docs/index.md)
- [REST API guide](docs/api/index.md) and [OpenAPI contract](docs/api/openapi.yaml)
- [Infrastructure README](infra/README.md)

VitaLink is licensed under the [MIT License](LICENSE).
