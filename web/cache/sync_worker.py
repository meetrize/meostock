"""后台同步队列：同市场互斥，跨市场有限并发；暴露精确进度。"""

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
    enrich_index_quotes,
    enrich_yf_quotes,
    fetch_fund_snapshot,
    merge_keep_quotes,
)
from cache.providers.sina_snapshot import SINA_HQ_NODE, fetch_sina_market_snapshot

ProgressCb = Callable[[int, int], None]

_FULL_MARKETS = frozenset({"cn", "hk", "us"})
_ALL_SYNC_MARKETS: tuple[str, ...] = (
    "cn",
    "hk",
    "us",
    "futures",
    "fund",
    "index",
    "yf:COMMODITIES",
    "yf:CURRENCIES",
    "yf:CRYPTOCURRENCIES",
    "yf:RATES",
    "yf:US",
    "yf:EUROPE",
    "yf:ASIA",
    "yf:GB",
)
_MARKET_LABELS = {
    "cn": "A股",
    "hk": "港股",
    "us": "美股",
    "futures": "期货",
    "fund": "基金",
    "index": "指数",
    "yf:COMMODITIES": "大宗商品",
    "yf:CURRENCIES": "外汇",
    "yf:CRYPTOCURRENCIES": "加密货币",
    "yf:RATES": "利率",
    "yf:US": "美国",
    "yf:EUROPE": "欧洲",
    "yf:ASIA": "亚洲",
    "yf:GB": "英国",
}

_queue: deque[tuple[int, str, bool]] = deque()  # priority, market, force
_queued: set[str] = set()
_running: set[str] = set()
_cv = threading.Condition()
_worker_started = False
_MAX_PARALLEL = 2
# 显式同步任务（进度条）期间串行，避免多市场进度互相覆盖
_serialize_jobs = False

_progress_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "job": None,  # single | all
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
}
# sync-all 时各市场预估总量（完成后累加实际行数）
_job_markets: list[str] = []
_job_completed_rows = 0
_job_expected: dict[str, int] = {}


def _normalize_market(market: str) -> str:
    m = (market or "").strip()
    if m.lower().startswith("yf:"):
        return "yf:" + m[3:].upper()
    return m.lower()


def _label(market: str) -> str:
    return _MARKET_LABELS.get(market, market)


def _set_progress(**kwargs: Any) -> None:
    with _progress_lock:
        _progress.update(kwargs)
        _progress["updated_at"] = time.time()


def get_progress() -> dict[str, Any]:
    with _progress_lock:
        return dict(_progress)


def _recompute_overall(*, item_done: int = 0, item_total: int = 0) -> tuple[int, int]:
    """overall = 已完成市场行数 + 当前市场进度；总数 = 各市场预估之和。"""
    expected_sum = sum(_job_expected.get(m, 1) for m in _job_markets) or max(
        1, _progress.get("markets_total") or 1
    )
    cur_total = max(1, item_total or _job_expected.get(_progress.get("market") or "", 1))
    cur_done = max(0, min(item_done, cur_total))
    overall_done = _job_completed_rows + cur_done
    return overall_done, max(expected_sum, overall_done, 1)


def _begin_job(job: str, markets: list[str]) -> None:
    global _job_markets, _job_completed_rows, _job_expected, _serialize_jobs
    _job_markets = list(markets)
    _job_completed_rows = 0
    _job_expected = {}
    _serialize_jobs = True
    for m in markets:
        meta = models.get_market_meta(m)
        n = int((meta or {}).get("row_count") or 0)
        _job_expected[m] = max(1, n) if n > 0 else (5000 if m in _FULL_MARKETS else 200)
    overall_total = sum(_job_expected.values()) or len(markets)
    _set_progress(
        active=True,
        job=job,
        markets_total=len(markets),
        markets_done=0,
        market=None,
        market_label=None,
        done=0,
        total=0,
        overall_done=0,
        overall_total=overall_total,
        ok_count=0,
        fail_count=0,
        message="准备同步…",
        source=None,
        errors=[],
    )


def _end_job() -> None:
    global _serialize_jobs
    with _progress_lock:
        if not _running and not _queued:
            _serialize_jobs = False
            od = int(_progress.get("overall_done") or 0)
            ot = max(od, int(_progress.get("overall_total") or 1))
            ok = int(_progress.get("ok_count") or 0)
            fail = int(_progress.get("fail_count") or 0)
            if fail and ok:
                msg = f"同步结束：成功 {ok}，失败 {fail}"
            elif fail and not ok:
                msg = f"同步失败（{fail} 个市场）"
            else:
                msg = _progress.get("message") or "同步完成"
            _progress.update(
                {
                    "active": False,
                    "message": msg,
                    "done": int(_progress.get("done") or 0),
                    "total": max(int(_progress.get("total") or 0), int(_progress.get("done") or 0)),
                    "overall_done": max(od, ot) if od > 0 else ot,
                    "overall_total": ot,
                    "updated_at": time.time(),
                }
            )


