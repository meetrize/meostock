"""长线基本面扫描：高股息+ROE、成长趋势（M3）。

优先用 Tushare daily_basic（全市场 dv_ttm）+ fina_indicator（抽样 ROE/增速）。
无权限时明确降级，禁止静默满分。
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models as cache_models
from research.fina_probe import fetch_fina_indicator, probe_fina_access, to_ts_code
from research.kline_series import load_daily_bars
from research.limits import tradability
from research.rule_engine import eval_ma_above
from research.strategy_presets import get_preset, rule_block_to_sentence

_log = logging.getLogger("research.fundamental_scan")
_SH = ZoneInfo("Asia/Shanghai")


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


def _route_code(code: str) -> str:
    c = (code or "").strip().upper()
    if "." in c:
        return c
    if c.startswith(("5", "6", "9")):
        return f"{c}.SH"
    return f"{c}.SZ"


def _pure(code: str) -> str:
    c = (code or "").strip().upper()
    if "." in c:
        return c.split(".", 1)[0]
    return c


def _quote_index() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for q in cache_models.read_snapshot("cn") or []:
        code = _pure(str(q.get("code") or ""))
        if code:
            out[code] = q
    return out


def _latest_trade_date() -> str | None:
    try:
        from tsrelay.client import get_client

        res = get_client().query(
            "daily_basic",
            {"ts_code": "600519.SH", "limit": 1},
            "ts_code,trade_date",
        )
        if not res.ok:
            return None
        rows = res.as_records() or []
        if not rows:
            return None
        return str(rows[0].get("trade_date") or "") or None
    except Exception as exc:  # noqa: BLE001
        _log.warning("latest trade_date failed: %s", exc)
        return None


def fetch_daily_basic_map(*, trade_date: str | None = None) -> dict[str, Any]:
    """全市场 daily_basic → {pure_code: row}。"""
    probe = probe_fina_access()
    if not probe.get("configured"):
        return {
            "ok": False,
            "reason": "not_configured",
            "rows": {},
            "trade_date": None,
            "probe": probe,
        }
    td = trade_date or _latest_trade_date()
    if not td:
        return {
            "ok": False,
            "reason": "no_trade_date",
            "rows": {},
            "trade_date": None,
            "probe": probe,
        }
    try:
        from tsrelay.client import get_client

        res = get_client().query(
            "daily_basic",
            {"trade_date": td},
            "ts_code,trade_date,close,pe,pb,pe_ttm,dv_ttm,dv_ratio,total_mv,circ_mv",
        )
        if not res.ok:
            return {
                "ok": False,
                "reason": res.error_code or "query_failed",
                "error": res.error,
                "rows": {},
                "trade_date": td,
                "probe": probe,
            }
        rows: dict[str, dict[str, Any]] = {}
        for r in res.as_records() or []:
            ts = str(r.get("ts_code") or "")
            code = _pure(ts)
            if code:
                rows[code] = r
        return {
            "ok": True,
            "rows": rows,
            "trade_date": td,
            "count": len(rows),
            "probe": probe,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "reason": "exception",
            "error": str(exc),
            "rows": {},
            "trade_date": td,
            "probe": probe,
        }


def _fetch_roe(code: str) -> dict[str, Any]:
    fina = fetch_fina_indicator(code)
    if not fina.get("available"):
        return {
            "code": _pure(code),
            "roe": None,
            "available": False,
            "reason": fina.get("reason"),
        }
    metrics = fina.get("metrics") or {}
    hist = fina.get("history") or []
    roes = [ _f(h.get("roe")) for h in hist ]
    roes = [x for x in roes if x is not None]
    return {
        "code": _pure(code),
        "roe": _f(metrics.get("roe")),
        "roe_history": roes,
        "available": True,
        "end_date": fina.get("end_date"),
        "or_yoy": None,
        "netprofit_yoy": None,
    }


def _fetch_growth(code: str) -> dict[str, Any]:
    """单票增速：扩展 fina 字段查询。"""
    probe = probe_fina_access()
    ts_code = to_ts_code(code)
    if not ts_code or not probe.get("fina_indicator"):
        return {
            "code": _pure(code),
            "available": False,
            "reason": "no_permission" if probe.get("configured") else "not_configured",
        }
    try:
        from tsrelay.client import get_client

        res = get_client().query(
            "fina_indicator",
            {"ts_code": ts_code, "limit": 4},
            "ts_code,end_date,roe,or_yoy,netprofit_yoy,q_netprofit_yoy",
        )
        if not res.ok:
            return {
                "code": _pure(code),
                "available": False,
                "reason": res.error_code or "query_failed",
                "error": res.error,
            }
        rows = res.as_records() or []
        if not rows:
            return {"code": _pure(code), "available": False, "reason": "empty"}
        latest = rows[0]
        return {
            "code": _pure(code),
            "available": True,
            "roe": _f(latest.get("roe")),
            "or_yoy": _f(latest.get("or_yoy")),
            "netprofit_yoy": _f(latest.get("netprofit_yoy")),
            "end_date": latest.get("end_date"),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "code": _pure(code),
            "available": False,
            "reason": "exception",
            "error": str(exc),
        }


def _map_roe_batch(codes: list[str], *, concurrency: int = 6) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not codes:
        return out
    with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 12))) as pool:
        futs = {pool.submit(_fetch_roe, c): c for c in codes}
        for fut in as_completed(futs):
            try:
                row = fut.result()
            except Exception as exc:  # noqa: BLE001
                _log.debug("roe fetch failed: %s", exc)
                continue
            out[str(row.get("code"))] = row
    return out


def _map_growth_batch(codes: list[str], *, concurrency: int = 6) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not codes:
        return out
    with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 12))) as pool:
        futs = {pool.submit(_fetch_growth, c): c for c in codes}
        for fut in as_completed(futs):
            try:
                row = fut.result()
            except Exception as exc:  # noqa: BLE001
                _log.debug("growth fetch failed: %s", exc)
                continue
            out[str(row.get("code"))] = row
    return out


def run_dividend_roe_scan(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = dict(cfg or {})
    preset = get_preset("dividend_roe") or {}
    rules = preset.get("rules") or {}
    # 从规则读默认阈值
    dv_min = 3.0
    roe_min = 10.0
    for b in rules.get("all") or []:
        if not isinstance(b, dict):
            continue
        if b.get("op") == "valuation.dividend":
            dv_min = float((b.get("params") or {}).get("min") or dv_min)
        if b.get("op") == "fina.roe":
            roe_min = float((b.get("params") or {}).get("min") or roe_min)
    dv_min = float(cfg.get("dividend_min") or dv_min)
    roe_min = float(cfg.get("roe_min") or roe_min)
    exclude_st = bool(cfg.get("exclude_st", True))
    limit = max(1, min(int(cfg.get("limit") or 50), 200))
    roe_probe_n = max(20, min(int(cfg.get("roe_probe_n") or 120), 300))
    concurrency = max(1, min(int(cfg.get("concurrency") or 6), 12))

    basic = fetch_daily_basic_map()
    quotes = _quote_index()
    data_gaps: list[str] = []
    conditions = [
        rule_block_to_sentence(b)
        for b in (rules.get("all") or [])
        if isinstance(b, dict)
    ]

    if not basic.get("ok"):
        # 降级：无 daily_basic → 用 PE/PB 便宜分位近似，并标注缺口
        data_gaps.append("无 daily_basic/股息数据，已降级为 PE/PB 低估值近似（非真实高股息）")
        from research.scanner_run import _run_valuation_scanner

        degraded = _run_valuation_scanner(
            {
                "id": "dividend_roe",
                "name": "高股息+高ROE（降级）",
                "engine": "valuation",
                "params": {},
            },
            {
                "pe_percentile_max": 35.0,
                "pb_percentile_max": 45.0,
                "exclude_st": exclude_st,
                "limit": limit,
            },
        )
        for row in degraded.get("results") or []:
            why = list(row.get("why_hit") or [])
            why.insert(0, "数据缺口：缺少股息率，本结果为降级近似")
            row["why_hit"] = why
            row["data_gaps"] = list(data_gaps)
            row["dividend_yield"] = None
            row["roe"] = None
        degraded["preset_id"] = "dividend_roe"
        degraded["data_gaps"] = data_gaps
        degraded["conditions"] = conditions
        degraded["degraded"] = True
        return degraded

    rows: dict[str, dict[str, Any]] = basic.get("rows") or {}
    candidates: list[dict[str, Any]] = []
    for code, br in rows.items():
        q = quotes.get(code) or {}
        name = str(q.get("name") or code)
        if exclude_st and _is_st(name):
            continue
        dv = _f(br.get("dv_ttm"))
        if dv is None or dv < dv_min:
            continue
        candidates.append(
            {
                "code": code,
                "name": name,
                "quote": q,
                "basic": br,
                "dv_ttm": dv,
                "pe": _f(br.get("pe_ttm")) or _f(br.get("pe")) or _f(q.get("pe")),
                "pb": _f(br.get("pb")) or _f(q.get("pb")),
            }
        )
    candidates.sort(key=lambda x: float(x.get("dv_ttm") or 0), reverse=True)

    probe = basic.get("probe") or probe_fina_access()
    roe_map: dict[str, dict[str, Any]] = {}
    if probe.get("fina_indicator"):
        probe_codes = [c["code"] for c in candidates[:roe_probe_n]]
        roe_map = _map_roe_batch(probe_codes, concurrency=concurrency)
    else:
        data_gaps.append("无 fina_indicator 权限：未做 ROE 硬过滤，仅按股息率排序")

    hits: list[dict[str, Any]] = []
    for c in candidates:
        code = c["code"]
        roe_row = roe_map.get(code)
        roe = _f((roe_row or {}).get("roe")) if roe_row else None
        if probe.get("fina_indicator"):
            # 未抽到 ROE 的票跳过（避免把未验证 ROE 当通过）
            if code not in roe_map:
                continue
            if not roe_row or not roe_row.get("available") or roe is None or roe < roe_min:
                continue
        why = [f"股息率(TTM) {c['dv_ttm']:.2f}% ≥ {dv_min:g}%"]
        if roe is not None:
            why.append(f"ROE {roe:.2f}% ≥ {roe_min:g}%")
        else:
            why.append("ROE 未验证（数据缺口）")
            if "ROE 未硬过滤" not in "".join(data_gaps):
                pass
        q = c["quote"]
        trad = tradability(q) if q else {"tradable": True, "label": "可成交", "reasons": []}
        hits.append(
            {
                "symbol": code,
                "route_code": _route_code(code),
                "name": c["name"],
                "price": _f(q.get("price")) or _f(c["basic"].get("close")),
                "change_percent": _f(q.get("changePercent")),
                "pe": c["pe"],
                "pb": c["pb"],
                "dividend_yield": c["dv_ttm"],
                "roe": roe,
                "why_hit": why,
                "factors": {
                    "dv_ttm": c["dv_ttm"],
                    "roe": roe,
                    "pe": c["pe"],
                    "pb": c["pb"],
                },
                "data_gaps": list(data_gaps) if roe is None else [],
                "tradability": trad,
                "tradeable": trad.get("tradable", True),
                "score": float(c["dv_ttm"] or 0) + (float(roe or 0) / 10.0),
            }
        )

    hits.sort(key=lambda x: (x.get("score") or 0), reverse=True)
    tradeable = [h for h in hits if h.get("tradeable")]
    blocked = [h for h in hits if not h.get("tradeable")]
    results = (tradeable + blocked)[:limit]

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "preset_id": "dividend_roe",
        "template": {
            "id": "dividend_roe",
            "name": preset.get("name") or "高股息+高ROE",
            "engine": "fundamental",
        },
        "params": {
            "dividend_min": dv_min,
            "roe_min": roe_min,
            "exclude_st": exclude_st,
            "limit": limit,
            "roe_probe_n": roe_probe_n,
            "trade_date": basic.get("trade_date"),
        },
        "scanned": len(rows),
        "dividend_candidates": len(candidates),
        "roe_probed": len(roe_map),
        "hit_count": len(hits),
        "returned": len(results),
        "results": results,
        "conditions": conditions,
        "data_gaps": data_gaps,
        "degraded": bool(data_gaps),
        "fina_probe": {
            "mode": probe.get("mode"),
            "fina_indicator": probe.get("fina_indicator"),
            "hint": probe.get("hint"),
        },
        "disclaimer": "不构成投资建议；股息率为 TTM；ROE 为最近一期财报，非连续多年硬校验。",
    }


def run_growth_trend_scan(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = dict(cfg or {})
    preset = get_preset("growth_trend") or {}
    rules = preset.get("rules") or {}
    rev_min = 15.0
    profit_min = 15.0
    peg_max = 1.5
    ma_period = 60
    for b in rules.get("all") or []:
        if not isinstance(b, dict):
            continue
        p = b.get("params") or {}
        if b.get("op") == "fina.growth":
            rev_min = float(p.get("revenue_min") or rev_min)
            profit_min = float(p.get("profit_min") or profit_min)
        if b.get("op") == "valuation.peg":
            peg_max = float(p.get("max") or peg_max)
        if b.get("op") == "ma.above":
            ma_period = int(p.get("period") or ma_period)
    rev_min = float(cfg.get("revenue_min") or rev_min)
    profit_min = float(cfg.get("profit_min") or profit_min)
    peg_max = float(cfg.get("peg_max") or peg_max)
    ma_period = int(cfg.get("ma_period") or ma_period)
    exclude_st = bool(cfg.get("exclude_st", True))
    limit = max(1, min(int(cfg.get("limit") or 40), 120))
    universe_size = max(30, min(int(cfg.get("universe_size") or 180), 400))
    min_amount = float(cfg.get("min_amount") or 3.0e4)
    concurrency = max(1, min(int(cfg.get("concurrency") or 6), 12))
    fetch_kline = bool(cfg.get("fetch_kline", True))

    conditions = [
        rule_block_to_sentence(b)
        for b in (rules.get("all") or [])
        if isinstance(b, dict)
    ]
    data_gaps: list[str] = []
    probe = probe_fina_access()

    # 流动性池
    quotes = [
        q
        for q in (cache_models.read_snapshot("cn") or [])
        if _f(q.get("price"))
        and _f(q.get("amount"))
        and float(q.get("amount") or 0) >= min_amount
        and not (exclude_st and _is_st(str(q.get("name") or "")))
    ]
    quotes.sort(key=lambda x: float(x.get("amount") or 0), reverse=True)
    universe = quotes[:universe_size]
    codes = [_pure(str(q.get("code") or "")) for q in universe]
    codes = [c for c in codes if c]

    growth_map: dict[str, dict[str, Any]] = {}
    if probe.get("fina_indicator"):
        growth_map = _map_growth_batch(codes, concurrency=concurrency)
    else:
        data_gaps.append("无 fina 权限：无法验证业绩增速/PEG，已跳过成长硬过滤（仅趋势降级不可用）")
        return {
            "ok": True,
            "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
            "preset_id": "growth_trend",
            "template": {
                "id": "growth_trend",
                "name": preset.get("name") or "成长趋势",
                "engine": "fundamental",
            },
            "params": cfg,
            "scanned": len(universe),
            "hit_count": 0,
            "returned": 0,
            "results": [],
            "conditions": conditions,
            "data_gaps": data_gaps,
            "degraded": True,
            "fina_probe": {
                "mode": probe.get("mode"),
                "fina_indicator": False,
                "hint": probe.get("hint"),
            },
            "disclaimer": "不构成投资建议；缺少财务权限时成长趋势扫描不输出伪结果。",
        }

    # 先筛增速，再验均线（减 K 线量）
    growth_ok: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for q in universe:
        code = _pure(str(q.get("code") or ""))
        g = growth_map.get(code) or {}
        if not g.get("available"):
            continue
        or_yoy = _f(g.get("or_yoy"))
        np_yoy = _f(g.get("netprofit_yoy"))
        # 至少一项达标；另一项缺失不直接否决
        rev_ok = or_yoy is None or or_yoy >= rev_min
        np_ok = np_yoy is None or np_yoy >= profit_min
        if or_yoy is None and np_yoy is None:
            continue
        if not (rev_ok and np_ok):
            continue
        # 至少有一个明确正增长数字达到门槛
        if not (
            (or_yoy is not None and or_yoy >= rev_min)
            or (np_yoy is not None and np_yoy >= profit_min)
        ):
            continue
        growth_ok.append((q, g))

    hits: list[dict[str, Any]] = []

    def _eval_one(item: tuple[dict[str, Any], dict[str, Any]]) -> dict[str, Any] | None:
        q, g = item
        code = _pure(str(q.get("code") or ""))
        bars = load_daily_bars(code, limit=max(ma_period + 20, 100), fetch_if_empty=fetch_kline)
        closes = []
        for b in bars:
            c = _f(b.get("close"))
            if c is not None:
                closes.append(c)
        ok_ma, why_ma, fac_ma = eval_ma_above(closes, period=ma_period)
        if not ok_ma:
            return None
        pe = _f(q.get("pe"))
        growth = _f(g.get("netprofit_yoy")) or _f(g.get("or_yoy")) or 0.0
        peg = None
        if pe is not None and growth and growth > 0:
            peg = pe / growth
            if peg > peg_max:
                return None
        why = list(why_ma)
        if g.get("or_yoy") is not None:
            why.append(f"营收同比 {g['or_yoy']:.1f}%")
        if g.get("netprofit_yoy") is not None:
            why.append(f"净利同比 {g['netprofit_yoy']:.1f}%")
        if peg is not None:
            why.append(f"PEG≈{peg:.2f} ≤ {peg_max:g}")
        else:
            why.append("PEG 未计算（缺 PE 或增速）")
        trad = tradability(q)
        return {
            "symbol": code,
            "route_code": _route_code(code),
            "name": str(q.get("name") or code),
            "price": _f(q.get("price")),
            "change_percent": _f(q.get("changePercent")),
            "pe": pe,
            "pb": _f(q.get("pb")),
            "roe": _f(g.get("roe")),
            "growth": growth,
            "or_yoy": _f(g.get("or_yoy")),
            "netprofit_yoy": _f(g.get("netprofit_yoy")),
            "peg": round(peg, 3) if peg is not None else None,
            "why_hit": why,
            "factors": {**fac_ma, "growth": growth, "peg": peg},
            "tradability": trad,
            "tradeable": trad.get("tradable", True),
            "score": float(growth or 0),
            "data_gaps": [],
        }

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futs = [pool.submit(_eval_one, item) for item in growth_ok]
        for fut in as_completed(futs):
            try:
                row = fut.result()
            except Exception as exc:  # noqa: BLE001
                _log.debug("growth eval failed: %s", exc)
                continue
            if row:
                hits.append(row)

    hits.sort(key=lambda x: (x.get("score") or 0), reverse=True)
    tradeable = [h for h in hits if h.get("tradeable")]
    blocked = [h for h in hits if not h.get("tradeable")]
    results = (tradeable + blocked)[:limit]

    return {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "preset_id": "growth_trend",
        "template": {
            "id": "growth_trend",
            "name": preset.get("name") or "成长趋势",
            "engine": "fundamental",
        },
        "params": {
            "revenue_min": rev_min,
            "profit_min": profit_min,
            "peg_max": peg_max,
            "ma_period": ma_period,
            "universe_size": universe_size,
            "limit": limit,
        },
        "scanned": len(universe),
        "growth_candidates": len(growth_ok),
        "hit_count": len(hits),
        "returned": len(results),
        "results": results,
        "conditions": conditions,
        "data_gaps": data_gaps,
        "degraded": False,
        "fina_probe": {
            "mode": probe.get("mode"),
            "fina_indicator": probe.get("fina_indicator"),
            "hint": probe.get("hint"),
        },
        "disclaimer": "不构成投资建议；增速取最近一期财报同比，PEG 为近似值。",
    }
