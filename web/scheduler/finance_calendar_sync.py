"""东财财经日历同步：datacenter JSON 分页拉取 + upsert。"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any

from cache.db import _lock, get_conn, init_db

_log = logging.getLogger("scheduler.finance-calendar")

API_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"
REPORT_NAME = "RPT_CPH_FECALENDAR"
COLUMNS = (
    "START_DATE,END_DATE,FE_CODE,FE_NAME,FE_TYPE,CONTENT,"
    "STD_TYPE_CODE,SPONSOR_NAME,CITY"
)
PAGE_SIZE = 50
REFERER = "https://data.eastmoney.com/cjrl/default.html"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "inserted": 0,
    "updated": 0,
    "unchanged": 0,
    "message": "",
    "synced_at": None,
    "last_error": None,
}


def get_progress() -> dict[str, Any]:
    return dict(_progress)


def _set_progress(**kwargs: Any) -> None:
    _progress.update(kwargs)


def _parse_ts(raw: str | None) -> float | None:
    if not raw:
        return None
    text = str(raw).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:19] if len(text) >= 19 else text[:10], fmt).timestamp()
        except ValueError:
            continue
    return None


def _content_hash(row: dict[str, Any]) -> str:
    payload = {
        "start_at": row.get("start_at") or "",
        "end_at": row.get("end_at") or "",
        "name": row.get("name") or "",
        "sponsor": row.get("sponsor") or "",
        "city": row.get("city") or "",
        "fe_type": row.get("fe_type") or "",
        "std_type_code": row.get("std_type_code") or "",
        "content": row.get("content") or "",
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _normalize_row(item: dict[str, Any]) -> dict[str, Any] | None:
    fe_code = str(item.get("FE_CODE") or "").strip()
    if not fe_code:
        return None
    start_at = str(item.get("START_DATE") or "").strip()
    end_at = str(item.get("END_DATE") or "").strip() or None
    name = str(item.get("FE_NAME") or "").strip()
    row = {
        "fe_code": fe_code,
        "start_at": start_at,
        "end_at": end_at,
        "start_ts": _parse_ts(start_at),
        "name": name,
        "sponsor": (str(item.get("SPONSOR_NAME") or "").strip() or None),
        "city": (str(item.get("CITY") or "").strip() or None),
        "fe_type": (str(item.get("FE_TYPE") or "").strip() or None),
        "std_type_code": (str(item.get("STD_TYPE_CODE") or "").strip() or None),
        "content": (str(item.get("CONTENT") or "").strip() or None),
    }
    row["content_hash"] = _content_hash(row)
    return row


def _fetch_page(
    *,
    page: int,
    filter_expr: str,
    timeout: float = 25.0,
) -> dict[str, Any]:
    params = {
        "reportName": REPORT_NAME,
        "columns": COLUMNS,
        "pageNumber": str(page),
        "pageSize": str(PAGE_SIZE),
        "sortColumns": "START_DATE",
        "sortTypes": "1",
        "source": "WEB",
        "client": "WEB",
        "filter": filter_expr,
    }
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": REFERER,
            "Accept": "application/json, text/plain, */*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw) if raw else {}
    if not isinstance(data, dict):
        raise RuntimeError("invalid calendar api payload")
    if data.get("success") is False:
        raise RuntimeError(str(data.get("message") or data.get("code") or "api failed"))
    return data


def _window_filter(today: date | None = None) -> tuple[str, date, date]:
    base = today or date.today()
    start = base - timedelta(days=3)
    end = base + timedelta(days=29)
    # START_DATE < end+1 day（与东财页面 getNextDay 一致）
    filt = f"(END_DATE>='{start.isoformat()}')(START_DATE<'{(end + timedelta(days=1)).isoformat()}')"
    return filt, start, end


def upsert_events(rows: list[dict[str, Any]]) -> dict[str, int]:
    init_db()
    now = time.time()
    inserted = updated = unchanged = 0
    conn = get_conn()
    with _lock:
        for row in rows:
            existing = conn.execute(
                "SELECT content_hash FROM finance_calendar_event WHERE fe_code = ?",
                (row["fe_code"],),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO finance_calendar_event(
                      fe_code, start_at, end_at, start_ts, name, sponsor, city,
                      fe_type, std_type_code, content, content_hash, source,
                      first_seen_at, updated_at, synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'eastmoney', ?, ?, ?)
                    """,
                    (
                        row["fe_code"],
                        row["start_at"],
                        row["end_at"],
                        row["start_ts"],
                        row["name"],
                        row["sponsor"],
                        row["city"],
                        row["fe_type"],
                        row["std_type_code"],
                        row["content"],
                        row["content_hash"],
                        now,
                        now,
                        now,
                    ),
                )
                inserted += 1
            elif str(existing["content_hash"] or "") != row["content_hash"]:
                conn.execute(
                    """
                    UPDATE finance_calendar_event
                    SET start_at=?, end_at=?, start_ts=?, name=?, sponsor=?, city=?,
                        fe_type=?, std_type_code=?, content=?, content_hash=?,
                        updated_at=?, synced_at=?
                    WHERE fe_code=?
                    """,
                    (
                        row["start_at"],
                        row["end_at"],
                        row["start_ts"],
                        row["name"],
                        row["sponsor"],
                        row["city"],
                        row["fe_type"],
                        row["std_type_code"],
                        row["content"],
                        row["content_hash"],
                        now,
                        now,
                        row["fe_code"],
                    ),
                )
                updated += 1
            else:
                conn.execute(
                    "UPDATE finance_calendar_event SET synced_at=? WHERE fe_code=?",
                    (now, row["fe_code"]),
                )
                unchanged += 1
        conn.commit()
    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


