"""Agent 目标项目：本仓库 + agent 自动生成的工作区项目。"""

from __future__ import annotations

import json
import secrets
import time
from pathlib import Path
from typing import Any

from agent.paths import repo_root, workspace_dir, workspaces_root

_MEOSTOCK_ID = "meostock"
_SKIP_DIR_PREFIX = "_"


def _safe_id(raw: str) -> str:
    return "".join(c for c in (raw or "") if c.isalnum() or c in "-_")[:64]


def _default_project_name() -> str:
    return time.strftime("新项目 %m-%d %H:%M")


def _ascii_slug(raw: str | None) -> str:
    """目录 id 只用 ASCII，避免中文路径；展示名仍写在 project.json。"""
    chars: list[str] = []
    for c in raw or "":
        if ("a" <= c.lower() <= "z") or c.isdigit() or c in "-_":
            chars.append(c.lower() if c.isalpha() else c)
        elif c.isspace() or c in "·./":
            if chars and chars[-1] != "-":
                chars.append("-")
    slug = "".join(chars).strip("-_")[:32]
    if not slug or slug == _MEOSTOCK_ID:
        return "project"
    return slug


def _unique_workspace_id(preferred: str | None = None) -> str:
    base = _ascii_slug(preferred)
    for _ in range(8):
        suffix = secrets.token_hex(3)
        candidate = f"{base}-{suffix}"
        if not (workspaces_root() / candidate).exists():
            return candidate
    return f"project-{int(time.time())}-{secrets.token_hex(2)}"


def _write_meta(path: Path, payload: dict[str, Any]) -> None:
    meta_path = path / "project.json"
    meta_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _count_files(path: Path) -> int:
    n = 0
    try:
        for p in path.rglob("*"):
            if p.is_file() and p.name != "project.json":
                n += 1
                if n >= 50:
                    break
    except OSError:
        return 0
    return n


def _read_meta(path: Path) -> dict[str, Any]:
    meta_path = path / "project.json"
    if not meta_path.is_file():
        return {}
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def ensure_workspace_project_meta(
    session_or_project_id: str | None,
    *,
    name: str | None = None,
) -> Path:
    """工作区写入时确保有 project.json，便于项目列表展示。"""
    path = workspace_dir(session_or_project_id)
    meta_path = path / "project.json"
    if meta_path.is_file():
        return path
    sid = _safe_id(session_or_project_id or "default") or "default"
    payload = {
        "id": sid,
        "name": (name or f"工作区 {sid[:12]}").strip()[:80],
        "kind": "workspace",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "source": "agent",
        "hidden": False,
    }
    _write_meta(path, payload)
    return path


def create_project(
    name: str | None = None,
    *,
    description: str | None = None,
) -> dict[str, Any]:
    """新建工作区项目目录 + project.json；名称为空时用默认名。"""
    raw_name = (name or "").strip()[:80]
    display = raw_name or _default_project_name()
    # 仅用用户输入生成目录 slug；默认名走 project-xxxx，避免从时间戳抠数字
    sid = _unique_workspace_id(raw_name or None)
    path = workspaces_root() / sid
    path.mkdir(parents=True, exist_ok=False)
    now = time.time()
    desc = (description or "").strip()[:200] or "用户手动创建的 Agent 工作区项目"
    payload = {
        "id": sid,
        "name": display,
        "kind": "workspace",
        "createdAt": now,
        "updatedAt": now,
        "source": "user",
        "hidden": False,
        "description": desc,
    }
    _write_meta(path, payload)
    return {
        "id": sid,
        "name": display,
        "kind": "workspace",
        "path": str(path),
        "description": desc,
        "fileCount": 0,
        "updatedAt": now,
        "source": "user",
    }


def hide_project(project_id: str | None) -> dict[str, Any]:
    """从列表移除（仅标记 hidden，不删除目录文件）。本仓库不可移除。"""
    pid = _safe_id(project_id or "")
    if not pid or pid == _MEOSTOCK_ID:
        raise ValueError("不能移除 meostock 本仓库项目")
    path = workspaces_root() / pid
    if not path.is_dir():
        raise ValueError(f"项目不存在: {pid}")
    meta = _read_meta(path)
    now = time.time()
    payload = {
        **meta,
        "id": pid,
        "name": str(meta.get("name") or "").strip() or f"Agent 项目 · {pid[:16]}",
        "kind": "workspace",
        "hidden": True,
        "hiddenAt": now,
        "updatedAt": now,
        "source": meta.get("source") or "user",
    }
    if "description" not in payload:
        payload["description"] = "由 AI Agent 在隔离工作区生成"
    _write_meta(path, payload)
    return {
        "id": pid,
        "name": payload["name"],
        "kind": "workspace",
        "path": str(path),
        "hidden": True,
        "updatedAt": now,
    }


def list_projects() -> list[dict[str, Any]]:
    root = repo_root()
    items: list[dict[str, Any]] = [
        {
            "id": _MEOSTOCK_ID,
            "name": "meostock（本项目）",
            "kind": "repo",
            "path": str(root),
            "description": "当前看板与 Agent 所在仓库，改源码 / 自升级 / 前端发布请选此项",
            "fileCount": None,
            "updatedAt": root.stat().st_mtime if root.exists() else None,
        }
    ]

    ws_root = workspaces_root()
    if not ws_root.is_dir():
        return items

    for child in sorted(ws_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not child.is_dir():
            continue
        if child.name.startswith(_SKIP_DIR_PREFIX):
            continue
        meta = _read_meta(child)
        if meta.get("hidden") is True:
            continue
        file_count = _count_files(child)
        # 空目录且无 meta 的跳过，减少噪音
        if file_count == 0 and not meta:
            continue
        name = str(meta.get("name") or "").strip() or f"Agent 项目 · {child.name[:16]}"
        items.append(
            {
                "id": child.name,
                "name": name,
                "kind": "workspace",
                "path": str(child),
                "description": str(meta.get("description") or "由 AI Agent 在隔离工作区生成"),
                "fileCount": file_count,
                "updatedAt": child.stat().st_mtime,
                "source": meta.get("source") or "agent",
            }
        )
    return items


def resolve_project(project_id: str | None) -> dict[str, Any]:
    """解析目标项目；默认 meostock。"""
    pid = (project_id or _MEOSTOCK_ID).strip() or _MEOSTOCK_ID
    for p in list_projects():
        if p["id"] == pid:
            return p
    # 未知 id：若是合法工作区名则按工作区处理
    safe = _safe_id(pid)
    if safe and safe != _MEOSTOCK_ID:
        path = workspaces_root() / safe
        if path.is_dir():
            meta = _read_meta(path)
            return {
                "id": safe,
                "name": str(meta.get("name") or safe),
                "kind": "workspace",
                "path": str(path),
                "description": str(meta.get("description") or ""),
                "fileCount": _count_files(path),
                "updatedAt": path.stat().st_mtime,
            }
    root = repo_root()
    return {
        "id": _MEOSTOCK_ID,
        "name": "meostock（本项目）",
        "kind": "repo",
        "path": str(root),
        "description": "当前看板与 Agent 所在仓库",
        "fileCount": None,
        "updatedAt": root.stat().st_mtime if root.exists() else None,
    }
