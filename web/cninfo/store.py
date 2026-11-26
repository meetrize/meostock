"""巨潮公告本地 SQLite 读写。"""

from __future__ import annotations

import time
from typing import Any

from cache.db import _lock, get_conn, init_db
from cninfo.client import pdf_url


def upsert_stocks(rows: list[dict[str, str]]) -> int:
    if not rows:
        return 0
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        for r in rows:
            conn.execute(
                """
                INSERT INTO cninfo_stock(code, org_id, name, market, category, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                  org_id=excluded.org_id,
                  name=excluded.name,
                  market=excluded.market,
                  category=excluded.category,
                  updated_at=excluded.updated_at
                """,
                (
                    r["code"],
                    r["org_id"],
                    r.get("name") or "",
                    r.get("market") or "",
                    r.get("category") or "",
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO cninfo_sync_state(code, backfill_done, last_sync_at, oldest_ms, newest_ms, last_error)
                VALUES (?, 0, NULL, NULL, NULL, NULL)
                ON CONFLICT(code) DO NOTHING
                """,
                (r["code"],),
            )
        conn.commit()
    return len(rows)


def list_stocks_for_sync(*, prefer_backfill: bool = True) -> list[dict[str, Any]]:
    """待同步股票：优先未 backfill 完的，其次按 last_sync_at 升序。"""
    init_db()
    conn = get_conn()
    with _lock:
        if prefer_backfill:
            rows = conn.execute(
                """
                SELECT s.code, s.org_id, s.name, s.market,
                       IFNULL(st.backfill_done, 0) AS backfill_done,
                       st.last_sync_at, st.oldest_ms, st.newest_ms
                FROM cninfo_stock s
                LEFT JOIN cninfo_sync_state st ON st.code = s.code
                ORDER BY IFNULL(st.backfill_done, 0) ASC,
                         IFNULL(st.last_sync_at, 0) ASC,
                         s.code ASC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT s.code, s.org_id, s.name, s.market,
                       IFNULL(st.backfill_done, 0) AS backfill_done,
                       st.last_sync_at, st.oldest_ms, st.newest_ms
                FROM cninfo_stock s
                LEFT JOIN cninfo_sync_state st ON st.code = s.code
                WHERE IFNULL(st.backfill_done, 0) = 1
                ORDER BY IFNULL(st.last_sync_at, 0) ASC, s.code ASC
                """
            ).fetchall()
    return [dict(r) for r in rows]


def upsert_announcements(rows: list[dict[str, Any]]) -> dict[str, int]:
    if not rows:
        return {"inserted": 0, "updated": 0}
    init_db()
    now = time.time()
    inserted = updated = 0
    conn = get_conn()
    with _lock:
        for r in rows:
            aid = r["announcement_id"]
            existing = conn.execute(
                "SELECT announcement_id FROM cninfo_announcement WHERE announcement_id = ?",
                (aid,),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO cninfo_announcement(
                      announcement_id, code, org_id, title, announce_time_ms,
                      adjunct_url, adjunct_type, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        aid,
                        r["code"],
                        r.get("org_id"),
                        r.get("title") or "",
                        int(r.get("announce_time_ms") or 0),
                        r.get("adjunct_url"),
                        r.get("adjunct_type"),
                        now,
                    ),
                )
                inserted += 1
            else:
                conn.execute(
                    """
                    UPDATE cninfo_announcement
                    SET code=?, org_id=?, title=?, announce_time_ms=?,
                        adjunct_url=?, adjunct_type=?, fetched_at=?
                    WHERE announcement_id=?
                    """,
                    (
                        r["code"],
                        r.get("org_id"),
                        r.get("title") or "",
                        int(r.get("announce_time_ms") or 0),
                        r.get("adjunct_url"),
                        r.get("adjunct_type"),
                        now,
                        aid,
                    ),
                )
                updated += 1
        conn.commit()
    return {"inserted": inserted, "updated": updated}


def mark_sync_ok(
    code: str,
    *,
    backfill_done: bool | None = None,
    times_ms: list[int] | None = None,
) -> None:
    init_db()
    now = time.time()
    code6 = str(code).strip()[-6:]
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT backfill_done, oldest_ms, newest_ms FROM cninfo_sync_state WHERE code = ?",
            (code6,),
        ).fetchone()
        oldest = int(row["oldest_ms"]) if row and row["oldest_ms"] is not None else None
        newest = int(row["newest_ms"]) if row and row["newest_ms"] is not None else None
        if times_ms:
            vals = [int(t) for t in times_ms if t and int(t) > 0]
            if vals:
                mn, mx = min(vals), max(vals)
                oldest = mn if oldest is None else min(oldest, mn)
                newest = mx if newest is None else max(newest, mx)
        done = int(row["backfill_done"] or 0) if row else 0
        if backfill_done is not None:
            done = 1 if backfill_done else 0
        if row is None:
            conn.execute(
                """
                INSERT INTO cninfo_sync_state(
                  code, backfill_done, last_sync_at, oldest_ms, newest_ms, last_error
                ) VALUES (?, ?, ?, ?, ?, NULL)
                """,
                (code6, done, now, oldest, newest),
            )
        else:
            conn.execute(
                """
                UPDATE cninfo_sync_state
                SET backfill_done=?, last_sync_at=?, oldest_ms=?, newest_ms=?, last_error=NULL
                WHERE code=?
                """,
                (done, now, oldest, newest, code6),
            )
        conn.commit()


def mark_sync_error(code: str, error: str) -> None:
    init_db()
    code6 = str(code).strip()[-6:]
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO cninfo_sync_state(code, backfill_done, last_sync_at, oldest_ms, newest_ms, last_error)
            VALUES (?, 0, NULL, NULL, NULL, ?)
            ON CONFLICT(code) DO UPDATE SET last_error=excluded.last_error
            """,
            (code6, str(error)[:500]),
        )
        conn.commit()


def list_announcements(
    code: str,
    *,
    limit: int = 50,
    offset: int = 0,
    since_ms: int | None = None,
) -> list[dict[str, Any]]:
    init_db()
    code6 = str(code or "").strip()
    if len(code6) > 6:
        code6 = code6[-6:]
    if not code6:
        return []
    lim = max(1, min(int(limit), 200))
    off = max(0, int(offset))
    clauses = ["code = ?"]
    params: list[Any] = [code6]
    if since_ms is not None and int(since_ms) > 0:
        clauses.append("announce_time_ms >= ?")
        params.append(int(since_ms))
    params.extend([lim, off])
    sql = f"""
      SELECT announcement_id, code, org_id, title, announce_time_ms,
             adjunct_url, adjunct_type, fetched_at
      FROM cninfo_announcement
      WHERE {" AND ".join(clauses)}
      ORDER BY announce_time_ms DESC, announcement_id DESC
      LIMIT ? OFFSET ?
    """
    conn = get_conn()
    with _lock:
        rows = conn.execute(sql, params).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        item["pdf_url"] = pdf_url(item.get("adjunct_url"))
        out.append(item)
    return out


def count_announcements(code: str) -> int:
    init_db()
    code6 = str(code or "").strip()[-6:]
    if not code6:
        return 0
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM cninfo_announcement WHERE code = ?",
            (code6,),
        ).fetchone()
    return int(row["n"] if row else 0)


def sync_stats() -> dict[str, int]:
    init_db()
    conn = get_conn()
    with _lock:
        stocks = conn.execute("SELECT COUNT(*) AS n FROM cninfo_stock").fetchone()
        anns = conn.execute("SELECT COUNT(*) AS n FROM cninfo_announcement").fetchone()
        done = conn.execute(
            "SELECT COUNT(*) AS n FROM cninfo_sync_state WHERE backfill_done = 1"
        ).fetchone()
        pending = conn.execute(
            """
            SELECT COUNT(*) AS n FROM cninfo_stock s
            LEFT JOIN cninfo_sync_state st ON st.code = s.code
            WHERE IFNULL(st.backfill_done, 0) = 0
            """
        ).fetchone()
    return {
        "stocks": int(stocks["n"] if stocks else 0),
        "announcements": int(anns["n"] if anns else 0),
        "backfill_done": int(done["n"] if done else 0),
        "backfill_pending": int(pending["n"] if pending else 0),
    }
