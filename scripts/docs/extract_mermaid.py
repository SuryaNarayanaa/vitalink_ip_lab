#!/usr/bin/env python3
"""Extract every Mermaid fence into one Markdown file for one CLI render pass."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
FENCE = re.compile(r"^```mermaid\s*\r?\n(.*?)^```\s*$", re.MULTILINE | re.DOTALL)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else ROOT / args.output

    sections: list[str] = ["# Mermaid validation bundle\n"]
    count = 0
    for path in sorted(DOCS.rglob("*.md")):
        relative = path.relative_to(DOCS).as_posix()
        if relative == "AWS_MIGRATION_IMPLEMENTATION_PLAN.md" or relative.startswith("deliverables/"):
            continue
        text = path.read_text(encoding="utf-8")
        for index, match in enumerate(FENCE.finditer(text), start=1):
            body = match.group(1).strip()
            if not body:
                raise SystemExit(f"Empty Mermaid fence in {relative}")
            count += 1
            sections.append(f"\n## {relative} diagram {index}\n\n```mermaid\n{body}\n```\n")

    if count == 0:
        raise SystemExit("No Mermaid diagrams found")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(sections), encoding="utf-8")
    print(f"Extracted {count} Mermaid diagrams to {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
