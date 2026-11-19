"""空态精选提示词。"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_PROMPTS_PATH = Path(__file__).resolve().parent / "skills" / "curated_prompts.json"


@lru_cache(maxsize=1)
def _load() -> list[dict[str, Any]]:
    if not _PROMPTS_PATH.is_file():
        return []
    try:
        data = json.loads(_PROMPTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict) or not item.get("id") or not item.get("prompt"):
            continue
        out.append(
            {
                "id": str(item["id"]),
                "title": str(item.get("title") or item["id"]),
                "category": str(item.get("category") or "通用"),
                "description": str(item.get("description") or ""),
                "prompt": str(item["prompt"]),
                "skillId": (str(item["skillId"]) if item.get("skillId") else None),
            }
        )
    return out


def list_curated_prompts(*, refresh: bool = False) -> list[dict[str, Any]]:
    if refresh:
        _load.cache_clear()
    return list(_load())
