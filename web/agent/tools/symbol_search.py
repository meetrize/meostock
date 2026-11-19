"""标的名称/代码搜索，供前端生成 K 线链接。"""

from __future__ import annotations

from typing import Any

from agent.tools.db_readonly import open_ro


def _kline_symbol(market: str, code: str, stored: str | None) -> str:
    if stored and str(stored).strip():
        return str(stored).strip()
    m = (market or "").lower()
    c = (code or "").strip()
    if m == "cn" and c.isdigit() and len(c) == 6:
        prefix = "sh" if c.startswith(("5", "6", "9")) else "sz"
        return f"{prefix}{c}"
    if m in ("hk", "us", "fut", "fx", "index"):
        return c
    return c


def search_symbols(query: str, *, limit: int = 20) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        raise ValueError("query 为空")
    lim = max(1, min(int(limit or 20), 50))
    like = f"%{q}%"
    conn = open_ro()
    try:
        rows = conn.execute(
            """
            SELECT market, code, name, kline_symbol, price, change_percent
            FROM quote_snapshot
            WHERE name LIKE ? OR code LIKE ? OR IFNULL(kline_symbol,'') LIKE ?
            ORDER BY ABS(IFNULL(change_percent, 0)) DESC
            LIMIT ?
            """,
            (like, like, like, lim),
        ).fetchall()
        if not rows:
            rows = conn.execute(
                """
                SELECT market, code, name, NULL AS kline_symbol, NULL AS price, NULL AS change_percent
                FROM symbol
                WHERE name LIKE ? OR code LIKE ? OR symbol LIKE ?
                ORDER BY market, code
                LIMIT ?
                """,
                (like, like, like, lim),
            ).fetchall()

        items: list[dict[str, Any]] = []
        for r in rows:
            market = str(r["market"] if hasattr(r, "keys") else r[0] or "")
            code = str(r["code"] if hasattr(r, "keys") else r[1] or "")
            name = str(r["name"] if hasattr(r, "keys") else r[2] or "")
            stored = r["kline_symbol"] if hasattr(r, "keys") else r[3]
            ks = _kline_symbol(market, code, str(stored) if stored else None)
            price = r["price"] if hasattr(r, "keys") else r[4]
            pct = r["change_percent"] if hasattr(r, "keys") else r[5]
            items.append(
                {
                    "market": market,
                    "code": code,
                    "name": name,
                    "klineSymbol": ks,
                    "klineUrl": f"/?symbol={ks}",
                    "price": price,
                    "changePercent": pct,
                }
            )
        return {"ok": True, "query": q, "items": items, "count": len(items)}
    finally:
        conn.close()
