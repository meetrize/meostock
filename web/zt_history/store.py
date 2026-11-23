"""涨跌停日终快照读写。"""

from __future__ import annotations

import json
import time
from typing import Any

from cache.db import _lock, get_conn, init_db

OTHER_PLATE_ID = "_other"


def symbol_to_code(symbol: str) -> str:
    s = str(symbol or "").strip()
    if not s:
        return ""
    base = s.split(".")[0]
    return base if base.isdigit() else base


def _f(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _i(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def replace_day_snapshot(
    *,
    trade_date: str,
    pool: str,
    stocks: list[dict[str, Any]],
    themes: list[dict[str, Any]],
    memberships: list[dict[str, Any]],
    status: str = "ok",
    error: str | None = None,
    source: str = "xuangubao",
) -> dict[str, Any]:
    """事务替换某一日某一池的完整快照。"""
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            "DELETE FROM zt_day_stock_theme WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        )
        conn.execute(
            "DELETE FROM zt_day_stock WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        )
        conn.execute(
            "DELETE FROM zt_day_theme WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        )
        conn.execute(
            "DELETE FROM zt_day_snap WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        )

        conn.execute(
            """
            INSERT INTO zt_day_snap(
              trade_date, pool, captured_at, status, stock_count, theme_count,
              source, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_date,
                pool,
                now,
                status,
                len(stocks),
                len(themes),
                source,
                error,
            ),
        )

        for t in themes:
            conn.execute(
                """
                INSERT INTO zt_day_theme(
                  trade_date, pool, plate_id, plate_name, plate_reason,
                  core_avg_pcp, rise_count, fall_count, stay_count, limit_up_count,
                  stock_count, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trade_date,
                    pool,
                    str(t["plate_id"]),
                    str(t.get("plate_name") or ""),
                    str(t.get("plate_reason") or ""),
                    _f(t.get("core_avg_pcp")),
                    _i(t.get("rise_count")),
                    _i(t.get("fall_count")),
                    _i(t.get("stay_count")),
                    _i(t.get("limit_up_count")),
                    int(t.get("stock_count") or 0),
                    int(t.get("sort_order") or 0),
                ),
            )

        for s in stocks:
            raw = s.get("raw") if isinstance(s.get("raw"), dict) else s.get("raw_json")
            if isinstance(raw, dict):
                raw_json = json.dumps(raw, ensure_ascii=False)
            else:
                raw_json = str(raw or "{}")
            conn.execute(
                """
                INSERT INTO zt_day_stock(
                  trade_date, pool, symbol, code, name, price, change_percent,
                  limit_up_days, limit_down_days, break_times,
                  first_limit_ts, last_limit_ts, stock_reason, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trade_date,
                    pool,
                    str(s["symbol"]),
                    str(s.get("code") or symbol_to_code(str(s["symbol"]))),
                    str(s.get("name") or ""),
                    _f(s.get("price")),
                    _f(s.get("change_percent")),
                    _i(s.get("limit_up_days")),
                    _i(s.get("limit_down_days")),
                    _i(s.get("break_times")),
                    _i(s.get("first_limit_ts")),
                    _i(s.get("last_limit_ts")),
                    str(s.get("stock_reason") or ""),
                    raw_json,
                ),
            )

        for m in memberships:
            conn.execute(
                """
                INSERT OR IGNORE INTO zt_day_stock_theme(
                  trade_date, pool, symbol, plate_id, is_primary
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    trade_date,
                    pool,
                    str(m["symbol"]),
                    str(m["plate_id"]),
                    1 if m.get("is_primary") else 0,
                ),
            )
        conn.commit()

    return {
        "trade_date": trade_date,
        "pool": pool,
        "captured_at": now,
        "status": status,
        "stock_count": len(stocks),
        "theme_count": len(themes),
        "error": error,
    }


def get_snap(trade_date: str, pool: str) -> dict[str, Any] | None:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT * FROM zt_day_snap WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        ).fetchone()
    return dict(row) if row else None


def list_snap_dates(pool: str | None = None, *, limit: int = 120) -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    lim = max(1, min(int(limit or 120), 500))
    with _lock:
        if pool:
            rows = conn.execute(
                """
                SELECT trade_date, pool, captured_at, status, stock_count, theme_count
                FROM zt_day_snap
                WHERE pool = ? AND status = 'ok'
                ORDER BY trade_date DESC
                LIMIT ?
                """,
                (pool, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT trade_date, pool, captured_at, status, stock_count, theme_count
                FROM zt_day_snap
                WHERE status = 'ok'
                ORDER BY trade_date DESC, pool
                LIMIT ?
                """,
                (lim,),
            ).fetchall()
    return [dict(r) for r in rows]


def load_day(trade_date: str, pool: str) -> dict[str, Any] | None:
    init_db()
    conn = get_conn()
    with _lock:
        snap = conn.execute(
            "SELECT * FROM zt_day_snap WHERE trade_date = ? AND pool = ?",
            (trade_date, pool),
        ).fetchone()
        if not snap:
            return None
        themes = conn.execute(
            """
            SELECT * FROM zt_day_theme
            WHERE trade_date = ? AND pool = ?
            ORDER BY sort_order ASC, stock_count DESC, plate_name ASC
            """,
            (trade_date, pool),
        ).fetchall()
        stocks = conn.execute(
            """
            SELECT * FROM zt_day_stock
            WHERE trade_date = ? AND pool = ?
            ORDER BY symbol
            """,
            (trade_date, pool),
        ).fetchall()
        links = conn.execute(
            """
            SELECT symbol, plate_id, is_primary FROM zt_day_stock_theme
            WHERE trade_date = ? AND pool = ?
            """,
            (trade_date, pool),
        ).fetchall()

    by_plate: dict[str, list[str]] = {}
    primary_of: dict[str, str] = {}
    for lk in links:
        sym = str(lk["symbol"])
        pid = str(lk["plate_id"])
        by_plate.setdefault(pid, []).append(sym)
        if int(lk["is_primary"] or 0):
            primary_of[sym] = pid

    theme_list = []
    for t in themes:
        d = dict(t)
        pid = str(d["plate_id"])
        d["symbols"] = by_plate.get(pid, [])
        theme_list.append(d)

    stock_list = []
    for s in stocks:
        d = dict(s)
        raw = d.pop("raw_json", "{}")
        try:
            item = json.loads(raw) if isinstance(raw, str) else {}
        except json.JSONDecodeError:
            item = {}
        if not isinstance(item, dict):
            item = {}
        item["_snap"] = {
            "code": d.get("code"),
            "primary_plate_id": primary_of.get(str(d["symbol"])),
            "stock_reason": d.get("stock_reason"),
        }
        stock_list.append(item)

    return {
        "trade_date": trade_date,
        "pool": pool,
        "captured_at": snap["captured_at"],
        "status": snap["status"],
        "stock_count": snap["stock_count"],
        "theme_count": snap["theme_count"],
        "source": snap["source"],
        "error": snap["error"],
        "themes": theme_list,
        "stocks": stock_list,
    }


def load_theme_detail(
    *,
    trade_date: str,
    pool: str,
    plate_id: str,
) -> dict[str, Any] | None:
    """某日某池某题材：题材字段 + 成分股（含原因）。"""
    init_db()
    td = "".join(c for c in (trade_date or "") if c.isdigit())
    pid = str(plate_id or "").strip()
    if len(td) != 8 or not pid or pool not in ("limit_up", "limit_down"):
        return None
    conn = get_conn()
    with _lock:
        theme = conn.execute(
            """
            SELECT * FROM zt_day_theme
            WHERE trade_date = ? AND pool = ? AND plate_id = ?
            """,
            (td, pool, pid),
        ).fetchone()
        if not theme:
            return None
        links = conn.execute(
            """
            SELECT m.symbol, m.is_primary, s.code, s.name, s.price, s.change_percent,
                   s.limit_up_days, s.limit_down_days, s.break_times, s.stock_reason,
                   s.first_limit_ts, s.last_limit_ts
            FROM zt_day_stock_theme m
            JOIN zt_day_stock s
              ON s.trade_date = m.trade_date AND s.pool = m.pool AND s.symbol = m.symbol
            WHERE m.trade_date = ? AND m.pool = ? AND m.plate_id = ?
            ORDER BY m.is_primary DESC, s.limit_up_days DESC, s.change_percent DESC
            """,
            (td, pool, pid),
        ).fetchall()
    d = dict(theme)
    d["stocks"] = [dict(r) for r in links]
    return d


def load_stock_history(
    *,
    code: str,
    pool: str | None = None,
    limit: int = 60,
) -> list[dict[str, Any]]:
    init_db()
    code6 = symbol_to_code(code)
    if not code6:
        return []
    lim = max(1, min(int(limit or 60), 365))
    conn = get_conn()
    with _lock:
        if pool:
            rows = conn.execute(
                """
                SELECT s.trade_date, s.pool, s.symbol, s.code, s.name, s.price,
                       s.change_percent, s.limit_up_days, s.limit_down_days,
                       s.break_times, s.first_limit_ts, s.last_limit_ts,
                       s.stock_reason, snap.captured_at
                FROM zt_day_stock s
                JOIN zt_day_snap snap
                  ON snap.trade_date = s.trade_date AND snap.pool = s.pool
                WHERE s.code = ? AND s.pool = ? AND snap.status = 'ok'
                ORDER BY s.trade_date DESC
                LIMIT ?
                """,
                (code6, pool, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT s.trade_date, s.pool, s.symbol, s.code, s.name, s.price,
                       s.change_percent, s.limit_up_days, s.limit_down_days,
                       s.break_times, s.first_limit_ts, s.last_limit_ts,
                       s.stock_reason, snap.captured_at
                FROM zt_day_stock s
                JOIN zt_day_snap snap
                  ON snap.trade_date = s.trade_date AND snap.pool = s.pool
                WHERE s.code = ? AND snap.status = 'ok'
                ORDER BY s.trade_date DESC, s.pool
                LIMIT ?
                """,
                (code6, lim),
            ).fetchall()

        out = []
        for r in rows:
            d = dict(r)
            # 主题材
            link = conn.execute(
                """
                SELECT t.plate_id, t.plate_name, t.plate_reason
                FROM zt_day_stock_theme m
                JOIN zt_day_theme t
                  ON t.trade_date = m.trade_date AND t.pool = m.pool
                 AND t.plate_id = m.plate_id
                WHERE m.trade_date = ? AND m.pool = ? AND m.symbol = ?
                ORDER BY m.is_primary DESC, t.stock_count DESC
                LIMIT 1
                """,
                (d["trade_date"], d["pool"], d["symbol"]),
            ).fetchone()
            if link:
                d["plate_id"] = link["plate_id"]
                d["plate_name"] = link["plate_name"]
                d["plate_reason"] = link["plate_reason"]
            else:
                d["plate_id"] = None
                d["plate_name"] = None
                d["plate_reason"] = None
            out.append(d)
    return out
