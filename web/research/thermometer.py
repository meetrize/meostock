"""A 股市场温度计（设计方案 §4.2；不含北向日频净流入）。"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models as cache_models
from research.limits import is_limit_down, is_limit_up, is_one_word_board

_SH = ZoneInfo("Asia/Shanghai")

STAGE_DEFS = {
    "ice": "冰点：跌停多、涨停少、宽度极差",
    "start": "启动：涨停抬头、跌停回落、成交回暖",
    "main": "主升：涨停质量好、宽度健康、连板有高度",
    "diverge": "分歧：涨跌停并存、炸板增多、宽度摇摆",
    "ebb": "退潮：涨停萎缩、跌停抬升、成交回落",
    "unknown": "数据不足，无法判定情绪阶段",
}


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _pct_rank(value: float, samples: list[float]) -> float | None:
    if not samples:
        return None
    below = sum(1 for s in samples if s <= value)
    return 100.0 * below / len(samples)


def _load_ts_topic(market_id: str) -> dict[str, Any] | None:
    try:
        from tsrelay import store as ts_store

        meta_rows = ts_store.list_meta()
        meta = next((m for m in meta_rows if m.get("market_id") == market_id), None)
        td = (meta or {}).get("last_trade_date")
        if not td or td == "00000000":
            return None
        return ts_store.get_snapshot(market_id, str(td))
    except Exception:  # noqa: BLE001
        return None


def _margin_delta() -> dict[str, Any]:
    snap = _load_ts_topic("ts:margin")
    if not snap:
        return {
            "available": False,
            "balance": None,
            "delta": None,
            "trade_date": None,
            "note": "两融 topic 未缓存",
        }
    items = snap.get("items") or []
    row = items[0] if items else {}
    balance = (
        _f(row.get("rzye"))
        or _f(row.get("finBalance"))
        or _f(row.get("rz_balance"))
        or _f(row.get("balance"))
    )
    # 若仅有单日切片，delta 暂不可得
    return {
        "available": balance is not None,
        "balance": balance,
        "delta": None,
        "trade_date": snap.get("trade_date"),
        "note": "两融余额（估算口径以 Tushare margin 为准；日环比需多日切片，Phase 1 暂缺）",
        "source": snap.get("source"),
    }


def _limit_stats_from_topic() -> dict[str, Any]:
    snap = _load_ts_topic("ts:limit")
    if not snap:
        return {"available": False, "up": None, "down": None, "items": 0}
    items = snap.get("items") or []
    up = 0
    down = 0
    for it in items:
        side = str(it.get("limit") or it.get("side") or it.get("type") or "").upper()
        name = str(it.get("name") or "")
        # limit_list 常见 U/D
        if side in ("U", "UP", "Z", "涨停") or "涨停" in name:
            up += 1
        elif side in ("D", "DOWN", "跌停") or "跌停" in name:
            down += 1
    # 若无 side 字段，用 limit 字段计数
    if up == 0 and down == 0 and items:
        for it in items:
            lim = str(it.get("limit") or "").upper()
            if lim == "U":
                up += 1
            elif lim == "D":
                down += 1
    return {
        "available": True,
        "up": up,
        "down": down,
        "items": len(items),
        "trade_date": snap.get("trade_date"),
        "source": snap.get("source"),
    }


def _emotion_stage(
    *,
    rise_ratio: float,
    limit_up: int,
    limit_down: int,
    one_word_up: int,
    amount_pct: float | None,
) -> tuple[str, str]:
    if limit_up + limit_down == 0 and rise_ratio == 0:
        return "unknown", STAGE_DEFS["unknown"]
    if limit_down >= max(40, limit_up * 2) and rise_ratio < 0.35:
        return "ice", STAGE_DEFS["ice"]
    if limit_up >= 60 and rise_ratio >= 0.55 and one_word_up <= limit_up * 0.45:
        return "main", STAGE_DEFS["main"]
    if limit_up >= 30 and rise_ratio >= 0.45 and (amount_pct or 50) >= 40:
        return "start", STAGE_DEFS["start"]
    if limit_up >= 20 and limit_down >= 15:
        return "diverge", STAGE_DEFS["diverge"]
    if limit_up < 20 and rise_ratio < 0.45:
        return "ebb", STAGE_DEFS["ebb"]
    if rise_ratio >= 0.55:
        return "start", STAGE_DEFS["start"]
    return "diverge", STAGE_DEFS["diverge"]


def build_market_thermometer() -> dict[str, Any]:
    as_of = datetime.now(_SH).isoformat(timespec="seconds")
    quotes = cache_models.read_snapshot("cn")
    data_gaps: list[str] = []
    if not quotes:
        data_gaps.append("quote_snapshot_cn")
        return {
            "ok": True,
            "as_of": as_of,
            "temperature": None,
            "stage": "unknown",
            "stage_def": STAGE_DEFS["unknown"],
            "factors": [],
            "breadth": {},
            "data_gaps": data_gaps,
            "disclaimer": "不构成投资建议；无行情缓存。",
            "northbound_note": "北向日频净买入已停更，不进入温度分",
        }

    rise = fall = flat = 0
    limit_up = limit_down = 0
    one_word_up = 0
    amounts: list[float] = []
    total_amount = 0.0

    for q in quotes:
        pct = _f(q.get("changePercent"))
        if pct is None:
            continue
        if pct > 0:
            rise += 1
        elif pct < 0:
            fall += 1
        else:
            flat += 1
        code = str(q.get("code") or "")
        name = str(q.get("name") or "")
        if is_limit_up(code, name, pct):
            limit_up += 1
            if is_one_word_board(q):
                one_word_up += 1
        if is_limit_down(code, name, pct):
            limit_down += 1
        amt = _f(q.get("amount"))
        if amt is not None and amt > 0:
            amounts.append(amt)
            total_amount += amt

    traded = rise + fall + flat
    rise_ratio = (rise / traded) if traded else 0.0
    # 用全市场个股成交额分布的中位分位近似「今日总成交冷热」：取总成交相对「均股×股数」无历史，
    # Phase 1 用涨跌比 + 涨停质量为主，成交额因子用 rise_ratio 相关代理：金额均值分位不可得时用宽度替代
    amount_pct = _clamp(rise_ratio * 100.0)  # 无历史序列时降级
    if not amounts:
        data_gaps.append("amount_history")

    # 涨停质量：非一字占比
    limit_quality = 50.0
    if limit_up > 0:
        limit_quality = 100.0 * (1.0 - one_word_up / limit_up)

    breadth_score = _clamp(rise_ratio * 100.0)
    limit_score = _clamp(50.0 + (limit_up - limit_down) * 0.8)
    amount_score = amount_pct
    # 两融
    margin = _margin_delta()
    if not margin.get("available"):
        data_gaps.append("margin")
    margin_score = 50.0  # 无环比时中性

    # 波动惩罚：跌停占比
    dd_ratio = (limit_down / traded) if traded else 0.0
    vol_penalty = _clamp(dd_ratio * 400.0)  # 跌停 25% → 惩罚 100

    w = {"breadth": 0.35, "limit": 0.25, "amount": 0.20, "margin": 0.10, "vol": 0.10}
    temperature = _clamp(
        w["breadth"] * breadth_score
        + w["limit"] * (0.5 * limit_score + 0.5 * limit_quality)
        + w["amount"] * amount_score
        + w["margin"] * margin_score
        + w["vol"] * (100.0 - vol_penalty)
    )

    topic_lim = _limit_stats_from_topic()
    # 若 topic 有更权威涨停数且差异大，标注
    if topic_lim.get("available") and topic_lim.get("up") is not None:
        # 不覆盖本地计算，仅附对照
        pass

    stage, stage_def = _emotion_stage(
        rise_ratio=rise_ratio,
        limit_up=limit_up,
        limit_down=limit_down,
        one_word_up=one_word_up,
        amount_pct=amount_pct,
    )

    factors = [
        {
            "id": "breadth",
            "name": "涨跌比",
            "value": round(rise_ratio, 4),
            "score": round(breadth_score, 1),
            "weight": w["breadth"],
            "detail": f"涨{rise}/跌{fall}/平{flat}",
        },
        {
            "id": "limit_quality",
            "name": "涨停质量",
            "value": {
                "limit_up": limit_up,
                "limit_down": limit_down,
                "one_word_up": one_word_up,
            },
            "score": round(0.5 * limit_score + 0.5 * limit_quality, 1),
            "weight": w["limit"],
            "detail": f"涨停{limit_up} 跌停{limit_down} 一字涨停{one_word_up}",
        },
        {
            "id": "amount",
            "name": "成交额代理",
            "value": round(total_amount, 2),
            "unit": "万元",
            "score": round(amount_score, 1),
            "weight": w["amount"],
            "detail": "无历史分位时以降级代理（宽度）估算；标注口径",
            "caveat": "估算",
        },
        {
            "id": "margin",
            "name": "两融",
            "value": margin.get("balance"),
            "score": round(margin_score, 1),
            "weight": w["margin"],
            "detail": margin.get("note"),
            "caveat": "中性占位" if margin.get("delta") is None else None,
        },
        {
            "id": "vol_penalty",
            "name": "波动惩罚",
            "value": round(dd_ratio, 4),
            "score": round(100.0 - vol_penalty, 1),
            "weight": w["vol"],
            "detail": f"跌停占比 {dd_ratio:.2%}",
        },
    ]

    return {
        "ok": True,
        "as_of": as_of,
        "temperature": round(temperature, 1),
        "stage": stage,
        "stage_def": stage_def,
        "stage_defs": STAGE_DEFS,
        "factors": factors,
        "breadth": {
            "rise": rise,
            "fall": fall,
            "flat": flat,
            "traded": traded,
            "limit_up": limit_up,
            "limit_down": limit_down,
            "one_word_up": one_word_up,
            "total_amount_wan": round(total_amount, 2),
        },
        "margin": margin,
        "limit_topic": topic_lim,
        "data_gaps": data_gaps,
        "disclaimer": "不构成投资建议；温度分为规则引擎硬分，样本外未充分验证时作参考。",
        "northbound_note": "北向日频净买入已停更，不进入温度分",
    }
