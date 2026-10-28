"""Tushare 专题后台同步队列（与东财 Worker 隔离）。"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any

from cache.source_lanes import TUSHARE_MARKETS
from tsrelay import store
from tsrelay.catalog import MARKET_SPECS
from tsrelay.markets import fetch_market, resolve_trade_date

_log = logging.getLogger("tushare-gateway")

_queue: deque[tuple[str, str | None, bool]] = deque()  # market_id, trade_date, force
_queued: set[str] = set()
_lock = threading.Lock()
_cv = threading.Condition(_lock)
_worker_started = False
_running = False

_progress_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "job": None,
    "markets_total": 0,
    "markets_done": 0,
    "market": None,
    "market_label": None,
    "done": 0,
    "total": 0,
    "overall_done": 0,
    "overall_total": 0,
    "ok_count": 0,
    "fail_count": 0,
    "message": "",
    "source": None,
    "errors": [],
    "updated_at": 0.0,
    "trade_date": None,
}
_job_markets: list[str] = []


def _set_progress(**kwargs: Any) -> None:
    with _progress_lock:
        _progress.update(kwargs)
        _progress["updated_at"] = time.time()


def get_progress() -> dict[str, Any]:
    with _progress_lock:
        base = dict(_progress)
    lane = {
        "lane": "tushare",
        "label": "Tushare",
        "title": "Tushare 中继",
        "active": bool(base.get("active")),
        "done": int(base.get("markets_done") or 0),
        "total": int(base.get("markets_total") or 0),
        "percent": 0,
        "market": base.get("market"),
        "market_label": base.get("market_label"),
        "message": base.get("message") or "",
    }
    total = max(1, lane["total"]) if base.get("active") or lane["total"] else 0
    if total:
        done = lane["done"]
        if base.get("active") and base.get("market"):
            lane["percent"] = int(min(99, (done + 0.5) / total * 100))
        else:
            lane["percent"] = int(done / total * 100) if lane["total"] else 0
    base["lanes"] = {"tushare": lane}
    return base


def is_syncing() -> bool:
    with _lock:
        return _running or bool(_queue)


def _catalog_date_key(market_id: str) -> bool:
    return market_id in ("ts:opt", "ts:ths")


def _pull_and_store(market_id: str, trade_date: str | None) -> dict[str, Any]:
    store.ensure_schema()
    td_info = resolve_trade_date(trade_date)
    td = trade_date or td_info.get("trade_date")
    if _catalog_date_key(market_id):
        td_key = store.CATALOG_TRADE_DATE
    else:
        if not td:
            return {"ok": False, "error": "无交易日", "error_code": "no_trade_date"}
        td_key = td

    live = fetch_market(market_id, td if not _catalog_date_key(market_id) else td)
    if not live.get("ok"):
        err = str(live.get("error") or "拉取失败")
        store.set_meta_error(market_id, err)
        return live

    # 占位不落库
    if live.get("placeholder"):
        return live

    items = live.get("items") or []
    columns = live.get("columns") or []
    table_kind = str(live.get("table") or "topic")
    label = str(live.get("label") or MARKET_SPECS.get(market_id, {}).get("label") or market_id)
    source = live.get("source")
    # 允许空表落库防穿透
    store.replace_snapshot(
        market_id,
        td_key,
        table_kind=table_kind,
        label=label,
        columns=columns,
        items=items,
        source=str(source) if source else None,
    )
    return {**live, "cached_write": True, "trade_date": live.get("trade_date") or td}


def _worker_loop() -> None:
    global _running
    while True:
        with _cv:
            while not _queue:
                _cv.wait(timeout=1.0)
            if not _queue:
                continue
            market_id, trade_date, _force = _queue.popleft()
            _queued.discard(market_id)
            _running = True

        label = MARKET_SPECS.get(market_id, {}).get("label") or market_id
        try:
            _set_progress(
                market=market_id,
                market_label=label,
                message=f"正在同步 {label}…",
            )
            result = _pull_and_store(market_id, trade_date)
            with _progress_lock:
                done = int(_progress.get("markets_done") or 0) + 1
                total = int(_progress.get("markets_total") or 1)
                ok = int(_progress.get("ok_count") or 0)
                fail = int(_progress.get("fail_count") or 0)
                errors = list(_progress.get("errors") or [])
            if result.get("ok"):
                ok += 1
            else:
                fail += 1
                errors.append({"market": market_id, "error": result.get("error") or "fail"})
            _set_progress(
                markets_done=done,
                ok_count=ok,
                fail_count=fail,
                errors=errors[-20:],
                overall_done=done,
                overall_total=total,
                done=done,
                total=total,
                message=f"{label} {'完成' if result.get('ok') else '失败'}",
                source=result.get("source"),
            )
        except Exception as e:  # noqa: BLE001
            _log.exception("tushare sync %s", market_id)
            store.set_meta_error(market_id, str(e))
            with _progress_lock:
                done = int(_progress.get("markets_done") or 0) + 1
                total = int(_progress.get("markets_total") or 1)
                fail = int(_progress.get("fail_count") or 0) + 1
                errors = list(_progress.get("errors") or [])
                errors.append({"market": market_id, "error": str(e)[:200]})
            _set_progress(
                markets_done=done,
                fail_count=fail,
                errors=errors[-20:],
                overall_done=done,
                overall_total=total,
                message=f"{market_id} 异常",
            )
        finally:
            with _cv:
                _running = False
                finished = not _queue
            if finished:
                _set_progress(active=False, message="Tushare 同步结束", market=None)


def start_worker() -> None:
    global _worker_started
    with _lock:
        if _worker_started:
            return
        th = threading.Thread(target=_worker_loop, name="tushare-cache-sync", daemon=True)
        th.start()
        _worker_started = True


def enqueue(market_id: str, *, trade_date: str | None = None, force: bool = True) -> bool:
    if market_id.startswith("ts:ph:"):
        return False
    start_worker()
    with _cv:
        if market_id in _queued:
            return False
        _queued.add(market_id)
        _queue.append((market_id, trade_date, force))
        _cv.notify()
    return True


def start_sync(market_id: str, *, trade_date: str | None = None, force: bool = True) -> dict[str, Any]:
    global _job_markets
    _job_markets = [market_id]
    _set_progress(
        active=True,
        job="single",
        markets_total=1,
        markets_done=0,
        overall_done=0,
        overall_total=1,
        done=0,
        total=1,
        ok_count=0,
        fail_count=0,
        errors=[],
        trade_date=trade_date,
        message="排队同步…",
    )
    enqueue(market_id, trade_date=trade_date, force=force)
    return {"ok": True, "queued": True, "market": market_id}


def start_sync_all(*, trade_date: str | None = None, force: bool = True) -> dict[str, Any]:
    global _job_markets
    targets = [m for m in TUSHARE_MARKETS if m in MARKET_SPECS]
    _job_markets = list(targets)
    n = len(targets)
    _set_progress(
        active=True,
        job="all",
        markets_total=n,
        markets_done=0,
        overall_done=0,
        overall_total=n,
        done=0,
        total=n,
        ok_count=0,
        fail_count=0,
        errors=[],
        trade_date=trade_date,
        message="排队同步全部 Tushare…",
    )
    for m in targets:
        enqueue(m, trade_date=trade_date, force=force)
    return {"ok": True, "queued": True, "markets": targets, "markets_total": n}
