"""日 K 收盘序列（复用 quote-cache；缺则拉取）。"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

_log = logging.getLogger("research.kline")
_SH = ZoneInfo("Asia/Shanghai")

# 展示码 → 缓存 symbol
_BENCH_TO_CACHE = {
    "000300.SH": "sh000300",
    "000905.SH": "sh000905",
    "399006.SZ": "sz399006",
    "000001.SH": "sh000001",
}


def to_cache_symbol(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    key = s.upper()
    if key in _BENCH_TO_CACHE:
        return _BENCH_TO_CACHE[key]
    try:
        from cache.providers.kline_fetch import normalize_symbol

        norm = normalize_symbol(s)
        if norm.get("market") == "cn":
            return str(norm["symbol"])
        # 指数/其它：尽量用 display 小写
        return str(norm.get("symbol") or s).lower()
    except Exception:  # noqa: BLE001
        low = s.lower()
        if low.startswith(("sh", "sz", "bj")):
            return low
        # 600519.SH → sh600519
        import re

        m = re.search(r"(\d{6})", s)
        if not m:
            return low
        dig = m.group(1)
        if dig.startswith(("5", "6", "9")) or dig.startswith("000") or dig.startswith("399"):
            # 粗判：000xxx / 399xxx 用 sh/sz
            if dig.startswith("399") or dig.startswith("0") and not dig.startswith("00"):
                # 000001 上证、000300 等走 sh
                if dig.startswith(("000", "880", "399")):
                    pref = "sz" if dig.startswith("399") else "sh"
                    return f"{pref}{dig}"
            if dig.startswith(("0", "1", "2", "3")):
                return f"sz{dig}"
            return f"sh{dig}"
        return f"sh{dig}"


def bar_date(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000.0, tz=_SH).date().isoformat()


def load_daily_bars(
    symbol: str,
    *,
    limit: int = 800,
    fetch_if_empty: bool = True,
) -> list[dict[str, Any]]:
    """返回 [{date, open, high, low, close, volume, timestamp}] 升序。"""
    from cache.kline_models import read_kline_bars
    from cache.providers.kline_fetch import normalize_symbol

    cache_sym = to_cache_symbol(symbol)
    if not cache_sym:
        return []

    try:
        norm = normalize_symbol(cache_sym if cache_sym.startswith(("sh", "sz", "bj")) else symbol)
        market = str(norm.get("market") or "cn")
        sym = str(norm.get("symbol") or cache_sym)
    except Exception:  # noqa: BLE001
        market, sym = "cn", cache_sym

    bars = read_kline_bars(market, sym, "1d", limit=limit)
    if (not bars) and fetch_if_empty:
        try:
            from cache.providers.kline_fetch import fetch_kline_bars
            from cache.kline_models import upsert_kline_bars

            fetched, name, src = fetch_kline_bars(
                {"market": market, "symbol": sym, "display": sym}, "1d"
            )
            if fetched:
                upsert_kline_bars(
                    market, sym, "1d", fetched, source=src or "fetch", name=name
                )
                bars = read_kline_bars(market, sym, "1d", limit=limit)
        except Exception as exc:  # noqa: BLE001
            _log.warning("fetch kline %s failed: %s", symbol, exc)

    out: list[dict[str, Any]] = []
    for b in bars:
        ts = int(b.get("timestamp") or 0)
        if ts <= 0:
            continue
        out.append(
            {
                "date": bar_date(ts),
                "timestamp": ts,
                "open": b.get("open"),
                "high": b.get("high"),
                "low": b.get("low"),
                "close": b.get("close"),
                "volume": b.get("volume"),
            }
        )
    return out


def closes_by_date(bars: list[dict[str, Any]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for b in bars:
        try:
            c = float(b["close"])
        except (TypeError, ValueError, KeyError):
            continue
        out[str(b["date"])] = c
    return out


def interval_return(
    closes: dict[str, float],
    start: str | None,
    end: str | None,
) -> float | None:
    """[start, end] 区间简单收益 %；缺边界日则用区间内最近可用收盘。"""
    if not closes or not start or not end:
        return None
    s = start[:10]
    e = end[:10]
    dates = sorted(closes.keys())
    start_c = None
    end_c = None
    for d in dates:
        if d >= s and start_c is None:
            # 用 s 当日或之后第一根；若需入场日前收盘，取 <=s 最后一根
            pass
    # entry: 最后一个 date <= start；exit: 最后一个 date <= end
    for d in dates:
        if d <= s:
            start_c = closes[d]
        if d <= e:
            end_c = closes[d]
    if start_c is None or end_c is None or start_c == 0:
        return None
    return round((end_c - start_c) / start_c * 100.0, 2)
