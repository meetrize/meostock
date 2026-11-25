"""对外查询封装。"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from zt_history import store
from zt_history.xgb_client import POOLS, fetch_plate_data, fetch_pool_items

_log = logging.getLogger("zt_history.service")
_SH = ZoneInfo("Asia/Shanghai")

_live_lock = threading.Lock()
_live_cache: dict[str, Any] = {
    "day": "",
    "ts": 0.0,
    "limit_up": [],
    "limit_down": [],
}
_LIVE_TTL_SEC = 60.0


def _today_ymd() -> str:
    return datetime.now(_SH).strftime("%Y%m%d")


def _live_pools() -> dict[str, list[dict[str, Any]]]:
    """短时缓存今日涨停/跌停池（与 dashboard limit-up/down 同源）。"""
    day = _today_ymd()
    now = time.time()
    with _live_lock:
        if (
            _live_cache.get("day") == day
            and now - float(_live_cache.get("ts") or 0) < _LIVE_TTL_SEC
            and isinstance(_live_cache.get("limit_up"), list)
            and isinstance(_live_cache.get("limit_down"), list)
        ):
            return {
                "limit_up": list(_live_cache["limit_up"]),
                "limit_down": list(_live_cache["limit_down"]),
            }

    up: list[dict[str, Any]] = []
    down: list[dict[str, Any]] = []
    try:
        up = fetch_pool_items("limit_up")
    except Exception as exc:  # noqa: BLE001
        _log.debug("live limit_up: %s", exc)
    try:
        down = fetch_pool_items("limit_down")
    except Exception as exc:  # noqa: BLE001
        _log.debug("live limit_down: %s", exc)

    with _live_lock:
        _live_cache.update(
            {"day": day, "ts": time.time(), "limit_up": up, "limit_down": down}
        )
    return {"limit_up": up, "limit_down": down}


def _primary_plate(item: dict[str, Any]) -> dict[str, Any]:
    surge = item.get("surge_reason") if isinstance(item.get("surge_reason"), dict) else {}
    plates = surge.get("related_plates") if isinstance(surge, dict) else None
    if not isinstance(plates, list):
        return {}
    for p in plates:
        if isinstance(p, dict) and str(p.get("plate_name") or "").strip():
            return p
    return {}


def _pool_item_to_hist_row(
    item: dict[str, Any],
    *,
    pool: str,
    trade_date: str,
) -> dict[str, Any]:
    """把实时池条目转成与 load_stock_history 同结构的一行。"""
    symbol = str(item.get("symbol") or "").strip()
    code = store.symbol_to_code(symbol)
    surge = item.get("surge_reason") if isinstance(item.get("surge_reason"), dict) else {}
    plate = _primary_plate(item)
    is_down = pool == "limit_down"
    if is_down:
        break_times = item.get("break_limit_down_times")
        first_ts = item.get("first_limit_down")
        last_ts = item.get("last_limit_down")
    else:
        break_times = item.get("break_limit_up_times")
        first_ts = item.get("first_limit_up")
        last_ts = item.get("last_limit_up")
    pid = plate.get("plate_id")
    return {
        "trade_date": trade_date,
        "pool": pool,
        "symbol": symbol,
        "code": code,
        "name": str(item.get("stock_chi_name") or ""),
        "price": item.get("price"),
        "change_percent": item.get("change_percent"),
        "limit_up_days": item.get("limit_up_days"),
        "limit_down_days": item.get("limit_down_days"),
        "break_times": break_times,
        "first_limit_ts": first_ts,
        "last_limit_ts": last_ts,
        "stock_reason": str((surge or {}).get("stock_reason") or "").strip(),
        "captured_at": int(time.time()),
        "plate_id": str(pid) if pid is not None and str(pid).strip() != "" else None,
        "plate_name": str(plate.get("plate_name") or "").strip() or None,
        "plate_reason": str(plate.get("plate_reason") or "").strip() or None,
        "source": "live_pool",
    }


def _find_live_row(code6: str) -> dict[str, Any] | None:
    pools = _live_pools()
    day = _today_ymd()
    for pool in ("limit_up", "limit_down"):
        for item in pools.get(pool) or []:
            if store.symbol_to_code(str(item.get("symbol") or "")) == code6:
                return _pool_item_to_hist_row(item, pool=pool, trade_date=day)
    return None


def _build_live_theme(
    code6: str,
    live_row: dict[str, Any],
) -> dict[str, Any] | None:
    """用今日实时池拼一条题材卡（格式对齐历史 theme detail）。"""
    pid = str(live_row.get("plate_id") or "").strip()
    pname = str(live_row.get("plate_name") or "").strip()
    if not pname:
        return None
    pool = str(live_row.get("pool") or "limit_up")
    day = str(live_row.get("trade_date") or _today_ymd())
    pools = _live_pools()
    peers_raw = pools.get(pool) or []
    peer_stocks: list[dict[str, Any]] = []
    for item in peers_raw:
        plate = _primary_plate(item)
        plate_id = str(plate.get("plate_id") or "").strip()
        plate_name = str(plate.get("plate_name") or "").strip()
        if pid:
            if plate_id != pid:
                continue
        elif plate_name != pname:
            continue
        row = _pool_item_to_hist_row(item, pool=pool, trade_date=day)
        peer_stocks.append(
            {
                "symbol": row.get("symbol"),
                "code": row.get("code"),
                "name": row.get("name"),
                "price": row.get("price"),
                "change_percent": row.get("change_percent"),
                "limit_up_days": row.get("limit_up_days"),
                "limit_down_days": row.get("limit_down_days"),
                "break_times": row.get("break_times"),
                "stock_reason": row.get("stock_reason"),
                "first_limit_ts": row.get("first_limit_ts"),
                "last_limit_ts": row.get("last_limit_ts"),
                "is_primary": store.symbol_to_code(str(row.get("symbol") or "")) == code6,
            }
        )
    # 当前票置顶
    peer_stocks.sort(key=lambda s: (0 if s.get("is_primary") else 1))
    plate_meta: dict[str, Any] = {}
    if pid and pid.isdigit():
        try:
            plate_meta = (fetch_plate_data([pid]) or {}).get(pid) or {}
        except Exception:  # noqa: BLE001
            plate_meta = {}
    return {
        "trade_date": day,
        "pool": pool,
        "plate_id": pid or f"_live_{pname}",
        "plate_name": pname,
        "plate_reason": live_row.get("plate_reason") or "",
        "stock_count": len(peer_stocks) or plate_meta.get("rise_count"),
        "limit_up_count": plate_meta.get("limit_up_count"),
        "core_avg_pcp": plate_meta.get("core_avg_pcp"),
        "stocks": peer_stocks,
        "source": "live_pool",
    }


def list_dates(pool: str | None = None, *, limit: int = 120) -> dict[str, Any]:
    if pool and pool not in POOLS:
        return {"ok": False, "error": f"pool 须为 {' | '.join(POOLS)}"}
    rows = store.list_snap_dates(pool, limit=limit)
    return {"ok": True, "pool": pool, "dates": rows, "total": len(rows)}


def get_day(trade_date: str, pool: str) -> dict[str, Any]:
    if pool not in POOLS:
        return {"ok": False, "error": f"pool 须为 {' | '.join(POOLS)}"}
    td = "".join(c for c in (trade_date or "") if c.isdigit())
    if len(td) != 8:
        return {"ok": False, "error": "date 须为 YYYYMMDD"}
    data = store.load_day(td, pool)
    if not data:
        return {"ok": False, "error": "not_found", "trade_date": td, "pool": pool}
    if data.get("status") != "ok":
        return {
            "ok": False,
            "error": data.get("error") or "snapshot_error",
            "trade_date": td,
            "pool": pool,
            "status": data.get("status"),
        }
    return {
        "ok": True,
        "source": "zt_history",
        "trade_date": data["trade_date"],
        "pool": data["pool"],
        "captured_at": data["captured_at"],
        "total": data["stock_count"],
        "theme_count": data["theme_count"],
        "themes": data["themes"],
        "items": data["stocks"],
        # 兼容实时池字段名
        "stocks": data["stocks"],
    }


def list_stock_history(
    code: str,
    *,
    pool: str | None = None,
    limit: int = 60,
) -> dict[str, Any]:
    if pool and pool not in POOLS:
        return {"ok": False, "error": f"pool 须为 {' | '.join(POOLS)}"}
    code6 = store.symbol_to_code(code)
    if not code6:
        return {"ok": False, "error": "code required"}
    rows = store.load_stock_history(code=code6, pool=pool, limit=limit)
    return {
        "ok": True,
        "code": code6,
        "pool": pool,
        "total": len(rows),
        "items": rows,
    }


def get_stock_panel(
    code: str,
    *,
    limit: int = 90,
    theme_limit: int = 8,
) -> dict[str, Any]:
    """K 线侧栏：单票涨跌停履历 + 关联题材详情（含成分）。

    今日若在实时涨停/跌停池中，优先插入一条与历史同结构的记录（盘中未落库也能看）。
    """
    code6 = store.symbol_to_code(code)
    if not code6:
        return {"ok": False, "error": "code required"}
    rows = store.load_stock_history(code=code6, pool=None, limit=limit)

    live_row = _find_live_row(code6)
    live_theme: dict[str, Any] | None = None
    if live_row:
        today = str(live_row.get("trade_date") or _today_ymd())
        pool = str(live_row.get("pool") or "")
        # 同日同池用实时覆盖历史快照
        rows = [
            r
            for r in rows
            if not (
                str(r.get("trade_date") or "") == today
                and str(r.get("pool") or "") == pool
            )
        ]
        rows.insert(0, live_row)
        live_theme = _build_live_theme(code6, live_row)

    # 按最近出现顺序收集题材，展开详情
    themes: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    theme_cap = max(1, min(int(theme_limit or 8), 20))
    if live_theme:
        themes.append(live_theme)
        pid = str(live_theme.get("plate_id") or "")
        seen.add(
            (
                str(live_theme.get("trade_date") or ""),
                str(live_theme.get("pool") or ""),
                pid,
            )
        )
    for r in rows:
        if len(themes) >= theme_cap:
            break
        pid = r.get("plate_id")
        if not pid:
            continue
        key = (str(r.get("trade_date") or ""), str(r.get("pool") or ""), str(pid))
        if key in seen:
            continue
        seen.add(key)
        detail = store.load_theme_detail(
            trade_date=key[0], pool=key[1], plate_id=key[2]
        )
        if detail:
            themes.append(detail)

    name = ""
    if live_row and live_row.get("name"):
        name = str(live_row["name"])
    if not name:
        for r in rows:
            if r.get("name"):
                name = str(r["name"])
                break

    return {
        "ok": True,
        "code": code6,
        "name": name,
        "total": len(rows),
        "items": rows,
        "themes": themes,
        "theme_count": len(themes),
        "live_today": bool(live_row),
    }
