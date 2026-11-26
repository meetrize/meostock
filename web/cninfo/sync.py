"""巨潮公告同步：两年回填 + 夜间增量。"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any, Literal

from cninfo import client as cninfo_client
from cninfo import store as cninfo_store

_log = logging.getLogger("cninfo.sync")

Mode = Literal["auto", "backfill", "incremental"]

_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "inserted": 0,
    "updated": 0,
    "unchanged": 0,
    "requests": 0,
    "stocks_done": 0,
    "message": "",
    "synced_at": None,
    "last_error": None,
    "mode": "",
}


def get_progress() -> dict[str, Any]:
    return dict(_progress)


def _set_progress(**kwargs: Any) -> None:
    _progress.update(kwargs)


def _se_date_range(start: date, end: date) -> str:
    if end < start:
        start, end = end, start
    return f"{start.isoformat()}~{end.isoformat()}"


def _sync_one_stock(
    *,
    code: str,
    org_id: str,
    se_date: str,
    page_delay: float,
    request_budget: list[int],
) -> dict[str, Any]:
    """同步单只股票窗口；request_budget[0] 为剩余请求次数。"""
    inserted = updated = 0
    times: list[int] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        if request_budget[0] <= 0:
            return {
                "ok": False,
                "partial": True,
                "inserted": inserted,
                "updated": updated,
                "times": times,
                "pages": page - 1,
            }
        payload = cninfo_client.query_announcements(
            code=code, org_id=org_id, page_num=page, se_date=se_date
        )
        request_budget[0] -= 1
        _set_progress(requests=_progress.get("requests", 0) + 1)

        total_pages = max(1, int(payload.get("totalpages") or 1))
        raw_list = payload.get("announcements") or []
        rows: list[dict[str, Any]] = []
        if isinstance(raw_list, list):
            for item in raw_list:
                if not isinstance(item, dict):
                    continue
                row = cninfo_client.normalize_announcement(item, code=code, org_id=org_id)
                if not row:
                    continue
                rows.append(row)
                if row.get("announce_time_ms"):
                    times.append(int(row["announce_time_ms"]))
        if rows:
            stats = cninfo_store.upsert_announcements(rows)
            inserted += stats["inserted"]
            updated += stats["updated"]

        has_more = bool(payload.get("hasMore"))
        if page >= total_pages or (not has_more and page >= total_pages):
            break
        page += 1
        if page_delay > 0:
            time.sleep(page_delay)

    return {
        "ok": True,
        "partial": False,
        "inserted": inserted,
        "updated": updated,
        "times": times,
        "pages": page,
        "total_pages": total_pages,
    }


def run_cninfo_announcement_sync(
    *,
    mode: Mode = "auto",
    page_delay: float = 0.2,
    max_stocks: int = 200,
    max_requests: int = 1500,
    backfill_years: int = 2,
    incremental_days: int = 7,
) -> dict[str, Any]:
    """同步入口。

    - auto：未回填完的优先两年窗口；已完成的扫近 incremental_days 天
    - backfill：只处理未完成回填的股票
    - incremental：只处理已回填股票的近 N 天
    """
    started = time.time()
    today = date.today()
    backfill_start = today - timedelta(days=365 * max(1, backfill_years))
    incr_start = today - timedelta(days=max(1, incremental_days))

    _set_progress(
        active=True,
        phase="stock_list",
        done=0,
        total=0,
        inserted=0,
        updated=0,
        unchanged=0,
        requests=0,
        stocks_done=0,
        message="刷新巨潮 A 股列表…",
        last_error=None,
        mode=mode,
    )

    try:
        stocks = cninfo_client.fetch_stock_list()
        cninfo_store.upsert_stocks(stocks)
        prefer_backfill = mode != "incremental"
        queue = cninfo_store.list_stocks_for_sync(prefer_backfill=prefer_backfill)
        if mode == "backfill":
            queue = [s for s in queue if not int(s.get("backfill_done") or 0)]
        elif mode == "incremental":
            queue = [s for s in queue if int(s.get("backfill_done") or 0)]

        queue = queue[: max(1, int(max_stocks))]
        budget = [max(1, int(max_requests))]
        total_ins = total_upd = 0
        stocks_ok = stocks_partial = stocks_err = 0

        _set_progress(
            phase="sync",
            total=len(queue),
            done=0,
            message=f"待同步 {len(queue)} 只 · 请求预算 {budget[0]}",
        )

        for idx, stock in enumerate(queue):
            if budget[0] <= 0:
                _set_progress(message="请求预算耗尽，下轮续跑")
                break
            code = str(stock["code"])
            org_id = str(stock["org_id"])
            done = bool(int(stock.get("backfill_done") or 0))
            if mode == "incremental" or (mode == "auto" and done):
                se_date = _se_date_range(incr_start, today)
                is_backfill = False
            else:
                se_date = _se_date_range(backfill_start, today)
                is_backfill = True

            _set_progress(
                done=idx,
                message=f"{code} {stock.get('name') or ''} · {'回填' if is_backfill else '增量'} {se_date}",
            )
            try:
                result = _sync_one_stock(
                    code=code,
                    org_id=org_id,
                    se_date=se_date,
                    page_delay=page_delay,
                    request_budget=budget,
                )
                total_ins += int(result.get("inserted") or 0)
                total_upd += int(result.get("updated") or 0)
                if result.get("partial"):
                    stocks_partial += 1
                    # 部分完成不标 backfill_done，便于续跑
                    cninfo_store.mark_sync_ok(
                        code, backfill_done=None, times_ms=result.get("times") or []
                    )
                else:
                    stocks_ok += 1
                    cninfo_store.mark_sync_ok(
                        code,
                        backfill_done=True if is_backfill else None,
                        times_ms=result.get("times") or [],
                    )
            except Exception as exc:  # noqa: BLE001
                stocks_err += 1
                _log.warning("cninfo sync stock failed code=%s err=%s", code, exc)
                cninfo_store.mark_sync_error(code, str(exc))
                _set_progress(last_error=f"{code}: {exc}")

            _set_progress(
                stocks_done=stocks_ok + stocks_partial + stocks_err,
                inserted=total_ins,
                updated=total_upd,
                done=idx + 1,
            )
            if page_delay > 0:
                time.sleep(page_delay * 0.5)

        stats = cninfo_store.sync_stats()
        elapsed = round(time.time() - started, 2)
        out = {
            "ok": True,
            "mode": mode,
            "elapsed_sec": elapsed,
            "queued": len(queue),
            "stocks_ok": stocks_ok,
            "stocks_partial": stocks_partial,
            "stocks_err": stocks_err,
            "inserted": total_ins,
            "updated": total_upd,
            "requests_used": int(_progress.get("requests") or 0),
            "requests_left": budget[0],
            "window_backfill": _se_date_range(backfill_start, today),
            "window_incremental": _se_date_range(incr_start, today),
            **stats,
        }
        _set_progress(
            active=False,
            phase="done",
            message=(
                f"完成：股 {stocks_ok}/{len(queue)} "
                f"+{total_ins} ~{total_upd} 请求{_progress.get('requests')} "
                f"待回填{stats.get('backfill_pending')}"
            ),
            synced_at=time.time(),
            inserted=total_ins,
            updated=total_upd,
        )
        return out
    except Exception as exc:  # noqa: BLE001
        _log.exception("cninfo announcement sync failed")
        _set_progress(
            active=False,
            phase="error",
            message=str(exc),
            last_error=str(exc),
        )
        raise


def next_2am_ts(now: float | None = None) -> float:
    """复用财经日历槽位：本地次日 02:00。"""
    from scheduler.finance_calendar_sync import next_2am_ts as _cal_next

    return _cal_next(now)
