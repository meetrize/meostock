"""巨潮公告 HTTP API。"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from cache.db import init_db
from cninfo import store as cninfo_store
from cninfo.impact_rules import level_label

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
    sec = ms / 1000.0 if ms > 1e12 else float(ms)
    try:
        return datetime.fromtimestamp(sec, tz=_CST).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return ""


def _impact_public(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    level = str(row.get("final_level") or "")
    return {
        "final_level": level,
        "final_level_label": level_label(level) if level else "",
        "candidate_level": row.get("candidate_level"),
        "direction": row.get("direction"),
        "category": row.get("category"),
        "score": row.get("score"),
        "reasons": row.get("reasons") or [],
        "core_summary": row.get("core_summary") or "",
        "core_quotes": row.get("core_quotes") or [],
        "risk_flags": row.get("risk_flags") or [],
        "expected_gap_hint": row.get("expected_gap_hint") or "",
        "disclosure_stage": row.get("disclosure_stage"),
        "is_first_disclosure": bool(row.get("is_first_disclosure")),
        "confidence": row.get("confidence"),
        "judge_status": row.get("judge_status"),
        "materiality": row.get("materiality") or {},
        "thread_id": row.get("thread_id"),
    }


@router.get("/announcements")
def cninfo_announcements(
    symbol: str = Query(..., description="如 301112 / sz301112"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ensure: int = Query(
        0,
        ge=0,
        le=1,
        description="本地无数据时按需从巨潮拉该股近两年（侧栏用）",
    ),
) -> JSONResponse:
    """本地库公告列表（近两年由夜间任务维护）。"""
    init_db()
    code = _pure_code(symbol)
    if not code:
        return JSONResponse(
            {"ok": False, "error": "请提供 A 股六位代码", "error_code": "bad_symbol"},
            status_code=400,
        )
    ensured: dict[str, Any] | None = None
    total = cninfo_store.count_announcements(code)
    stock = cninfo_store.get_stock(code)
    need_ensure = bool(ensure) and offset == 0 and total == 0 and not (
        stock and int(stock.get("backfill_done") or 0)
    )
    if need_ensure:
        from cninfo.sync import ensure_stock_announcements

        ensured = ensure_stock_announcements(code)
        total = cninfo_store.count_announcements(code)

    rows = cninfo_store.list_announcements(code, limit=limit, offset=offset)
    impacts = cninfo_store.get_impacts_for_ids(
        [str(r.get("announcement_id") or "") for r in rows]
    )
    items: list[dict[str, Any]] = []
    for r in rows:
        ms = int(r.get("announce_time_ms") or 0)
        aid = str(r.get("announcement_id") or "")
        items.append(
            {
                "announcement_id": aid,
                "code": r.get("code"),
                "title": r.get("title") or "",
                "announce_time_ms": ms,
                "announce_time": _fmt_iso(ms),
                "adjunct_type": r.get("adjunct_type") or "",
                "pdf_url": r.get("pdf_url") or "",
                "impact": _impact_public(impacts.get(aid)),
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
            "ensured": ensured,
            "announcements": items,
        }
    )


@router.get("/stats")
def cninfo_stats() -> JSONResponse:
    init_db()
    return JSONResponse(
        {
            "ok": True,
            **cninfo_store.sync_stats(),
            "impact": cninfo_store.impact_stats(),
        }
    )


@router.get("/impact/list")
def impact_list(
    days: int = Query(3, ge=1, le=60),
    levels: str = Query("XL,L", description="逗号分隔 XL,L,M,S；空=按 hide_small"),
    direction: str = Query("", description="bullish|bearish|mixed|neutral"),
    code: str = Query(""),
    min_score: float | None = Query(None),
    q: str = Query(""),
    hide_small: int = Query(1, ge=0, le=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> JSONResponse:
    init_db()
    now = datetime.now(_CST)
    start = datetime(
        (now - timedelta(days=days - 1)).year,
        (now - timedelta(days=days - 1)).month,
        (now - timedelta(days=days - 1)).day,
        tzinfo=_CST,
    )
    since_ms = int(start.timestamp() * 1000)
    lvl_list = [x.strip().upper() for x in levels.split(",") if x.strip()] if levels.strip() else None
    items, total = cninfo_store.list_impacts(
        since_ms=since_ms,
        levels=lvl_list,
        direction=direction.strip() or None,
        code=_pure_code(code) or None,
        min_score=min_score,
        q=q.strip() or None,
        limit=limit,
        offset=offset,
        hide_small=bool(hide_small) and not lvl_list,
    )
    out = []
    for it in items:
        pub = _impact_public(it) or {}
        out.append(
            {
                "announcement_id": it.get("announcement_id"),
                "code": it.get("code"),
                "stock_name": it.get("stock_name") or "",
                "title": it.get("title") or "",
                "announce_time_ms": it.get("announce_time_ms"),
                "announce_time": _fmt_iso(int(it.get("announce_time_ms") or 0)),
                "pdf_url": it.get("pdf_url") or "",
                **pub,
            }
        )
    return JSONResponse(
        {
            "ok": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "since_ms": since_ms,
            "items": out,
        }
    )


@router.get("/impact/{announcement_id}")
def impact_detail(announcement_id: str) -> JSONResponse:
    init_db()
    impact = cninfo_store.get_impact(announcement_id)
    if not impact:
        return JSONResponse(
            {"ok": False, "error": "未找到评估结果", "error_code": "not_found"},
            status_code=404,
        )
    ann = cninfo_store.get_announcement(announcement_id)
    stock = cninfo_store.get_stock(str(impact.get("code") or ""))
    pub = _impact_public(impact) or {}
    return JSONResponse(
        {
            "ok": True,
            "item": {
                "announcement_id": announcement_id,
                "code": impact.get("code"),
                "stock_name": (stock or {}).get("name") or "",
                "title": impact.get("title") or (ann or {}).get("title") or "",
                "announce_time_ms": impact.get("announce_time_ms"),
                "announce_time": _fmt_iso(int(impact.get("announce_time_ms") or 0)),
                "pdf_url": (ann or {}).get("pdf_url") or "",
                "matched_rules": impact.get("matched_rules") or [],
                "judge_status": impact.get("judge_status"),
                "pdf_extract_status": impact.get("pdf_extract_status"),
                "error": impact.get("error"),
                **pub,
            },
        }
    )


@router.post("/impact/rejudge")
def impact_rejudge(
    announcement_id: str = Query(..., description="公告 ID"),
    use_llm: int = Query(1, ge=0, le=1),
) -> JSONResponse:
    init_db()
    ann = cninfo_store.get_announcement(announcement_id)
    if not ann:
        return JSONResponse(
            {"ok": False, "error": "公告不存在", "error_code": "not_found"},
            status_code=404,
        )
    from cninfo.impact_sync import process_one

    try:
        result = process_one(ann, use_llm=bool(use_llm), force_pdf=True)
        return JSONResponse({"ok": True, **result})
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": str(e)},
            status_code=500,
        )
