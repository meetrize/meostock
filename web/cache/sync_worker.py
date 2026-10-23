"""后台同步队列：同市场互斥，跨市场有限并发。"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Any, Callable

from cache import models
from cache.providers.em_snapshot import fetch_market_snapshot
from cache.providers.lazy_markets import (
    catalog_futures,
    catalog_index,
    catalog_yf,
    enrich_futures_quotes,
    enrich_yf_quotes,
    fetch_fund_snapshot,
    merge_keep_quotes,
)

ProgressCb = Callable[[int, int], None]

_FULL_MARKETS = frozenset({"cn", "hk", "us"})
_queue: deque[tuple[int, str, bool]] = deque()  # priority, market, force
_queued: set[str] = set()
_running: set[str] = set()
_cv = threading.Condition()
_worker_started = False
_MAX_PARALLEL = 2


def _normalize_market(market: str) -> str:
    m = (market or "").strip()
    if m.lower().startswith("yf:"):
        return "yf:" + m[3:].upper()
    return m.lower()


def enqueue(market: str, *, force: bool = False, priority: int = 5) -> None:
    market = _normalize_market(market)
    with _cv:
        if market in _running or market in _queued:
            if force and market in _queued:
                # 提升为 force：重建队列项
                _queue.appendleft((0, market, True))
            _cv.notify()
            return
        _queued.add(market)
        _queue.append((priority, market, force))
        # 按 priority 排序（稳定：同优先级保持 FIFO 较难，简单重排）
        items = sorted(_queue, key=lambda x: x[0])
        _queue.clear()
        _queue.extend(items)
        _cv.notify()


def is_syncing(market: str | None = None) -> bool:
    with _cv:
        if market is None:
            return bool(_running) or bool(_queued)
        m = _normalize_market(market)
        return m in _running or m in _queued


def sync_now(market: str, *, force: bool = True) -> dict[str, Any]:
    """同步执行（API force / 冷启动）。"""
    market = _normalize_market(market)
    with _cv:
        if market in _running:
            return {"ok": False, "error": "already_running", "market": market}
        _running.add(market)
        _queued.discard(market)
    try:
        return _run_sync(market, force=force)
    finally:
        with _cv:
            _running.discard(market)
            _cv.notify()


def _run_sync(market: str, *, force: bool = False) -> dict[str, Any]:
    models.upsert_market_meta(market, sync_state="running", last_error=None)
    t0 = time.time()
    try:
        if market in _FULL_MARKETS:
            # 渐进 upsert 便于冷启动早出首屏；结束后全量 replace 去掉退市残留
            def _batch(rows: list[dict[str, Any]]) -> None:
                models.upsert_snapshot_rows(market, rows, source="eastmoney")

            rows, source = fetch_market_snapshot(market, on_batch=_batch)
            n = models.replace_snapshot(market, rows, source=source)
        elif market == "fund":
            prev = models.read_snapshot(market)
            rows = merge_keep_quotes(fetch_fund_snapshot(), prev)
            n = models.replace_snapshot(market, rows, source="eastmoney")
        elif market == "index":
            prev = models.read_snapshot(market)
            rows = merge_keep_quotes(catalog_index(), prev)
            n = models.replace_snapshot(market, rows, source="static")
        elif market == "futures":
            prev = models.read_snapshot(market)
            base = catalog_futures()
            ready_n = sum(1 for r in prev if r.get("quoteReady") and r.get("price") is not None)
            # 东财期货 K 线常断连：默认合并保留旧价；仅 force 或几乎无缓存时尝试补价
            if not force and prev and ready_n >= max(1, int(len(prev) * 0.4)):
                rows = merge_keep_quotes(base, prev)
                source = "cache+static"
            else:
                try:
                    enriched = enrich_futures_quotes(base, max_workers=3)
                except Exception:
                    enriched = base
                rows = merge_keep_quotes(enriched, prev)
                got = sum(1 for r in rows if r.get("price") is not None)
                source = "eastmoney" if got else "static"
            n = models.replace_snapshot(market, rows, source=source)
        elif market.startswith("yf:"):
            prev = models.read_snapshot(market)
            base = catalog_yf(market)
            ready_n = sum(1 for r in prev if r.get("quoteReady") and r.get("price") is not None)
            # 加密等 Yahoo 源慢：非强制且多数已有价 → 只合并目录，不重打 Yahoo
            if not force and prev and ready_n >= max(1, int(len(prev) * 0.6)):
                rows = merge_keep_quotes(base, prev)
                source = "cache+yahoo"
            else:
                enriched = enrich_yf_quotes(base, force=force)
                rows = merge_keep_quotes(enriched, prev)
                source = "yahoo"
            n = models.replace_snapshot(market, rows, source=source)
        else:
            raise ValueError(f"unsupported market: {market}")
        return {
            "ok": True,
            "market": market,
            "row_count": n,
            "elapsed_sec": round(time.time() - t0, 2),
            "force": force,
        }
    except Exception as e:
        models.upsert_market_meta(
            market,
            sync_state="error",
            last_error=str(e)[:500],
        )
        return {"ok": False, "market": market, "error": str(e)}


def _worker_loop() -> None:
    while True:
        job: tuple[int, str, bool] | None = None
        with _cv:
            while True:
                if len(_running) >= _MAX_PARALLEL or not _queue:
                    _cv.wait(timeout=1.0)
                    if not _queue:
                        continue
                    if len(_running) >= _MAX_PARALLEL:
                        continue
                _priority, market, force = _queue.popleft()
                _queued.discard(market)
                if market in _running:
                    continue
                _running.add(market)
                job = (_priority, market, force)
                break
        assert job is not None
        _priority, market, force = job
        try:
            _run_sync(market, force=force)
        finally:
            with _cv:
                _running.discard(market)
                _cv.notify()


def start_worker() -> None:
    global _worker_started
    if os.environ.get("QUOTE_CACHE_ENABLED", "1").strip() in ("0", "false", "False"):
        return
    with _cv:
        if _worker_started:
            return
        _worker_started = True
    th = threading.Thread(target=_worker_loop, name="quote-cache-sync", daemon=True)
    th.start()


def prefetch_on_startup() -> None:
    """启动预热：静态目录 + 上次市场（若有）。"""
    if os.environ.get("QUOTE_CACHE_ENABLED", "1").strip() in ("0", "false", "False"):
        return
    enqueue("index", priority=8)
    enqueue("futures", priority=8)
    last = models.get_config("last_market")
    if last:
        enqueue(last, priority=3)
