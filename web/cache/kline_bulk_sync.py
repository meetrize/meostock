"""A 股日 K 全量入库：按代码表串行/有限并发拉约半年日线落 SQLite。"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from cache import kline_models, models
from cache.providers.kline_fetch import (
    fetch_kline_bars,
    normalize_period,
    normalize_symbol,
)

_log = logging.getLogger("quote-cache.kline-bulk")

_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "market": "cn",
    "period": "1d",
    "total": 0,
    "done": 0,
    # 注意：勿用键名 ok（会覆盖 HTTP {"ok": true}）
    "ok_count": 0,
    "skip_count": 0,
    "fail_count": 0,
    "current": None,
    "message": "",
    "started_at": 0.0,
    "updated_at": 0.0,
    "min_bars": 120,
    "errors": [],
}
_cancel = threading.Event()
_runner: threading.Thread | None = None


def get_bulk_progress() -> dict[str, Any]:
    with _lock:
        return dict(_progress)


def _set(**kwargs: Any) -> None:
    with _lock:
        _progress.update(kwargs)
        _progress["updated_at"] = time.time()


def _append_error(symbol: str, err: str) -> None:
    with _lock:
        errs = list(_progress.get("errors") or [])
        errs.append({"symbol": symbol, "error": err[:240]})
        _progress["errors"] = errs[-30:]
        _progress["updated_at"] = time.time()


def _target_symbols(market: str) -> list[str]:
    """优先代码表 klineSymbol；否则快照。"""
    market = (market or "cn").lower()
    seeds = models.read_symbol_seeds(market) if hasattr(models, "read_symbol_seeds") else []
    out: list[str] = []
    seen: set[str] = set()
    for s in seeds:
        sym = str(s.get("klineSymbol") or s.get("code") or "").strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    if out:
        return out
    rows = models.read_snapshot(market)
    for r in rows:
        sym = str(r.get("klineSymbol") or r.get("code") or "").strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _already_enough(market: str, symbol: str, period: str, min_bars: int) -> tuple[bool, int]:
    meta = kline_models.get_kline_meta(market, symbol, period)
    if meta:
        try:
            n = int(meta.get("bar_count") or 0)
        except (TypeError, ValueError):
            n = 0
        if n >= min_bars:
            return True, n
    bars = kline_models.read_kline_bars(market, symbol, period)
    n = len(bars or [])
    return n >= min_bars, n


def _sync_one(
    raw: str,
    *,
    period: str,
    min_bars: int,
    force: bool,
) -> str:
    """返回 ok|skip|fail。"""
    if _cancel.is_set():
        return "fail"
    try:
        norm = normalize_symbol(raw)
    except ValueError as e:
        _append_error(raw, str(e))
        return "fail"
    market = norm["market"]
    sym = norm["symbol"]
    display = norm.get("display") or sym
    _set(current=raw or display)

    if not force:
        enough, n = _already_enough(market, sym, period, min_bars)
        if enough:
            return "skip"

    try:
        fresh, name, source = fetch_kline_bars(norm, period)
        if not fresh:
            _append_error(raw, "empty bars")
            return "fail"
        # 约半年：保留最近 min_bars*1.2（交易日缓冲），多余也可留着，upsert 不删更早
        kline_models.upsert_kline_bars(
            market,
            sym,
            period,
            fresh,
            source=source,
            name=name or display,
            touch_as_of=True,
        )
        return "ok"
    except Exception as e:  # noqa: BLE001
        _append_error(raw, str(e))
        _log.warning("bulk kline fail %s: %s", raw, e)
        return "fail"


def _run_job(
    *,
    market: str,
    period: str,
    min_bars: int,
    force: bool,
    concurrency: int,
    max_symbols: int | None,
) -> None:
    from cache.db import init_db

    init_db()
    period_n = normalize_period(period)
    targets = _target_symbols(market)
    if max_symbols and max_symbols > 0:
        targets = targets[: int(max_symbols)]
    total = len(targets)
    _set(
        active=True,
        market=market,
        period=period_n,
        total=total,
        done=0,
        ok_count=0,
        skip_count=0,
        fail_count=0,
        current=None,
        message=f"开始全量入库 {market} {period_n}（目标≥{min_bars} 根）…",
        started_at=time.time(),
        min_bars=min_bars,
        errors=[],
    )
    if total <= 0:
        _set(active=False, message="无代码可同步（请先同步 A 股行情/代码表）")
        return

    workers = max(1, min(int(concurrency or 3), 6))
    done = ok = skip = fail = 0

    def _handle(raw: str) -> str:
        # 轻微节流，降低东财限流概率
        time.sleep(0.05)
        return _sync_one(raw, period=period_n, min_bars=min_bars, force=force)

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_handle, raw): raw for raw in targets}
            for fut in as_completed(futs):
                if _cancel.is_set():
                    break
                status = "fail"
                try:
                    status = fut.result()
                except Exception as e:  # noqa: BLE001
                    _append_error(futs[fut], str(e))
                    status = "fail"
                done += 1
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    skip += 1
                else:
                    fail += 1
                _set(
                    done=done,
                    ok_count=ok,
                    skip_count=skip,
                    fail_count=fail,
                    message=f"日K入库 {done}/{total} · 成功{ok} 跳过{skip} 失败{fail}",
                )
    finally:
        cancelled = _cancel.is_set()
        _cancel.clear()
        _set(
            active=False,
            current=None,
            message=(
                f"{'已取消 · ' if cancelled else ''}完成：成功{ok} 跳过{skip} 失败{fail} / 共{total}"
            ),
        )


def start_bulk_kline_sync(
    *,
    market: str = "cn",
    period: str = "1d",
    min_bars: int = 120,
    force: bool = False,
    concurrency: int = 3,
    max_symbols: int | None = None,
) -> dict[str, Any]:
    """启动后台全量日 K 入库。已在跑则返回 already_running。"""
    global _runner
    with _lock:
        if _progress.get("active") and _runner and _runner.is_alive():
            return {"ok": False, "error": "already_running", "progress": dict(_progress)}

    market = (market or "cn").lower().strip()
    if market != "cn":
        return {"ok": False, "error": "目前仅支持 market=cn（A股日线全量）"}

    min_bars = max(60, min(int(min_bars or 120), 500))
    concurrency = max(1, min(int(concurrency or 3), 6))
    _cancel.clear()

    def _boot() -> None:
        try:
            _run_job(
                market=market,
                period=period,
                min_bars=min_bars,
                force=bool(force),
                concurrency=concurrency,
                max_symbols=max_symbols,
            )
        except Exception as e:  # noqa: BLE001
            _log.exception("bulk kline job crashed")
            _set(active=False, message=f"任务异常：{e}")

    th = threading.Thread(target=_boot, name="kline-bulk-sync", daemon=True)
    _runner = th
    th.start()
    return {
        "ok": True,
        "queued": True,
        "market": market,
        "period": normalize_period(period),
        "min_bars": min_bars,
        "concurrency": concurrency,
        "message": "A股日K全量入库已在后台开始（约半年，可在进度接口查看）",
    }


def cancel_bulk_kline_sync() -> dict[str, Any]:
    if not get_bulk_progress().get("active"):
        return {"ok": True, "cancelled": False, "message": "当前无进行中的任务"}
    _cancel.set()
    return {"ok": True, "cancelled": True, "message": "已请求取消，等待当前批次结束"}
