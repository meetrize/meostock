"""仓库与工作区路径约定。"""

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]  # meostock/
_WORKSPACES = _ROOT / "data" / "agent_workspaces"


def repo_root() -> Path:
    return _ROOT


def workspaces_root() -> Path:
    _WORKSPACES.mkdir(parents=True, exist_ok=True)
    return _WORKSPACES


def workspace_dir(session_id: str | None) -> Path:
    sid = "".join(c for c in (session_id or "default") if c.isalnum() or c in "-_")[:64]
    if not sid:
        sid = "default"
    path = workspaces_root() / sid
    path.mkdir(parents=True, exist_ok=True)
    return path