def run_finance_calendar_sync(*, page_delay: float = 0.15) -> dict[str, Any]:
    """同步入口：分页拉取未来窗口并 upsert。"""
    started = time.time()
    filt, start, end = _window_filter()
    _set_progress(
        active=True,
        phase="fetch",
        done=0,
        total=1,
        inserted=0,
        updated=0,
        unchanged=0,
        message="拉取东财财经日历…",
        last_error=None,
    )

    all_rows: list[dict[str, Any]] = []
    try:
        first = _fetch_page(page=1, filter_expr=filt)
        result = first.get("result") or {}
        pages = int(result.get("pages") or 1)
        count = int(result.get("count") or 0)
        _set_progress(total=max(pages, 1), message=f"共 {count} 条 / {pages} 页")

        def ingest(payload: dict[str, Any]) -> None:
            data = (payload.get("result") or {}).get("data") or []
            for item in data:
                if not isinstance(item, dict):
                    continue
                row = _normalize_row(item)
                if row:
                    all_rows.append(row)

        ingest(first)
        _set_progress(done=1)

        for page in range(2, pages + 1):
            if page_delay > 0:
                time.sleep(page_delay)
            payload = _fetch_page(page=page, filter_expr=filt)
            ingest(payload)
            _set_progress(done=page, message=f"已拉 {page}/{pages} 页")

        _set_progress(phase="upsert", message="写入本地库…")
        stats = upsert_events(all_rows)
        elapsed = round(time.time() - started, 2)
        out = {
            "ok": True,
            "window": {"from": start.isoformat(), "to": end.isoformat()},
            "fetched": len(all_rows),
            "remote_count": count,
            "pages": pages,
            "elapsed_sec": elapsed,
            **stats,
        }
        _set_progress(
            active=False,
            phase="done",
            done=pages,
            total=pages,
            inserted=stats["inserted"],
            updated=stats["updated"],
            unchanged=stats["unchanged"],
            message=f"完成：+{stats['inserted']} ~{stats['updated']} ={stats['unchanged']}",
            synced_at=time.time(),
            last_error=None,
        )
        return out
    except Exception as exc:  # noqa: BLE001
        _log.exception("finance calendar sync failed")
        _set_progress(
            active=False,
            phase="error",
            message=str(exc),
            last_error=str(exc),
        )
        raise


def next_2am_ts(now: float | None = None) -> float:
    """本地时区次日 02:00（若当前未过今天 02:00 且调用方需要也可用于当天；默认次日）。"""
    ts = now if now is not None else time.time()
    local = datetime.fromtimestamp(ts)
    target = local.replace(hour=2, minute=0, second=0, microsecond=0)
    if local >= target:
        target = target + timedelta(days=1)
    return target.timestamp()
