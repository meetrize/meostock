"""巨潮公告 HTTP API。"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from cache.db import init_db
from cninfo import store as cninfo_store

router = APIRouter(prefix="/api/cninfo", tags=["cninfo"])

_CST = timezone(timedelta(hours=8))


def _pure_code(symbol: str) -> str:
    s = str(symbol or "").strip()
    if not s:
        return ""
    bare = s
    for p in ("sh", "sz", "bj", "SH", "SZ", "BJ"):
        if bare.startswith(p):
            bare = bare[len(p) :]
            break
    digits = "".join(ch for ch in bare if ch.isdigit())
    return digits[-6:] if len(digits) >= 6 else ""


def _fmt_iso(ms: int) -> str:
    if not ms or ms <= 0:
        return ""
    # 巨潮为毫秒；兜底秒
    sec = ms / 1000.0 if ms > 1e12 else float(ms)
    try:
        return datetime.fromtimestamp(sec, tz=_CST).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return ""


@router.get("/announcements")
def cninfo_announcements(
    symbol: str = Query(..., description="如 301112 / sz301112"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> JSONResponse:
    """本地库公告列表（近两年由夜间任务维护）。"""
    init_db()
    code = _pure_code(symbol)
    if not code:
        return JSONResponse(
            {"ok": False, "error": "请提供 A 股六位代码", "error_code": "bad_symbol"},
            status_code=400,
        )
    rows = cninfo_store.list_announcements(code, limit=limit, offset=offset)
    total = cninfo_store.count_announcements(code)
    items: list[dict[str, Any]] = []
    for r in rows:
        ms = int(r.get("announce_time_ms") or 0)
        items.append(
            {
                "announcement_id": r.get("announcement_id"),
                "code": r.get("code"),
                "title": r.get("title") or "",
                "announce_time_ms": ms,
                "announce_time": _fmt_iso(ms),
                "adjunct_type": r.get("adjunct_type") or "",
                "pdf_url": r.get("pdf_url") or "",
            }
        )
    return JSONResponse(
        {
            "ok": True,
            "source": "cninfo",
            "symbol": symbol,
            "code": code,
            "total": total,
            "limit": limit,
            "offset": offset,
            "announcements": items,
        }
    )


@router.get("/stats")
def cninfo_stats() -> JSONResponse:
    init_db()
    return JSONResponse({"ok": True, **cninfo_store.sync_stats()})
