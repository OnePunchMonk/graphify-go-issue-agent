from __future__ import annotations

import json
from pathlib import Path


DEFAULT_IGNORES = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    ".cache",
    "runs",
    "workspaces",
    "__pycache__",
}


def read_text(path: str | Path) -> str:
    return Path(path).read_text(encoding="utf-8")


def write_text(path: str | Path, value: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")


def write_json(path: str | Path, value) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, indent=2), encoding="utf-8")


def walk_files(root: str | Path, extensions: list[str] | None = None, ignores: list[str] | None = None):
    root_path = Path(root)
    if not root_path.exists():
        return []

    ignore_set = set(DEFAULT_IGNORES)
    if ignores:
        ignore_set.update(ignores)

    files = []
    for path in root_path.rglob("*"):
        if any(part in ignore_set for part in path.parts[len(root_path.parts) :]):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        if extensions and path.suffix not in extensions:
            continue
        files.append(
            {
                "path": str(path),
                "relativePath": str(path.relative_to(root_path)),
                "size": path.stat().st_size,
            }
        )
    return files
