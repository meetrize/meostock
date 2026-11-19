"""Agent skill 元数据（可执行字段骨架；Phase 1 主要驱动 system 提示）。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"


@lru_cache(maxsize=1)
def _load() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not _SKILLS_DIR.is_dir():
        return out
    for path in sorted(_SKILLS_DIR.glob("*.json")):
        if path.name == "curated_prompts.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or not data.get("id"):
            continue
        out.append(
            {
                "id": str(data["id"]),
                "title": str(data.get("title") or data["id"]),
                "description": str(data.get("description") or ""),
                "intent": str(data.get("intent") or "chat"),
                "tools": [str(t) for t in (data.get("tools") or []) if t],
                "prompt": str(data.get("prompt") or ""),
                "userHint": str(data.get("userHint") or data.get("user_hint") or ""),
                "permission": str(data.get("permission") or "L0"),
            }
        )
    return out


def list_skills(*, refresh: bool = False) -> list[dict[str, Any]]:
    if refresh:
        _load.cache_clear()
    return list(_load())


def get_skill(skill_id: str | None) -> dict[str, Any] | None:
    if not skill_id:
        return None
    sid = str(skill_id).strip()
    for s in list_skills(refresh=True):
        if s["id"] == sid:
            return s
    return None


def list_skills_public() -> list[dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "title": s["title"],
            "description": s["description"],
            "intent": s["intent"],
            "tools": s["tools"],
            "userHint": s["userHint"],
            "permission": s["permission"],
        }
        for s in list_skills(refresh=True)
    ]
