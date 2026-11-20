"""工作区 / 本仓库文件读写（支持分段读取，避免大文件被截断后无法安全改写）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent.paths import workspace_dir
from agent.sandbox import resolve_repo_path, resolve_workspace_path

_MAX_READ_CHARS = 200_000
_MAX_WRITE = 800_000
_MAX_LIST = 200
# 单次返回给模型的建议块大小（配合 runtime 上限）
_DEFAULT_CHUNK = 80_000


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


def _read_file(
    base: Path,
    target: Path,
    *,
    offset: int | None = None,
    max_chars: int | None = None,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    if not target.is_file():
        raise IsADirectoryError(str(target))
    raw = target.read_text(encoding="utf-8", errors="replace")
    total_chars = len(raw)
    total_lines = raw.count("\n") + (1 if raw and not raw.endswith("\n") else 0)
    if raw == "":
        total_lines = 0

    # 按行切片优先
    if start_line is not None or end_line is not None:
        lines = raw.splitlines(keepends=True)
        s = max(1, int(start_line or 1))
        e = int(end_line) if end_line is not None else len(lines)
        e = max(s - 1, min(e, len(lines)))
        chunk = "".join(lines[s - 1 : e])
        next_line = e + 1 if e < len(lines) else None
        return {
            "ok": True,
            "path": str(target.relative_to(base)),
            "content": chunk,
            "bytes": target.stat().st_size,
            "totalChars": total_chars,
            "totalLines": len(lines),
            "startLine": s,
            "endLine": e,
            "nextStartLine": next_line,
            "truncated": next_line is not None,
            "hint": (
                f"用 start_line={next_line} 继续读取后续行"
                if next_line
                else None
            ),
        }

    off = max(0, int(offset or 0))
    lim = int(max_chars) if max_chars is not None else _DEFAULT_CHUNK
    lim = max(1_000, min(lim, _MAX_READ_CHARS))
    chunk = raw[off : off + lim]
    next_off = off + len(chunk)
    truncated = next_off < total_chars
    return {
        "ok": True,
        "path": str(target.relative_to(base)),
        "content": chunk,
        "bytes": target.stat().st_size,
        "totalChars": total_chars,
        "totalLines": total_lines,
        "offset": off,
        "charsReturned": len(chunk),
        "nextOffset": next_off if truncated else None,
        "truncated": truncated,
        "hint": (
            f"文件共 {total_chars} 字符；本次 offset={off} 返回 {len(chunk)}。"
            f"继续读请设 offset={next_off}（或用 start_line/end_line）。"
            if truncated
            else None
        ),
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


def workspace_read(
    session_id: str | None,
    path: str,
    *,
    offset: int | None = None,
    max_chars: int | None = None,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    base = workspace_dir(session_id)
    target = resolve_workspace_path(session_id, path, must_exist=True)
    return _read_file(
        base,
        target,
        offset=offset,
        max_chars=max_chars,
        start_line=start_line,
        end_line=end_line,
    )


def workspace_write(session_id: str | None, path: str, content: str) -> dict[str, Any]:
    from agent.projects import ensure_workspace_project_meta

    ensure_workspace_project_meta(session_id)
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


def repo_read(
    path: str,
    *,
    offset: int | None = None,
    max_chars: int | None = None,
    start_line: int | None = None,
    end_line: int | None = None,
) -> dict[str, Any]:
    from agent.paths import repo_root

    base = repo_root()
    target = resolve_repo_path(path, must_exist=True)
    return _read_file(
        base,
        target,
        offset=offset,
        max_chars=max_chars,
        start_line=start_line,
        end_line=end_line,
    )


def repo_write(path: str, content: str) -> dict[str, Any]:
    from agent.paths import repo_root

    base = repo_root()
    target = resolve_repo_path(path, for_write=True)
    out = _write_file(base, target, content)
    out["scope"] = "repo"
    return out
