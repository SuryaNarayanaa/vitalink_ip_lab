# Documentation validation report

This page records the reproducible validation contract and the results observed against source commit `b73965c` on 2026-08-04.

## Commands

From the repository root:

```powershell
python -m pip install -r requirements-docs.txt
python scripts/docs/validate_docs.py
python scripts/docs/extract_mermaid.py --output build/mermaid-validation.md
npx.cmd -y puppeteer browsers install chrome-headless-shell
npx.cmd -y @mermaid-js/mermaid-cli -p scripts/docs/puppeteer-config.json -i build/mermaid-validation.md -o build/mermaid-rendered.md
docker run --rm -v "${PWD}/docs/architecture:/usr/local/structurizr" structurizr/cli:2025.11.09 validate -workspace /usr/local/structurizr/workspace.dsl
mkdocs build --strict
```

OpenAPI is additionally linted with the backend's pinned dependency tree:

```powershell
cd backend
npm.cmd run lint:openapi
```

## What `validate_docs.py` checks

- local Markdown targets and section anchors;
- MkDocs navigation target existence;
- OpenAPI parsing, version, response presence, and exact duplicate-copy equality;
- exact canonical route parity with all Express router declarations plus the API version index;
- exact entity-marker parity with all Mongoose model declarations under `backend/src/models/`;
- non-empty Structurizr workspace and required view keys;
- required documentation files and the root `AGENTS.md` contract;
- YAML syntax for every checked-in GitHub Actions workflow.

## Observed results

| Check | Result | Evidence |
| --- | --- | --- |
| MkDocs strict build | Pass | Material site built successfully; the CLI emitted only its upstream MkDocs 2.0 advisory |
| Local link validation | Pass | 41 local targets/anchors checked; MkDocs emitted no unresolved-link messages after correction |
| OpenAPI parse/lint | Pass with warnings | Redocly reports a valid description and 104 non-blocking quality warnings, principally missing `operationId` and standard 4xx responses |
| API route comparison | Pass | 114 implemented canonical operations = 114 OpenAPI operations |
| Entity comparison | Pass | 18 discovered Mongoose models = 18 documented model markers |
| Mermaid parse/render | Pass | All 23 Mermaid fences extracted and rendered by Mermaid CLI |
| Structurizr validation | Pass | `workspace.dsl` validated with the pinned `structurizr/cli:2025.11.09` image |
| Backend documentation copy parity | Pass | `docs/api/openapi.yaml` is byte-for-byte identical to `backend/docs/api/openapi.yaml` |
| GitHub Actions YAML syntax | Pass | All 6 workflow YAML files parsed |

Runtime application tests are reported separately from documentation validators. A documentation build does not prove a live deployment, provider account, backup, or clinical end-to-end path.
