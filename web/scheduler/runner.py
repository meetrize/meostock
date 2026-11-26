"""定时任务调度循环。"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from scheduler import jobs as jobs_mod
from scheduler.em_board_sync import get_progress as em_progress
from scheduler.em_board_sync import run_em_board_sync
from scheduler.finance_calendar_sync import get_progress as cal_progress
from scheduler.finance_calendar_sync import run_finance_calendar_sync
from scheduler.ths_concept_sync import get_progress as ths_progress
from scheduler.ths_concept_sync import run_ths_concept_sync

_log = logging.getLogger("scheduler.runner")

_stop = threading.Event()
_thread: threading.Thread | None = None
_run_lock = threading.Lock()
_running_job_id: str | None = None


def _register_handlers() -> None:
    def ths_handler() -> dict[str, Any]:
        # 阻塞执行，便于写回完整结果
        return run_ths_concept_sync(delay=0.05, workers=6)

    def em_handler() -> dict[str, Any]:
        return run_em_board_sync(delay=0.05, workers=6)

    def cal_handler() -> dict[str, Any]:
        return run_finance_calendar_sync(page_delay=0.12)

    def cninfo_ann_handler() -> dict[str, Any]:
        from cninfo.sync import run_cninfo_announcement_sync

        return run_cninfo_announcement_sync(mode="auto", page_delay=0.2)

    def zt_eod_handler() -> dict[str, Any]:
        from zt_history.capture import capture_eod

        return capture_eod(force=False)

    def cn_daily_eod_handler() -> dict[str, Any]:
        from scheduler.cn_daily_eod_patch import run_cn_daily_eod_patch

        return run_cn_daily_eod_patch(force_snapshot=True, skip_non_trade_day=True)

    def _portal_eod(lane: str):
        def _handler() -> dict[str, Any]:
            from scheduler.portal_kline_eod import run_portal_kline_eod

            return run_portal_kline_eod(lane, force=True, skip_non_trade_day=True)

        return _handler

    jobs_mod.register_handler("ths_concept_sync", ths_handler)
    jobs_mod.register_handler("em_board_sync", em_handler)
    jobs_mod.register_handler("finance_calendar_sync", cal_handler)
    jobs_mod.register_handler("cninfo_announcement_sync", cninfo_ann_handler)
    jobs_mod.register_handler("zt_pool_eod_snapshot", zt_eod_handler)
    jobs_mod.register_handler("cn_daily_eod_patch", cn_daily_eod_handler)
    for _lane in ("cn", "asia", "eu", "us", "crypto"):
        jobs_mod.register_handler(f"portal_kline_eod_{_lane}", _portal_eod(_lane))


def _tick() -> None:
    global _running_job_id
    if not _run_lock.acquire(blocking=False):
        return
    try:
        due = jobs_mod.due_jobs()
        if not due:
            return
        job = due[0]
        job_id = str(job["id"])
        _running_job_id = job_id
        _log.info("scheduler run job %s", job_id)
        jobs_mod.run_job(job_id, trigger="schedule")
    finally:
        _running_job_id = None
        _run_lock.release()


def _loop() -> None:
    jobs_mod.ensure_default_jobs()
    _register_handlers()
    while not _stop.is_set():
        try:
            _tick()
        except Exception:  # noqa: BLE001
            _log.exception("scheduler tick failed")
        _stop.wait(20.0)


def start_scheduler() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="job-scheduler", daemon=True)
    _thread.start()
    _log.info("job scheduler started")


def stop_scheduler() -> None:
    _stop.set()


def run_job_async(job_id: str) -> dict[str, Any]:
    """手动触发：后台线程执行。"""
    _register_handlers()
    if not _run_lock.acquire(blocking=False):
        return {
            "ok": False,
            "error": f"busy:{_running_job_id or 'unknown'}",
            "running": _running_job_id,
        }

    def _run() -> None:
        global _running_job_id
        try:
            _running_job_id = job_id
            jobs_mod.run_job(job_id, trigger="manual")
        finally:
            _running_job_id = None
            _run_lock.release()

    threading.Thread(target=_run, name=f"job-{job_id}", daemon=True).start()
    return {"ok": True, "started": True, "job_id": job_id}


def runtime_status() -> dict[str, Any]:
    return {
        "scheduler_alive": bool(_thread and _thread.is_alive()),
        "running_job_id": _running_job_id,
        "ths_concept_sync": ths_progress(),
        "em_board_sync": em_progress(),
        "finance_calendar_sync": cal_progress(),
    }
