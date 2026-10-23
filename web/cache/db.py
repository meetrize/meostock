"""SQLite 连接与 schema 初始化。"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DB = _ROOT / "data" / "quote_cache.db"
_SCHEMA = Path(__file__).resolve().parent / "schema.sql"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def db_path() -> Path:
    raw = os.environ.get("QUOTE_CACHE_PATH", "").strip()
    return Path(raw) if raw else _DEFAULT_DB


def get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is not None:
            return _conn
        path = db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), check_same_thread=False, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _conn = conn
        return conn


def init_db() -> Path:
    """创建表并写入默认配置。返回 db 路径。"""
    conn = get_conn()
    sql = _SCHEMA.read_text(encoding="utf-8")
    with _lock:
        conn.executescript(sql)
        cur = conn.execute("SELECT value FROM cache_config WHERE key = ?", ("mode",))
        if cur.fetchone() is None:
            import time

            now = time.time()
            conn.execute(
                "INSERT INTO cache_config(key, value, updated_at) VALUES (?, ?, ?)",
                ("mode", os.environ.get("QUOTE_CACHE_MODE", "balanced").strip() or "balanced", now),
            )
            conn.execute(
                "INSERT INTO cache_config(key, value, updated_at) VALUES (?, ?, ?)",
                ("prefetch", "symbols+last_market", now),
            )
        conn.commit()
    return db_path()


def close_db() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
