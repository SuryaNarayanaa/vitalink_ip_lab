# ADR-0014: Build the existing Vercel frontend from GitHub pushes

## Status

Accepted on 2026-10-21 for the `vitalinkwebapp` Vercel project.

## Context and problem statement

The user wants GitHub pushes to deploy the existing Vercel web application. The project is already connected to the repository, but its empty build settings do not build Flutter source. The repository also has a separate GitHub Pages workflow and historical manual static-upload instructions.

## Decision drivers

- Keep the existing Vercel project and production domain.
- Build committed Flutter source automatically.
- Match the Flutter version pinned by frontend CI.
- Use the user-selected Cloud Run backend.

## Considered options

- Continue building locally and uploading `build/web` manually.
- Add a GitHub Actions Vercel upload job with deployment credentials.
- Use Vercel's existing GitHub connection and custom Flutter build settings.

## Decision outcome

Use Vercel's GitHub integration. Production tracks `main`, the root is `frontend`, and the output is `build/web`. The install command clones Flutter 3.44.8 into `/tmp/vitalink-flutter` and resolves dependencies. The release build explicitly compiles the Cloud Run API origin and `/api/v1` prefix. Exact dashboard commands are in the [deployment runbook](../operations/deployment-runbook.md#vercel-web-deployments-from-github).

### Consequences

- A push to `main` starts a production build; local commits require a push.
- Other branches can produce Preview deployments, whose backend CORS access requires separate verification.
- SDK download and dependency resolution require network access during builds.
- Flutter updates require keeping Vercel and frontend CI settings in sync.
- Dashboard settings are external configuration recorded here for recovery.
- GitHub Pages delivery remains separate. No backend deployment or persistence change is introduced.
- The relative `/api/*` rewrite still targets Render. The explicit build-time API origin sends application requests directly to Cloud Run.

## Links

- [Vercel Git integration](https://vercel.com/docs/git)
- [Deployment verification questions](../reference/open-questions.md#vercel-github-deployment-verification-2026-10-21)
