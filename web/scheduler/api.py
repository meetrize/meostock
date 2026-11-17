"""定时任务 HTTP API。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cache.db import init_db
from scheduler import jobs as jobs_mod
from scheduler import runner as runner_mod
from scheduler.ths_concept_sync import get_progress as ths_progress

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


class JobUpdateBody(BaseModel):
    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=10080)


@router.get("/status")
def scheduler_status() -> JSONResponse:
    init_db()
    jobs_mod.ensure_default_jobs()
    return JSONResponse({"ok": True, **runner_mod.runtime_status()})


@router.get("/jobs")
def scheduler_jobs() -> JSONResponse:
    init_db()
    return JSONResponse({"ok": True, "jobs": jobs_mod.list_jobs()})


@router.get("/jobs/{job_id}")
def scheduler_job(job_id: str) -> JSONResponse:
    init_db()
    job = jobs_mod.get_job(job_id)
    if not job:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    return JSONResponse({"ok": True, "job": job})


@router.patch("/jobs/{job_id}")
def scheduler_job_update(job_id: str, body: JobUpdateBody) -> JSONResponse:
    init_db()
    job = jobs_mod.update_job(
        job_id,
        enabled=body.enabled,
        interval_minutes=body.interval_minutes,
    )
    if not job:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    return JSONResponse({"ok": True, "job": job})


@router.post("/jobs/{job_id}/run")
def scheduler_job_run(job_id: str) -> JSONResponse:
    init_db()
    if not jobs_mod.get_job(job_id):
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    result = runner_mod.run_job_async(job_id)
    status = 200 if result.get("ok") else 409
    return JSONResponse(result, status_code=status)


@router.get("/runs")
def scheduler_runs(
    job_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> JSONResponse:
    init_db()
    return JSONResponse(
        {"ok": True, "runs": jobs_mod.list_recent_runs(job_id=job_id, limit=limit)}
    )


@router.get("/ths-concept/progress")
def ths_concept_progress() -> JSONResponse:
    return JSONResponse({"ok": True, **ths_progress()})
