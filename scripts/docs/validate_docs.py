#!/usr/bin/env python3
"""Validate VitaLink documentation contracts against repository source."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import markdown
import yaml


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}


class DocsSafeLoader(yaml.SafeLoader):
    """Safe YAML loader that preserves MkDocs callable references as strings."""


def _python_name_as_string(
    loader: DocsSafeLoader, suffix: str, node: yaml.Node
) -> str:
    del loader, node
    return suffix


DocsSafeLoader.add_multi_constructor(
    "tag:yaml.org,2002:python/name:", _python_name_as_string
)


class ValidationFailure(Exception):
    pass


def fail(message: str) -> None:
    raise ValidationFailure(message)


def load_yaml(path: Path) -> Any:
    try:
        return yaml.load(path.read_text(encoding="utf-8"), Loader=DocsSafeLoader)
    except Exception as exc:  # pragma: no cover - diagnostic boundary
        fail(f"YAML parse failed for {path.relative_to(ROOT)}: {exc}")


def validate_required_files() -> None:
    required = [
        ROOT / "AGENTS.md",
        ROOT / "mkdocs.yml",
        ROOT / "requirements-docs.txt",
        DOCS / "index.md",
        DOCS / "api" / "openapi.yaml",
        DOCS / "architecture" / "workspace.dsl",
        DOCS / "data" / "entities.md",
        DOCS / "reference" / "open-questions.md",
        DOCS / "reference" / "validation.md",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    if missing:
        fail("Required documentation files are missing: " + ", ".join(missing))

    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    required_terms = ["OpenAPI", "database schemas", "security controls", "architecture", "documentation"]
    absent = [term for term in required_terms if term.lower() not in agents.lower()]
    if absent:
        fail("AGENTS.md is missing documentation contract terms: " + ", ".join(absent))


def iter_nav_targets(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from iter_nav_targets(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_nav_targets(item)


def validate_mkdocs_nav() -> None:
    config = load_yaml(ROOT / "mkdocs.yml")
    if not isinstance(config, dict) or config.get("theme", {}).get("name") != "material":
        fail("mkdocs.yml must configure the Material theme")
    missing: list[str] = []
    for target in iter_nav_targets(config.get("nav", [])):
        if re.match(r"^[a-z]+://", target) or target.startswith("#"):
            continue
        if not (DOCS / target).is_file():
            missing.append(target)
    if missing:
        fail("MkDocs nav targets do not exist: " + ", ".join(sorted(set(missing))))


MARKDOWN_LINK = re.compile(r"!?(?:\[[^\]]*\])\(([^)]+)\)")


def markdown_anchors(path: Path) -> set[str]:
    rendered = markdown.Markdown(extensions=["toc"])
    rendered.convert(path.read_text(encoding="utf-8"))
    anchors: set[str] = set()

    def collect(tokens: list[dict[str, Any]]) -> None:
        for token in tokens:
            anchor = token.get("id")
            if isinstance(anchor, str):
                anchors.add(anchor)
            children = token.get("children", [])
            if isinstance(children, list):
                collect(children)

    collect(getattr(rendered, "toc_tokens", []))
    return anchors


def validate_local_links() -> int:
    problems: list[str] = []
    checked = 0
    for path in sorted(DOCS.rglob("*.md")):
        relative = path.relative_to(DOCS).as_posix()
        if relative == "AWS_MIGRATION_IMPLEMENTATION_PLAN.md" or relative.startswith("deliverables/"):
            continue
        text = path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK.finditer(text):
            raw = match.group(1).strip()
            if raw.startswith("<") and raw.endswith(">"):
                raw = raw[1:-1]
            elif " " in raw:
                raw = raw.split(" ", 1)[0]
            if not raw or re.match(r"^(?:https?|mailto|tel):", raw):
                continue
            target_and_query, separator, anchor = raw.partition("#")
            target_text = target_and_query.split("?", 1)[0]
            checked += 1
            if not target_text:
                target = path
            elif target_text.startswith("/"):
                target = ROOT / target_text.lstrip("/")
            else:
                target = path.parent / target_text
            candidates = [target, target / "index.md"] if target.suffix == "" else [target]
            existing = next((candidate for candidate in candidates if candidate.exists()), None)
            if existing is None:
                problems.append(f"{relative}: missing link target {raw}")
                continue
            if separator and anchor and existing.suffix.lower() == ".md":
                if anchor not in markdown_anchors(existing):
                    problems.append(f"{relative}: missing link anchor {raw}")
    if problems:
        fail("Local link validation failed:\n  " + "\n  ".join(problems))
    return checked


def extract_implemented_routes() -> set[str]:
    route_dir = ROOT / "backend" / "src" / "routes"
    mounts = {
        "auth.routes.ts": "/auth",
        "device.routes.ts": "/devices",
        "doctor.routes.ts": "/doctors",
        "patient.routes.ts": "/patient",
        "admin.routes.ts": "/admin",
        "statistics.routes.ts": "/statistics",
    }
    routes: set[str] = set()
    register_pattern = re.compile(r"registerAdminRoute\(router,\s*\{(.*?)\}\s*,", re.DOTALL)
    direct_pattern = re.compile(
        r"(?:router|deviceRouter)\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"]",
        re.IGNORECASE,
    )
    chained_pattern = re.compile(
        r"router\.route\(\s*['\"]([^'\"]+)['\"]\s*\)([^\n;]*)",
        re.IGNORECASE,
    )

    for filename, base in mounts.items():
        text = (route_dir / filename).read_text(encoding="utf-8")
        for block_match in register_pattern.finditer(text):
            block = block_match.group(1)
            method_match = re.search(r"method:\s*['\"](\w+)['\"]", block)
            path_match = re.search(r"path:\s*['\"]([^'\"]+)['\"]", block)
            if not method_match or not path_match:
                fail(f"Could not parse registerAdminRoute declaration in {filename}")
            routes.add(f"{method_match.group(1).upper()} {base}{path_match.group(1)}")
        for match in direct_pattern.finditer(text):
            routes.add(f"{match.group(1).upper()} {base}{match.group(2)}")
        for match in chained_pattern.finditer(text):
            route_path, chain = match.groups()
            for method in re.findall(r"\.(get|post|put|patch|delete)\(", chain, re.IGNORECASE):
                routes.add(f"{method.upper()} {base}{route_path}")

    index_text = (route_dir / "index.ts").read_text(encoding="utf-8")
    webhook = re.search(r"router\.post\(\s*['\"](/webhooks/payment)['\"]", index_text)
    if not webhook:
        fail("Could not find payment webhook route in backend/src/routes/index.ts")
    routes.add(f"POST {webhook.group(1)}")
    routes.add("GET /")  # /api/v1 version index declared directly in app.ts
    return routes


def normalize_express_route(route: str) -> str:
    method, path = route.split(" ", 1)
    path = re.sub(r":([^/]+)", r"{\1}", path)
    return f"{method} {path}"


def validate_openapi() -> tuple[int, int]:
    docs_spec_path = DOCS / "api" / "openapi.yaml"
    backend_spec_path = ROOT / "backend" / "docs" / "api" / "openapi.yaml"
    docs_bytes = docs_spec_path.read_bytes()
    backend_bytes = backend_spec_path.read_bytes()
    if docs_bytes != backend_bytes:
        fail("docs/api/openapi.yaml and backend/docs/api/openapi.yaml are not byte-for-byte identical")

    spec = load_yaml(docs_spec_path)
    if not isinstance(spec, dict) or not str(spec.get("openapi", "")).startswith("3."):
        fail("OpenAPI document must declare an OpenAPI 3.x version")
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        fail("OpenAPI paths must be an object")

    documented: set[str] = set()
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            fail(f"OpenAPI path item must be an object: {path}")
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS:
                continue
            if not isinstance(operation, dict) or "responses" not in operation:
                fail(f"OpenAPI operation lacks responses: {method.upper()} {path}")
            documented.add(f"{method.upper()} {path}")

    implemented = {normalize_express_route(route) for route in extract_implemented_routes()}
    missing = sorted(implemented - documented)
    extra = sorted(documented - implemented)
    if missing or extra:
        details = []
        if missing:
            details.append("Missing from OpenAPI:\n    " + "\n    ".join(missing))
        if extra:
            details.append("Not implemented by canonical router:\n    " + "\n    ".join(extra))
        fail("API route parity failed:\n  " + "\n  ".join(details))
    return len(implemented), len(documented)


def implemented_model_names() -> set[str]:
    model_dir = ROOT / "backend" / "src" / "models"
    pattern = re.compile(r"mongoose\.model(?:<[^>]+>)?\(\s*['\"]([^'\"]+)['\"]")
    names: set[str] = set()
    for path in sorted(model_dir.glob("*.ts")):
        if path.name == "index.ts":
            continue
        names.update(pattern.findall(path.read_text(encoding="utf-8")))
    if not names:
        fail("No Mongoose models were discovered")
    return names


def validate_entity_coverage() -> tuple[int, int]:
    implemented = implemented_model_names()
    catalog = (DOCS / "data" / "entities.md").read_text(encoding="utf-8")
    documented_list = re.findall(r"<!--\s*model:\s*([A-Za-z0-9_]+)\s*-->", catalog)
    if len(documented_list) != len(set(documented_list)):
        duplicates = sorted({name for name in documented_list if documented_list.count(name) > 1})
        fail("Duplicate entity markers: " + ", ".join(duplicates))
    documented = set(documented_list)
    missing = sorted(implemented - documented)
    extra = sorted(documented - implemented)
    if missing or extra:
        fail(
            "Entity parity failed. Missing: "
            + (", ".join(missing) or "none")
            + "; extra: "
            + (", ".join(extra) or "none")
        )
    return len(implemented), len(documented)


def validate_structurizr_shape() -> None:
    path = DOCS / "architecture" / "workspace.dsl"
    text = path.read_text(encoding="utf-8")
    required = [
        'workspace "VitaLink"',
        'systemContext vitalink "SystemContext"',
        'container vitalink "Containers"',
        'component vitalink.api "BackendComponents"',
        'component vitalink.api "AuthComponents"',
        'component vitalink.api "ClinicalComponents"',
        'component vitalink.api "NotificationComponents"',
        'deployment vitalink production "ProductionDeployment"',
    ]
    missing = [item for item in required if item not in text]
    if missing:
        fail("Structurizr workspace is missing required declarations: " + ", ".join(missing))


def validate_workflow_yaml() -> int:
    workflow_dir = ROOT / ".github" / "workflows"
    paths = sorted([*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml")])
    for path in paths:
        try:
            yaml.compose(path.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - diagnostic boundary
            fail(f"Workflow YAML parse failed for {path.relative_to(ROOT)}: {exc}")
    return len(paths)


def main() -> int:
    try:
        validate_required_files()
        validate_mkdocs_nav()
        links = validate_local_links()
        implemented_routes, documented_routes = validate_openapi()
        implemented_models, documented_models = validate_entity_coverage()
        validate_structurizr_shape()
        workflow_count = validate_workflow_yaml()
    except ValidationFailure as exc:
        print(f"DOCUMENTATION VALIDATION FAILED\n{exc}", file=sys.stderr)
        return 1

    print("Documentation validation passed")
    print(f"  Local links checked: {links}")
    print(f"  API operations: implemented={implemented_routes}, documented={documented_routes}")
    print(f"  Mongoose models: implemented={implemented_models}, documented={documented_models}")
    print("  OpenAPI copies: identical")
    print("  MkDocs nav and required Structurizr views: present")
    print(f"  GitHub Actions workflow YAML files parsed: {workflow_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
