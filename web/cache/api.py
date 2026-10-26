"""本地行情缓存 HTTP API。"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cache import kline_models, models
from cache.providers.kline_fetch import fetch_kline_bars, normalize_period, normalize_symbol
from cache.sync_worker import (
    enqueue,
    get_progress,
    is_syncing,
    start_sync,
    start_sync_all,
    sync_now,
)
from cache.ttl import (
    cn_daily_bars_missing_today,
    is_stale,
    kline_is_stale,
    kline_ttl_seconds,
    normalize_mode,
    should_auto_sync,
    ttl_seconds,
)

router = APIRouter(prefix="/api/cache", tags=["quote-cache"])
_log = logging.getLogger("quote-cache")

_ENABLED = os.environ.get("QUOTE_CACHE_ENABLED", "1").strip() not in ("0", "false", "False")

# K 线后台刷新去重（market, symbol, period）
_kline_bg_lock = threading.Lock()
_kline_bg_inflight: set[tuple[str, str, str]] = set()


def _refresh_kline_background(norm: dict[str, str], period_n: str) -> None:
    """有旧缓存时的后台拉网落库（不阻塞 HTTP）。"""
    market = norm["market"]
    sym = norm["symbol"]
    key = (market, sym, period_n)
    try:
        fresh, fetch_name, fetch_source = fetch_kline_bars(norm, period_n)
        if fresh:
            kline_models.replace_kline_bars(
                market,
                sym,
                period_n,
                fresh,
                source=fetch_source,
                name=fetch_name,
            )
    except Exception as e:
        _log.warning("kline bg refresh failed %s/%s %s: %s", market, sym, period_n, e)
    finally:
        with _kline_bg_lock:
            _kline_bg_inflight.discard(key)


def _schedule_kline_bg(norm: dict[str, str], period_n: str) -> bool:
    market = norm["market"]
    sym = norm["symbol"]
    key = (market, sym, period_n)
    with _kline_bg_lock:
        if key in _kline_bg_inflight:
            return False
        _kline_bg_inflight.add(key)
    th = threading.Thread(
        target=_refresh_kline_background,
        args=(norm, period_n),
        name=f"kline-bg-{market}-{sym}-{period_n}",
        daemon=True,
    )
    th.start()
    return True


class ModeBody(BaseModel):
    mode: str = Field(..., description="speed|balanced|realtime")


class SyncBody(BaseModel):
    market: str
    force: bool = True
    # True=后台入队并返回进度；False=阻塞跑完（兼容旧脚本）
    background: bool = False


class SyncAllBody(BaseModel):
    force: bool = True
    markets: list[str] | None = None


class ClearBody(BaseModel):
    market: str | None = None
    what: str = "snapshot"  # snapshot|all


class UpsertBody(BaseModel):
    market: str
    items: list[dict[str, Any]] = Field(default_factory=list)
    source: str = "client"


class SourceBody(BaseModel):
    source: str = Field(..., description="auto|local|network")


class GcBody(BaseModel):
    max_age_days: float = 30.0
    max_series: int = 200


def _market_key(market: str) -> str:
    m = (market or "").strip()
    if m.lower().startswith("yf:"):
        return "yf:" + m[3:].upper()
    return m.lower()


def _parse_codes(codes: str | None) -> list[str] | None:
    if not codes or not str(codes).strip():
        return None
    parts = [p.strip() for p in str(codes).replace(";", ",").split(",")]
    out = [p for p in parts if p]
    return out or None


@router.get("/status")
def cache_status() -> JSONResponse:
    if not _ENABLED:
        return JSONResponse(
            {
                "ok": True,
                "enabled": False,
                "mode": models.get_mode(),
                "quote_source": models.get_quote_source(),
                "markets": [],
            }
        )
    payload = models.dump_status(models.get_mode())
    payload["enabled"] = True
    payload["syncing"] = is_syncing()
    return JSONResponse(payload)


@router.get("/snapshot")
def cache_snapshot(
    market: str = Query(..., description="cn|hk|us|fund|index|futures|yf:COMMODITIES"),
    force: int = Query(0, description="1=强制同步"),
    mode: str | None = Query(None, description="可选覆盖全局模式"),
    codes: str | None = Query(None, description="逗号分隔，过滤 code/kline_symbol"),
) -> JSONResponse:
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)

    market = _market_key(market)
    active_mode = normalize_mode(mode) if mode else models.get_mode()
    quote_source = models.get_quote_source()
    code_list = _parse_codes(codes)
    models.set_config("last_market", market)

    meta = models.get_market_meta(market)
    # 全表读用于判断是否有缓存 / 是否需同步；再按 codes 过滤返回
    all_items = models.read_snapshot(market)
    items = models.read_snapshot(market, codes=code_list) if code_list else all_items
    now = time.time()
    as_of = float(meta["snapshot_as_of"]) if meta and meta.get("snapshot_as_of") else None
    synced_at = float(meta["snapshot_synced_at"]) if meta and meta.get("snapshot_synced_at") else None
    age = (now - as_of) if as_of is not None else None
    stale = is_stale(age, active_mode, market)
    syncing = is_syncing(market)
    source = (meta or {}).get("source")

    # local：不入队；network：视为更积极同步（force 语义）
    allow_net = quote_source != "local"
    need_sync = False
    if allow_net:
        if quote_source == "network":
            need_sync = bool(force) or (not all_items) or should_auto_sync(active_mode)
        else:
            need_sync = bool(force) or (not all_items) or (stale and should_auto_sync(active_mode))

    # 无缓存：后台拉，短等首批（渐进落库），避免阻塞数十秒
    if not all_items:
        if allow_net and not is_syncing(market):
            enqueue(market, force=True, priority=0)
        if allow_net:
            deadline = time.time() + 8.0
            while time.time() < deadline:
                all_items = models.read_snapshot(market)
                if all_items:
                    break
                if not is_syncing(market):
                    break
                time.sleep(0.35)
        items = models.read_snapshot(market, codes=code_list) if code_list else all_items
        meta = models.get_market_meta(market)
        as_of = float(meta["snapshot_as_of"]) if meta and meta.get("snapshot_as_of") else None
        synced_at = float(meta["snapshot_synced_at"]) if meta and meta.get("snapshot_synced_at") else None
        age = (time.time() - as_of) if as_of is not None else None
        stale = True
        syncing = is_syncing(market) or (meta or {}).get("sync_state") == "running"
        source = (meta or {}).get("source")
        if not all_items and not syncing:
            if quote_source == "local":
                return JSONResponse(
                    {
                        "ok": True,
                        "market": market,
                        "mode": active_mode,
                        "quote_source": quote_source,
                        "as_of": None,
                        "synced_at": None,
                        "age_sec": None,
                        "ttl_sec": ttl_seconds(active_mode, market),
                        "stale": True,
                        "offline": True,
                        "syncing": False,
                        "source": None,
                        "total": 0,
                        "items": [],
                    }
                )
            err = (meta or {}).get("last_error") or "sync failed"
            return JSONResponse(
                {
                    "ok": False,
                    "error": err,
                    "market": market,
                    "offline": True,
                },
                status_code=502,
            )
    elif need_sync and not syncing and allow_net:
        if force or active_mode == "realtime" or quote_source == "network":
            enqueue(market, force=True, priority=0)
            syncing = True
            stale = True
        else:
            enqueue(market, force=False, priority=2)
            syncing = True

    return JSONResponse(
        {
            "ok": True,
            "market": market,
            "mode": active_mode,
            "quote_source": quote_source,
            "as_of": as_of,
            "synced_at": synced_at,
            "age_sec": age,
            "ttl_sec": ttl_seconds(active_mode, market),
            "stale": bool(stale),
            "offline": False,
            "syncing": bool(syncing or is_syncing(market)),
            "source": source,
            "total": len(items),
            "filtered": bool(code_list),
            "items": items,
        }
    )


@router.post("/sync")
def cache_sync(body: SyncBody) -> JSONResponse:
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    market = _market_key(body.market)
    if body.background:
        result = start_sync(market, force=bool(body.force))
        return JSONResponse(result)
    if body.force:
        result = sync_now(market, force=True)
        return JSONResponse(result, status_code=200 if result.get("ok") else 502)
    enqueue(market, force=False, priority=1)
    return JSONResponse({"ok": True, "queued": True, "market": market})


@router.post("/sync-all")
def cache_sync_all(body: SyncAllBody) -> JSONResponse:
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    result = start_sync_all(force=bool(body.force), markets=body.markets)
    return JSONResponse(result)


@router.get("/sync/progress")
def cache_sync_progress() -> JSONResponse:
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    prog = get_progress()
    return JSONResponse({"ok": True, **prog, "syncing": is_syncing()})


@router.post("/mode")
def cache_mode(body: ModeBody) -> JSONResponse:
    m = models.set_mode(body.mode)
    return JSONResponse({"ok": True, "mode": m})


@router.get("/source")
def cache_source_get() -> JSONResponse:
    return JSONResponse({"ok": True, "source": models.get_quote_source()})


@router.post("/source")
def cache_source_set(body: SourceBody) -> JSONResponse:
    s = models.set_quote_source(body.source)
    return JSONResponse({"ok": True, "source": s})


@router.post("/gc")
def cache_gc(body: GcBody | None = None) -> JSONResponse:
    """清理久未访问的 K 线缓存。"""
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    from cache.db import init_db

    init_db()
    b = body or GcBody()
    result = kline_models.gc_kline(max_age_days=b.max_age_days, max_series=b.max_series)
    return JSONResponse(result)


@router.post("/clear")
def cache_clear(body: ClearBody) -> JSONResponse:
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    market = _market_key(body.market) if body.market else None
    what = body.what if body.what in ("snapshot", "all") else "snapshot"
    models.clear_market(market, what)
    return JSONResponse({"ok": True, "market": market, "what": what})


@router.post("/upsert")
def cache_upsert(body: UpsertBody) -> JSONResponse:
    """前端补齐行情后回写 SQLite，避免期货/yf 每次重拉。"""
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)
    market = _market_key(body.market)
    rows: list[dict[str, Any]] = []
    for it in body.items or []:
        if not isinstance(it, dict):
            continue
        code = str(it.get("code") or "").strip()
        if not code:
            continue
        rows.append(
            {
                "code": code,
                "name": it.get("name") or code,
                "klineSymbol": it.get("klineSymbol") or code,
                "quoteReady": bool(it.get("quoteReady", True)),
                "price": it.get("price"),
                "change": it.get("change"),
                "changePercent": it.get("changePercent"),
                "open": it.get("open"),
                "prevClose": it.get("prevClose"),
                "high": it.get("high"),
                "low": it.get("low"),
                "volume": it.get("volume"),
                "amount": it.get("amount"),
                "turnoverRate": it.get("turnoverRate"),
                "volumeRatio": it.get("volumeRatio"),
                "amplitude": it.get("amplitude"),
                "pe": it.get("pe"),
                "pb": it.get("pb"),
                "totalMarketCap": it.get("totalMarketCap"),
                "circulatingMarketCap": it.get("circulatingMarketCap"),
            }
        )
    if not rows:
        return JSONResponse({"ok": True, "upserted": 0, "market": market})
    n = models.upsert_snapshot_rows(market, rows, source=body.source or "client")
    return JSONResponse({"ok": True, "upserted": n, "market": market})


@router.get("/kline")
def cache_kline(
    symbol: str = Query(..., description="如 usNVDA / sh600036 / yf:BTC-USD / fut:AUM"),
    period: str = Query("1d", description="1m|5m|15m|1h|1d|1w|fs"),
    force: int = Query(0, description="1=强制重拉（阻塞等待）"),
    local_first: int = Query(
        0,
        description="1=有缓存立即返回，过期时后台刷新（多面板加速）",
    ),
    cache_only: int = Query(
        0,
        description="1=只读本地 SQLite，不拉网、不后台刷新（前端「缓存模式」）",
    ),
    mode: str | None = Query(None),
) -> JSONResponse:
    """K 线本地缓存：先读盘，过期或 force 再拉源并落库。

    ``local_first=1``：只要盘上有 bars 就立刻返回，需要联网时后台刷新（对齐列表 snapshot 的 stale-while-revalidate）。
    ``cache_only=1``：仅返回已缓存 bars，无缓存则 404。
    """
    if not _ENABLED:
        return JSONResponse({"ok": False, "error": "quote cache disabled"}, status_code=503)

    try:
        norm = normalize_symbol(symbol)
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

    period_n = normalize_period(period)
    market = norm["market"]
    sym = norm["symbol"]
    active_mode = normalize_mode(mode) if mode else models.get_mode()
    quote_source = models.get_quote_source()
    only_cache = bool(cache_only)

    # 确保表存在（旧库升级）
    from cache.db import init_db

    init_db()

    kline_models.touch_access(market, sym, period_n)
    meta = kline_models.get_kline_meta(market, sym, period_n)
    bars = kline_models.read_kline_bars(market, sym, period_n)
    now = time.time()
    as_of = float(meta["as_of"]) if meta and meta.get("as_of") else None
    age = (now - as_of) if as_of is not None else None
    stale = kline_is_stale(age, active_mode, period_n, market)
    # A 股交易日白天：缓存日 K 若尚无今日棒，视为过期（新浪历史常缺未收盘日）
    if (
        not stale
        and market == "cn"
        and period_n == "1d"
        and cn_daily_bars_missing_today(bars)
    ):
        stale = True
    allow_net = (not only_cache) and quote_source != "local"
    if not allow_net:
        need_net = False
    elif quote_source == "network":
        need_net = bool(force) or (not bars) or should_auto_sync(active_mode)
    else:
        need_net = bool(force) or (not bars) or (stale and should_auto_sync(active_mode))

    from_cache = bool(bars)
    source = (meta or {}).get("source")
    name = (meta or {}).get("name") or sym
    refreshing = False

    # —— 缓存模式：只读盘，有则立即返回，无则 404 ——
    if only_cache:
        if not bars:
            return JSONResponse(
                {
                    "ok": False,
                    "error": f"本地无 K 线缓存: {symbol}/{period_n}",
                    "market": market,
                    "symbol": sym,
                },
                status_code=404,
            )
        out_bars = [
            {
                "timestamp": b["timestamp"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b.get("volume") or 0,
            }
            for b in bars
        ]
        return JSONResponse(
            {
                "ok": True,
                "market": market.upper() if market in ("cn", "hk", "us") else market,
                "symbol": norm.get("display") or sym,
                "code": sym,
                "name": name,
                "period": period_n,
                "bars": out_bars,
                "count": len(out_bars),
                "source": source,
                "from_cache": True,
                "stale": bool(stale),
                "refreshing": False,
                "mode": active_mode,
                "ttl_sec": kline_ttl_seconds(active_mode, period_n, market),
                "as_of": as_of,
                "cache_only": True,
            }
        )

    # —— 多面板加速：有缓存则先返回，联网刷新放到后台 ——
    if local_first and bars and not force:
        if need_net and allow_net:
            refreshing = _schedule_kline_bg(norm, period_n)
            stale = True
        out_bars = [
            {
                "timestamp": b["timestamp"],
                "open": b["open"],
                "high": b["high"],
                "low": b["low"],
                "close": b["close"],
                "volume": b.get("volume") or 0,
            }
            for b in bars
        ]
        return JSONResponse(
            {
                "ok": True,
                "market": market.upper() if market in ("cn", "hk", "us") else market,
                "symbol": norm.get("display") or sym,
                "code": sym,
                "name": name,
                "period": period_n,
                "bars": out_bars,
                "count": len(out_bars),
                "source": source,
                "from_cache": True,
                "stale": bool(stale),
                "refreshing": refreshing,
                "mode": active_mode,
                "ttl_sec": kline_ttl_seconds(active_mode, period_n, market),
                "as_of": as_of,
            }
        )

    if need_net:
        try:
            fresh, fetch_name, fetch_source = fetch_kline_bars(norm, period_n)
            if fresh:
                kline_models.replace_kline_bars(
                    market,
                    sym,
                    period_n,
                    fresh,
                    source=fetch_source,
                    name=fetch_name,
                )
                bars = fresh
                name = fetch_name or name
                source = fetch_source
                from_cache = False
                stale = False
                as_of = time.time()
            elif not bars:
                return JSONResponse(
                    {"ok": False, "error": f"无 K 线数据: {symbol}", "market": market, "symbol": sym},
                    status_code=404,
                )
            else:
                # 拉空但有旧缓存：继续用旧的
                stale = True
        except Exception as e:
            if not bars:
                kline_models.set_kline_error(market, sym, period_n, str(e))
                return JSONResponse(
                    {"ok": False, "error": str(e), "market": market, "symbol": sym},
                    status_code=502,
                )
            stale = True

    # 去掉内部 source 字段，保持与 index.html toBars 一致
    out_bars = [
        {
            "timestamp": b["timestamp"],
            "open": b["open"],
            "high": b["high"],
            "low": b["low"],
            "close": b["close"],
            "volume": b.get("volume") or 0,
        }
        for b in bars
    ]

    return JSONResponse(
        {
            "ok": True,
            "market": market.upper() if market in ("cn", "hk", "us") else market,
            "symbol": norm.get("display") or sym,
            "code": sym,
            "name": name,
            "period": period_n,
            "bars": out_bars,
            "count": len(out_bars),
            "source": source,
            "from_cache": from_cache,
            "stale": bool(stale),
            "refreshing": False,
            "mode": active_mode,
            "ttl_sec": kline_ttl_seconds(active_mode, period_n, market),
            "as_of": as_of,
        }
    )
