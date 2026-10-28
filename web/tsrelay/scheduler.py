"""Tushare 定时同步：工作日 15:30 + 16:00 补跑（进程内）。"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models
from tsrelay.client import get_client
from tsrelay.sync_worker import is_syncing, start_sync_all, start_worker

_log = logging.getLogger("tushare-gateway")
_SH = ZoneInfo("Asia/Shanghai")

# (hour, minute) — 拍板：15:30 主跑 + 16:00 补跑
_SLOTS = ((15, 30), (16, 0))

_started = False
_stop = threading.Event()
_last_slot_key: str | None = None


def _enabled() -> bool:
    return (models.get_config("ts_schedule_enabled", "1") or "1").strip() not in (
        "0",
        "false",
        "False",
    )


def set_enabled(on: bool) -> None:
    models.set_config("ts_schedule_enabled", "1" if on else "0")


def status() -> dict[str, Any]:
    last_run = models.get_config("ts_schedule_last_run")
    last_result = models.get_config("ts_schedule_last_result")
    try:
        result_obj = json.loads(last_result) if last_result else None
    except Exception:
        result_obj = last_result
    return {
        "enabled": _enabled(),
        "timezone": "Asia/Shanghai",
        "slots": [{"hour": h, "minute": m} for h, m in _SLOTS],
        "cron": ["30 15 * * 1-5", "0 16 * * 1-5"],
        "last_run": last_run,
        "last_result": result_obj,
        "syncing": is_syncing(),
    }


def _slot_key(now: datetime, hour: int, minute: int) -> str:
    return f"{now.strftime('%Y%m%d')}-{hour:02d}{minute:02d}"


def _should_fire(now: datetime) -> tuple[bool, str | None]:
    global _last_slot_key
    if now.weekday() >= 5:  # Sat/Sun
        return False, None
    for hour, minute in _SLOTS:
        if now.hour == hour and now.minute == minute:
            key = _slot_key(now, hour, minute)
            if key == _last_slot_key:
                return False, None
            return True, key
    return False, None


def _run_job(slot_key: str) -> None:
    if not get_client().configured():
        _log.warning("tushare schedule skip: token not configured")
        return
    if is_syncing():
        _log.info("tushare schedule skip: already syncing")
        return
    models.set_config("ts_schedule_last_run", slot_key)
    result = start_sync_all(force=True)
    models.set_config(
        "ts_schedule_last_result",
        json.dumps(
            {"ok": result.get("ok"), "markets_total": result.get("markets_total"), "at": time.time()},
            ensure_ascii=False,
        ),
    )
    _log.info("tushare schedule fired %s -> %s", slot_key, result.get("markets_total"))


def _loop() -> None:
    global _last_slot_key
    while not _stop.is_set():
        try:
            if _enabled():
                now = datetime.now(_SH)
                fire, key = _should_fire(now)
                if fire and key:
                    _last_slot_key = key
                    _run_job(key)
        except Exception:  # noqa: BLE001
            _log.exception("tushare schedule loop")
        _stop.wait(30.0)


def start_scheduler() -> None:
    global _started
    if _started:
        return
    if not get_client().configured():
        _log.info("tushare scheduler not started (no token)")
        return
    start_worker()
    th = threading.Thread(target=_loop, name="tushare-scheduler", daemon=True)
    th.start()
    _started = True
    _log.info("tushare scheduler started (15:30 + 16:00 Asia/Shanghai)")
