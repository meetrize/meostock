"""估值维：行情 PE/PB 全市场分位（财务权限不足时的降级路径）。"""

from __future__ import annotations

import math
from typing import Any


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        if not math.isfinite(x):
            return None
        return x
    except (TypeError, ValueError):
        return None


def _percentile_rank(value: float, sample: list[float], *, lower_better: bool) -> float:
    """返回 0–100：lower_better 时越小分位越高（便宜）。"""
    if not sample:
        return 50.0
    n = len(sample)
    if lower_better:
        below = sum(1 for x in sample if x > value)
    else:
        below = sum(1 for x in sample if x < value)
    return round(100.0 * below / max(n, 1), 2)


def build_universe_stats(quotes: list[dict[str, Any]]) -> dict[str, Any]:
    pe_list: list[float] = []
    pb_list: list[float] = []
    for q in quotes:
        pe = _f(q.get("pe"))
        pb = _f(q.get("pb"))
        # 过滤异常：负 PE 或极端值不进分位样本
        if pe is not None and 0 < pe < 500:
            pe_list.append(pe)
        if pb is not None and 0 < pb < 50:
            pb_list.append(pb)
    return {
        "count": len(quotes),
        "pe_sample": len(pe_list),
        "pb_sample": len(pb_list),
        "pe_list": pe_list,
        "pb_list": pb_list,
    }


def score_valuation(
    pe: float | None,
    pb: float | None,
    universe: dict[str, Any],
) -> dict[str, Any]:
    pe_list: list[float] = list(universe.get("pe_list") or [])
    pb_list: list[float] = list(universe.get("pb_list") or [])

    pe_pct: float | None = None
    pb_pct: float | None = None
    if pe is not None and pe > 0 and pe_list:
        pe_pct = _percentile_rank(pe, pe_list, lower_better=True)
    if pb is not None and pb > 0 and pb_list:
        pb_pct = _percentile_rank(pb, pb_list, lower_better=True)

    parts: list[float] = []
    if pe_pct is not None:
        parts.append(pe_pct)
    if pb_pct is not None:
        parts.append(pb_pct)

    score: float | None = round(sum(parts) / len(parts), 2) if parts else None
    band = "unknown"
    if score is not None:
        if score >= 70:
            band = "cheap"
        elif score >= 40:
            band = "fair"
        else:
            band = "expensive"

    return {
        "ok": score is not None,
        "score": score,
        "band": band,
        "pe": pe,
        "pb": pb,
        "pe_percentile": pe_pct,
        "pb_percentile": pb_pct,
        "universe": {
            "count": universe.get("count"),
            "pe_sample": universe.get("pe_sample"),
            "pb_sample": universe.get("pb_sample"),
        },
        "source": "quote_cross_section",
        "note": "分位越高表示相对全市场越便宜（PE/PB 越低）",
    }