def _job_tracks(market: str | None = None) -> bool:
    with _progress_lock:
        if not _progress.get("active"):
            return False
        if not _job_markets:
            return False
        if market is None:
            return True
        return market in _job_markets


def _on_item_progress(done: int, total: int) -> None:
    with _progress_lock:
        if not _progress.get("active"):
            return
        market = _progress.get("market")
    if not market:
        return
    if total > 0:
        _job_expected[market] = max(_job_expected.get(market, 1), total)
    od, ot = _recompute_overall(item_done=done, item_total=total)
    label = _label(market)
    _set_progress(
        done=done,
        total=max(total, done, 1),
        overall_done=od,
        overall_total=ot,
        message=f"正在同步{label} {done}/{max(total, done, 1)}…",
    )


def enqueue(market: str, *, force: bool = False, priority: int = 5) -> None:
    market = _normalize_market(market)
    with _cv:
        if market in _running:
            # 正在跑：force 时排队等结束后再跑一遍
            if force and market not in _queued:
                _queued.add(market)
                _queue.appendleft((0, market, True))
            _cv.notify()
            return
        if market in _queued:
            if force:
                # 提升优先级并标记 force
                items = [(p, m, f) for (p, m, f) in _queue if m != market]
                items.insert(0, (0, market, True))
                _queue.clear()
                _queue.extend(items)
            _cv.notify()
            return
        _queued.add(market)
        _queue.append((priority, market, force))
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
    _begin_job("single", [market])
    try:
        return _run_sync(market, force=force)
    finally:
        with _cv:
            _running.discard(market)
            _cv.notify()
        _end_job()


def start_sync(market: str, *, force: bool = True) -> dict[str, Any]:
    """后台同步单个市场（带进度）。"""
    market = _normalize_market(market)
    _begin_job("single", [market])
    enqueue(market, force=force, priority=0)
    return {"ok": True, "queued": True, "market": market}


def start_sync_all(*, force: bool = True, markets: list[str] | None = None) -> dict[str, Any]:
    """后台同步全部（或指定）市场。"""
    if markets:
        targets = [_normalize_market(m) for m in markets]
    else:
        targets = list(_ALL_SYNC_MARKETS)
    seen: set[str] = set()
    ordered: list[str] = []
    for m in targets:
        if m not in seen:
            seen.add(m)
            ordered.append(m)
    _begin_job("all", ordered)
    for i, m in enumerate(ordered):
        enqueue(m, force=force, priority=1 + i)
    return {
        "ok": True,
        "queued": True,
        "markets": ordered,
        "markets_total": len(ordered),
    }


def _fetch_full_with_fallback(
    market: str,
    *,
    on_batch: Callable[[list[dict[str, Any]]], None] | None,
) -> tuple[list[dict[str, Any]], str]:
    """东财优先；失败且支持新浪时回退。"""
    try:
        rows, source = fetch_market_snapshot(
            market,
            on_batch=on_batch,
            on_progress=_on_item_progress,
        )
        if rows:
            return rows, source
        raise RuntimeError("eastmoney empty")
    except Exception as em_err:
        if market not in SINA_HQ_NODE:
            raise
        _set_progress(message=f"东财失败，改用新浪同步{_label(market)}…", source="sina")
        rows, source = fetch_sina_market_snapshot(
            market,
            on_batch=on_batch,
            on_progress=_on_item_progress,
        )
        _set_progress(source=source)
        # 保留东财错误信息便于排查，但不抛出
        _ = em_err
        return rows, source


