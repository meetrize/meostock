"""巨潮公告本地 SQLite 读写。"""

from __future__ import annotations

import json
import time
from typing import Any

from cache.db import _lock, get_conn, init_db
from cninfo.client import pdf_url


def _json_dumps(obj: Any) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj, ensure_ascii=False)


def _json_loads(raw: Any, default: Any = None) -> Any:
    if raw is None or raw == "":
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


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


def get_stock(code: str) -> dict[str, Any] | None:
    init_db()
    code6 = str(code or "").strip()[-6:]
    if not code6:
        return None
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT s.code, s.org_id, s.name, s.market,
                   IFNULL(st.backfill_done, 0) AS backfill_done,
                   st.last_sync_at, st.last_error
            FROM cninfo_stock s
            LEFT JOIN cninfo_sync_state st ON st.code = s.code
            WHERE s.code = ?
            """,
            (code6,),
        ).fetchone()
    return dict(row) if row else None


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


def get_announcement(announcement_id: str) -> dict[str, Any] | None:
    init_db()
    aid = str(announcement_id or "").strip()
    if not aid:
        return None
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT announcement_id, code, org_id, title, announce_time_ms,
                   adjunct_url, adjunct_type, fetched_at
            FROM cninfo_announcement WHERE announcement_id = ?
            """,
            (aid,),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["pdf_url"] = pdf_url(item.get("adjunct_url"))
    return item


