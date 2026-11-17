"""选股宝盘中涨跌停实时池：短 TTL，不落 sqlite 日终切片。"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from tsrelay.catalog import MARKET_SPECS
from tsrelay.normalize import _f, _s, ts_code_to_display

_log = logging.getLogger("tushare-gateway")
_SH = ZoneInfo("Asia/Shanghai")

XUANGUBAO_POOL = "https://flash-api.xuangubao.cn/api/pool/detail"
# 集合竞价起 → 收盘后缓冲；之后优先 Tushare
_LIVE_START_MIN = 9 * 60 + 15
_LIVE_END_MIN = 15 * 60 + 5
_TTL_SEC = 45.0

_cache_lock = threading.Lock()
_cache: dict[str, Any] = {"ts": 0.0, "payload": None}


def _shanghai_now() -> datetime:
    return datetime.now(_SH)


def shanghai_ymd() -> str:
    return _shanghai_now().strftime("%Y%m%d")


def _minutes_of_day(now: datetime | None = None) -> int:
    n = now or _shanghai_now()
    return n.hour * 60 + n.minute


def in_live_session_window(now: datetime | None = None) -> bool:
    m = _minutes_of_day(now)
    return _LIVE_START_MIN <= m < _LIVE_END_MIN


def use_live_limit_now(*, last_open: str | None) -> bool:
    """今日为最近开市日且处于盘中窗口 → 走实时池。"""
    today = shanghai_ymd()
    if not last_open or last_open != today:
        return False
    return in_live_session_window()


def _xgb_symbol_to_ts(symbol: str) -> str:
    """600202.SS / 000766.SZ → Tushare 风格 ts_code。"""
    s = _s(symbol)
    if not s:
        return ""
    if s.endswith(".SS"):
        return f"{s[:-3]}.SH"
    return s


def _unix_to_hhmmss(raw: Any) -> str:
    try:
        ts = int(raw or 0)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    try:
        dt = datetime.fromtimestamp(ts, _SH)
    except (OverflowError, OSError, ValueError):
        return ""
    return dt.strftime("%H%M%S")


def _pct_to_percent(raw: Any) -> float | None:
    x = _f(raw)
    if x is None:
        return None
    # 选股宝多为小数涨跌幅（0.10 = 10%）
    if -1.5 < x < 1.5:
        return round(x * 100.0, 4)
    return x


def _http_get_json(url: str, *, timeout: float = 12.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; meostock-live-limit/0.1)",
            "Accept": "application/json",
            "Referer": "https://xuangubao.cn/",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def _fetch_pool(pool_name: str) -> list[dict[str, Any]]:
    url = f"{XUANGUBAO_POOL}?{urllib.parse.urlencode({'pool_name': pool_name})}"
    payload = _http_get_json(url)
    if not isinstance(payload, dict):
        raise ValueError(f"xuangubao {pool_name}: unexpected payload type")
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError(f"xuangubao {pool_name}: data is not a list")
    return [x for x in data if isinstance(x, dict)]


def _row_from_xgb(rec: dict[str, Any], *, limit: str, trade_date: str) -> dict[str, Any] | None:
    ts = _xgb_symbol_to_ts(_s(rec.get("symbol")))
    if not ts:
        return None
    disp, kline = ts_code_to_display(ts)
    if limit == "U":
        first = _unix_to_hhmmss(rec.get("first_limit_up"))
        last = _unix_to_hhmmss(rec.get("last_limit_up"))
        open_times = _f(rec.get("break_limit_up_times"))
        limit_times = _f(rec.get("limit_up_days"))
    else:
        first = _unix_to_hhmmss(rec.get("first_limit_down"))
        last = _unix_to_hhmmss(rec.get("last_limit_down"))
        open_times = _f(rec.get("break_limit_down_times"))
        limit_times = _f(rec.get("limit_down_days"))
    return {
        "code": disp,
        "name": _s(rec.get("stock_chi_name")),
        "klineSymbol": kline,
        "close": _f(rec.get("price")),
        "pctChg": _pct_to_percent(rec.get("change_percent")),
        "limit": limit,
        "fdAmount": None,
        "firstTime": first,
        "lastTime": last,
        "openTimes": open_times,
        "limitTimes": limit_times,
        "tradeDate": trade_date,
    }


def _build_live_payload(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS.get("ts:limit") or {}
    up_raw = _fetch_pool("limit_up")
    down_raw = _fetch_pool("limit_down")
    items: list[dict[str, Any]] = []
    for r in up_raw:
        row = _row_from_xgb(r, limit="U", trade_date=trade_date)
        if row:
            items.append(row)
    for r in down_raw:
        row = _row_from_xgb(r, limit="D", trade_date=trade_date)
        if row:
            items.append(row)
    return {
        "ok": True,
        "id": "ts:limit",
        "label": spec.get("label") or "涨跌停",
        "table": spec.get("table") or "topic",
        "columns": list(spec.get("columns") or []),
        "items": items,
        "total": len(items),
        "trade_date": trade_date,
        "source": "xuangubao",
        "cached": False,
        "stale": False,
        "syncing": False,
        "synced_at": time.time(),
        "live": True,
        "meta": {"pool": "limit_up+limit_down", "provider": "xuangubao"},
    }


def fetch_live_limit(
    trade_date: str | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """拉取并归一选股宝涨跌停；进程内短 TTL。"""
    td = (trade_date or shanghai_ymd()).strip()
    now = time.time()
    with _cache_lock:
        hit = _cache.get("payload")
        if (
            not force
            and isinstance(hit, dict)
            and hit.get("trade_date") == td
            and now - float(_cache.get("ts") or 0) < _TTL_SEC
        ):
            return {**hit, "cached": True, "synced_at": _cache.get("ts")}

    try:
        payload = _build_live_payload(td)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, ValueError) as e:
        _log.warning("live_limit fetch failed: %s", e)
        with _cache_lock:
            stale = _cache.get("payload")
            if isinstance(stale, dict) and stale.get("trade_date") == td and (stale.get("items") or []):
                return {**stale, "cached": True, "stale": True, "error": str(e)}
        return {
            "ok": False,
            "id": "ts:limit",
            "error": str(e),
            "error_code": "live_limit_failed",
            "items": [],
            "total": 0,
            "trade_date": td,
            "source": "xuangubao",
            "cached": False,
            "live": True,
        }

    with _cache_lock:
        _cache["ts"] = time.time()
        _cache["payload"] = payload
    return payload
