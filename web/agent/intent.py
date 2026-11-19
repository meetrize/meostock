"""轻量意图路由（启发式；可被 skillId 覆盖）。"""

from __future__ import annotations

import re
from typing import Any

from agent.skills_meta import get_skill
from agent.tools.registry import tools_for_permission

_DB_HINT = re.compile(
    r"(表|数据库|sqlite|sql|查询|select|schema|字段|列名|涨幅|跌幅|行情库|calendar|日历)",
    re.IGNORECASE,
)
_RESEARCH_HINT = re.compile(r"(简报|解读|复盘|情绪|板块|涨停|异动|观察)", re.IGNORECASE)
_CODING_HINT = re.compile(
    r"(写代码|写个|生成脚本|工作区|coding|交付|小工具|markdown报告|写一个)",
    re.IGNORECASE,
)
_UPGRADE_HINT = re.compile(
    r"(自升级|改本项目|改仓库|meostock|commit|push|升级本系统|修改本项目)",
    re.IGNORECASE,
)


def resolve_intent(
    text: str,
    *,
    skill_id: str | None = None,
) -> dict[str, Any]:
    skill = get_skill(skill_id)
    if skill:
        perm = str(skill.get("permission") or "L0")
        tools = list(skill.get("tools") or []) or tools_for_permission(perm)
        return {
            "intent": skill.get("intent") or "chat",
            "skillId": skill["id"],
            "tools": tools,
            "permission": perm,
            "systemExtra": skill.get("prompt") or "",
            "source": "skill",
            "maxRounds": 12 if perm in ("L1", "L2", "L3") else 6,
        }

    raw = (text or "").strip()
    if _UPGRADE_HINT.search(raw):
        sk = get_skill("self_upgrade") or {}
        return {
            "intent": "self_upgrade",
            "skillId": "self_upgrade",
            "tools": tools_for_permission("L2"),
            "permission": "L2",
            "systemExtra": sk.get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 14,
        }
    if _CODING_HINT.search(raw):
        sk = get_skill("coding_workspace") or {}
        return {
            "intent": "coding",
            "skillId": "coding_workspace",
            "tools": tools_for_permission("L1"),
            "permission": "L1",
            "systemExtra": sk.get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 12,
        }
    if _DB_HINT.search(raw):
        return {
            "intent": "db_query",
            "skillId": "db_explore",
            "tools": tools_for_permission("L0"),
            "permission": "L0",
            "systemExtra": (get_skill("db_explore") or {}).get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 6,
        }
    if _RESEARCH_HINT.search(raw):
        return {
            "intent": "research",
            "skillId": "research_brief",
            "tools": tools_for_permission("L0"),
            "permission": "L0",
            "systemExtra": (get_skill("research_brief") or {}).get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 6,
        }
    return {
        "intent": "chat",
        "skillId": None,
        "tools": tools_for_permission("L0"),
        "permission": "L0",
        "systemExtra": "",
        "source": "default",
        "maxRounds": 6,
    }
