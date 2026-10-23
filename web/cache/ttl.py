"""缓存模式 × 市场会话 → TTL（秒）。"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

MODES = ("speed", "balanced", "realtime")

# 盘中 TTL
_TTL_SESSION = {
    "speed": 180,
    "balanced": 45,
    "realtime": 10,
}

# 盘后 / 周末 TTL
_TTL_OFF = {
    "speed": 6 * 3600,
    "balanced": 3 * 3600,
    "realtime": 600,
}

_SH = ZoneInfo("Asia/Shanghai")
_HK = ZoneInfo("Asia/Hong_Kong")
_NY = ZoneInfo("America/New_York")

# A 股休市日粗表（含调休连休；不含全部港/美节假日）。缺漏时 fail-open 仅靠周末。
_CN_HOLIDAYS: frozenset[str] = frozenset(
    {
        # 2025
        "2025-01-01",
        "2025-01-28",
        "2025-01-29",
        "2025-01-30",
        "2025-01-31",
        "2025-02-01",
        "2025-02-02",
        "2025-02-03",
        "2025-02-04",
        "2025-04-04",
        "2025-04-05",
        "2025-04-06",
        "2025-05-01",
        "2025-05-02",
        "2025-05-03",
        "2025-05-04",
        "2025-05-05",
        "2025-05-31",
        "2025-06-01",
        "2025-06-02",
        "2025-10-01",
        "2025-10-02",
        "2025-10-03",
        "2025-10-04",
        "2025-10-05",
        "2025-10-06",
        "2025-10-07",
        "2025-10-08",
        # 2026
        "2026-01-01",
        "2026-01-02",
        "2026-02-15",
        "2026-02-16",
        "2026-02-17",
        "2026-02-18",
        "2026-02-19",
        "2026-02-20",
        "2026-02-21",
        "2026-02-22",
        "2026-02-23",
        "2026-04-04",
        "2026-04-05",
        "2026-04-06",
        "2026-05-01",
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
        "2026-05-05",
        "2026-06-19",
        "2026-06-20",
        "2026-06-21",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
    }
)


def normalize_mode(mode: str | None) -> str:
    m = (mode or "balanced").strip().lower()
    return m if m in MODES else "balanced"


def _in_window(now_t: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= now_t <= end
    return now_t >= start or now_t <= end


def _ymd(d: date) -> str:
    return d.isoformat()


def is_cn_holiday(d: date) -> bool:
    """A 股休市日：静态表 + 可选 mootdx2.holiday（失败则忽略）。"""
    key = _ymd(d)
    if key in _CN_HOLIDAYS:
        return True
    try:
        from mootdx2.utils.holiday import holiday  # type: ignore

        # holiday() 常见签名：传 YYYYMMDD 或 date；兼容多种
        ymd = d.strftime("%Y%m%d")
        try:
            return bool(holiday(ymd))
        except TypeError:
            return bool(holiday(d))
    except Exception:
        return False


def is_session_open(market: str, now: datetime | None = None) -> bool:
    """交易时段判断（周末 + A 股节假日粗表）。"""
    m = (market or "").lower()
    if m.startswith("yf:"):
        # 加密近似 7x24；其它 yf 按美股盘处理
        sub = m[3:].upper()
        if sub in ("CRYPTOCURRENCIES", "CURRENCIES"):
            return True
        m = "us"

    if m in ("cn", "fund", "index", "futures"):
        dt = (now or datetime.now(tz=_SH)).astimezone(_SH)
        if dt.weekday() >= 5 or is_cn_holiday(dt.date()):
            return False
        t = dt.time()
        # 含集合竞价缓冲
        return _in_window(t, time(9, 15), time(11, 35)) or _in_window(
            t, time(12, 55), time(15, 5)
        )

    if m == "hk":
        dt = (now or datetime.now(tz=_HK)).astimezone(_HK)
        if dt.weekday() >= 5:
            return False
        # 港股部分假日与 A 股重叠，粗用同一静态表（宁严勿松）
        if is_cn_holiday(dt.date()):
            return False
        t = dt.time()
        return _in_window(t, time(9, 20), time(12, 10)) or _in_window(
            t, time(12, 55), time(16, 15)
        )

    if m == "us":
        dt = (now or datetime.now(tz=_NY)).astimezone(_NY)
        if dt.weekday() >= 5:
            return False
        t = dt.time()
        return _in_window(t, time(9, 25), time(16, 5))

    return True


def ttl_seconds(mode: str, market: str, now: datetime | None = None) -> float:
    mode = normalize_mode(mode)
    m = (market or "").lower()
    # Yahoo / 期货补价成本高：拉长 TTL，避免每次打开都当 stale 重同步
    if m.startswith("yf:"):
        boost = {"speed": 1800, "balanced": 600, "realtime": 120}
        return float(boost[mode])
    if m == "futures":
        boost = {"speed": 900, "balanced": 180, "realtime": 60}
        if is_session_open(market, now):
            return float(boost[mode])
        return float(max(boost[mode], _TTL_OFF[mode]))
    if is_session_open(market, now):
        return float(_TTL_SESSION[mode])
    return float(_TTL_OFF[mode])


def is_stale(age_sec: float | None, mode: str, market: str, now: datetime | None = None) -> bool:
    if age_sec is None:
        return True
    return age_sec > ttl_seconds(mode, market, now)


def should_auto_sync(mode: str) -> bool:
    """speed 模式打开页面不自动打网（除非 force）。"""
    return normalize_mode(mode) != "speed"


# K 线 TTL（秒）：日/周 vs 分钟
_KLINE_DAILY = {
    "speed": 6 * 3600,
    "balanced": 30 * 60,
    "realtime": 5 * 60,
}
_KLINE_MINUTE = {
    "speed": 15 * 60,
    "balanced": 3 * 60,
    "realtime": 60,
}


def is_cn_trade_daytime(now: datetime | None = None) -> bool:
    """A 股交易日白天（含午休）：用于日 K TTL，午休不当成盘后拉长缓存。"""
    dt = (now or datetime.now(tz=_SH)).astimezone(_SH)
    if dt.weekday() >= 5 or is_cn_holiday(dt.date()):
        return False
    t = dt.time()
    return _in_window(t, time(9, 15), time(15, 5))


def cn_daily_bars_missing_today(bars: list | None, now: datetime | None = None) -> bool:
    """日 K 最后一根早于上海今日 → 缺未收盘当日（需补实时）。"""
    if not bars:
        return False
    if not is_cn_trade_daytime(now):
        return False
    try:
        last_ts = int(bars[-1].get("timestamp") or 0)  # type: ignore[union-attr]
    except (TypeError, ValueError, AttributeError, IndexError):
        return False
    if last_ts <= 0:
        return False
    dt = (now or datetime.now(tz=_SH)).astimezone(_SH)
    last_day = datetime.fromtimestamp(last_ts / 1000.0, tz=_SH).date()
    return last_day < dt.date()


def kline_ttl_seconds(mode: str, period: str, market: str = "", now: datetime | None = None) -> float:
    mode = normalize_mode(mode)
    p = (period or "1d").lower()
    if p in ("1d", "1w", "1m_month", "1M", "daily", "weekly"):
        # 日/周：盘后更长；A 股交易日白天（含午休）保持盘中 TTL，便于补今日 K
        base = float(_KLINE_DAILY[mode])
        mkt = market.lower() if market else "cn"
        if mkt == "cn":
            if is_cn_trade_daytime(now):
                return base
            return max(base, float(_TTL_OFF[mode]))
        if mkt in ("hk", "us", "futures") and not is_session_open(mkt, now):
            return max(base, float(_TTL_OFF[mode]))
        return base
    return float(_KLINE_MINUTE[mode])


def kline_is_stale(
    age_sec: float | None,
    mode: str,
    period: str,
    market: str = "",
    now: datetime | None = None,
) -> bool:
    if age_sec is None:
        return True
    return age_sec > kline_ttl_seconds(mode, period, market, now)
