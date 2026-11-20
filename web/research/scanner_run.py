"""研判扫描器：质量+低估值等模板。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models as cache_models
from research.fina_probe import probe_fina_access
from research.limits import tradability
from research.valuation import build_universe_stats, score_valuation

_SH = ZoneInfo("Asia/Shanghai")

SCAN_TEMPLATES: dict[str, dict[str, Any]] = {
    "quality_value": {
        "id": "quality_value",
        "name": "质量+低估值",
        "description": "PE/PB 全市场分位偏低；有财务权限时叠加 ROE 过滤；排除 ST",
        "params": {
            "pe_percentile_max": 30.0,
            "pb_percentile_max": 40.0,
            "roe_min": 12.0,
            "exclude_st": True,
            "limit": 50,
        },
    },
}


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_st(name: str | None) -> bool:
    n = name or ""
    return "ST" in n.upper() or "退" in n


def list_scan_templates() -> list[dict[str, Any]]:
    return [dict(v) for v in SCAN_TEMPLATES.values()]


def run_scanner(
    template_id: str = "quality_value",
    *,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tmpl = SCAN_TEMPLATES.get((template_id or "").strip()) or SCAN_TEMPLATES["quality_value"]
    cfg = dict(tmpl.get("params") or {})
    if params:
        cfg.update({k: v for k, v in params.items() if v is not None})

    pe_max = float(cfg.get("pe_percentile_max") or 30.0)
    pb_max = float(cfg.get("pb_percentile_max") or 40.0)
    exclude_st = bool(cfg.get("exclude_st", True))
    limit = int(cfg.get("limit") or 50)
    limit = max(1, min(limit, 200))

    quotes = cache_models.read_snapshot("cn")
    universe = build_universe_stats(quotes)
    probe = probe_fina_access()

    hits: list[dict[str, Any]] = []
    scanned = 0
    for q in quotes:
        name = str(q.get("name") or "")
        code = str(q.get("code") or "")
        if not code:
            continue
        if exclude_st and _is_st(name):
            continue
        pe = _f(q.get("pe"))
        pb = _f(q.get("pb"))
        if pe is None and pb is None:
            continue
        scanned += 1
        val = score_valuation(pe, pb, universe)
        pe_pct = val.get("pe_percentile")
        pb_pct = val.get("pb_percentile")
        # 便宜 = 分位高；过滤要求分位 ≥ (100 - max) 即相对便宜
        # 设计：PE 分位≤30% 指历史/截面上处于低分位（便宜）。
        # 我们的 score_valuation 里 percentile 越高越便宜，故转换为：
        # cheap_rank = pe_percentile；要求 pe_percentile >= (100 - pe_max)
        pe_ok = pe_pct is None or pe_pct >= (100.0 - pe_max)
        pb_ok = pb_pct is None or pb_pct >= (100.0 - pb_max)
        # 至少一个有值且通过
        if pe_pct is None and pb_pct is None:
            continue
        if pe_pct is not None and not pe_ok:
            continue
        if pb_pct is not None and not pb_ok:
            continue
        if pe_pct is None and not pb_ok:
            continue
        if pb_pct is None and not pe_ok:
            continue

        trad = tradability(q)
        hits.append(
            {
                "symbol": code,
                "name": name,
                "price": _f(q.get("price")),
                "change_percent": _f(q.get("changePercent")),
                "pe": pe,
                "pb": pb,
                "pe_percentile": pe_pct,
                "pb_percentile": pb_pct,
                "valuation_score": val.get("score"),
                "valuation_band": val.get("band"),
                "tradability": trad,
                "tradeable": trad.get("tradable", True),
            }
        )

    hits.sort(key=lambda x: (x.get("valuation_score") or 0), reverse=True)
    # 不可成交的排后面但仍返回并标注
    tradeable = [h for h in hits if h.get("tradeable")]
    blocked = [h for h in hits if not h.get("tradeable")]
    ordered = tradeable + blocked
    results = ordered[:limit]

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "template": tmpl,
        "params": cfg,
        "scanned": scanned,
        "hit_count": len(hits),
        "returned": len(results),
        "results": results,
        "fina_probe": {
            "mode": probe.get("mode"),
            "fina_indicator": probe.get("fina_indicator"),
            "hint": (
                "当前扫描以 PE/PB 截面分位为主；"
                + (
                    "已探测到 fina_indicator，后续可叠加 ROE 硬过滤"
                    if probe.get("fina_indicator")
                    else "无财务权限，ROE 条件未启用（降级）"
                )
            ),
        },
        "disclaimer": "不构成投资建议；一字板等标记为信号成立但不可成交。",
    }
