"""意图路由：本机单用户默认开放本仓库全权限（L2 工具集）。"""

from __future__ import annotations

import re
from typing import Any

from agent.skills_meta import get_skill
from agent.tools.registry import tools_for_permission

# 本机 Agent：一律 L2（只读库 + 工作区 + 本仓库写 + allowlist shell + 自升级验收）
_DEFAULT_PERM = "L2"

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
    r"(自升级|改本项目|改仓库|meostock|commit|push|升级本系统|修改本项目|"
    r"发布|重新发布|构建|build|部署|前端|dashboard|删掉|删除文案|改页面|改样式|"
    r"菜单|侧栏|侧边栏|路由|加一个.*页|新增.*页)",
    re.IGNORECASE,
)


def resolve_intent(
    text: str,
    *,
    skill_id: str | None = None,
) -> dict[str, Any]:
    """返回意图元数据；工具集始终为 L2（本仓库全权限）。"""
    full_tools = tools_for_permission(_DEFAULT_PERM)
    skill = get_skill(skill_id)
    # maxRounds=0：不限制工具轮次（runtime 仅保留安全天花板 / AGENT_MAX_TOOL_ROUNDS）
    if skill:
        return {
            "intent": skill.get("intent") or "chat",
            "skillId": skill["id"],
            "tools": full_tools,
            "permission": _DEFAULT_PERM,
            "systemExtra": skill.get("prompt") or "",
            "source": "skill",
            "maxRounds": 0,
        }

    raw = (text or "").strip()
    if _UPGRADE_HINT.search(raw):
        sk = get_skill("self_upgrade") or {}
        return {
            "intent": "self_upgrade",
            "skillId": "self_upgrade",
            "tools": full_tools,
            "permission": _DEFAULT_PERM,
            "systemExtra": sk.get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 0,
        }
    if _CODING_HINT.search(raw):
        sk = get_skill("coding_workspace") or {}
        return {
            "intent": "coding",
            "skillId": "coding_workspace",
            "tools": full_tools,
            "permission": _DEFAULT_PERM,
            "systemExtra": sk.get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 0,
        }
    if _DB_HINT.search(raw):
        return {
            "intent": "db_query",
            "skillId": "db_explore",
            "tools": full_tools,
            "permission": _DEFAULT_PERM,
            "systemExtra": (get_skill("db_explore") or {}).get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 0,
        }
    if _RESEARCH_HINT.search(raw):
        return {
            "intent": "research",
            "skillId": "research_brief",
            "tools": full_tools,
            "permission": _DEFAULT_PERM,
            "systemExtra": (get_skill("research_brief") or {}).get("prompt") or "",
            "source": "heuristic",
            "maxRounds": 0,
        }
    return {
        "intent": "chat",
        "skillId": None,
        "tools": full_tools,
        "permission": _DEFAULT_PERM,
        "systemExtra": (
            "本机 Agent 默认具备 meostock 本仓库全权限（L2）。"
            "可读写仓库（禁 .env/*.db/.git）、隔离工作区、allowlist shell（含 ./scripts/build_dashboard.sh）、"
            "冒烟与准备验收。改仓库后应 run_smoke_test；commit/push 须经 UI 人工验收。"
            "前端重新发布：改源码后执行 shell_run ./scripts/build_dashboard.sh。"
        ),
        "source": "default",
        "maxRounds": 0,
    }
