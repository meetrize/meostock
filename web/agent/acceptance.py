"""自升级人工验收状态（本机 JSON 文件）。"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from agent.paths import repo_root, workspaces_root

_STORE = workspaces_root() / "_acceptance"


def _path(aid: str) -> Path:
    safe = "".join(c for c in aid if c.isalnum() or c in "-_")
    return _STORE / f"{safe}.json"


def create_acceptance(
    *,
    session_id: str | None,
    summary: str,
    commit_message: str,
    files: list[str] | None = None,
    diff_stat: str = "",
) -> dict[str, Any]:
    _STORE.mkdir(parents=True, exist_ok=True)
    aid = uuid.uuid4().hex
    now = time.time()
    rec = {
        "id": aid,
        "sessionId": session_id or "",
        "status": "pending",  # pending | approved | rejected | finalized
        "summary": (summary or "").strip()[:2000],
        "commitMessage": (commit_message or "").strip()[:2000],
        "files": list(files or [])[:200],
        "diffStat": (diff_stat or "")[:8000],
        "repo": str(repo_root()),
        "createdAt": now,
        "updatedAt": now,
        "finalizeResult": None,
    }
    _path(aid).write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def get_acceptance(aid: str) -> dict[str, Any] | None:
    p = _path(aid)
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def update_acceptance(aid: str, **fields: Any) -> dict[str, Any]:
    rec = get_acceptance(aid)
    if not rec:
        raise FileNotFoundError("验收单不存在")
    rec.update(fields)
    rec["updatedAt"] = time.time()
    _path(aid).write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def list_pending(session_id: str | None = None) -> list[dict[str, Any]]:
    if not _STORE.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(_STORE.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        if session_id and data.get("sessionId") != session_id:
            continue
        if data.get("status") in ("pending", "approved"):
            out.append(data)
        if len(out) >= 20:
            break
    return out
