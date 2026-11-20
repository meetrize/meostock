"""交易卡片最小存储（SQLite，与 quote_cache 同库）。"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from cache.db import _lock, get_conn, init_db

_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS research_trade_card (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_card_status ON research_trade_card (status);
CREATE INDEX IF NOT EXISTS idx_research_card_symbol ON research_trade_card (symbol);
"""


def ensure_table() -> None:
    init_db()
    conn = get_conn()
    with _lock:
        conn.executescript(_TABLE_SQL)
        conn.commit()


def _row(row: Any) -> dict[str, Any]:
    payload = json.loads(row["payload_json"] or "{}")
    payload["id"] = row["id"]
    payload["symbol"] = row["symbol"]
    payload["status"] = row["status"]
    payload["created_at"] = row["created_at"]
    payload["updated_at"] = row["updated_at"]
    return payload


def list_cards(
    *,
    status: str | None = None,
    symbol: str | None = None,
) -> list[dict[str, Any]]:
    ensure_table()
    conn = get_conn()
    sym = (symbol or "").strip().upper() or None
    with _lock:
        clauses: list[str] = []
        params: list[Any] = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if sym:
            clauses.append("symbol = ?")
            params.append(sym)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = conn.execute(
            f"""
            SELECT * FROM research_trade_card
            {where}
            ORDER BY updated_at DESC
            """,
            params,
        ).fetchall()
    return [_row(r) for r in rows]


def get_card(card_id: str) -> dict[str, Any] | None:
    ensure_table()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT * FROM research_trade_card WHERE id = ?", (card_id,)
        ).fetchone()
    return _row(row) if row else None


def upsert_card(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_table()
    now = time.time()
    card_id = str(payload.get("id") or "").strip() or str(uuid.uuid4())
    symbol = str(payload.get("symbol") or "").strip().upper()
    if not symbol:
        raise ValueError("symbol 必填")
    status = str(payload.get("status") or "draft").strip() or "draft"
    body = dict(payload)
    body["id"] = card_id
    body["symbol"] = symbol
    body["status"] = status
    # 商业模式未验证时禁止 open：卡片字段与独立三态表取「更确认」者
    biz = str(body.get("business_mode_state") or "unverified")
    try:
        from research.business_mode import get_business_mode, set_business_mode

        stored = str(get_business_mode(symbol).get("state") or "unverified")
        rank = {"unverified": 0, "doubt": 1, "clear": 2}
        if rank.get(stored, 0) > rank.get(biz, 0):
            biz = stored
            body["business_mode_state"] = biz
        elif status == "open" and biz in ("clear", "doubt") and stored == "unverified":
            # 开仓时把卡片确认态写回三态表，避免下次被拦截
            set_business_mode(symbol, biz)
    except Exception:  # noqa: BLE001
        pass
    if status == "open" and biz == "unverified":
        raise ValueError("商业模式未验证时禁止将卡片设为 open")
    if status == "open" and not str(body.get("stop_rule") or "").strip():
        raise ValueError("open 卡片必须填写 stop_rule")
    # 结案字段完整性（完整流程见 cards_close.close_card）
    if status in ("closed", "stopped") and not str(body.get("exit_reason") or "").strip():
        raise ValueError("结案卡片必须填写 exit_reason")
    raw = json.dumps(body, ensure_ascii=False)
    conn = get_conn()
    with _lock:
        existing = conn.execute(
            "SELECT created_at FROM research_trade_card WHERE id = ?", (card_id,)
        ).fetchone()
        created = float(existing["created_at"]) if existing else now
        conn.execute(
            """
            INSERT INTO research_trade_card(id, symbol, payload_json, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              symbol=excluded.symbol,
              payload_json=excluded.payload_json,
              status=excluded.status,
              updated_at=excluded.updated_at
            """,
            (card_id, symbol, raw, status, created, now),
        )
        conn.commit()
    return get_card(card_id) or body


def delete_card(card_id: str) -> bool:
    ensure_table()
    conn = get_conn()
    with _lock:
        cur = conn.execute(
            "DELETE FROM research_trade_card WHERE id = ?", (card_id,)
        )
        conn.commit()
        return int(cur.rowcount or 0) > 0


def import_cards(items: list[dict[str, Any]]) -> dict[str, Any]:
    ok_n = 0
    errors: list[str] = []
    saved: list[dict[str, Any]] = []
    for i, it in enumerate(items):
        try:
            card = upsert_card(it)
            saved.append(card)
            ok_n += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"[{i}] {exc}")
    return {"ok": ok_n, "failed": len(errors), "errors": errors, "cards": saved}
