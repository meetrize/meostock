"""Dashboard portal 曲线日 K：按市场盘后分 lane 同步写入本地 SQLite。

符号清单来自 ``cache.portal_curves``（与前端 catalog 对齐的单一事实源）。
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from cache import kline_models
from cache.portal_curves import portal_symbols_all, portal_symbols_by_lane
from cache.providers.kline_fetch import fetch_kline_bars, normalize_period, normalize_symbol
from cache.ttl import is_cn_holiday

_log = logging.getLogger("scheduler.portal-kline-eod")

# lane 调度元数据（符号由 portal_curves 按 eodLane 提供）
PORTAL_LANES: dict[str, dict[str, Any]] = {
    "cn": {
        "name": "A股指数/期货日K",
        "tz": "Asia/Shanghai",
        "slots": ((15, 20), (15, 50)),
        "skip_weekend": True,
        "skip_cn_holiday": True,
    },
    "asia": {
        "name": "亚太指数日K",
        "tz": "Asia/Hong_Kong",
        "slots": ((16, 45), (17, 15)),
        "skip_weekend": True,
        "skip_cn_holiday": False,
    },
    "eu": {
        "name": "欧洲指数日K",
        "tz": "Europe/Berlin",
        "slots": ((18, 10), (18, 40)),
        "skip_weekend": True,
        "skip_cn_holiday": False,
    },
    "us": {
        "name": "美股与宏观日K",
        "tz": "America/New_York",
        "slots": ((16, 20), (16, 50)),
        "skip_weekend": True,
        "skip_cn_holiday": False,
    },
    "crypto": {
        "name": "加密货币日K",
        "tz": "UTC",
        "slots": ((0, 20), (0, 50)),
        "skip_weekend": False,
        "skip_cn_holiday": False,
    },
}


def run_portal_kline_eod(
    lane: str,
    *,
    force: bool = True,
    skip_non_trade_day: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """按 lane 拉取 portal 标的日 K 并 upsert 本地库。"""
    t0 = time.time()
    key = (lane or "").strip().lower()
    cfg = PORTAL_LANES.get(key)
    if not cfg:
        return {"ok": False, "error": f"unknown lane: {lane}", "lane": lane}

    tz = ZoneInfo(str(cfg["tz"]))
    dt = (now or datetime.now(tz=tz)).astimezone(tz)
    trade_day = dt.date()

    if skip_non_trade_day and cfg.get("skip_weekend") and trade_day.weekday() >= 5:
        return {
            "ok": True,
            "skipped": True,
            "reason": "weekend",
            "lane": key,
            "trade_day": trade_day.isoformat(),
            "elapsed_sec": round(time.time() - t0, 2),
        }
    if skip_non_trade_day and cfg.get("skip_cn_holiday") and is_cn_holiday(trade_day):
        return {
            "ok": True,
            "skipped": True,
            "reason": "cn_holiday",
            "lane": key,
            "trade_day": trade_day.isoformat(),
            "elapsed_sec": round(time.time() - t0, 2),
        }

    symbols = portal_symbols_by_lane(key)
    ok = 0
    skip = 0
    fail = 0
    errors: list[dict[str, str]] = []
    period_n = normalize_period("1d")

    for raw in symbols:
        try:
            norm = normalize_symbol(raw)
            market = norm["market"]
            sym = norm["symbol"]
            if not force:
                existing = kline_models.read_kline_bars(market, sym, period_n)
                if existing:
                    from cache.ttl import daily_bars_missing_today

                    if not daily_bars_missing_today(market, existing, symbol=sym):
                        skip += 1
                        continue
            fresh, name, source = fetch_kline_bars(norm, period_n)
            if not fresh:
                fail += 1
                if len(errors) < 20:
                    errors.append({"symbol": raw, "error": "empty bars"})
                continue
            kline_models.upsert_kline_bars(
                market,
                sym,
                period_n,
                fresh,
                source=f"eod:{source}",
                name=name,
                touch_as_of=True,
            )
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            if len(errors) < 20:
                errors.append({"symbol": raw, "error": str(e)[:200]})
            _log.warning("portal kline eod fail %s/%s: %s", key, raw, e)

    return {
        "ok": fail == 0 or ok > 0,
        "lane": key,
        "lane_name": cfg.get("name"),
        "trade_day": trade_day.isoformat(),
        "tz": str(cfg["tz"]),
        "total": len(symbols),
        "ok_count": ok,
        "skip_count": skip,
        "fail_count": fail,
        "errors": errors,
        "elapsed_sec": round(time.time() - t0, 2),
        "message": (
            f"portal {cfg.get('name')} {trade_day.isoformat()}："
            f"成功{ok} 跳过{skip} 失败{fail}"
        ),
    }


def next_portal_kline_eod_ts(lane: str, now: float | None = None) -> float:
    """下一盘后槽位（该 lane 时区）。"""
    cfg = PORTAL_LANES.get((lane or "").strip().lower())
    if not cfg:
        return time.time() + 3600
    tz = ZoneInfo(str(cfg["tz"]))
    slots = tuple(cfg.get("slots") or ((16, 0),))
    base = datetime.fromtimestamp(now if now is not None else time.time(), tz)
    cursor = base.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(21 * 24 * 60):
        d = cursor.date()
        if cfg.get("skip_weekend") and d.weekday() >= 5:
            cursor += timedelta(minutes=1)
            continue
        if cfg.get("skip_cn_holiday") and is_cn_holiday(d):
            cursor += timedelta(minutes=1)
            continue
        if (cursor.hour, cursor.minute) in slots:
            return cursor.timestamp()
        cursor += timedelta(minutes=1)
    nxt = (base + timedelta(days=1)).replace(
        hour=slots[0][0], minute=slots[0][1], second=0, microsecond=0
    )
    return nxt.timestamp()


# 兼容旧 import
__all__ = [
    "PORTAL_LANES",
    "portal_symbols_all",
    "run_portal_kline_eod",
    "next_portal_kline_eod_ts",
]
