"""对外查询封装。"""

from __future__ import annotations

from typing import Any

from zt_history import store
from zt_history.xgb_client import POOLS


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
    """K 线侧栏：单票涨跌停履历 + 关联题材详情（含成分）。"""
    code6 = store.symbol_to_code(code)
    if not code6:
        return {"ok": False, "error": "code required"}
    rows = store.load_stock_history(code=code6, pool=None, limit=limit)

    # 按最近出现顺序收集题材，展开详情
    themes: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for r in rows:
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
        if len(themes) >= max(1, min(int(theme_limit or 8), 20)):
            break

    name = ""
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
    }
