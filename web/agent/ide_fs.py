"""Agent IDE：按 projectId 列目录 / 读文件（复用 sandbox）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent.projects import resolve_project
from agent.sandbox import resolve_under
from agent.tools.fs_ops import _list_dir, _read_file

_HIDE_NAMES = {
    ".git",
    "node_modules",
    ".venv",
    ".venv310",
    "__pycache__",
    ".pnpm-store",
    "dist",
    ".turbo",
    ".pytest_cache",
    ".mypy_cache",
}


def project_root(project_id: str | None) -> tuple[Path, dict[str, Any]]:
    proj = resolve_project(project_id)
    root = Path(str(proj.get("path") or "")).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"项目目录不存在: {root}")
    return root, proj


def list_tree(project_id: str | None, path: str = ".") -> dict[str, Any]:
    root, proj = project_root(project_id)
    target = resolve_under(root, path or ".")
    raw = _list_dir(root, target)
    entries = []
    for e in raw.get("entries") or []:
        name = str(e.get("name") or "")
        if name in _HIDE_NAMES or name.startswith(".git"):
            continue
        entries.append(e)
    return {
        "ok": True,
        "projectId": proj.get("id"),
        "kind": proj.get("kind"),
        "path": raw.get("path") or ".",
        "entries": entries,
        "truncated": bool(raw.get("truncated")),
    }


def read_file(
    project_id: str | None,
    path: str,
    *,
    offset: int | None = None,
    max_chars: int | None = None,
) -> dict[str, Any]:
    root, proj = project_root(project_id)
    rel = (path or "").strip()
    if not rel or rel == ".":
        raise ValueError("缺少文件 path")
    target = resolve_under(root, rel, must_exist=True)
    if not target.is_file():
        raise IsADirectoryError(rel)
    # 粗略二进制检测
    try:
        sample = target.read_bytes()[:4096]
        if b"\x00" in sample:
            return {
                "ok": False,
                "error": "二进制文件，无法预览",
                "path": rel,
                "binary": True,
            }
    except OSError as e:
        raise FileNotFoundError(str(e)) from e

    out = _read_file(root, target, offset=offset, max_chars=max_chars or 120_000)
    out["projectId"] = proj.get("id")
    out["kind"] = proj.get("kind")
    return out
