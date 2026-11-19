"""路径沙箱：L1 工作区 / L2 本仓库。"""

from __future__ import annotations

from pathlib import Path

from agent.paths import repo_root, workspace_dir

# 禁止写入（相对仓库根，或后缀）
_DENY_WRITE_NAMES = {
    ".env",
    ".env.local",
    ".git",
}
_DENY_WRITE_SUFFIXES = (
    ".db",
    ".db-wal",
    ".db-shm",
    ".db-journal",
)
_DENY_WRITE_PARTS = {
    ".git",
    ".venv",
    ".venv310",
    "node_modules",
    "__pycache__",
}


def _is_relative_to(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def resolve_under(base: Path, rel: str, *, must_exist: bool = False) -> Path:
    raw = (rel or ".").strip() or "."
    if raw.startswith("~") or Path(raw).is_absolute():
        raise ValueError("禁止绝对路径与 ~")
    if ".." in Path(raw).parts:
        raise ValueError("禁止 .. 路径穿越")
    target = (base / raw).resolve()
    if not _is_relative_to(target, base):
        raise ValueError("路径越界")
    if must_exist and not target.exists():
        raise FileNotFoundError(str(target.relative_to(base)))
    return target


def assert_writable_repo_path(path: Path) -> None:
    root = repo_root().resolve()
    resolved = path.resolve()
    if not _is_relative_to(resolved, root):
        raise ValueError("不在本仓库内")
    rel = resolved.relative_to(root)
    parts = set(rel.parts)
    if parts & _DENY_WRITE_PARTS:
        raise ValueError(f"禁止写入受保护目录: {rel}")
    if resolved.name in _DENY_WRITE_NAMES:
        raise ValueError(f"禁止写入受保护文件: {resolved.name}")
    name_l = resolved.name.lower()
    for suf in _DENY_WRITE_SUFFIXES:
        if name_l.endswith(suf):
            raise ValueError(f"禁止写入数据库相关文件: {resolved.name}")
    # data/*.db 已由后缀挡住；额外禁止改 data 下缓存库旁路文件
    if len(rel.parts) >= 1 and rel.parts[0] == "data" and name_l.endswith(".db"):
        raise ValueError("禁止写入 data 下数据库")


def resolve_workspace_path(session_id: str | None, rel: str, *, must_exist: bool = False) -> Path:
    return resolve_under(workspace_dir(session_id), rel, must_exist=must_exist)


def resolve_repo_path(rel: str, *, must_exist: bool = False, for_write: bool = False) -> Path:
    path = resolve_under(repo_root(), rel, must_exist=must_exist)
    if for_write:
        assert_writable_repo_path(path)
    return path