def _run_sync(market: str, *, force: bool = False) -> dict[str, Any]:
    global _job_completed_rows
    models.upsert_market_meta(market, sync_state="running", last_error=None)
    t0 = time.time()
    label = _label(market)
    track = _job_tracks(market)
    progress_cb: ProgressCb | None = _on_item_progress if track else None
    if track:
        expected = _job_expected.get(market, 1)
        od, ot = _recompute_overall(item_done=0, item_total=expected)
        _set_progress(
            market=market,
            market_label=label,
            done=0,
            total=expected,
            overall_done=od,
            overall_total=ot,
            message=f"正在同步{label}…",
            source=None,
        )
    try:
        if market in _FULL_MARKETS:

            def _batch(rows: list[dict[str, Any]]) -> None:
                models.upsert_snapshot_rows(market, rows, source="eastmoney")

            if track:
                rows, source = _fetch_full_with_fallback(market, on_batch=_batch)
            else:
                rows, source = fetch_market_snapshot(market, on_batch=_batch)
            n = models.replace_snapshot(market, rows, source=source)
        elif market == "fund":
            if progress_cb:
                progress_cb(0, _job_expected.get(market, 1))
            try:
                rows = merge_keep_quotes(fetch_fund_snapshot(), models.read_snapshot(market))
                source = "eastmoney"
            except Exception:
                if "fund" in SINA_HQ_NODE:
                    if track:
                        _set_progress(message="东财基金失败，改用新浪…", source="sina")
                    rows, source = fetch_sina_market_snapshot(
                        "fund",
                        on_progress=progress_cb,
                    )
                    prev = models.read_snapshot(market)
                    rows = merge_keep_quotes(rows, prev)
                else:
                    raise
            n = models.replace_snapshot(market, rows, source=source)
            if progress_cb:
                progress_cb(n, n)
        elif market == "index":
            prev = models.read_snapshot(market)
            base = catalog_index()
            if track:
                _job_expected[market] = max(len(base), 1)
            if progress_cb:
                progress_cb(0, len(base) or 1)
            ready_n = sum(
                1 for r in prev if r.get("quoteReady") and r.get("price") is not None
            )
            # 已有足够报价且非 force：保留旧价，避免闭市反复打网
            if not force and prev and ready_n >= max(1, int(len(prev) * 0.5)):
                rows = merge_keep_quotes(base, prev)
                source = "cache+static"
            else:
                try:
                    enriched = enrich_index_quotes(base, max_workers=6, allow_network=True)
                except Exception:
                    enriched = enrich_index_quotes(
                        base, max_workers=4, allow_network=False
                    )
                rows = merge_keep_quotes(enriched, prev)
                got = sum(1 for r in rows if r.get("price") is not None)
                source = "eastmoney" if got else "kline+static"
            n = models.replace_snapshot(market, rows, source=source)
            if progress_cb:
                progress_cb(n, n)
        elif market == "futures":
            prev = models.read_snapshot(market)
            base = catalog_futures()
            if track:
                _job_expected[market] = max(len(base), 1)
            if progress_cb:
                progress_cb(0, len(base))
            ready_n = sum(1 for r in prev if r.get("quoteReady") and r.get("price") is not None)
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
            if progress_cb:
                progress_cb(n, n)
        elif market.startswith("yf:"):
            prev = models.read_snapshot(market)
            base = catalog_yf(market)
            if track:
                _job_expected[market] = max(len(base), 1)
            if progress_cb:
                progress_cb(0, len(base))
            ready_n = sum(1 for r in prev if r.get("quoteReady") and r.get("price") is not None)
            if not force and prev and ready_n >= max(1, int(len(prev) * 0.6)):
                rows = merge_keep_quotes(base, prev)
                source = "cache+yahoo"
            else:
                enriched = enrich_yf_quotes(base, force=force)
                rows = merge_keep_quotes(enriched, prev)
                source = "yahoo"
            n = models.replace_snapshot(market, rows, source=source)
            if progress_cb:
                progress_cb(n, n)
        else:
            raise ValueError(f"unsupported market: {market}")

        if track:
            _job_completed_rows += n
            _job_expected[market] = max(n, 1)
            with _progress_lock:
                markets_done = int(_progress.get("markets_done") or 0) + 1
                ok_count = int(_progress.get("ok_count") or 0) + 1
            od = _job_completed_rows
            ot = max(sum(_job_expected.get(m, 1) for m in _job_markets), od, 1)
            _set_progress(
                markets_done=markets_done,
                ok_count=ok_count,
                done=n,
                total=n,
                overall_done=od,
                overall_total=ot,
                source=source,
                message=f"{label}同步完成（{n} 只）",
            )
        return {
            "ok": True,
            "market": market,
            "row_count": n,
            "elapsed_sec": round(time.time() - t0, 2),
            "force": force,
            "source": source,
        }
    except Exception as e:
        if track:
            with _progress_lock:
                markets_done = int(_progress.get("markets_done") or 0) + 1
                fail_count = int(_progress.get("fail_count") or 0) + 1
                errors = list(_progress.get("errors") or [])
                errors.append({"market": market, "error": str(e)[:300]})
            skipped = _job_expected.get(market, 1)
            _job_completed_rows += skipped
            od = _job_completed_rows
            ot = max(sum(_job_expected.get(m, 1) for m in _job_markets), od, 1)
            _set_progress(
                markets_done=markets_done,
                fail_count=fail_count,
                errors=errors,
                overall_done=od,
                overall_total=ot,
                message=f"{label}同步失败：{e}",
            )
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
                limit = 1 if _serialize_jobs else _MAX_PARALLEL
                if len(_running) >= limit or not _queue:
                    _cv.wait(timeout=1.0)
                    if not _queue:
                        if not _running:
                            _end_job()
                        continue
                    if len(_running) >= limit:
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
                if not _running and not _queued:
                    _end_job()
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
