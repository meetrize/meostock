"""盘后抓取涨跌停池并落库。"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from zt_history import store
from zt_history.xgb_client import POOLS, fetch_plate_data, fetch_pool_items

_log = logging.getLogger("zt_history.capture")
_SH = ZoneInfo("Asia/Shanghai")


def shanghai_ymd(now: datetime | None = None) -> str:
    n = now or datetime.now(_SH)
    return n.strftime("%Y%m%d")


def resolve_capture_trade_date(*, force: bool = False) -> dict[str, Any]:
    """解析应落库的交易日。

    - 优先 Tushare 最近开市日（含今天）
    - 不可用时：周一至周五用今天，周末拒绝（除非 force）
    """
    today = shanghai_ymd()
    try:
        from tsrelay.markets import resolve_trade_date

        info = resolve_trade_date(prefer_today=True)
        last_open = str(info.get("last_open") or "") or None
        if last_open:
            if last_open != today and not force:
                return {
                    "ok": False,
                    "trade_date": last_open,
                    "today": today,
                    "reason": "not_trading_day",
                    "last_open": last_open,
                }
            return {
                "ok": True,
                "trade_date": today if force and last_open != today else last_open,
                "today": today,
                "last_open": last_open,
                "source": info.get("source"),
            }
    except Exception as exc:  # noqa: BLE001
        _log.warning("resolve_trade_date failed: %s", exc)

    now = datetime.now(_SH)
    if now.weekday() >= 5 and not force:
        return {
            "ok": False,
            "trade_date": today,
            "today": today,
            "reason": "weekend",
        }
    return {
        "ok": True,
        "trade_date": today,
        "today": today,
        "last_open": today,
        "source": "weekday_fallback",
    }


def _plates_of(item: dict[str, Any]) -> list[dict[str, Any]]:
    surge = item.get("surge_reason") if isinstance(item.get("surge_reason"), dict) else {}
    plates = surge.get("related_plates") if isinstance(surge, dict) else None
    if not isinstance(plates, list):
        return []
    out = []
    for p in plates:
        if not isinstance(p, dict):
            continue
        name = str(p.get("plate_name") or "").strip()
        if not name:
            continue
        pid = p.get("plate_id")
        pid_s = str(pid) if pid is not None and str(pid).strip() != "" else ""
        out.append(
            {
                "plate_id": pid_s,
                "plate_name": name,
                "plate_reason": str(p.get("plate_reason") or "").strip(),
            }
        )
    return out


def _build_from_items(
    items: list[dict[str, Any]],
    *,
    pool: str,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[str],
]:
    """返回 stocks, themes, memberships, plate_ids_for_api。"""
    stocks: list[dict[str, Any]] = []
    memberships: list[dict[str, Any]] = []
    theme_map: dict[str, dict[str, Any]] = {}
    # plate_id 优先；无 id 时用 name 作 key，最终落 OTHER 或 hash name
    name_to_id: dict[str, str] = {}
    is_down = pool == "limit_down"

    for item in items:
        symbol = str(item.get("symbol") or "").strip()
        if not symbol:
            continue
        surge = item.get("surge_reason") if isinstance(item.get("surge_reason"), dict) else {}
        stock_reason = str((surge or {}).get("stock_reason") or "").strip()
        if is_down:
            break_times = item.get("break_limit_down_times")
            first_ts = item.get("first_limit_down")
            last_ts = item.get("last_limit_down")
        else:
            break_times = item.get("break_limit_up_times")
            first_ts = item.get("first_limit_up")
            last_ts = item.get("last_limit_up")
        stocks.append(
            {
                "symbol": symbol,
                "code": store.symbol_to_code(symbol),
                "name": str(item.get("stock_chi_name") or ""),
                "price": item.get("price"),
                "change_percent": item.get("change_percent"),
                "limit_up_days": item.get("limit_up_days"),
                "limit_down_days": item.get("limit_down_days"),
                "break_times": break_times,
                "first_limit_ts": first_ts,
                "last_limit_ts": last_ts,
                "stock_reason": stock_reason,
                "raw": item,
            }
        )

        plates = _plates_of(item)
        if not plates:
            pid = store.OTHER_PLATE_ID
            if pid not in theme_map:
                theme_map[pid] = {
                    "plate_id": pid,
                    "plate_name": "其他",
                    "plate_reason": "",
                    "symbols": [],
                }
            theme_map[pid]["symbols"].append(symbol)
            memberships.append({"symbol": symbol, "plate_id": pid, "is_primary": True})
            continue

        for idx, p in enumerate(plates):
            raw_id = p["plate_id"]
            name = p["plate_name"]
            if raw_id:
                pid = raw_id
                name_to_id.setdefault(name, pid)
            else:
                pid = name_to_id.get(name) or f"_name:{name}"
                name_to_id[name] = pid
            if pid not in theme_map:
                theme_map[pid] = {
                    "plate_id": pid,
                    "plate_name": name,
                    "plate_reason": p["plate_reason"],
                    "symbols": [],
                }
            elif p["plate_reason"] and not theme_map[pid]["plate_reason"]:
                theme_map[pid]["plate_reason"] = p["plate_reason"]
            if symbol not in theme_map[pid]["symbols"]:
                theme_map[pid]["symbols"].append(symbol)
            memberships.append(
                {"symbol": symbol, "plate_id": pid, "is_primary": idx == 0}
            )

    # 按股票数排序题材
    ordered = sorted(
        theme_map.values(),
        key=lambda t: (-len(t["symbols"]), t["plate_name"]),
    )
    themes: list[dict[str, Any]] = []
    api_ids: list[str] = []
    for i, t in enumerate(ordered):
        pid = str(t["plate_id"])
        themes.append(
            {
                "plate_id": pid,
                "plate_name": t["plate_name"],
                "plate_reason": t["plate_reason"],
                "stock_count": len(t["symbols"]),
                "sort_order": i,
                "symbols": t["symbols"],
            }
        )
        if pid.isdigit():
            api_ids.append(pid)

    return stocks, themes, memberships, api_ids


def capture_pool(
    pool: str,
    *,
    trade_date: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    if pool not in POOLS:
        return {"ok": False, "error": f"pool 须为 {' | '.join(POOLS)}", "pool": pool}

    if trade_date:
        td = "".join(c for c in trade_date if c.isdigit())
        if len(td) != 8:
            return {"ok": False, "error": "trade_date 须为 YYYYMMDD", "pool": pool}
    else:
        cal = resolve_capture_trade_date(force=force)
        if not cal.get("ok"):
            return {
                "ok": False,
                "skipped": True,
                "reason": cal.get("reason"),
                "trade_date": cal.get("trade_date"),
                "pool": pool,
            }
        td = str(cal["trade_date"])

    try:
        items = fetch_pool_items(pool)
    except Exception as exc:  # noqa: BLE001
        _log.exception("fetch pool %s failed", pool)
        store.replace_day_snapshot(
            trade_date=td,
            pool=pool,
            stocks=[],
            themes=[],
            memberships=[],
            status="error",
            error=str(exc),
        )
        return {"ok": False, "error": str(exc), "trade_date": td, "pool": pool}

    stocks, themes, memberships, api_ids = _build_from_items(items, pool=pool)
    plate_data = fetch_plate_data(api_ids)
    for t in themes:
        row = plate_data.get(str(t["plate_id"])) or {}
        if not row:
            continue
        t["core_avg_pcp"] = row.get("core_avg_pcp")
        t["rise_count"] = row.get("rise_count")
        t["fall_count"] = row.get("fall_count")
        t["stay_count"] = row.get("stay_count")
        t["limit_up_count"] = row.get("limit_up_count")
        if row.get("plate_name") and not t.get("plate_name"):
            t["plate_name"] = row["plate_name"]

    meta = store.replace_day_snapshot(
        trade_date=td,
        pool=pool,
        stocks=stocks,
        themes=themes,
        memberships=memberships,
        status="ok",
    )
    return {
        "ok": True,
        "trade_date": td,
        "pool": pool,
        "stock_count": meta["stock_count"],
        "theme_count": meta["theme_count"],
        "captured_at": meta["captured_at"],
    }


def capture_eod(
    *,
    trade_date: str | None = None,
    force: bool = False,
    pools: tuple[str, ...] = POOLS,
) -> dict[str, Any]:
    """抓取涨停+跌停（默认）。非交易日且非 force 则整体跳过。"""
    if not trade_date:
        cal = resolve_capture_trade_date(force=force)
        if not cal.get("ok"):
            return {
                "ok": True,
                "skipped": True,
                "reason": cal.get("reason"),
                "trade_date": cal.get("trade_date"),
                "pools": {},
            }
        trade_date = str(cal["trade_date"])

    results: dict[str, Any] = {}
    all_ok = True
    for pool in pools:
        r = capture_pool(pool, trade_date=trade_date, force=True)
        results[pool] = r
        if not r.get("ok"):
            all_ok = False
    return {
        "ok": all_ok,
        "trade_date": trade_date,
        "pools": results,
        "skipped": False,
    }
