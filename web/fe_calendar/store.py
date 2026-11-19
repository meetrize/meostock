"""财经日历查询。"""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

from cache.db import _lock, get_conn, init_db

STD_TYPE_LABELS = {
    "1": "财经会议",
    "2": "经济数据",
    "3": "其他类型",
}

SOURCE_LABELS = {
    "eastmoney": "东财",
    "feedgen": "feedgen",
    "manual": "手动",
}


def _day_start_ts(d: date) -> float:
    return datetime(d.year, d.month, d.day).timestamp()


def _parse_day(raw: str | None, fallback: date) -> date:
    if not raw:
        return fallback
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return fallback


def list_events(
    *,
    from_day: str | None = None,
    to_day: str | None = None,
    std_type: str | None = None,
    fe_type: str | None = None,
    city: str | None = None,
    q: str | None = None,
    importance: str | None = None,
    source: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """importance: ``unrated`` | ``1``..``5``（表示 ≥N 星）。
    source: ``eastmoney`` | ``feedgen`` | ``manual``。
    """
    init_db()
    today = date.today()
    start = _parse_day(from_day, today)
    end = _parse_day(to_day, today + timedelta(days=29))
    if end < start:
        start, end = end, start

    start_ts = _day_start_ts(start)
    end_ts = _day_start_ts(end + timedelta(days=1))

    clauses = [
        """(
          (start_ts IS NOT NULL AND start_ts >= ? AND start_ts < ?)
          OR (
            start_ts IS NOT NULL AND start_ts < ?
            AND end_at IS NOT NULL AND date(substr(end_at,1,10)) >= date(?)
          )
        )"""
    ]
    params: list[Any] = [start_ts, end_ts, start_ts, start.isoformat()]

    if std_type:
        clauses.append("std_type_code = ?")
        params.append(std_type.strip())
    if fe_type:
        clauses.append("fe_type = ?")
        params.append(fe_type.strip())
    if city:
        clauses.append("city = ?")
        params.append(city.strip())
    if source and source.strip():
        clauses.append("IFNULL(NULLIF(TRIM(source), ''), 'eastmoney') = ?")
        params.append(source.strip().lower())
    if q and q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(name LIKE ? OR sponsor LIKE ? OR content LIKE ? OR city LIKE ?)")
        params.extend([like, like, like, like])

    imp = (importance or "").strip().lower()
    if imp in ("unrated", "0", "none"):
        clauses.append("importance IS NULL")
    elif imp in ("1", "2", "3", "4", "5"):
        clauses.append("importance IS NOT NULL AND importance >= ?")
        params.append(int(imp))

    sql = f"""
      SELECT fe_code, start_at, end_at, start_ts, name, sponsor, city,
             fe_type, std_type_code, content, source,
             importance, importance_reason, importance_rated_at,
             updated_at, synced_at
      FROM finance_calendar_event
      WHERE {' AND '.join(clauses)}
      ORDER BY (start_ts IS NULL), start_ts ASC, name ASC
      LIMIT ?
    """
    params.append(max(1, min(int(limit), 1000)))

    conn = get_conn()
    with _lock:
        rows = conn.execute(sql, params).fetchall()

    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        code = str(item.get("std_type_code") or "")
        item["std_type_label"] = STD_TYPE_LABELS.get(code, "其他")
        src = str(item.get("source") or "").strip().lower() or "eastmoney"
        item["source"] = src
        item["source_label"] = SOURCE_LABELS.get(src, src)
        out.append(item)
    return out


def facets(
    *,
    from_day: str | None = None,
    to_day: str | None = None,
) -> dict[str, Any]:
    events = list_events(from_day=from_day, to_day=to_day, limit=1000)
    by_std: dict[str, int] = {}
    by_fe: dict[str, int] = {}
    by_city: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for e in events:
        st = str(e.get("std_type_code") or "") or "-"
        by_std[st] = by_std.get(st, 0) + 1
        ft = str(e.get("fe_type") or "").strip() or "-"
        by_fe[ft] = by_fe.get(ft, 0) + 1
        city = str(e.get("city") or "").strip() or "-"
        by_city[city] = by_city.get(city, 0) + 1
        src = str(e.get("source") or "").strip().lower() or "eastmoney"
        by_source[src] = by_source.get(src, 0) + 1

    def top(d: dict[str, int], n: int = 40) -> list[dict[str, Any]]:
        items = sorted(d.items(), key=lambda x: (-x[1], x[0]))[:n]
        return [{"value": k, "count": v, "label": STD_TYPE_LABELS.get(k, k)} for k, v in items]

    sources = [
        {
            "value": k,
            "count": v,
            "label": SOURCE_LABELS.get(k, k),
        }
        for k, v in sorted(by_source.items(), key=lambda x: (-x[1], x[0]))
    ]

    return {
        "std_types": top(by_std, 10),
        "fe_types": top(by_fe, 40),
        "cities": top(by_city, 40),
        "sources": sources,
        "total": len(events),
    }


def sync_status() -> dict[str, Any]:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT COUNT(*) AS cnt,
                   MAX(synced_at) AS last_synced,
                   MAX(updated_at) AS last_updated
            FROM finance_calendar_event
            """
        ).fetchone()
        job = conn.execute(
            """
            SELECT last_run_at, next_run_at, last_status, last_error, last_result_json
            FROM scheduled_job WHERE id = 'finance_calendar_sync'
            """
        ).fetchone()
    out: dict[str, Any] = {
        "row_count": int(row["cnt"] or 0) if row else 0,
        "last_synced_at": float(row["last_synced"]) if row and row["last_synced"] else None,
        "last_updated_at": float(row["last_updated"]) if row and row["last_updated"] else None,
        "server_now": time.time(),
    }
    if job:
        out["job"] = {
            "last_run_at": job["last_run_at"],
            "next_run_at": job["next_run_at"],
            "last_status": job["last_status"],
            "last_error": job["last_error"],
        }
    return out
