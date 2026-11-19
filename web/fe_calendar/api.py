"""财经日历 HTTP API。"""

from __future__ import annotations

import logging
import threading
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ai import config as ai_config
from fe_calendar.ai_rate import get_rate_progress, list_unrated_events, run_ai_importance_rating
from fe_calendar.parse import parse_calendar_text
from fe_calendar.store import facets, list_events, sync_status
from fe_calendar.write import create_manual_events, preview_duplicates
from scheduler.finance_calendar_sync import get_progress

router = APIRouter(prefix="/api/calendar", tags=["calendar"])
_log = logging.getLogger("fe-calendar-api")

_rate_lock = threading.Lock()
_rate_thread: threading.Thread | None = None

_HINT_AI = "在设置 → AI 模型 中添加配置并设为使用中"


class ParseBody(BaseModel):
    text: str = Field(..., min_length=1)


class CreateEventItem(BaseModel):
    name: str
    start_at: str
    end_at: str | None = None
    std_type_code: str | None = "3"
    fe_type: str | None = None
    sponsor: str | None = None
    city: str | None = None
    summary: str | None = None
    force: bool | None = None


class CreateBody(BaseModel):
    events: list[CreateEventItem] = Field(default_factory=list)
    source_excerpt: str | None = None
    force: bool = False


@router.get("/events")
def calendar_events(
    from_: str | None = Query(None, alias="from", description="开始日 YYYY-MM-DD"),
    to: str | None = Query(None, description="结束日 YYYY-MM-DD"),
    std_type: str | None = Query(None, description="1|2|3"),
    fe_type: str | None = Query(None),
    city: str | None = Query(None),
    q: str | None = Query(None),
    importance: str | None = Query(
        None, description="unrated | 1..5（≥N 星）"
    ),
    source: str | None = Query(None, description="eastmoney|feedgen|manual"),
    limit: int = Query(200, ge=1, le=1000),
):
    try:
        items = list_events(
            from_day=from_,
            to_day=to,
            std_type=std_type,
            fe_type=fe_type,
            city=city,
            q=q,
            importance=importance,
            source=source,
            limit=limit,
        )
        return JSONResponse({"ok": True, "items": items, "count": len(items)})
    except Exception as exc:  # noqa: BLE001
        _log.exception("calendar events failed")
        return JSONResponse({"ok": False, "error": str(exc), "items": []}, status_code=502)


@router.get("/facets")
def calendar_facets(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
):
    try:
        data = facets(from_day=from_, to_day=to)
        return JSONResponse({"ok": True, **data})
    except Exception as exc:  # noqa: BLE001
        _log.exception("calendar facets failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/sync/status")
def calendar_sync_status():
    try:
        return JSONResponse({"ok": True, **sync_status(), "progress": get_progress()})
    except Exception as exc:  # noqa: BLE001
        _log.exception("calendar sync status failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/parse")
def calendar_parse(body: ParseBody):
    """粘贴文本 → AI 抽取未来日程（不写库）。"""
    if not ai_config.is_configured():
        return JSONResponse(
            {"ok": False, "error": "未配置 AI 模型", "hint": _HINT_AI},
            status_code=503,
        )
    try:
        data = parse_calendar_text(body.text)
        events = preview_duplicates(data["events"])
        return JSONResponse(
            {
                "ok": True,
                "events": events,
                "count": len(events),
                "model": data.get("model"),
                "provider": data.get("provider"),
                "truncated": data.get("truncated"),
            }
        )
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("calendar parse failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/events")
def calendar_create(body: CreateBody):
    """确认添加手动日程（含语义去重）。"""
    if not body.events:
        return JSONResponse({"ok": False, "error": "events 为空"}, status_code=400)
    try:
        payload: list[dict[str, Any]] = []
        for e in body.events:
            payload.append(
                {
                    "name": e.name,
                    "start_at": e.start_at,
                    "end_at": e.end_at,
                    "std_type_code": e.std_type_code or "3",
                    "fe_type": e.fe_type or "",
                    "sponsor": e.sponsor or "",
                    "city": e.city or "",
                    "summary": e.summary or "",
                }
            )
        for i, e in enumerate(body.events):
            if e.force:
                payload[i]["force"] = True
        result = create_manual_events(
            payload,
            source_excerpt=(body.source_excerpt or "")[:800],
            force=bool(body.force),
        )
        return JSONResponse(
            {
                "ok": True,
                **result,
                "message": (
                    f"新建 {result['inserted']}，合并 {result['merged']}，"
                    f"更新 {result['updated']}，跳过 {result['skipped']}"
                ),
            }
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("calendar create failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/ai-rate/progress")
def calendar_ai_rate_progress():
    return JSONResponse({"ok": True, **get_rate_progress()})


@router.get("/ai-rate/pending")
def calendar_ai_rate_pending():
    items = list_unrated_events(limit=5000)
    return JSONResponse(
        {
            "ok": True,
            "pending": len(items),
            "configured": ai_config.is_configured(),
        }
    )


@router.post("/ai-rate")
def calendar_ai_rate():
    """异步启动 AI 重要性批量评级（跳过已有 importance 的事件）。"""
    if not ai_config.is_configured():
        return JSONResponse(
            {
                "ok": False,
                "error": "未配置 AI 模型",
                "hint": "在设置 → AI 模型 中添加配置并设为使用中",
            },
            status_code=503,
        )

    global _rate_thread
    if not _rate_lock.acquire(blocking=False):
        return JSONResponse(
            {"ok": False, "error": "busy", "progress": get_rate_progress()},
            status_code=409,
        )

    prog = get_rate_progress()
    if prog.get("active"):
        _rate_lock.release()
        return JSONResponse(
            {"ok": False, "error": "busy", "progress": prog},
            status_code=409,
        )

    pending = list_unrated_events(limit=5000)
    if not pending:
        _rate_lock.release()
        return JSONResponse(
            {
                "ok": True,
                "started": False,
                "pending": 0,
                "message": "没有需要评级的事件",
            }
        )

    def _run() -> None:
        global _rate_thread
        try:
            run_ai_importance_rating()
        except Exception:  # noqa: BLE001
            _log.exception("ai importance rating failed")
        finally:
            _rate_thread = None
            try:
                _rate_lock.release()
            except RuntimeError:
                pass

    _rate_thread = threading.Thread(target=_run, name="cal-ai-rate", daemon=True)
    _rate_thread.start()
    return JSONResponse(
        {
            "ok": True,
            "started": True,
            "pending": len(pending),
            "message": f"已启动 AI 评级，待处理 {len(pending)} 条",
        }
    )
