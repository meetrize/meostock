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
    "current_code": "",
    "current_name": "",
    "backfill_done": 0,
    "backfill_pending": 0,
    "universe": 0,
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


def ensure_stock_announcements(
    code: str,
    *,
    page_delay: float = 0.12,
    backfill_years: int = 2,
) -> dict[str, Any]:
    """按需同步单只股票近两年公告（侧栏打开空库时调用）。"""
    code6 = str(code or "").strip()[-6:]
    if not code6.isdigit():
        return {"ok": False, "error": "bad_code"}

    stock = cninfo_store.get_stock(code6)
    if not stock or not stock.get("org_id"):
        # 列表里没有：刷新一次全市场再查
        rows = cninfo_client.fetch_stock_list()
        cninfo_store.upsert_stocks(rows)
        stock = cninfo_store.get_stock(code6)
    if not stock or not stock.get("org_id"):
        return {"ok": False, "error": "stock_not_found", "code": code6}

    today = date.today()
    se_date = _se_date_range(today - timedelta(days=365 * max(1, backfill_years)), today)
    name = str(stock.get("name") or "")
    budget = [80]
    _set_progress(
        active=True,
        phase="ensure",
        done=0,
        total=1,
        current_code=code6,
        current_name=name,
        message=f"按需同步 {code6} {name}",
        last_error=None,
        mode="ensure",
    )
    try:
        result = _sync_one_stock(
            code=code6,
            org_id=str(stock["org_id"]),
            se_date=se_date,
            page_delay=page_delay,
            request_budget=budget,
        )
        cninfo_store.mark_sync_ok(
            code6,
            backfill_done=not bool(result.get("partial")),
            times_ms=result.get("times") or [],
        )
        stats = cninfo_store.sync_stats()
        _set_progress(
            active=False,
            phase="done",
            done=1,
            total=1,
            current_code=code6,
            current_name=name,
            inserted=int(result.get("inserted") or 0),
            updated=int(result.get("updated") or 0),
            backfill_done=stats.get("backfill_done") or 0,
            backfill_pending=stats.get("backfill_pending") or 0,
            universe=stats.get("stocks") or 0,
            message=f"按需完成 {code6} {name} +{result.get('inserted') or 0}",
            synced_at=time.time(),
        )
        return {
            "ok": True,
            "code": code6,
            "name": name,
            "inserted": int(result.get("inserted") or 0),
            "updated": int(result.get("updated") or 0),
            "partial": bool(result.get("partial")),
        }
    except Exception as exc:  # noqa: BLE001
        cninfo_store.mark_sync_error(code6, str(exc))
        _set_progress(
            active=False,
            phase="error",
            current_code=code6,
            current_name=name,
            message=str(exc),
            last_error=str(exc),
        )
        return {"ok": False, "error": str(exc), "code": code6}


def run_cninfo_announcement_sync(
    *,
    mode: Mode = "auto",
    page_delay: float = 0.2,
    max_stocks: int = 400,
    max_requests: int = 3000,
    backfill_years: int = 2,
    incremental_days: int = 7,
) -> dict[str, Any]:
    """同步入口。

    - auto：未回填完的优先两年窗口；已完成的扫近 incremental_days 天
    - backfill：只处理未完成回填的股票
    - incremental：只处理已回填股票的近 N 天
    单次有软上限，成功≠全市场完成；剩余待回填看 backfill_pending。
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
        current_code="",
        current_name="",
        backfill_done=0,
        backfill_pending=0,
        universe=0,
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
        stats0 = cninfo_store.sync_stats()

        _set_progress(
            phase="sync",
            total=len(queue),
            done=0,
            universe=stats0.get("stocks") or 0,
            backfill_done=stats0.get("backfill_done") or 0,
            backfill_pending=stats0.get("backfill_pending") or 0,
            message=(
                f"本轮计划 {len(queue)} 只 · 全市场待回填 "
                f"{stats0.get('backfill_pending') or 0}/{stats0.get('stocks') or 0}"
            ),
        )

        for idx, stock in enumerate(queue):
            if budget[0] <= 0:
                _set_progress(
                    message=(
                        f"请求预算耗尽，已完成 {idx}/{len(queue)} 只，下轮续跑"
                    ),
                    current_code="",
                    current_name="",
                )
                break
            code = str(stock["code"])
            org_id = str(stock["org_id"])
            name = str(stock.get("name") or "")
            done = bool(int(stock.get("backfill_done") or 0))
            if mode == "incremental" or (mode == "auto" and done):
                se_date = _se_date_range(incr_start, today)
                is_backfill = False
            else:
                se_date = _se_date_range(backfill_start, today)
                is_backfill = True

            _set_progress(
                done=idx,
                current_code=code,
                current_name=name,
                message=(
                    f"正在同步 {code} {name} · "
                    f"{'回填两年' if is_backfill else '增量'} "
                    f"({idx + 1}/{len(queue)})"
                ),
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
                _set_progress(last_error=f"{code} {name}: {exc}")

            live = cninfo_store.sync_stats()
            _set_progress(
                stocks_done=stocks_ok + stocks_partial + stocks_err,
                inserted=total_ins,
                updated=total_upd,
                done=idx + 1,
                current_code=code,
                current_name=name,
                backfill_done=live.get("backfill_done") or 0,
                backfill_pending=live.get("backfill_pending") or 0,
                universe=live.get("stocks") or 0,
                message=(
                    f"正在同步 {code} {name} · "
                    f"本轮 {idx + 1}/{len(queue)} · "
                    f"全市场已回填 {live.get('backfill_done') or 0}/"
                    f"{live.get('stocks') or 0}"
                ),
            )
            if page_delay > 0:
                time.sleep(page_delay * 0.5)

        stats = cninfo_store.sync_stats()
        elapsed = round(time.time() - started, 2)
        pending = int(stats.get("backfill_pending") or 0)
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
            "complete_universe": pending == 0,
            **stats,
        }
        _set_progress(
            active=False,
            phase="done",
            current_code="",
            current_name="",
            backfill_done=stats.get("backfill_done") or 0,
            backfill_pending=pending,
            universe=stats.get("stocks") or 0,
            message=(
                f"本轮完成 {stocks_ok + stocks_partial}/{len(queue)} 只 "
                f"+{total_ins} 条；全市场已回填 {stats.get('backfill_done') or 0}/"
                f"{stats.get('stocks') or 0}"
                + (f"，仍待 {pending} 只（可再点运行或等夜间续跑）" if pending else "，已全部回填")
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
            current_code="",
            current_name="",
        )
        raise


def next_2am_ts(now: float | None = None) -> float:
    """复用财经日历槽位：本地次日 02:00。"""
    from scheduler.finance_calendar_sync import next_2am_ts as _cal_next

    return _cal_next(now)
