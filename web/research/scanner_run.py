"""研判扫描器：质量+低估值 + M2 技术规则预设。"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models as cache_models
from research.fina_probe import probe_fina_access
from research.kline_series import load_daily_bars
from research.limits import tradability
from research.rule_engine import evaluate_rules_on_bars
from research.strategy_presets import get_preset, rule_block_to_sentence
from research.valuation import build_universe_stats, score_valuation

_log = logging.getLogger("research.scanner")
_SH = ZoneInfo("Asia/Shanghai")

SCAN_TEMPLATES: dict[str, dict[str, Any]] = {
    "quality_value": {
        "id": "quality_value",
        "name": "质量+低估值",
        "description": "PE/PB 全市场分位偏低；有财务权限时叠加 ROE 过滤；排除 ST",
        "engine": "valuation",
        "params": {
            "pe_percentile_max": 30.0,
            "pb_percentile_max": 40.0,
            "roe_min": 12.0,
            "exclude_st": True,
            "limit": 50,
        },
    },
    "ma_bull_stack": {
        "id": "ma_bull_stack",
        "name": "均线多头波段",
        "description": "MA 多头排列且价站上关键均线",
        "engine": "tech_rules",
        "preset_id": "ma_bull_stack",
        "params": {
            "exclude_st": True,
            "limit": 50,
            "universe_size": 300,
            # amount 与 quote_snapshot 同口径（当前缓存多为“万元”量级），勿按元设阈值
            "min_amount": 3.0e4,
            "concurrency": 8,
            "fetch_kline": True,
            "min_bars": 100,
        },
    },
    "dual_ma_coil": {
        "id": "dual_ma_coil",
        "name": "双线擒牛",
        "description": "MA60/89 粘合且价站上双线",
        "engine": "tech_rules",
        "preset_id": "dual_ma_coil",
        "params": {
            "exclude_st": True,
            "limit": 50,
            "universe_size": 300,
            "min_amount": 3.0e4,
            "concurrency": 8,
            "fetch_kline": True,
            "min_bars": 120,
        },
    },
    "breakout_volume": {
        "id": "breakout_volume",
        "name": "放量突破",
        "description": "近 N 日新高 + 放量",
        "engine": "tech_rules",
        "preset_id": "breakout_volume",
        "params": {
            "exclude_st": True,
            "limit": 50,
            "universe_size": 300,
            "min_amount": 5.0e4,
            "concurrency": 8,
            "fetch_kline": True,
            "min_bars": 40,
        },
    },
    "volume_price_rise": {
        "id": "volume_price_rise",
        "name": "量价齐升",
        "description": "近窗口价量总体抬升，上涨日多数放量，允许少量例外",
        "engine": "tech_rules",
        "preset_id": "volume_price_rise",
        "params": {
            "exclude_st": True,
            "limit": 50,
            "universe_size": 300,
            "min_amount": 3.0e4,
            "concurrency": 8,
            "fetch_kline": True,
            "min_bars": 30,
        },
    },
    "dividend_roe": {
        "id": "dividend_roe",
        "name": "高股息+高ROE",
        "description": "daily_basic 股息率 + fina ROE",
        "engine": "fundamental",
        "preset_id": "dividend_roe",
        "params": {
            "exclude_st": True,
            "limit": 50,
            "dividend_min": 3.0,
            "roe_min": 10.0,
            "roe_probe_n": 120,
            "concurrency": 6,
        },
    },
    "growth_trend": {
        "id": "growth_trend",
        "name": "成长趋势",
        "description": "业绩增速 + 站上 MA60 + PEG 约束",
        "engine": "fundamental",
        "preset_id": "growth_trend",
        "params": {
            "exclude_st": True,
            "limit": 40,
            "universe_size": 160,
            "min_amount": 3.0e4,
            "revenue_min": 15.0,
            "profit_min": 15.0,
            "peg_max": 1.5,
            "ma_period": 60,
            "concurrency": 6,
            "fetch_kline": True,
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


def _route_code(code: str) -> str:
    c = (code or "").strip().upper()
    if "." in c:
        return c
    if c.startswith(("5", "6", "9")):
        return f"{c}.SH"
    return f"{c}.SZ"


def _display_code(code: str) -> str:
    c = (code or "").strip()
    if "." in c:
        return c.split(".", 1)[0]
    return c


def _select_universe(
    quotes: list[dict[str, Any]],
    *,
    exclude_st: bool,
    universe_size: int,
    min_amount: float,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for q in quotes:
        code = str(q.get("code") or "").strip()
        name = str(q.get("name") or "")
        if not code or len(code) < 6:
            continue
        # 只要 A 股 6 位；过滤北交所退市杂码可按名称
        if exclude_st and _is_st(name):
            continue
        price = _f(q.get("price"))
        amount = _f(q.get("amount"))
        if price is None or price <= 0:
            continue
        if amount is None or amount < min_amount:
            continue
        rows.append(q)
    rows.sort(key=lambda x: float(x.get("amount") or 0), reverse=True)
    return rows[: max(1, universe_size)]


def _run_valuation_scanner(tmpl: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
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
        pe_ok = pe_pct is None or pe_pct >= (100.0 - pe_max)
        pb_ok = pb_pct is None or pb_pct >= (100.0 - pb_max)
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
        why_hit = ["PE/PB 截面分位偏低（相对便宜）"]
        if pe_pct is not None:
            why_hit.append(f"PE 便宜分位约 {pe_pct:.0f}")
        if pb_pct is not None:
            why_hit.append(f"PB 便宜分位约 {pb_pct:.0f}")
        hits.append(
            {
                "symbol": code,
                "route_code": _route_code(code),
                "name": name,
                "price": _f(q.get("price")),
                "change_percent": _f(q.get("changePercent")),
                "pe": pe,
                "pb": pb,
                "pe_percentile": pe_pct,
                "pb_percentile": pb_pct,
                "valuation_score": val.get("score"),
                "valuation_band": val.get("band"),
                "why_hit": why_hit,
                "factors": {
                    "pe_percentile": pe_pct,
                    "pb_percentile": pb_pct,
                    "valuation_score": val.get("score"),
                },
                "tradability": trad,
                "tradeable": trad.get("tradable", True),
                "score": float(val.get("score") or 0),
            }
        )

    hits.sort(key=lambda x: (x.get("score") or 0), reverse=True)
    tradeable = [h for h in hits if h.get("tradeable")]
    blocked = [h for h in hits if not h.get("tradeable")]
    results = (tradeable + blocked)[:limit]

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


def _eval_one_tech(
    q: dict[str, Any],
    *,
    rules: dict[str, Any],
    fetch_kline: bool,
    min_bars: int,
) -> dict[str, Any] | None:
    code = str(q.get("code") or "")
    name = str(q.get("name") or "")
    try:
        bars = load_daily_bars(code, limit=max(min_bars + 20, 160), fetch_if_empty=fetch_kline)
    except Exception as exc:  # noqa: BLE001
        _log.debug("kline %s failed: %s", code, exc)
        return None
    if len(bars) < min_bars:
        return None
    judged = evaluate_rules_on_bars(bars, rules, quote=q)
    if not judged.get("ok"):
        return None
    trad = tradability(q)
    amount = _f(q.get("amount"))
    factors = judged.get("factors") or {}
    sync_fac = factors.get("volume.price_sync_rise") or {}
    breakout_fac = factors.get("breakout.volume") or {}
    # 量价齐升优先按量能抬升倍数排序；放量突破按量能倍数；其余按成交额
    score = float(amount or 0)
    if isinstance(sync_fac, dict) and sync_fac.get("vol_ratio") is not None:
        score = float(sync_fac.get("vol_ratio") or 0) * 1e6 + float(amount or 0)
    elif isinstance(breakout_fac, dict) and breakout_fac.get("volume_multiple") is not None:
        score = float(breakout_fac.get("volume_multiple") or 0) * 1e6 + float(amount or 0)
    row = {
        "symbol": code,
        "route_code": _route_code(code),
        "name": name,
        "price": _f(q.get("price")),
        "change_percent": _f(q.get("changePercent")),
        "amount": amount,
        "turnover_rate": _f(q.get("turnoverRate")),
        "volume_ratio": _f(q.get("volumeRatio")),
        "circulating_market_cap": _f(q.get("circulatingMarketCap")),
        "pe": _f(q.get("pe")),
        "pb": _f(q.get("pb")),
        "why_hit": list(judged.get("why_hit") or []),
        "factors": factors,
        "tradability": trad,
        "tradeable": trad.get("tradable", True),
        "score": score,
        "as_of_bar": bars[-1].get("date") if bars else None,
    }
    if isinstance(sync_fac, dict):
        for key in (
            "price_rise_pct",
            "vol_ratio",
            "sync_ratio",
            "price_up_days",
            "sync_up_days",
            "vol_down_on_up",
        ):
            if key in sync_fac:
                row[key] = sync_fac[key]
    if isinstance(breakout_fac, dict):
        if "volume_multiple" in breakout_fac:
            row["volume_multiple"] = breakout_fac["volume_multiple"]
        if "breakout" in breakout_fac:
            row["breakout"] = breakout_fac["breakout"]
    return row


def _run_tech_rules_scanner(tmpl: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    preset_id = str(tmpl.get("preset_id") or tmpl.get("id") or "")
    preset = get_preset(preset_id)
    if not preset:
        return {"ok": False, "error": f"preset not found: {preset_id}"}

    exclude_st = bool(cfg.get("exclude_st", True))
    limit = max(1, min(int(cfg.get("limit") or 50), 200))
    universe_size = max(20, min(int(cfg.get("universe_size") or 300), 800))
    min_amount = float(cfg.get("min_amount") or 3.0e4)
    concurrency = max(1, min(int(cfg.get("concurrency") or 8), 16))
    fetch_kline = bool(cfg.get("fetch_kline", True))
    min_bars = max(30, int(cfg.get("min_bars") or 100))

    quotes = cache_models.read_snapshot("cn")
    universe = _select_universe(
        quotes,
        exclude_st=exclude_st,
        universe_size=universe_size,
        min_amount=min_amount,
    )
    rules = preset.get("rules") or {"all": []}

    hits: list[dict[str, Any]] = []
    scanned = 0
    kline_ok = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futs = [
            pool.submit(
                _eval_one_tech,
                q,
                rules=rules,
                fetch_kline=fetch_kline,
                min_bars=min_bars,
            )
            for q in universe
        ]
        for fut in as_completed(futs):
            scanned += 1
            try:
                row = fut.result()
            except Exception as exc:  # noqa: BLE001
                _log.debug("tech eval failed: %s", exc)
                continue
            if row is None:
                continue
            kline_ok += 1
            hits.append(row)

    hits.sort(key=lambda x: (x.get("score") or 0), reverse=True)
    tradeable = [h for h in hits if h.get("tradeable")]
    blocked = [h for h in hits if not h.get("tradeable")]
    results = (tradeable + blocked)[:limit]

    conditions = [
        rule_block_to_sentence(b)
        for b in (rules.get("all") or [])
        if isinstance(b, dict)
    ]

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "template": tmpl,
        "preset_id": preset_id,
        "params": {
            **cfg,
            "universe_size": universe_size,
            "min_amount": min_amount,
            "concurrency": concurrency,
            "fetch_kline": fetch_kline,
            "min_bars": min_bars,
        },
        "scanned": scanned,
        "universe": len(universe),
        "kline_evaluated_hits": kline_ok,
        "hit_count": len(hits),
        "returned": len(results),
        "results": results,
        "conditions": conditions,
        "disclaimer": (
            "不构成投资建议；技术扫描默认在成交额靠前股票池内执行；"
            "一字板等标记为信号成立但不可成交。"
        ),
    }


def run_scanner(
    template_id: str = "quality_value",
    *,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from research.fundamental_scan import run_dividend_roe_scan, run_growth_trend_scan

    tid = (template_id or "").strip() or "quality_value"
    # 允许直接传 strategy preset id
    tmpl = SCAN_TEMPLATES.get(tid)
    if not tmpl:
        preset = get_preset(tid)
        if preset and preset.get("run_engine") == "research_scanner":
            engine_guess = "valuation"
            if tid in {
                "ma_bull_stack",
                "dual_ma_coil",
                "breakout_volume",
                "volume_price_rise",
            }:
                engine_guess = "tech_rules"
            elif tid in {"dividend_roe", "growth_trend"}:
                engine_guess = "fundamental"
            tmpl = {
                "id": tid,
                "name": preset.get("name") or tid,
                "description": (preset.get("copy") or {}).get("one_liner") or "",
                "engine": engine_guess,
                "preset_id": tid,
                "params": {
                    "exclude_st": True,
                    "limit": 50,
                    "universe_size": 300,
                    "min_amount": 3.0e4,
                    "concurrency": 8,
                    "fetch_kline": True,
                    "min_bars": 100,
                },
            }
        else:
            tmpl = SCAN_TEMPLATES["quality_value"]
            tid = "quality_value"

    cfg = dict(tmpl.get("params") or {})
    if params:
        cfg.update({k: v for k, v in params.items() if v is not None})

    engine = str(tmpl.get("engine") or "valuation")
    if engine == "tech_rules":
        return _run_tech_rules_scanner(tmpl, cfg)
    if engine == "fundamental":
        if tid == "growth_trend" or tmpl.get("preset_id") == "growth_trend":
            return run_growth_trend_scan(cfg)
        return run_dividend_roe_scan(cfg)
    return _run_valuation_scanner(tmpl, cfg)
