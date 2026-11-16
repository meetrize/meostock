"""宏观利率 HTTP API。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from macro.rates import build_macro_rates

router = APIRouter(prefix="/api/macro", tags=["macro"])
_log = logging.getLogger("macro-rates")


@router.get("/rates")
def macro_rates(force: int = Query(0, description="1=绕过短缓存强制刷新")):
    try:
        payload = build_macro_rates(force=bool(force))
        status = 200 if payload.get("ok") else 502
        return JSONResponse(payload, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("macro rates failed")
        return JSONResponse(
            {"ok": False, "error": str(exc), "series": []},
            status_code=502,
        )