def list_announcements_since(
    *,
    since_ms: int = 0,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """按时间取公告（影响力任务用）。"""
    init_db()
    lim = max(1, min(int(limit), 20000))
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT announcement_id, code, org_id, title, announce_time_ms,
                   adjunct_url, adjunct_type, fetched_at
            FROM cninfo_announcement
            WHERE announce_time_ms >= ?
            ORDER BY announce_time_ms DESC, announcement_id DESC
            LIMIT ?
            """,
            (int(since_ms or 0), lim),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        item["pdf_url"] = pdf_url(item.get("adjunct_url"))
        out.append(item)
    return out


def list_pending_impact(
    *,
    since_ms: int = 0,
    limit: int = 2000,
    only_missing: bool = True,
) -> list[dict[str, Any]]:
    """待评估公告：缺 impact 行或 judge_status 为 pending/error。"""
    init_db()
    lim = max(1, min(int(limit), 10000))
    conn = get_conn()
    with _lock:
        if only_missing:
            rows = conn.execute(
                """
                SELECT a.announcement_id, a.code, a.org_id, a.title, a.announce_time_ms,
                       a.adjunct_url, a.adjunct_type, a.fetched_at,
                       i.judge_status
                FROM cninfo_announcement a
                LEFT JOIN cninfo_announcement_impact i
                  ON i.announcement_id = a.announcement_id
                WHERE a.announce_time_ms >= ?
                  AND (
                    i.announcement_id IS NULL
                    OR IFNULL(i.judge_status, '') IN ('pending', 'error', '')
                  )
                ORDER BY a.announce_time_ms DESC
                LIMIT ?
                """,
                (int(since_ms or 0), lim),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT a.announcement_id, a.code, a.org_id, a.title, a.announce_time_ms,
                       a.adjunct_url, a.adjunct_type, a.fetched_at,
                       i.judge_status
                FROM cninfo_announcement a
                LEFT JOIN cninfo_announcement_impact i
                  ON i.announcement_id = a.announcement_id
                WHERE a.announce_time_ms >= ?
                ORDER BY a.announce_time_ms DESC
                LIMIT ?
                """,
                (int(since_ms or 0), lim),
            ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        item["pdf_url"] = pdf_url(item.get("adjunct_url"))
        out.append(item)
    return out


def upsert_impact(row: dict[str, Any]) -> None:
    init_db()
    now = time.time()
    aid = str(row.get("announcement_id") or "").strip()
    if not aid:
        return
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO cninfo_announcement_impact(
              announcement_id, code, title, announce_time_ms, thread_id,
              candidate_level, final_level, direction, category,
              disclosure_stage, is_first_disclosure, score,
              matched_rules_json, reasons_json, materiality_json, quality_flags_json,
              core_summary, core_quotes_json, risk_flags_json, expected_gap_hint,
              confidence, judge_status, pdf_extract_status, error, judged_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(announcement_id) DO UPDATE SET
              code=excluded.code,
              title=excluded.title,
              announce_time_ms=excluded.announce_time_ms,
              thread_id=excluded.thread_id,
              candidate_level=excluded.candidate_level,
              final_level=excluded.final_level,
              direction=excluded.direction,
              category=excluded.category,
              disclosure_stage=excluded.disclosure_stage,
              is_first_disclosure=excluded.is_first_disclosure,
              score=excluded.score,
              matched_rules_json=excluded.matched_rules_json,
              reasons_json=excluded.reasons_json,
              materiality_json=excluded.materiality_json,
              quality_flags_json=excluded.quality_flags_json,
              core_summary=excluded.core_summary,
              core_quotes_json=excluded.core_quotes_json,
              risk_flags_json=excluded.risk_flags_json,
              expected_gap_hint=excluded.expected_gap_hint,
              confidence=excluded.confidence,
              judge_status=excluded.judge_status,
              pdf_extract_status=excluded.pdf_extract_status,
              error=excluded.error,
              judged_at=excluded.judged_at,
              updated_at=excluded.updated_at
            """,
            (
                aid,
                str(row.get("code") or "")[-6:],
                row.get("title") or "",
                int(row.get("announce_time_ms") or 0),
                row.get("thread_id"),
                row.get("candidate_level"),
                row.get("final_level"),
                row.get("direction"),
                row.get("category"),
                row.get("disclosure_stage"),
                int(row.get("is_first_disclosure") if row.get("is_first_disclosure") is not None else 1),
                row.get("score"),
                _json_dumps(row.get("matched_rules")),
                _json_dumps(row.get("reasons")),
                _json_dumps(row.get("materiality")),
                _json_dumps(row.get("quality_flags")),
                row.get("core_summary"),
                _json_dumps(row.get("core_quotes")),
                _json_dumps(row.get("risk_flags")),
                row.get("expected_gap_hint"),
                row.get("confidence"),
                row.get("judge_status"),
                row.get("pdf_extract_status"),
                (str(row.get("error"))[:500] if row.get("error") else None),
                row.get("judged_at"),
                now,
            ),
        )
        conn.commit()


def get_impact(announcement_id: str) -> dict[str, Any] | None:
    init_db()
    aid = str(announcement_id or "").strip()
    if not aid:
        return None
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT * FROM cninfo_announcement_impact WHERE announcement_id = ?",
            (aid,),
        ).fetchone()
    if not row:
        return None
    return _decode_impact_row(dict(row))


def get_impacts_for_ids(ids: list[str]) -> dict[str, dict[str, Any]]:
    init_db()
    clean = [str(x).strip() for x in ids if str(x).strip()]
    if not clean:
        return {}
    # SQLite 变量上限保守分批
    out: dict[str, dict[str, Any]] = {}
    conn = get_conn()
    with _lock:
        for i in range(0, len(clean), 400):
            batch = clean[i : i + 400]
            placeholders = ",".join("?" * len(batch))
            rows = conn.execute(
                f"SELECT * FROM cninfo_announcement_impact WHERE announcement_id IN ({placeholders})",
                batch,
            ).fetchall()
            for r in rows:
                item = _decode_impact_row(dict(r))
                out[str(item["announcement_id"])] = item
    return out


def _decode_impact_row(item: dict[str, Any]) -> dict[str, Any]:
    item["matched_rules"] = _json_loads(item.pop("matched_rules_json", None), [])
    item["reasons"] = _json_loads(item.pop("reasons_json", None), [])
    item["materiality"] = _json_loads(item.pop("materiality_json", None), {})
    item["quality_flags"] = _json_loads(item.pop("quality_flags_json", None), {})
    item["core_quotes"] = _json_loads(item.pop("core_quotes_json", None), [])
    item["risk_flags"] = _json_loads(item.pop("risk_flags_json", None), [])
    return item


def list_impacts(
    *,
    since_ms: int = 0,
    levels: list[str] | None = None,
    direction: str | None = None,
    code: str | None = None,
    min_score: float | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    hide_small: bool = True,
) -> tuple[list[dict[str, Any]], int]:
    init_db()
    lim = max(1, min(int(limit), 200))
    off = max(0, int(offset))
    clauses = ["i.announce_time_ms >= ?"]
    params: list[Any] = [int(since_ms or 0)]

    lvl = [str(x).upper() for x in (levels or []) if str(x).strip()]
    if lvl:
        placeholders = ",".join("?" * len(lvl))
        clauses.append(f"i.final_level IN ({placeholders})")
        params.extend(lvl)
    elif hide_small:
        clauses.append("IFNULL(i.final_level, '') != 'S'")

    if direction:
        clauses.append("i.direction = ?")
        params.append(str(direction).strip().lower())

    if code:
        code6 = str(code).strip()[-6:]
        clauses.append("i.code = ?")
        params.append(code6)

    if min_score is not None:
        clauses.append("IFNULL(i.score, 0) >= ?")
        params.append(float(min_score))

    if q:
        clauses.append(
            "(i.title LIKE ? OR i.code LIKE ? OR IFNULL(i.core_summary,'') LIKE ?)"
        )
        like = f"%{q.strip()}%"
        params.extend([like, like, like])

    where = " AND ".join(clauses)
    conn = get_conn()
    with _lock:
        total_row = conn.execute(
            f"""
            SELECT COUNT(*) AS n
            FROM cninfo_announcement_impact i
            WHERE {where}
            """,
            params,
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT i.*, IFNULL(s.name, '') AS stock_name, a.adjunct_url
            FROM cninfo_announcement_impact i
            LEFT JOIN cninfo_stock s ON s.code = i.code
            LEFT JOIN cninfo_announcement a ON a.announcement_id = i.announcement_id
            WHERE {where}
            ORDER BY i.announce_time_ms DESC, IFNULL(i.score, 0) DESC
            LIMIT ? OFFSET ?
            """,
            [*params, lim, off],
        ).fetchall()

    items = []
    for r in rows:
        item = _decode_impact_row(dict(r))
        item["pdf_url"] = pdf_url(item.pop("adjunct_url", None))
        items.append(item)
    return items, int(total_row["n"] if total_row else 0)


def thread_max_score(thread_id: str, *, exclude_id: str | None = None) -> float | None:
    """同线索历史最高分（用于修订稿不得高于首次）。"""
    init_db()
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    conn = get_conn()
    with _lock:
        if exclude_id:
            row = conn.execute(
                """
                SELECT MAX(score) AS m FROM cninfo_announcement_impact
                WHERE thread_id = ? AND announcement_id != ? AND score IS NOT NULL
                """,
                (tid, exclude_id),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT MAX(score) AS m FROM cninfo_announcement_impact
                WHERE thread_id = ? AND score IS NOT NULL
                """,
                (tid,),
            ).fetchone()
    if not row or row["m"] is None:
        return None
    return float(row["m"])


def impact_stats() -> dict[str, Any]:
    init_db()
    conn = get_conn()
    with _lock:
        total = conn.execute("SELECT COUNT(*) AS n FROM cninfo_announcement_impact").fetchone()
        by_level = conn.execute(
            """
            SELECT IFNULL(final_level, '?') AS lv, COUNT(*) AS n
            FROM cninfo_announcement_impact GROUP BY IFNULL(final_level, '?')
            """
        ).fetchall()
        pending = conn.execute(
            """
            SELECT COUNT(*) AS n FROM cninfo_announcement_impact
            WHERE IFNULL(judge_status, '') IN ('pending', 'error')
            """
        ).fetchone()
    return {
        "impact_rows": int(total["n"] if total else 0),
        "by_level": {str(r["lv"]): int(r["n"]) for r in by_level},
        "pending_or_error": int(pending["n"] if pending else 0),
    }

