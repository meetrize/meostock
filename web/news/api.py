"""按标的资讯时间线：反代 feedgen `/api/finance/articles-by-instrument`。"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/news", tags=["news"])
_log = logging.getLogger("news-proxy")

FEEDGEN_BASE_URL = os.environ.get("FEEDGEN_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
FEEDGEN_SERVICE_TOKEN = os.environ.get("FEEDGEN_SERVICE_TOKEN", "").strip()
_TIMEOUT_SEC = float(os.environ.get("FEEDGEN_NEWS_TIMEOUT", "12") or 12)


def _proxy_get(path: str, params: dict[str, str]) -> tuple[int, dict[str, Any]]:
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None and v != ""})
    url = f"{FEEDGEN_BASE_URL}{path}"
    if qs:
        url = f"{url}?{qs}"

    headers = {"Accept": "application/json"}
    if FEEDGEN_SERVICE_TOKEN:
        headers["Authorization"] = f"Bearer {FEEDGEN_SERVICE_TOKEN}"
        headers["X-Service-Token"] = FEEDGEN_SERVICE_TOKEN

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SEC) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else {}
            return int(resp.status), data if isinstance(data, dict) else {"ok": True, "raw": data}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            payload = json.loads(raw) if raw else {"error": e.reason}
        except json.JSONDecodeError:
            payload = {"error": raw or str(e.reason)}
        return int(e.code), payload if isinstance(payload, dict) else {"error": str(payload)}
    except Exception as e:  # noqa: BLE001
        _log.warning("feedgen proxy failed: %s", e)
        return 502, {"error": f"feedgen 不可达: {e}", "feedgen_base": FEEDGEN_BASE_URL}


@router.get("/by-symbol")
def news_by_symbol(
    symbol: str = Query(..., description="meostock klineSymbol / feedgen chart_symbol"),
    cursor: str | None = Query(None),
    limit: int = Query(20, ge=1, le=50),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> JSONResponse:
    """同源反代：dashboard 资讯时间线用。"""
    sym = (symbol or "").strip()
    if not sym:
        return JSONResponse({"error": "缺少 symbol"}, status_code=400)

    if not FEEDGEN_SERVICE_TOKEN:
        return JSONResponse(
            {
                "error": "未配置 FEEDGEN_SERVICE_TOKEN，无法拉取资讯",
                "hint": "在 meostock 与 feedgen 两端设置相同的 FEEDGEN_SERVICE_TOKEN",
            },
            status_code=503,
        )

    status, data = _proxy_get(
        "/api/finance/articles-by-instrument",
        {
            "chart_symbol": sym,
            "cursor": cursor or "",
            "limit": str(limit),
            "from": from_ or "",
            "to": to or "",
        },
    )
    if status >= 400:
        return JSONResponse(data if isinstance(data, dict) else {"error": "upstream error"}, status_code=status)
    return JSONResponse(data)
