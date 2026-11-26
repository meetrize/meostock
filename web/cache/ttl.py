"""缓存模式 × 市场会话 → TTL（秒）。"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
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


def _session_date_for_tz(tz: ZoneInfo, open_t: time, now: datetime | None = None) -> date:
    """当前（或上一）交易日：开盘前回退到前一工作日。"""
    dt = (now or datetime.now(tz=tz)).astimezone(tz)
    d = dt.date()
    if dt.time() < open_t:
        d = d - timedelta(days=1)
    while d.weekday() >= 5:
        d = d - timedelta(days=1)
    return d


def cn_session_date(now: datetime | None = None) -> date:
    """A 股当前（或上一）交易日，含节假日回退。"""
    d = _session_date_for_tz(_SH, time(9, 15), now)
    guard = 0
    while (d.weekday() >= 5 or is_cn_holiday(d)) and guard < 15:
        d = d - timedelta(days=1)
        guard += 1
    return d


def us_session_date(now: datetime | None = None) -> date:
    return _session_date_for_tz(_NY, time(9, 25), now)


def hk_session_date(now: datetime | None = None) -> date:
    d = _session_date_for_tz(_HK, time(9, 20), now)
    # 粗用 A 股假日表回退（港股假日不完全一致，宁多刷新）
    guard = 0
    while is_cn_holiday(d) and guard < 10:
        d = d - timedelta(days=1)
        while d.weekday() >= 5:
            d = d - timedelta(days=1)
        guard += 1
    return d


def _last_bar_day(bars: list | None, tz: ZoneInfo) -> date | None:
    if not bars:
        return None
    try:
        last_ts = int(bars[-1].get("timestamp") or 0)  # type: ignore[union-attr]
    except (TypeError, ValueError, AttributeError, IndexError):
        return None
    if last_ts <= 0:
        return None
    return datetime.fromtimestamp(last_ts / 1000.0, tz=tz).date()


def cn_daily_bars_missing_today(bars: list | None, now: datetime | None = None) -> bool:
    """日 K 末根早于 A 股当前交易日 → 缺当日（盘中/盘后均需补，直到追上）。"""
    last_day = _last_bar_day(bars, _SH)
    if last_day is None:
        return False
    return last_day < cn_session_date(now)


def us_daily_bars_missing_today(bars: list | None, now: datetime | None = None) -> bool:
    """美股日 K 末根早于美东当前交易日 → 缺当日（Yahoo 常滞后；盘后也要补到齐）。"""
    last_day = _last_bar_day(bars, _NY)
    if last_day is None:
        return False
    return last_day < us_session_date(now)


def hk_daily_bars_missing_today(bars: list | None, now: datetime | None = None) -> bool:
    """港股日 K 末根早于港股当前交易日 → 缺当日（盘后也要补到齐）。"""
    last_day = _last_bar_day(bars, _HK)
    if last_day is None:
        return False
    return last_day < hk_session_date(now)


def yf_session_tz_name(symbol: str = "") -> str:
    """Yahoo 标的粗分时区（portal spark 用）。"""
    s = (symbol or "").upper()
    if any(k in s for k in ("BTC", "ETH", "SOL", "BNB")) and (
        "-USD" in s or s.endswith("USD")
    ):
        return "UTC"
    if s in ("^HSI",) or s.endswith(".HK") or "HKD" in s:
        return "Asia/Hong_Kong"
    if s in ("^N225", "^KS11"):
        return "Asia/Tokyo"
    if s in ("^GDAXI", "^FTSE", "^STOXX50E") or s.startswith("^STOXX"):
        return "Europe/Berlin"
    return "America/New_York"


def yf_session_date(symbol: str = "", now: datetime | None = None) -> date:
    tz = ZoneInfo(yf_session_tz_name(symbol))
    # 加密 7x24：按日历日 00:00；其它按当地 09:00 前算上一交易日
    open_t = time(0, 0) if str(tz) == "UTC" else time(9, 0)
    d = _session_date_for_tz(tz, open_t, now)
    if str(tz) != "UTC":
        while d.weekday() >= 5:
            d = d - timedelta(days=1)
    return d


def futures_session_date(now: datetime | None = None) -> date:
    """国内期货粗用 A 股交易日（夜盘归属到下一交易日开盘前逻辑由 session_date 处理）。"""
    return cn_session_date(now)


def daily_bars_missing_today(
    market: str,
    bars: list | None,
    now: datetime | None = None,
    *,
    symbol: str = "",
) -> bool:
    m = (market or "").lower()
    if m == "cn":
        return cn_daily_bars_missing_today(bars, now)
    if m == "us":
        return us_daily_bars_missing_today(bars, now)
    if m == "hk":
        return hk_daily_bars_missing_today(bars, now)
    if m == "futures":
        last = _last_bar_day(bars, _SH)
        if last is None:
            return False
        return last < futures_session_date(now)
    if m == "yf":
        tz = ZoneInfo(yf_session_tz_name(symbol))
        last = _last_bar_day(bars, tz)
        if last is None:
            return False
        return last < yf_session_date(symbol, now)
    return False


def daily_bars_need_live_patch(
    market: str,
    bars: list | None,
    now: datetime | None = None,
    *,
    symbol: str = "",
) -> bool:
    """日 K 是否需要用实时/现价补当日棒。

    - 盘中（A 股含午休）：总是补，保证最新价
    - 盘后：仅当末根落后于当前交易日时补（避免北京白天狂刷已齐的美股）
    - yf/futures：按标的时区盘中总是补，盘后仅缺日才补
    """
    m = (market or "").lower()
    if not bars:
        return False
    if m == "cn":
        if is_cn_trade_daytime(now):
            return True
        return daily_bars_missing_today(m, bars, now, symbol=symbol)
    if m in ("hk", "us"):
        if is_session_open(m, now):
            return True
        return daily_bars_missing_today(m, bars, now, symbol=symbol)
    if m == "futures":
        if is_session_open("futures", now) or is_cn_trade_daytime(now):
            return True
        return daily_bars_missing_today(m, bars, now, symbol=symbol)
    if m == "yf":
        # 加密近似总是可补；其它看缺日 / 美欧亚交易时段粗判
        sym = (symbol or "").upper()
        if any(k in sym for k in ("BTC", "ETH", "SOL", "BNB")):
            return True
        if is_session_open("us", now) or is_session_open("hk", now):
            return True
        # 欧盘白天（柏林 8–18）
        eu = (now or datetime.now(tz=ZoneInfo("Europe/Berlin"))).astimezone(
            ZoneInfo("Europe/Berlin")
        )
        if eu.weekday() < 5 and time(8, 0) <= eu.time() <= time(18, 30):
            return True
        return daily_bars_missing_today(m, bars, now, symbol=symbol)
    return False


def _prev_trade_day(d: date, market: str) -> date:
    """上一交易日（周末/A 股假日粗回退）。"""
    m = (market or "").lower()
    x = d - timedelta(days=1)
    guard = 0
    while guard < 15:
        if x.weekday() >= 5:
            x = x - timedelta(days=1)
            guard += 1
            continue
        if m in ("cn", "hk", "futures") and is_cn_holiday(x):
            x = x - timedelta(days=1)
            guard += 1
            continue
        break
    return x


def daily_bars_multi_day_gap(
    market: str,
    bars: list | None,
    now: datetime | None = None,
    *,
    symbol: str = "",
) -> bool:
    """末根早于「上一交易日」→ 缺中间日，轻量现价补不够，需全量重拉。"""
    m = (market or "").lower()
    if m == "cn":
        last = _last_bar_day(bars, _SH)
        sess = cn_session_date(now)
    elif m == "us":
        last = _last_bar_day(bars, _NY)
        sess = us_session_date(now)
    elif m == "hk":
        last = _last_bar_day(bars, _HK)
        sess = hk_session_date(now)
    elif m == "futures":
        last = _last_bar_day(bars, _SH)
        sess = futures_session_date(now)
    elif m == "yf":
        tz = ZoneInfo(yf_session_tz_name(symbol))
        last = _last_bar_day(bars, tz)
        sess = yf_session_date(symbol, now)
    else:
        return False
    if last is None:
        return False
    return last < _prev_trade_day(sess, m if m != "yf" else "us")


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
