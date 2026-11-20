"""一致性检查器：六维方向冲突（教学向规则）。"""

from __future__ import annotations

from typing import Any

from research.scorecard import build_scorecard


def _dir_from_score(score: float | None, *, high_is_bull: bool = True) -> str:
    if score is None:
        return "unknown"
    if high_is_bull:
        if score >= 60:
            return "bullish"
        if score <= 40:
            return "bearish"
        return "neutral"
    # valuation: higher percentile = cheaper = bullish for long
    if score >= 60:
        return "bullish"
    if score <= 40:
        return "bearish"
    return "neutral"


def check_consistency(
    code: str,
    *,
    strategy_template_id: str | None = "long",
    scorecard: dict[str, Any] | None = None,
) -> dict[str, Any]:
    card = scorecard or build_scorecard(code, strategy_template_id=strategy_template_id)
    dims = card.get("dimensions") or {}

    directions: dict[str, str] = {}
    for key in ("fina", "valuation", "trend", "volume"):
        d = dims.get(key) or {}
        if not d.get("enabled"):
            continue
        directions[key] = _dir_from_score(d.get("score"))

    biz = (dims.get("business") or {}).get("state") or card.get("business_mode_state")
    conflicts: list[dict[str, Any]] = []

    # 估值便宜 vs 趋势极弱
    if directions.get("valuation") == "bullish" and directions.get("trend") == "bearish":
        conflicts.append(
            {
                "id": "cheap_but_weak_trend",
                "severity": "medium",
                "dims": ["valuation", "trend"],
                "message": "估值相对便宜但短期趋势偏弱——可能是价值陷阱或逢低布局窗口，需下钻证据",
            }
        )

    # 财务弱 vs 估值贵
    if directions.get("fina") == "bearish" and directions.get("valuation") == "bearish":
        conflicts.append(
            {
                "id": "weak_quality_expensive",
                "severity": "high",
                "dims": ["fina", "valuation"],
                "message": "财务质量偏弱且估值不便宜——长线模板应谨慎",
            }
        )

    # 量价过热 vs 估值贵
    if directions.get("volume") == "bearish" and directions.get("valuation") == "bearish":
        conflicts.append(
            {
                "id": "hot_and_expensive",
                "severity": "medium",
                "dims": ["volume", "valuation"],
                "message": "量价偏极端且不便宜——情绪拥挤风险",
            }
        )

    # 商业模式未验证
    if biz == "unverified" and (card.get("strategy_template") or {}).get("id") in (
        "long",
        "swing",
    ):
        conflicts.append(
            {
                "id": "business_unverified",
                "severity": "high",
                "dims": ["business"],
                "message": "商业模式未验证——禁止生成 open 交易卡片",
            }
        )

    if biz == "doubt" and directions.get("fina") == "bearish":
        conflicts.append(
            {
                "id": "doubt_and_weak_fina",
                "severity": "high",
                "dims": ["business", "fina"],
                "message": "商业模式存疑且财务偏弱——需补充证据后再决策",
            }
        )

    return {
        "ok": True,
        "symbol": card.get("symbol"),
        "as_of": card.get("as_of"),
        "directions": directions,
        "business_mode_state": biz,
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
        "disclaimer": "规则启发式冲突提示，不构成投资建议。",
    }
