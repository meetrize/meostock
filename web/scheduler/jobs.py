"""定时任务定义与持久化。"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from cache.db import _lock, get_conn, init_db

_log = logging.getLogger("scheduler.jobs")

JobHandler = Callable[[], dict[str, Any]]

# 内置任务注册表
_HANDLERS: dict[str, JobHandler] = {}

DEFAULT_JOBS: list[dict[str, Any]] = [
    {
        "id": "ths_concept_sync",
        "name": "同花顺概念同步",
        "job_type": "ths_concept_sync",
        "enabled": 0,
        "interval_minutes": 360,
    },
    {
        "id": "em_board_sync",
        "name": "东财板块/概念同步",
        "job_type": "em_board_sync",
        "enabled": 0,
        "interval_minutes": 360,
    },
    {
        "id": "finance_calendar_sync",
        "name": "东财财经日历同步",
        "job_type": "finance_calendar_sync",
        "enabled": 1,
        "interval_minutes": 1440,
        "align_next_2am": True,
    },
    {
        "id": "zt_pool_eod_snapshot",
        "name": "涨跌停盘后快照",
        "job_type": "zt_pool_eod_snapshot",
        "enabled": 1,
        "interval_minutes": 30,
        "align_zt_eod": True,
    },
    {
        "id": "cn_daily_eod_patch",
        "name": "A股收盘日K补全",
        "job_type": "cn_daily_eod_patch",
        "enabled": 1,
        "interval_minutes": 30,
        "align_cn_kline_eod": True,
    },
    # Dashboard portal 曲线：按市场盘后分 lane 补全日 K
    {
        "id": "portal_kline_eod_cn",
        "name": "Portal日K·A股/期货",
        "job_type": "portal_kline_eod_cn",
        "enabled": 1,
        "interval_minutes": 30,
        "align_portal_kline_eod": "cn",
    },
    {
        "id": "portal_kline_eod_asia",
        "name": "Portal日K·亚太",
        "job_type": "portal_kline_eod_asia",
        "enabled": 1,
        "interval_minutes": 30,
        "align_portal_kline_eod": "asia",
    },
    {
        "id": "portal_kline_eod_eu",
        "name": "Portal日K·欧洲",
        "job_type": "portal_kline_eod_eu",
        "enabled": 1,
        "interval_minutes": 30,
        "align_portal_kline_eod": "eu",
    },
    {
        "id": "portal_kline_eod_us",
        "name": "Portal日K·美股宏观",
        "job_type": "portal_kline_eod_us",
        "enabled": 1,
        "interval_minutes": 30,
        "align_portal_kline_eod": "us",
    },
    {
        "id": "portal_kline_eod_crypto",
        "name": "Portal日K·加密",
        "job_type": "portal_kline_eod_crypto",
        "enabled": 1,
        "interval_minutes": 60,
        "align_portal_kline_eod": "crypto",
    },
]


def register_handler(job_type: str, handler: JobHandler) -> None:
    _HANDLERS[job_type] = handler


def _default_next_run(job: dict[str, Any], now: float) -> float:
    if job.get("align_next_2am"):
        try:
            from scheduler.finance_calendar_sync import next_2am_ts

            return next_2am_ts(now)
        except Exception:  # noqa: BLE001
            pass
    if job.get("align_zt_eod") or job.get("id") == "zt_pool_eod_snapshot":
        try:
            from zt_history.schedule import next_slot_ts

            return next_slot_ts(now)
        except Exception:  # noqa: BLE001
            pass
    if job.get("align_cn_kline_eod") or job.get("id") == "cn_daily_eod_patch":
        try:
            from scheduler.cn_daily_eod_patch import next_cn_kline_eod_ts

            return next_cn_kline_eod_ts(now)
        except Exception:  # noqa: BLE001
            pass
    lane = job.get("align_portal_kline_eod")
    if lane or str(job.get("id") or "").startswith("portal_kline_eod_"):
        try:
            from scheduler.portal_kline_eod import next_portal_kline_eod_ts

            lane_id = str(lane or str(job.get("id")).removeprefix("portal_kline_eod_"))
            return next_portal_kline_eod_ts(lane_id, now)
        except Exception:  # noqa: BLE001
            pass
    return now + int(job.get("interval_minutes") or 360) * 60


def ensure_default_jobs() -> None:
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        for job in DEFAULT_JOBS:
            row = conn.execute(
                "SELECT id FROM scheduled_job WHERE id = ?", (job["id"],)
            ).fetchone()
            if row:
                continue
            conn.execute(
                """
                INSERT INTO scheduled_job(
                  id, name, job_type, enabled, interval_minutes,
                  last_run_at, next_run_at, last_status, last_error,
                  last_result_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'idle', NULL, NULL, ?)
                """,
                (
                    job["id"],
                    job["name"],
                    job["job_type"],
                    int(job.get("enabled") or 0),
                    int(job.get("interval_minutes") or 360),
                    _default_next_run(job, now),
                    now,
                ),
            )
        conn.commit()


def list_jobs() -> list[dict[str, Any]]:
    ensure_default_jobs()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, job_type, enabled, interval_minutes,
                   last_run_at, next_run_at, last_status, last_error,
                   last_result_json, updated_at
            FROM scheduled_job
            ORDER BY name
            """
        ).fetchall()
    out = []
    for r in rows:
        item = dict(r)
        item["enabled"] = bool(item.get("enabled"))
        raw = item.pop("last_result_json", None)
        try:
            item["last_result"] = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            item["last_result"] = None
        out.append(item)
    return out


