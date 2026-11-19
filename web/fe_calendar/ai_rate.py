"""用 DeepSeek 对财经日历事件做重要性（1–5 星）批量评级。"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from ai import config as ai_config
from ai.client import chat_json_content
from cache.db import _lock, get_conn, init_db

_log = logging.getLogger("fe-calendar.ai-rate")

BATCH_SIZE = 40

_progress_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "rated": 0,
    "skipped": 0,
    "failed_batches": 0,
    "message": "",
    "last_error": None,
    "finished_at": None,
}


def get_rate_progress() -> dict[str, Any]:
    with _progress_lock:
        return dict(_progress)


def _set_progress(**kwargs: Any) -> None:
    with _progress_lock:
        _progress.update(kwargs)


_SYSTEM = """你是 A 股/宏观投研助手，负责给「财经日历」事件打重要性分（对中国股市与宏观定价的短期关注价值）。
只输出 JSON 对象，不要 Markdown。格式：
{"ratings":[{"fe_code":"字符串","importance":1到5的整数,"reason":"不超过20字中文理由"}]}

评分标准：
1=几乎无关/常规例会
2=弱相关、局部行业
3=中等：常见宏观数据或一般行业峰会
4=较强：关键宏观数据、重要政策会议、市场高度关注事件
5=极高：重大央行/高层决策、超预期级别全球/国内关键事件

必须为输入列表中每一个 fe_code 给出一条 rating；importance 只能是 1–5 整数。"""


def list_unrated_events(*, limit: int = 2000) -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT fe_code, start_at, end_at, name, sponsor, city,
                   fe_type, std_type_code, content
            FROM finance_calendar_event
            WHERE importance IS NULL
            ORDER BY (start_ts IS NULL), start_ts ASC
            LIMIT ?
            """,
            (max(1, min(int(limit), 5000)),),
        ).fetchall()
    return [dict(r) for r in rows]


def apply_ratings(ratings: list[dict[str, Any]]) -> int:
    """回填 importance；返回成功写入条数。"""
    init_db()
    now = time.time()
    conn = get_conn()
    n = 0
    with _lock:
        for item in ratings:
            code = str(item.get("fe_code") or "").strip()
            try:
                stars = int(item.get("importance"))
            except (TypeError, ValueError):
                continue
            if not code or stars < 1 or stars > 5:
                continue
            reason = str(item.get("reason") or "").strip()[:80] or None
            cur = conn.execute(
                """
                UPDATE finance_calendar_event
                SET importance = ?, importance_reason = ?, importance_rated_at = ?,
                    updated_at = ?
                WHERE fe_code = ? AND importance IS NULL
                """,
                (stars, reason, now, now, code),
            )
            n += int(cur.rowcount or 0)
        conn.commit()
    return n


def _batch_payload(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for e in events:
        out.append(
            {
                "fe_code": e.get("fe_code"),
                "start_at": e.get("start_at"),
                "end_at": e.get("end_at"),
                "name": e.get("name"),
                "sponsor": e.get("sponsor"),
                "city": e.get("city"),
                "fe_type": e.get("fe_type"),
                "std_type_code": e.get("std_type_code"),
                "content": (str(e.get("content") or ""))[:280],
            }
        )
    return out


def _rate_batch(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    import json

    user = (
        "请为以下财经日历事件评分，返回 JSON：\n"
        + json.dumps(_batch_payload(events), ensure_ascii=False)
    )
    parsed = chat_json_content(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.15,
        max_tokens=4096,
        timeout=240.0,
    )
    ratings = parsed.get("ratings")
    if not isinstance(ratings, list):
        raise RuntimeError("模型未返回 ratings 数组")
    return [r for r in ratings if isinstance(r, dict)]


def run_ai_importance_rating(*, batch_size: int = BATCH_SIZE) -> dict[str, Any]:
    """对 importance IS NULL 的事件批量评级并回填。"""
    if not ai_config.is_configured():
        raise RuntimeError("未配置 DEEPSEEK_API_KEY，无法评级")

    started = time.time()
    pending = list_unrated_events()
    skipped_already = 0  # 本轮开始前已有评级的不在 pending 里
    total = len(pending)
    _set_progress(
        active=True,
        phase="rate",
        done=0,
        total=total,
        rated=0,
        skipped=skipped_already,
        failed_batches=0,
        message=f"待评级 {total} 条…",
        last_error=None,
        finished_at=None,
    )

    if total == 0:
        _set_progress(
            active=False,
            phase="done",
            message="没有需要评级的事件（均已有重要性）",
            finished_at=time.time(),
        )
        return {
            "ok": True,
            "rated": 0,
            "pending": 0,
            "batches": 0,
            "failed_batches": 0,
            "elapsed_sec": round(time.time() - started, 2),
        }

    rated = 0
    failed = 0
    batches = 0
    size = max(5, min(int(batch_size), 80))

    for i in range(0, total, size):
        chunk = pending[i : i + size]
        batches += 1
        _set_progress(
            message=f"AI 评级批次 {batches}（{i + 1}-{min(i + size, total)}/{total}）…",
            done=i,
            total=total,
        )
        try:
            ratings = _rate_batch(chunk)
            wrote = apply_ratings(ratings)
            rated += wrote
            # 若模型漏了部分，未写入的仍保持 NULL，可下次再跑
        except Exception as exc:  # noqa: BLE001
            failed += 1
            _log.exception("ai rate batch %s failed", batches)
            _set_progress(last_error=str(exc), failed_batches=failed)
        _set_progress(done=min(i + size, total), rated=rated)

    elapsed = round(time.time() - started, 2)
    msg = f"完成：新评级 {rated} 条，失败批次 {failed}，耗时 {elapsed}s"
    _set_progress(
        active=False,
        phase="done" if failed == 0 else "done_with_errors",
        done=total,
        total=total,
        rated=rated,
        failed_batches=failed,
        message=msg,
        finished_at=time.time(),
    )
    return {
        "ok": failed == 0,
        "rated": rated,
        "pending": total,
        "batches": batches,
        "failed_batches": failed,
        "elapsed_sec": elapsed,
        "message": msg,
    }
