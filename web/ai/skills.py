"""Skill 注册：从 web/ai/skills/*.json 加载。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"


def load_skills(*, refresh: bool = False) -> list[dict[str, Any]]:
    if refresh:
        _load_skills_cached.cache_clear()
    return _load_skills_cached()


@lru_cache(maxsize=1)
def _load_skills_cached() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not _SKILLS_DIR.is_dir():
        return out
    for path in sorted(_SKILLS_DIR.glob("*.json")):
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
                "prompt": str(data.get("prompt") or ""),
                "userHint": str(data.get("userHint") or data.get("user_hint") or ""),
            }
        )
    return out


def list_skills_public() -> list[dict[str, str]]:
    # 每次列表请求刷新，便于热加 skill 文件
    return [
        {
            "id": s["id"],
            "title": s["title"],
            "description": s["description"],
            "userHint": s["userHint"],
        }
        for s in load_skills(refresh=True)
    ]


def get_skill(skill_id: str | None) -> dict[str, Any] | None:
    if not skill_id:
        return None
    sid = str(skill_id).strip()
    for s in load_skills(refresh=True):
        if s["id"] == sid:
            return s
    return None
