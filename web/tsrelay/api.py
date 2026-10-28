"""Tushare 网关 HTTP API。"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from tsrelay.catalog import catalog_payload, find_nav_leaf
from tsrelay.client import get_client
from tsrelay.markets import fetch_market, resolve_trade_date

router = APIRouter(prefix="/api/tushare", tags=["tushare"])
_log = logging.getLogger("tushare-gateway")

_ENABLED = os.environ.get("TUSHARE_ENABLED", "1").strip() not in ("0", "false", "False")


def _disabled() -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": "Tushare 网关已关闭 (TUSHARE_ENABLED=0)", "error_code": "disabled"},
        status_code=503,
    )


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
):
    if not _ENABLED:
        return _disabled()
    if not get_client().configured():
        return JSONResponse(
            {
                "ok": False,
                "error": "TUSHARE_TOKEN 未配置。请在项目根目录 .env 设置后重启服务。",
                "error_code": "not_configured",
                "items": [],
            },
            status_code=503,
        )

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

    result = fetch_market(id, trade_date)
    status = 200 if result.get("ok") else 502
    if result.get("error_code") in ("not_configured", "unknown_market"):
        status = 400 if result.get("error_code") == "unknown_market" else 503
    return JSONResponse({**result, "id": id}, status_code=status if not result.get("ok") else 200)
