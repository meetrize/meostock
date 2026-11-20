"""策略模板：六维启用权重（长线 / 波段 / 短线）。"""

from __future__ import annotations

from typing import Any, Literal

DimKey = Literal["business", "fina", "valuation", "trend", "volume", "event"]
DimMode = Literal["on", "weak", "off"]

# on=计入综合分；weak=展示但不计入；off=灰显可点开
TEMPLATES: dict[str, dict[str, Any]] = {
    "long": {
        "id": "long",
        "name": "长线桌",
        "dims": {
            "business": "on",
            "fina": "on",
            "valuation": "on",
            "trend": "weak",
            "volume": "weak",
            "event": "off",
        },
    },
    "swing": {
        "id": "swing",
        "name": "波段桌",
        "dims": {
            "business": "on",
            "fina": "on",
            "valuation": "weak",
            "trend": "on",
            "volume": "on",
            "event": "on",
        },
    },
    "short": {
        "id": "short",
        "name": "短线桌",
        "dims": {
            "business": "off",
            "fina": "off",
            "valuation": "off",
            "trend": "on",
            "volume": "on",
            "event": "on",
        },
    },
}

DIM_META: dict[str, dict[str, str]] = {
    "business": {"label": "商业模式", "key": "S.business"},
    "fina": {"label": "财务质量", "key": "S.fina"},
    "valuation": {"label": "估值吸引力", "key": "S.valuation"},
    "trend": {"label": "趋势/波段", "key": "S.tech.trend"},
    "volume": {"label": "量价健康度", "key": "S.tech.volume"},
    "event": {"label": "事件/情绪", "key": "S.event"},
}


def resolve_template(template_id: str | None) -> dict[str, Any]:
    tid = (template_id or "long").strip().lower()
    # 兼容前端预设命名
    aliases = {
        "long_term": "long",
        "quality": "long",
        "quality_value": "long",
        "band": "swing",
        "swing_trade": "swing",
        "intraday": "short",
        "short_term": "short",
    }
    tid = aliases.get(tid, tid)
    if tid not in TEMPLATES:
        tid = "long"
    return dict(TEMPLATES[tid])


def list_templates() -> list[dict[str, Any]]:
    return [dict(v) for v in TEMPLATES.values()]
