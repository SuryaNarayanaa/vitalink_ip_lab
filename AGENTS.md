# Repository documentation contract

This repository uses documentation-as-code under `docs/`, configured by `mkdocs.yml`.

For every future Codex task:

1. Inspect the relevant implementation before changing documentation or code.
2. Update affected documentation in the same change whenever application behavior, frontend routes or workflows, REST API routes or payloads, database schemas or indexes, authentication or authorization behavior, security controls, external integrations, deployment topology, or CI/CD behavior changes.
3. Update `docs/api/openapi.yaml` and `backend/docs/api/openapi.yaml` together for API contract changes. They must remain byte-for-byte identical.
4. Update the model inventory and ER documentation for persistence changes. Keep each `<!-- model: ModelName -->` marker in `docs/data/entities.md` synchronized with the Mongoose models exported by `backend/src/models/index.ts`.
5. Create or supersede a MADR record under `docs/decisions/` when a change makes or reverses an important architectural decision. Do not rewrite accepted historical decisions to hide their history.
6. Record unconfirmed behavior in `docs/reference/open-questions.md`; do not present assumptions, proposed controls, or target-state architecture as implemented.
7. Run the documentation checks described in `docs/reference/validation.md`. At minimum run `python scripts/docs/validate_docs.py`, `mkdocs build --strict`, OpenAPI linting, Mermaid validation, and Structurizr validation when their inputs change.

Application code and documentation are one review unit. A behavior-changing task is incomplete until the affected documentation and validation evidence are updated.
