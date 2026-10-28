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
from tsrelay.markets import fetch_market, resolve_trade_date
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
    info = resolve_trade_date()
    return str(info.get("trade_date") or "")


def _serve_cached(market_id: str, trade_date: str | None, *, force: bool) -> dict[str, Any] | None:
    store.ensure_schema()
    td_key = _trade_key(market_id, trade_date)
    if not td_key:
        return None
    snap = store.get_snapshot(market_id, td_key)
    if not snap:
        return None
    quote_source = cache_models.get_quote_source()
    # local / auto：有切片即返回；network 或 force：返回但仍可后台刷
    out = {
        "ok": True,
        "id": market_id,
        "label": snap.get("label"),
        "table": snap.get("table"),
        "columns": snap.get("columns"),
        "items": snap.get("items"),
        "total": snap.get("total"),
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

    # 1) 读缓存
    cached = _serve_cached(id, trade_date, force=force_b)
    if cached and quote_source == "local":
        return JSONResponse(cached)
    if cached and not force_b and quote_source == "auto":
        return JSONResponse(cached)

    # 2) local 且无缓存
    if quote_source == "local":
        return JSONResponse(
            {
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
        )

    if not get_client().configured():
        if cached:
            return JSONResponse({**cached, "stale": True})
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
        start_worker()
        start_sync(id, trade_date=trade_date, force=True)
        return JSONResponse({**cached, "syncing": True, "stale": True})

    # 4) 无缓存：同步拉取并落库（首屏需要数据；后续靠缓存）
    try:
        live = _pull_and_store(id, trade_date)
    except Exception as e:  # noqa: BLE001
        _log.exception("market live %s", id)
        return JSONResponse(
            {"ok": False, "id": id, "error": str(e), "items": [], "error_code": "exception"},
            status_code=502,
        )
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
