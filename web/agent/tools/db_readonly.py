"""只读 SQLite 查询。"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from cache.db import db_path

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|"
    r"PRAGMA|VACUUM|REINDEX|GRANT|REVOKE|TRUNCATE)\b",
    re.IGNORECASE,
)
_ALLOWED_START = re.compile(r"^\s*(WITH|SELECT|EXPLAIN)\b", re.IGNORECASE)


def open_ro() -> sqlite3.Connection:
    path = db_path()
    if not path.is_file():
        raise RuntimeError(f"数据库不存在: {path}")
    uri = f"file:{path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    return conn


def validate_select(sql: str) -> str:
    text = (sql or "").strip().rstrip(";")
    if not text:
        raise ValueError("SQL 为空")
    if ";" in text:
        raise ValueError("不允许多语句")
    if not _ALLOWED_START.search(text):
        raise ValueError("仅允许 SELECT / WITH / EXPLAIN")
    if _FORBIDDEN.search(text):
        raise ValueError("检测到写操作或危险关键字，已拒绝")
    return text


def run_select(sql: str, *, limit: int = 100) -> dict[str, Any]:
    safe = validate_select(sql)
    lim = max(1, min(int(limit or 100), 200))
    conn = open_ro()
    try:
        cur = conn.execute(safe)
        cols = [d[0] for d in (cur.description or [])]
        rows_raw = cur.fetchmany(lim + 1)
        truncated = len(rows_raw) > lim
        rows = rows_raw[:lim]
        data = []
        for r in rows:
            if isinstance(r, sqlite3.Row):
                data.append({k: r[k] for k in cols})
            else:
                data.append(dict(zip(cols, r)))
        return {
            "ok": True,
            "columns": cols,
            "rows": data,
            "rowCount": len(data),
            "truncated": truncated,
            "limit": lim,
        }
    finally:
        conn.close()


def list_tables() -> list[str]:
    conn = open_ro()
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        return [str(r[0] if not isinstance(r, sqlite3.Row) else r["name"]) for r in rows]
    finally:
        conn.close()


def table_columns(table: str) -> list[dict[str, Any]]:
    name = (table or "").strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError("非法表名")
    conn = open_ro()
    try:
        rows = conn.execute(f"PRAGMA table_info({name})").fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            if isinstance(r, sqlite3.Row):
                out.append(
                    {
                        "cid": r["cid"],
                        "name": r["name"],
                        "type": r["type"],
                        "notnull": r["notnull"],
                        "pk": r["pk"],
                    }
                )
            else:
                out.append(
                    {
                        "cid": r[0],
                        "name": r[1],
                        "type": r[2],
                        "notnull": r[3],
                        "pk": r[5],
                    }
                )
        return out
    finally:
        conn.close()
