"""涨跌停日终快照：对齐 15:30 / 16:00 的 next_run 计算。"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

_SH = ZoneInfo("Asia/Shanghai")
# (hour, minute)
SLOTS = ((15, 30), (16, 0))


def next_slot_ts(now: float | None = None) -> float:
    """返回下一个工作日 15:30 或 16:00（上海时区）的 unix 时间。"""
    import time

    base = datetime.fromtimestamp(now if now is not None else time.time(), _SH)
    # 从当前分钟的下一分钟起找
    cursor = base.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(14 * 24 * 60):  # 最多扫两周
        if cursor.weekday() < 5:
            hm = (cursor.hour, cursor.minute)
            if hm in SLOTS:
                return cursor.timestamp()
        cursor += timedelta(minutes=1)
    # 兜底：明天 15:30
    nxt = (base + timedelta(days=1)).replace(hour=15, minute=30, second=0, microsecond=0)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt.timestamp()


def should_capture_now(now: datetime | None = None) -> bool:
    n = now or datetime.now(_SH)
    if n.weekday() >= 5:
        return False
    return (n.hour, n.minute) in SLOTS
