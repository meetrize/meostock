"""Tushare 网关 HTTP API（含本地缓存读写与后台同步）。"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cache import models as cache_models
from tsrelay import store
from tsrelay.catalog import MARKET_SPECS, catalog_payload, find_nav_leaf
from tsrelay.client import get_client
from tsrelay.live_limit import fetch_live_limit, shanghai_ymd, use_live_limit_now
from tsrelay.markets import (
    enrich_limit_down_first_times,
    fetch_market,
    market_prefer_today,
    resolve_trade_date,
)
from tsrelay.scheduler import set_enabled as schedule_set_enabled
from tsrelay.scheduler import start_scheduler, status as schedule_status
from tsrelay.sync_worker import (
    get_progress,
    is_syncing,
    start_sync,
    start_sync_all,
    start_worker,
)
from tsrelay.sync_worker import _pull_and_store  # noqa: SLF001 — 强制刷新复用

router = APIRouter(prefix="/api/tushare", tags=["tushare"])
_log = logging.getLogger("tushare-gateway")

_ENABLED = os.environ.get("TUSHARE_ENABLED", "1").strip() not in ("0", "false", "False")


def _disabled() -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": "Tushare 网关已关闭 (TUSHARE_ENABLED=0)", "error_code": "disabled"},
        status_code=503,
    )


def _limit_calendar() -> dict[str, Any]:
    return resolve_trade_date(prefer_today=True)


def _limit_live_response(*, force: bool = False, trade_date: str | None = None) -> dict[str, Any]:
    td = (trade_date or shanghai_ymd()).strip()
    return fetch_live_limit(td, force=force)


def _maybe_live_limit_fallback(
    market_id: str,
    payload: dict[str, Any] | None,
    *,
    force: bool = False,
) -> dict[str, Any] | None:
    """收盘后 Tushare 当日仍空时，回退选股宝当日实时池（不回昨天）。"""
    if market_id != "ts:limit" or not payload:
        return None
    if payload.get("items"):
        return None
    cal = _limit_calendar()
    last_open = str(cal.get("last_open") or "")
    today = shanghai_ymd()
    if not last_open or last_open != today:
        return None
    live = _limit_live_response(force=force, trade_date=today)
    if live.get("ok") and (live.get("items") or []):
        return live
    return None


class SyncBody(BaseModel):
    market_id: str
    trade_date: str | None = None
    force: bool = True
    background: bool = True


class SyncAllBody(BaseModel):
    trade_date: str | None = None
    force: bool = True


class ScheduleBody(BaseModel):
    enabled: bool = Field(..., description="是否启用定时同步")


class ClearBody(BaseModel):
    what: str = "all"


def _trade_key(market_id: str, trade_date: str | None) -> str:
    if market_id in ("ts:opt", "ts:ths"):
        return store.CATALOG_TRADE_DATE
    if trade_date:
        return trade_date
    info = resolve_trade_date(prefer_today=market_prefer_today(market_id))
    return str(info.get("trade_date") or "")


def _maybe_enrich_limit_cache(
    market_id: str,
    td_key: str,
    snap: dict[str, Any],
) -> list[dict[str, Any]]:
    """缓存中的跌停若缺 firstTime，用分时补全并写回，避免每次点同步才生效。"""
    items = list(snap.get("items") or [])
    if market_id != "ts:limit" or not items:
        return items
    need = any(
        isinstance(it, dict)
        and str(it.get("limit") or "").upper() == "D"
        and not str(it.get("firstTime") or it.get("first_time") or "").strip()
        for it in items
    )
    if not need:
        return items
    td = str(snap.get("trade_date") or td_key or "")
    enriched, filled = enrich_limit_down_first_times(items, td)
    if filled:
        try:
            store.replace_snapshot(
                market_id,
                td_key,
                table_kind=str(snap.get("table") or "topic"),
                label=str(snap.get("label") or "涨跌停"),
                columns=list(snap.get("columns") or []),
                items=enriched,
                source=str(snap.get("source") or "") or None,
            )
        except Exception as e:  # noqa: BLE001
            _log.warning("limit enrich writeback failed: %s", e)
    return enriched


def _limit_cache_matches_trade_date(
    market_id: str,
    td_key: str,
    items: list[dict[str, Any]],
) -> bool:
    """涨跌停缓存须与请求交易日一致；旧缓存无行级日期时视为不可信（曾回退昨天）。"""
    if market_id != "ts:limit":
        return True
    if not items:
        return True
    saw_row_td = False
    for it in items:
        if not isinstance(it, dict):
            continue
        row_td = str(it.get("tradeDate") or it.get("trade_date") or "").strip()
        if not row_td:
            continue
        saw_row_td = True
        if row_td != td_key:
            return False
    return saw_row_td


def _serve_cached(market_id: str, trade_date: str | None, *, force: bool) -> dict[str, Any] | None:
    store.ensure_schema()
    td_key = _trade_key(market_id, trade_date)
    if not td_key:
        return None
    snap = store.get_snapshot(market_id, td_key)
    if not snap:
        return None
    quote_source = cache_models.get_quote_source()
    items = _maybe_enrich_limit_cache(market_id, td_key, snap)
    if not _limit_cache_matches_trade_date(market_id, td_key, items):
        return None
    # local / auto：有切片即返回；network 或 force：返回但仍可后台刷
    out = {
        "ok": True,
        "id": market_id,
        "label": snap.get("label"),
        "table": snap.get("table"),
        "columns": snap.get("columns"),
        "items": items,
        "total": len(items) if items else snap.get("total"),
        "trade_date": snap.get("trade_date") if snap.get("trade_date") != store.CATALOG_TRADE_DATE else trade_date,
        "source": snap.get("source"),
        "cached": True,
        "stale": bool(force or quote_source == "network"),
        "synced_at": snap.get("synced_at"),
        "as_of": snap.get("as_of"),
        "syncing": is_syncing(),
    }
    return out


@router.get("/health")
def health() -> dict:
    if not _ENABLED:
        return {"ok": False, "enabled": False, "configured": False}
    client = get_client()
    ping = client.health_ping()
    primary_ok = bool((ping.get("primary") or {}).get("ok"))
    secondary_ok = bool((ping.get("secondary") or {}).get("ok"))
    return {
        "ok": ping["configured"] and (primary_ok or secondary_ok),
        "enabled": True,
        "schedule": schedule_status(),
        **ping,
    }


@router.get("/catalog", response_model=None)
def catalog():
    if not _ENABLED:
        return _disabled()
    return {"ok": True, **catalog_payload()}


@router.get("/trade-date", response_model=None)
def trade_date(date: str | None = Query(None, description="YYYYMMDD 可选偏好日")):
    if not _ENABLED:
        return _disabled()
    if not get_client().configured():
        return {
            "ok": False,
            "error": "TUSHARE_TOKEN 未配置",
            "error_code": "not_configured",
            "trade_date": None,
        }
    info = resolve_trade_date(date)
    return {"ok": info.get("ok", False), **info}


@router.get("/market", response_model=None)
def market(
    id: str = Query(..., description="行情节点 id，如 ts:limit"),
    trade_date: str | None = Query(None, description="YYYYMMDD"),
    force: int = Query(0, description="1=强制刷新"),
):
    if not _ENABLED:
        return _disabled()

    leaf = find_nav_leaf(id)
    if leaf and leaf.get("kind") == "placeholder":
        return {
            "ok": True,
            "placeholder": True,
            "id": id,
            "label": leaf.get("label"),
            "hint": leaf.get("hint") or "一期占位",
            "table": "topic",
            "columns": [],
            "items": [],
            "total": 0,
            "trade_date": trade_date,
        }
    if leaf and leaf.get("kind") == "legacy":
        return JSONResponse(
            {
                "ok": False,
                "error": f"{id} 为本地 cache/sdk 市场，请走 /api/cache/snapshot",
                "error_code": "legacy_market",
            },
            status_code=400,
        )

    quote_source = cache_models.get_quote_source()
    force_b = bool(force)

    # 涨跌停：盘中强制选股宝实时池（不读会被空表污染的 Tushare 当日缓存）
    if id == "ts:limit":
        cal = _limit_calendar()
        if use_live_limit_now(last_open=str(cal.get("last_open") or "")):
            live_lim = _limit_live_response(
                force=force_b,
                trade_date=trade_date or str(cal.get("trade_date") or shanghai_ymd()),
            )
            status = 200 if live_lim.get("ok") else 502
            return JSONResponse(live_lim, status_code=status)

    # 1) 读缓存
    cached = _serve_cached(id, trade_date, force=force_b)
    if cached and quote_source == "local":
        fb = _maybe_live_limit_fallback(id, cached, force=force_b)
        return JSONResponse(fb or cached)
    if cached and not force_b and quote_source == "auto":
        # 涨跌停等盘中专题：缓存超过 5 分钟或空表时后台重拉，避免一直停在「当日尚无/旧切片」
        if market_prefer_today(id) and get_client().configured():
            synced_at = float(cached.get("synced_at") or 0)
            age = time.time() - synced_at if synced_at else 1e9
            empty = not (cached.get("items") or [])
            if empty:
                fb = _maybe_live_limit_fallback(id, cached, force=force_b)
                if fb:
                    return JSONResponse(fb)
            if age >= 300 or empty:
                start_worker()
                start_sync(id, trade_date=trade_date, force=True)
                return JSONResponse({**cached, "syncing": True, "stale": True})
        return JSONResponse(cached)

    # 2) local 且无缓存
    if quote_source == "local":
        empty_local = {
            "ok": True,
            "id": id,
            "items": [],
            "total": 0,
            "columns": (MARKET_SPECS.get(id) or {}).get("columns") or [],
            "table": (MARKET_SPECS.get(id) or {}).get("table") or "topic",
            "label": (MARKET_SPECS.get(id) or {}).get("label") or id,
            "cached": False,
            "error": None,
            "hint": "本地无缓存，请切换自动/网络或点击同步",
            "trade_date": trade_date,
        }
        fb = _maybe_live_limit_fallback(id, empty_local, force=force_b)
        return JSONResponse(fb or empty_local)

    if not get_client().configured():
        if cached:
            fb = _maybe_live_limit_fallback(id, cached, force=force_b)
            return JSONResponse(fb or {**cached, "stale": True})
        # Token 未配时涨跌停仍可走实时池
        if id == "ts:limit":
            live_lim = _limit_live_response(force=force_b, trade_date=trade_date)
            if live_lim.get("ok") and (live_lim.get("items") or []):
                return JSONResponse(live_lim)
        return JSONResponse(
            {
                "ok": False,
                "error": "TUSHARE_TOKEN 未配置。请在项目根目录 .env 设置后重启服务。",
                "error_code": "not_configured",
                "items": [],
            },
            status_code=503,
        )

    # 3) 有缓存但 network/force：先返回缓存，后台刷新
    if cached and (force_b or quote_source == "network"):
        if not (cached.get("items") or []):
            fb = _maybe_live_limit_fallback(id, cached, force=force_b)
            if fb:
                return JSONResponse(fb)
        start_worker()
        start_sync(id, trade_date=trade_date, force=True)
        return JSONResponse({**cached, "syncing": True, "stale": True})

    # 4) 无缓存：同步拉取并落库（首屏需要数据；后续靠缓存）
    try:
        live = _pull_and_store(id, trade_date)
    except Exception as e:  # noqa: BLE001
        _log.exception("market live %s", id)
        if id == "ts:limit":
            fb = _maybe_live_limit_fallback(
                id,
                {"ok": False, "items": [], "trade_date": trade_date},
                force=True,
            )
            if fb:
                return JSONResponse(fb)
        return JSONResponse(
            {"ok": False, "id": id, "error": str(e), "items": [], "error_code": "exception"},
            status_code=502,
        )
    if not (live.get("items") or []):
        fb = _maybe_live_limit_fallback(id, live, force=force_b)
        if fb:
            return JSONResponse(fb)
    status = 200 if live.get("ok") else 502
    return JSONResponse(
        {
            **live,
            "id": id,
            "cached": False,
            "synced_at": time.time(),
            "syncing": False,
        },
        status_code=status,
    )


@router.get("/status", response_model=None)
def ts_status():
    if not _ENABLED:
        return _disabled()
    store.ensure_schema()
    return {
        "ok": True,
        "configured": get_client().configured(),
        "syncing": is_syncing(),
        "markets": store.list_meta(),
        "schedule": schedule_status(),
        "quote_source": cache_models.get_quote_source(),
        "mode": cache_models.get_mode(),
    }


@router.post("/sync", response_model=None)
def ts_sync(body: SyncBody):
    if not _ENABLED:
        return _disabled()
    if not get_client().configured():
        return JSONResponse(
            {"ok": False, "error": "TUSHARE_TOKEN 未配置", "error_code": "not_configured"},
            status_code=503,
        )
    if body.market_id.startswith("ts:ph:"):
        return {"ok": False, "error": "占位节点不同步"}
    if body.background:
        return start_sync(body.market_id, trade_date=body.trade_date, force=body.force)
    live = _pull_and_store(body.market_id, body.trade_date)
    return live


@router.post("/sync-all", response_model=None)
def ts_sync_all(body: SyncAllBody | None = None):
    if not _ENABLED:
        return _disabled()
    if not get_client().configured():
        return JSONResponse(
            {"ok": False, "error": "TUSHARE_TOKEN 未配置", "error_code": "not_configured"},
            status_code=503,
        )
    b = body or SyncAllBody()
    return start_sync_all(trade_date=b.trade_date, force=b.force)


@router.get("/sync/progress", response_model=None)
def ts_sync_progress():
    if not _ENABLED:
        return _disabled()
    prog = get_progress()
    return {"ok": True, **prog, "syncing": is_syncing()}


@router.get("/schedule", response_model=None)
def ts_schedule_get():
    return {"ok": True, **schedule_status()}


@router.post("/schedule", response_model=None)
def ts_schedule_set(body: ScheduleBody):
    schedule_set_enabled(bool(body.enabled))
    if body.enabled:
        start_scheduler()
    return {"ok": True, **schedule_status()}


@router.post("/cache/clear", response_model=None)
def ts_cache_clear(body: ClearBody | None = None):
    store.ensure_schema()
    store.clear_all()
    return {"ok": True, "cleared": True}
