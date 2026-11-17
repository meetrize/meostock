"""东财行业/概念目录 + 个股板块严格对齐同步。

流程：
1. 拉取东财行业/概念目录入库（含涨跌等列表字段快照）
2. 对本库每只股票拉取东财 F10 所属板块，严格对齐 eastmoney 来源（多删少补）

打开板块页优先读库，避免实时打东财 clist。
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from cache.board_concepts import (
    fetch_em_board_catalog,
    fetch_em_stock_boards_result,
    list_cn_codes,
    reconcile_stock_em_boards,
    save_board_catalog,
)

_log = logging.getLogger("scheduler.em-board")

_sync_lock = threading.Lock()
_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "ok_count": 0,
    "failed": 0,
    "tagged": 0,
    "removed": 0,
    "skipped": 0,
    "message": "",
    "synced_at": None,
    "last_error": None,
}
_thread: threading.Thread | None = None


def get_progress() -> dict[str, Any]:
    with _sync_lock:
        return dict(_progress)


def _set_progress(**kwargs: Any) -> None:
    with _sync_lock:
        _progress.update(kwargs)


def _sync_one_stock(code: str) -> dict[str, Any]:
    try:
        boards, fetch_ok = fetch_em_stock_boards_result(code)
        if not fetch_ok:
            return {
                "ok": False,
                "code": code,
                "error": "fetch_failed",
                "skipped": True,
            }
        stats = reconcile_stock_em_boards(code, boards)
        return {
            "ok": True,
            "code": code,
            "boards": len(boards),
            **stats,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "code": code, "error": str(e)}


def run_em_board_sync(
    *,
    delay: float = 0.05,
    workers: int = 6,
) -> dict[str, Any]:
    """同步入口：东财目录 + 全库个股板块严格对齐。"""
    started = time.time()
    _set_progress(
        active=True,
        phase="catalog",
        done=0,
        total=2,
        ok_count=0,
        failed=0,
        tagged=0,
        removed=0,
        skipped=0,
        message="抓取东财行业/概念目录…",
        last_error=None,
    )

    catalogs: list[dict[str, Any]] = []
    catalog_counts: dict[str, int] = {}
    for label, board_type in (("concept", "concept"), ("industry", "industry")):
        try:
            part = fetch_em_board_catalog(board_type)
            catalogs.extend(part)
            catalog_counts[label] = len(part)
            _log.info("em catalog %s: %s", label, len(part))
        except Exception as e:  # noqa: BLE001
            catalog_counts[label] = 0
            _log.warning("em catalog %s failed: %s", label, e)
        _set_progress(done=_progress["done"] + 1, total=2)

    n_cat = save_board_catalog(catalogs) if catalogs else 0

    codes = list_cn_codes()
    total = len(codes)
    _set_progress(
        phase="stocks",
        done=0,
        total=total,
        message=f"同步个股东财板块 0/{total}",
    )

    ok = 0
    failed = 0
    skipped = 0
    tagged = 0
    removed = 0
    empty = 0
    done = 0
    samples: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(_sync_one_stock, c): c for c in codes}
        for fut in as_completed(futures):
            done += 1
            row = fut.result()
            if row.get("ok"):
                ok += 1
                tagged += int(row.get("added") or 0)
                removed += int(row.get("removed") or 0)
                if int(row.get("boards") or 0) == 0:
                    empty += 1
                if len(samples) < 30 and (
                    int(row.get("added") or 0) or int(row.get("removed") or 0)
                ):
                    samples.append(row)
            elif row.get("skipped"):
                skipped += 1
            else:
                failed += 1
                if len(samples) < 40:
                    samples.append(row)
            if done % 20 == 0 or done == total:
                _set_progress(
                    done=done,
                    total=total,
                    ok_count=ok,
                    failed=failed,
                    skipped=skipped,
                    tagged=tagged,
                    removed=removed,
                    message=(
                        f"同步个股东财板块 {done}/{total} · "
                        f"新增 {tagged} · 移除 {removed} · 跳过 {skipped}"
                    ),
                )
            if delay > 0:
                time.sleep(delay / max(1, workers))

    finished = time.time()
    result = {
        "catalog": n_cat,
        "catalog_counts": catalog_counts,
        "stocks": total,
        "ok": ok,
        "failed": failed,
        "skipped": skipped,
        "tagged": tagged,
        "removed": removed,
        "empty_boards": empty,
        "elapsed_sec": round(finished - started, 1),
        "samples": samples[:30],
        "note": "东财目录+个股 F10 板块严格对齐；列表/详情优先读库",
    }
    _set_progress(
        active=False,
        phase="done",
        done=total,
        total=total,
        ok_count=ok,
        failed=failed,
        skipped=skipped,
        tagged=tagged,
        removed=removed,
        message="东财板块/概念同步完成",
        synced_at=finished,
        last_error=None,
    )
    return result


def start_em_board_sync(*, delay: float = 0.05) -> dict[str, Any]:
    global _thread
    with _sync_lock:
        if _progress.get("active") and _thread and _thread.is_alive():
            return {
                "ok": True,
                "started": False,
                "reason": "already_running",
                **get_progress(),
            }

        def _run() -> None:
            try:
                run_em_board_sync(delay=delay)
            except Exception as e:  # noqa: BLE001
                _log.exception("em board sync crashed")
                _set_progress(
                    active=False,
                    phase="error",
                    last_error=str(e),
                    message="东财板块/概念同步失败",
                )

        t = threading.Thread(target=_run, name="em-board-sync", daemon=True)
        _thread = t
        t.start()
    return {"ok": True, "started": True, **get_progress()}
