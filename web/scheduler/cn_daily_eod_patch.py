"""A 股收盘后：用全市场快照快速补写「当日日 K」到本地 SQLite。

策略（快）：
1. 可选强制刷新 cn 行情快照（一次全市场，避免逐票打网）
2. 将快照 OHLCV 写成今日 09:30 日 K，upsert 进 kline_bar
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import kline_models, models
from cache.ttl import is_cn_holiday

_log = logging.getLogger("scheduler.cn-daily-eod")
_SH = ZoneInfo("Asia/Shanghai")


def _today_sh(now: datetime | None = None) -> date:
    return (now or datetime.now(tz=_SH)).astimezone(_SH).date()


def _today_bar_ts_ms(d: date) -> int:
    return int(
        datetime(d.year, d.month, d.day, 9, 30, tzinfo=_SH).timestamp() * 1000
    )


def _is_cn_trade_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    return not is_cn_holiday(d)


def _row_to_today_bar(row: dict[str, Any], trade_day: date) -> dict[str, Any] | None:
    """quote_snapshot 行 → 当日日 K。amount：库内为万元 → 转为元与 K 线一致。"""
    price = row.get("price")
    try:
        close = float(price) if price is not None else None
    except (TypeError, ValueError):
        close = None
    if close is None or close <= 0:
        return None

    def _f(key: str, fallback: float) -> float:
        v = row.get(key)
        try:
            x = float(v) if v is not None else fallback
        except (TypeError, ValueError):
            return fallback
        return x if x == x and x > 0 else fallback  # NaN / <=0

    open_v = _f("open", close)
    high_v = _f("high", max(open_v, close))
    low_v = _f("low", min(open_v, close))
    if high_v < max(open_v, close):
        high_v = max(open_v, close, high_v)
    if low_v <= 0 or low_v > min(open_v, close):
        low_v = min(open_v, close, high_v)

    try:
        vol = float(row.get("volume") or 0)
    except (TypeError, ValueError):
        vol = 0.0
    try:
        amt_wan = float(row.get("amount") or 0)
    except (TypeError, ValueError):
        amt_wan = 0.0
    # 快照成交额：万元；日 K 与新浪/东财合并逻辑一致用「元」
    amount = amt_wan * 10000.0 if amt_wan > 0 else (close * vol if vol > 0 else None)

    return {
        "timestamp": _today_bar_ts_ms(trade_day),
        "open": open_v,
        "high": high_v,
        "low": low_v,
        "close": close,
        "volume": vol,
        "amount": amount,
    }


def _refresh_cn_snapshot(*, force: bool = True) -> dict[str, Any]:
    """同步刷新 A 股快照；失败不阻断（继续用库内旧快照）。"""
    try:
        from cache.sync_worker import sync_now

        return sync_now("cn", force=force)
    except Exception as e:  # noqa: BLE001
        _log.warning("cn snapshot refresh failed: %s", e)
        return {"ok": False, "error": str(e)}


def run_cn_daily_eod_patch(
    *,
    force_snapshot: bool = True,
    skip_non_trade_day: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """执行收盘补当日日 K。返回统计结果。"""
    t0 = time.time()
    dt = (now or datetime.now(tz=_SH)).astimezone(_SH)
    trade_day = dt.date()

    if skip_non_trade_day and not _is_cn_trade_day(trade_day):
        return {
            "ok": True,
            "skipped": True,
            "reason": "non_trade_day",
            "trade_day": trade_day.isoformat(),
            "elapsed_sec": round(time.time() - t0, 2),
        }

    # 收盘前过早跑：仍允许手动 force；定时任务建议 15:05+ 
    snap_meta: dict[str, Any] = {}
    if force_snapshot:
        snap_meta = _refresh_cn_snapshot(force=True)

    rows = models.read_snapshot("cn")
    if not rows:
        return {
            "ok": False,
            "error": "cn snapshot empty",
            "trade_day": trade_day.isoformat(),
            "snapshot": snap_meta,
            "elapsed_sec": round(time.time() - t0, 2),
        }

    ok = 0
    skip = 0
    fail = 0
    errors: list[dict[str, str]] = []

    for row in rows:
        if not isinstance(row, dict):
            skip += 1
            continue
        kline_sym = str(row.get("klineSymbol") or "").strip()
        code = str(row.get("code") or "").strip()
        # kline_bar.symbol 存完整 sh/sz/bj 码
        sym = kline_sym.lower() if kline_sym else ""
        if not sym:
            # 兜底：从 code 推断
            if code.startswith(("sh", "sz", "bj")):
                sym = code.lower()
            elif code.isdigit():
                if code.startswith(("8", "4")) or code.startswith("92"):
                    sym = f"bj{code}"
                elif code.startswith(("5", "6", "9")):
                    sym = f"sh{code}"
                else:
                    sym = f"sz{code}"
            else:
                skip += 1
                continue

        bar = _row_to_today_bar(row, trade_day)
        if not bar:
            skip += 1
            continue
        try:
            kline_models.upsert_kline_bars(
                "cn",
                sym,
                "1d",
                [bar],
                source="eod-snapshot",
                name=(str(row.get("name") or "").strip() or None),
                touch_as_of=True,
            )
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            if len(errors) < 20:
                errors.append({"symbol": sym, "error": str(e)[:200]})
            _log.warning("eod patch fail %s: %s", sym, e)

    return {
        "ok": fail == 0 or ok > 0,
        "trade_day": trade_day.isoformat(),
        "total_snapshot": len(rows),
        "ok_count": ok,
        "skip_count": skip,
        "fail_count": fail,
        "snapshot": {
            "refreshed": bool(snap_meta.get("ok")),
            "row_count": snap_meta.get("row_count"),
            "source": snap_meta.get("source"),
            "error": snap_meta.get("error"),
        },
        "errors": errors,
        "elapsed_sec": round(time.time() - t0, 2),
        "message": f"收盘日K补全 {trade_day.isoformat()}：成功{ok} 跳过{skip} 失败{fail}",
    }


def next_cn_kline_eod_ts(now: float | None = None) -> float:
    """下一个交易日 15:10 或 15:40（上海）。"""
    from datetime import timedelta

    base = datetime.fromtimestamp(now if now is not None else time.time(), _SH)
    slots = ((15, 10), (15, 40))
    cursor = base.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(14 * 24 * 60):
        d = cursor.date()
        if _is_cn_trade_day(d) and (cursor.hour, cursor.minute) in slots:
            return cursor.timestamp()
        cursor += timedelta(minutes=1)
    nxt = (base + timedelta(days=1)).replace(hour=15, minute=10, second=0, microsecond=0)
    while not _is_cn_trade_day(nxt.date()):
        nxt += timedelta(days=1)
    return nxt.timestamp()
