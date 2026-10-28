"""Tushare 专题 SQLite 读写。"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from cache import db as cache_db
from cache.db import get_conn

CATALOG_TRADE_DATE = "00000000"
DEFAULT_RETAIN_DAYS = 60


def _lock():
    return cache_db._lock  # noqa: SLF001


def ensure_schema() -> None:
    """已有库补表（init_db 会跑全 schema；此函数可单独调用）。"""
    cache_db.init_db()


def get_snapshot(market_id: str, trade_date: str) -> dict[str, Any] | None:
    conn = get_conn()
    with _lock():
        row = conn.execute(
            "SELECT * FROM ts_snapshot WHERE market_id = ? AND trade_date = ?",
            (market_id, trade_date),
        ).fetchone()
    if not row:
        return None
    return {
        "market_id": row["market_id"],
        "trade_date": row["trade_date"],
        "table": row["table_kind"],
        "label": row["label"],
        "columns": json.loads(row["columns_json"] or "[]"),
        "items": json.loads(row["items_json"] or "[]"),
        "total": int(row["row_count"] or 0),
        "source": row["source"],
        "as_of": row["as_of"],
        "synced_at": row["synced_at"],
        "etag": row["etag"],
        "cached": True,
    }


def replace_snapshot(
    market_id: str,
    trade_date: str,
    *,
    table_kind: str,
    label: str,
    columns: list[Any],
    items: list[Any],
    source: str | None,
) -> dict[str, Any]:
    now = time.time()
    cols_j = json.dumps(columns, ensure_ascii=False, separators=(",", ":"))
    items_j = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    etag = hashlib.sha256((cols_j + "\n" + items_j).encode("utf-8")).hexdigest()[:32]
    row_count = len(items)
    conn = get_conn()
    with _lock():
        conn.execute(
            """
            INSERT INTO ts_snapshot(
              market_id, trade_date, table_kind, label, columns_json, items_json,
              row_count, source, as_of, synced_at, etag
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(market_id, trade_date) DO UPDATE SET
              table_kind=excluded.table_kind,
              label=excluded.label,
              columns_json=excluded.columns_json,
              items_json=excluded.items_json,
              row_count=excluded.row_count,
              source=excluded.source,
              as_of=excluded.as_of,
              synced_at=excluded.synced_at,
              etag=excluded.etag
            """,
            (
                market_id,
                trade_date,
                table_kind,
                label or market_id,
                cols_j,
                items_j,
                row_count,
                source,
                now,
                now,
                etag,
            ),
        )
        conn.execute(
            """
            INSERT INTO ts_market_meta(
              market_id, last_trade_date, as_of, synced_at, row_count, source, sync_state, last_error
            ) VALUES (?, ?, ?, ?, ?, ?, 'idle', NULL)
            ON CONFLICT(market_id) DO UPDATE SET
              last_trade_date=excluded.last_trade_date,
              as_of=excluded.as_of,
              synced_at=excluded.synced_at,
              row_count=excluded.row_count,
              source=excluded.source,
              sync_state='idle',
              last_error=NULL
            """,
            (market_id, trade_date, now, now, row_count, source),
        )
        conn.commit()
    return {
        "market_id": market_id,
        "trade_date": trade_date,
        "row_count": row_count,
        "synced_at": now,
        "etag": etag,
    }


def set_meta_error(market_id: str, error: str) -> None:
    conn = get_conn()
    with _lock():
        conn.execute(
            """
            INSERT INTO ts_market_meta(market_id, sync_state, last_error)
            VALUES (?, 'error', ?)
            ON CONFLICT(market_id) DO UPDATE SET sync_state='error', last_error=excluded.last_error
            """,
            (market_id, error[:500]),
        )
        conn.commit()


def list_meta() -> list[dict[str, Any]]:
    conn = get_conn()
    with _lock():
        rows = conn.execute("SELECT * FROM ts_market_meta ORDER BY market_id").fetchall()
    return [dict(r) for r in rows]


def gc_old(*, retain_days: int = DEFAULT_RETAIN_DAYS) -> int:
    """删除过期日终切片；保留目录键 00000000。"""
    if retain_days <= 0:
        return 0
    cutoff = time.time() - retain_days * 86400
    conn = get_conn()
    with _lock():
        cur = conn.execute(
            """
            DELETE FROM ts_snapshot
            WHERE trade_date != ? AND synced_at < ?
            """,
            (CATALOG_TRADE_DATE, cutoff),
        )
        conn.commit()
        return int(cur.rowcount or 0)


def clear_all() -> None:
    conn = get_conn()
    with _lock():
        conn.execute("DELETE FROM ts_snapshot")
        conn.execute("DELETE FROM ts_market_meta")
        conn.commit()
