"""日/周/月 K 时间戳规范化：同一交易日统一落到市场开盘 09:30。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

DAY_LIKE_PERIODS = frozenset({"1d", "1w", "1M"})

_SOURCE_RANK = {
    "eastmoney": 30,
    "yahoo": 20,
    "yf": 20,
    "sina": 10,
}


def market_day_tz(market: str, symbol: str = "") -> str:
    m = (market or "").strip().lower()
    if m == "us":
        return "America/New_York"
    if m == "hk":
        return "Asia/Hong_Kong"
    if m == "futures":
        return "Asia/Shanghai"
    if m == "yf":
        sym = (symbol or "").upper()
        if sym.endswith(".HK"):
            return "Asia/Hong_Kong"
        if sym.endswith(".SS") or sym.endswith(".SZ") or sym.endswith(".SH"):
            return "Asia/Shanghai"
        return "America/New_York"
    # cn 及默认
    return "Asia/Shanghai"


def canonicalize_bar_ts(
    market: str,
    period: str,
    ts_ms: int,
    *,
    symbol: str = "",
    open_hm: tuple[int, int] = (9, 30),
) -> int:
    """日/周/月：按市场日历日归一到开盘时刻；分钟线原样返回。"""
    ts = int(ts_ms or 0)
    if ts <= 0 or period not in DAY_LIKE_PERIODS:
        return ts
    tz = ZoneInfo(market_day_tz(market, symbol))
    dt = datetime.fromtimestamp(ts / 1000.0, tz=tz)
    hh, mm = open_hm
    canon = datetime(dt.year, dt.month, dt.day, hh, mm, tzinfo=tz)
    return int(canon.timestamp() * 1000)


def day_key(market: str, ts_ms: int, *, symbol: str = "") -> str:
    tz = ZoneInfo(market_day_tz(market, symbol))
    dt = datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=tz)
    return dt.strftime("%Y-%m-%d")


def _source_rank(source: str | None) -> int:
    return _SOURCE_RANK.get(str(source or "").strip().lower(), 0)


def collapse_day_like_bars(
    market: str,
    period: str,
    bars: list[dict[str, Any]],
    *,
    symbol: str = "",
) -> list[dict[str, Any]]:
    """同一日历日只留一根，时间戳改为开盘 09:30；优先东财 > Yahoo > 新浪。"""
    if period not in DAY_LIKE_PERIODS or not bars:
        return bars
    best: dict[str, dict[str, Any]] = {}
    for raw in bars:
        try:
            ts0 = int(raw.get("timestamp") or 0)
        except (TypeError, ValueError):
            continue
        if ts0 <= 0:
            continue
        key = day_key(market, ts0, symbol=symbol)
        ts = canonicalize_bar_ts(market, period, ts0, symbol=symbol)
        cand = {**raw, "timestamp": ts}
        prev = best.get(key)
        if prev is None:
            best[key] = cand
            continue
        pr = _source_rank(prev.get("source"))
        cr = _source_rank(cand.get("source"))
        if cr > pr:
            best[key] = cand
            continue
        if cr == pr:
            # 同优先级：保留成交量更大的；相同则后写覆盖
            try:
                pv = float(prev.get("volume") or 0)
                cv = float(cand.get("volume") or 0)
            except (TypeError, ValueError):
                pv, cv = 0.0, 0.0
            if cv >= pv:
                best[key] = cand
    out = list(best.values())
    out.sort(key=lambda b: int(b.get("timestamp") or 0))
    return out
