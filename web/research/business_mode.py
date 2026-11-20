"""商业模式三态：未验证 / 存疑 / 清晰（本地 SQLite，与 TradeCard 同库）。"""

from __future__ import annotations

import time
from typing import Any

from cache.db import _lock, get_conn, init_db

# 与 models.BusinessModeState 对齐：清晰 / 存疑 / 未验证
VALID_STATES = frozenset({"clear", "doubt", "unverified"})

_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS research_business_mode (
  symbol TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'unverified',
  note TEXT NOT NULL DEFAULT '',
  updated_at REAL NOT NULL
);
"""


def ensure_table() -> None:
    init_db()
    conn = get_conn()
    with _lock:
        conn.executescript(_TABLE_SQL)
        conn.commit()


def get_business_mode(symbol: str) -> dict[str, Any]:
    ensure_table()
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"symbol": "", "state": "unverified", "note": "", "updated_at": None}
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT symbol, state, note, updated_at FROM research_business_mode WHERE symbol=?",
            (sym,),
        ).fetchone()
    if not row:
        return {"symbol": sym, "state": "unverified", "note": "", "updated_at": None}
    state = row["state"] if row["state"] in VALID_STATES else "unverified"
    return {
        "symbol": row["symbol"],
        "state": state,
        "note": row["note"] or "",
        "updated_at": row["updated_at"],
    }


def set_business_mode(
    symbol: str,
    state: str,
    note: str = "",
) -> dict[str, Any]:
    ensure_table()
    sym = (symbol or "").strip().upper()
    st = (state or "unverified").strip().lower()
    if st not in VALID_STATES:
        raise ValueError(f"state must be one of {sorted(VALID_STATES)}")
    if not sym:
        raise ValueError("symbol required")
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO research_business_mode(symbol, state, note, updated_at)
            VALUES(?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET
              state=excluded.state,
              note=excluded.note,
              updated_at=excluded.updated_at
            """,
            (sym, st, (note or "").strip()[:2000], now),
        )
        conn.commit()
    return get_business_mode(sym)


def score_business_dim(state: str) -> dict[str, Any]:
    """映射到 0–100 分；unverified 不给分。"""
    st = state if state in VALID_STATES else "unverified"
    mapping = {
        "unverified": None,
        "doubt": 35.0,
        "clear": 88.0,
    }
    labels = {"unverified": "未验证", "doubt": "存疑", "clear": "清晰"}
    return {
        "state": st,
        "score": mapping[st],
        "ok": st != "unverified",
        "label": labels[st],
    }


def can_open_trade_card(state: str) -> bool:
    """未验证禁止生成/打开交易卡片。"""
    return (state or "unverified") in ("clear", "doubt")
