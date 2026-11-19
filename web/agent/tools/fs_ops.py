"""工作区 / 本仓库文件读写。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent.paths import workspace_dir
from agent.sandbox import resolve_repo_path, resolve_workspace_path

_MAX_READ = 120_000
_MAX_WRITE = 400_000
_MAX_LIST = 200


def _list_dir(base: Path, target: Path) -> dict[str, Any]:
    if not target.is_dir():
        raise NotADirectoryError(str(target))
    entries: list[dict[str, Any]] = []
    for i, p in enumerate(sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))):
        if i >= _MAX_LIST:
            break
        try:
            rel = str(p.relative_to(base))
        except ValueError:
            rel = p.name
        entries.append(
            {
                "name": p.name,
                "path": rel,
                "type": "dir" if p.is_dir() else "file",
                "size": (p.stat().st_size if p.is_file() else None),
            }
        )
    return {
        "ok": True,
        "path": str(target.relative_to(base)) if target != base else ".",
        "entries": entries,
        "truncated": len(entries) >= _MAX_LIST,
    }


def _read_file(base: Path, target: Path) -> dict[str, Any]:
    if not target.is_file():
        raise IsADirectoryError(str(target))
    data = target.read_bytes()
    truncated = len(data) > _MAX_READ
    text = data[:_MAX_READ].decode("utf-8", errors="replace")
    return {
        "ok": True,
        "path": str(target.relative_to(base)),
        "content": text,
        "bytes": len(data),
        "truncated": truncated,
    }


def _write_file(base: Path, target: Path, content: str, *, mkdir: bool = True) -> dict[str, Any]:
    raw = content if isinstance(content, str) else str(content)
    if len(raw.encode("utf-8")) > _MAX_WRITE:
        raise ValueError(f"内容过大（上限 {_MAX_WRITE} 字节）")
    if mkdir:
        target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(raw, encoding="utf-8")
    return {
        "ok": True,
        "path": str(target.relative_to(base)),
        "bytes": target.stat().st_size,
        "artifact": {
            "type": "file",
            "path": str(target.relative_to(base)),
            "absPath": str(target),
            "scope": "workspace" if "agent_workspaces" in str(base) else "repo",
        },
    }


def workspace_list(session_id: str | None, path: str = ".") -> dict[str, Any]:
    base = workspace_dir(session_id)
    target = resolve_workspace_path(session_id, path)
    return _list_dir(base, target)


def workspace_read(session_id: str | None, path: str) -> dict[str, Any]:
    base = workspace_dir(session_id)
    target = resolve_workspace_path(session_id, path, must_exist=True)
    return _read_file(base, target)


def workspace_write(session_id: str | None, path: str, content: str) -> dict[str, Any]:
    base = workspace_dir(session_id)
    target = resolve_workspace_path(session_id, path)
    out = _write_file(base, target, content)
    out["scope"] = "workspace"
    out["workspaceId"] = session_id or "default"
    return out


def repo_list(path: str = ".") -> dict[str, Any]:
    from agent.paths import repo_root

    base = repo_root()
    target = resolve_repo_path(path)
    return _list_dir(base, target)


def repo_read(path: str) -> dict[str, Any]:
    from agent.paths import repo_root

    base = repo_root()
    target = resolve_repo_path(path, must_exist=True)
    return _read_file(base, target)


def repo_write(path: str, content: str) -> dict[str, Any]:
    from agent.paths import repo_root

    base = repo_root()
    target = resolve_repo_path(path, for_write=True)
    out = _write_file(base, target, content)
    out["scope"] = "repo"
    return out