def get_job(job_id: str) -> dict[str, Any] | None:
    for j in list_jobs():
        if j["id"] == job_id:
            return j
    return None


def update_job(
    job_id: str,
    *,
    enabled: bool | None = None,
    interval_minutes: int | None = None,
) -> dict[str, Any] | None:
    ensure_default_jobs()
    conn = get_conn()
    now = time.time()
    with _lock:
        row = conn.execute(
            "SELECT * FROM scheduled_job WHERE id = ?", (job_id,)
        ).fetchone()
        if not row:
            return None
        en = int(row["enabled"] if enabled is None else (1 if enabled else 0))
        interval = int(
            row["interval_minutes"]
            if interval_minutes is None
            else max(5, int(interval_minutes))
        )
        next_run = row["next_run_at"]
        if enabled is True:
            next_run = now + interval * 60
        if interval_minutes is not None and row["last_run_at"]:
            next_run = float(row["last_run_at"]) + interval * 60
        elif interval_minutes is not None:
            next_run = now + interval * 60
        conn.execute(
            """
            UPDATE scheduled_job
            SET enabled = ?, interval_minutes = ?, next_run_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (en, interval, next_run, now, job_id),
        )
        conn.commit()
    return get_job(job_id)


def _write_run_start(job_id: str) -> int:
    conn = get_conn()
    now = time.time()
    with _lock:
        cur = conn.execute(
            """
            INSERT INTO scheduled_job_run(job_id, started_at, status, message)
            VALUES (?, ?, 'running', ?)
            """,
            (job_id, now, "运行中"),
        )
        conn.execute(
            """
            UPDATE scheduled_job
            SET last_status = 'running', last_error = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, job_id),
        )
        conn.commit()
        return int(cur.lastrowid)


def _next_run_after_finish(job_id: str, now: float, interval_minutes: int) -> float:
    if job_id == "finance_calendar_sync":
        try:
            from scheduler.finance_calendar_sync import next_2am_ts

            return next_2am_ts(now)
        except Exception:  # noqa: BLE001
            pass
    if job_id == "zt_pool_eod_snapshot":
        try:
            from zt_history.schedule import next_slot_ts

            return next_slot_ts(now)
        except Exception:  # noqa: BLE001
            pass
    if job_id == "cn_daily_eod_patch":
        try:
            from scheduler.cn_daily_eod_patch import next_cn_kline_eod_ts

            return next_cn_kline_eod_ts(now)
        except Exception:  # noqa: BLE001
            pass
    if job_id.startswith("portal_kline_eod_"):
        try:
            from scheduler.portal_kline_eod import next_portal_kline_eod_ts

            return next_portal_kline_eod_ts(job_id.removeprefix("portal_kline_eod_"), now)
        except Exception:  # noqa: BLE001
            pass
    return now + max(5, interval_minutes) * 60


def _write_run_finish(
    run_id: int,
    job_id: str,
    *,
    status: str,
    message: str,
    result: dict[str, Any] | None,
    error: str | None,
    interval_minutes: int,
) -> None:
    conn = get_conn()
    now = time.time()
    next_run = _next_run_after_finish(job_id, now, interval_minutes)
    with _lock:
        conn.execute(
            """
            UPDATE scheduled_job_run
            SET finished_at = ?, status = ?, message = ?, detail_json = ?
            WHERE id = ?
            """,
            (
                now,
                status,
                message,
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                run_id,
            ),
        )
        conn.execute(
            """
            UPDATE scheduled_job
            SET last_run_at = ?, next_run_at = ?, last_status = ?,
                last_error = ?, last_result_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                now,
                next_run,
                status,
                error,
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                now,
                job_id,
            ),
        )
        conn.commit()


def list_recent_runs(job_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    ensure_default_jobs()
    conn = get_conn()
    with _lock:
        if job_id:
            rows = conn.execute(
                """
                SELECT id, job_id, started_at, finished_at, status, message, detail_json
                FROM scheduled_job_run
                WHERE job_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (job_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, job_id, started_at, finished_at, status, message, detail_json
                FROM scheduled_job_run
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    out = []
    for r in rows:
        item = dict(r)
        raw = item.pop("detail_json", None)
        try:
            item["detail"] = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            item["detail"] = None
        out.append(item)
    return out


def due_jobs(now: float | None = None) -> list[dict[str, Any]]:
    ensure_default_jobs()
    ts = now if now is not None else time.time()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, job_type, enabled, interval_minutes, next_run_at
            FROM scheduled_job
            WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
            ORDER BY next_run_at ASC
            """,
            (ts,),
        ).fetchall()
    return [dict(r) for r in rows]


def run_job(job_id: str, *, trigger: str = "manual") -> dict[str, Any]:
    """执行任务（阻塞）。同花顺概念同步内部会再启线程时需特殊处理。"""
    job = get_job(job_id)
    if not job:
        return {"ok": False, "error": "job not found"}
    handler = _HANDLERS.get(str(job["job_type"]))
    if not handler:
        return {"ok": False, "error": f"no handler for {job['job_type']}"}

    run_id = _write_run_start(job_id)
    interval = int(job.get("interval_minutes") or 360)
    try:
        result = handler()
        # 若返回 started 异步任务，把状态记为 running，由轮询补完
        if isinstance(result, dict) and result.get("async"):
            _write_run_finish(
                run_id,
                job_id,
                status="running",
                message=f"{trigger}: 已启动后台任务",
                result=result,
                error=None,
                interval_minutes=interval,
            )
            return {"ok": True, "run_id": run_id, "async": True, "result": result}

        _write_run_finish(
            run_id,
            job_id,
            status="success",
            message=f"{trigger}: 完成",
            result=result if isinstance(result, dict) else {"result": result},
            error=None,
            interval_minutes=interval,
        )
        return {"ok": True, "run_id": run_id, "result": result}
    except Exception as e:  # noqa: BLE001
        _log.exception("job %s failed", job_id)
        _write_run_finish(
            run_id,
            job_id,
            status="error",
            message=str(e),
            result=None,
            error=str(e),
            interval_minutes=interval,
        )
        return {"ok": False, "run_id": run_id, "error": str(e)}


def mark_job_result(
    job_id: str,
    *,
    status: str,
    message: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """供异步任务完成后回写最近一条 running 记录。"""
    job = get_job(job_id)
    interval = int((job or {}).get("interval_minutes") or 360)
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT id FROM scheduled_job_run
            WHERE job_id = ? AND status = 'running'
            ORDER BY id DESC LIMIT 1
            """,
            (job_id,),
        ).fetchone()
        run_id = int(row["id"]) if row else -1
    if run_id < 0:
        # 没有 running 记录则直接更新 job
        now = time.time()
        with _lock:
            conn.execute(
                """
                UPDATE scheduled_job
                SET last_run_at = ?, next_run_at = ?, last_status = ?,
                    last_error = ?, last_result_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    now,
                    now + interval * 60,
                    status,
                    error,
                    json.dumps(result, ensure_ascii=False) if result else None,
                    now,
                    job_id,
                ),
            )
            conn.commit()
        return
    _write_run_finish(
        run_id,
        job_id,
        status=status,
        message=message,
        result=result,
        error=error,
        interval_minutes=interval,
    )
