"""同花顺概念目录 + 个股概念严格对齐同步。

流程：
1. 打开 https://q.10jqka.com.cn/gn/ 收集概念目录入库
2. 对本库每只股票拉取同花顺个股概念（stockph JSON；空则 F10 concept.html）
3. 严格对齐：个股 ths 概念集合 = 网页/接口返回集合（多删少补）

说明：概念成分深分页常被同花顺拦截；按个股概念反推成份可完整覆盖（含北交所）。
"""

from __future__ import annotations

import logging
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from cache.board_concepts import (
    concept_name_key,
    fetch_ths_stock_concepts_result,
    list_cn_codes,
    reconcile_stock_ths_concepts,
    save_board_catalog,
)

_log = logging.getLogger("scheduler.ths-concept")

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_GN_HOME = "https://q.10jqka.com.cn/gn/"
_DETAIL = "https://q.10jqka.com.cn/gn/detail/code/{code}/"
_DETAIL_PAGE = (
    "https://q.10jqka.com.cn/gn/detail/field/199112/order/desc/"
    "page/{page}/ajax/1/code/{code}"
)
_INDEX_PAGE = (
    "https://q.10jqka.com.cn/gn/index/field/199112/order/desc/page/{page}/ajax/1/"
)

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


def _http_get(url: str, *, referer: str, timeout: float = 20.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": referer,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "X-Requested-With": "XMLHttpRequest",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        import gzip

        raw = gzip.decompress(raw)
    for enc in ("gbk", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _is_login_wall(html: str) -> bool:
    """真正拦内容时才算登录墙；页头「登录」链接不算。"""
    s = html or ""
    if "m-table" in s or "stockpage.10jqka.com.cn" in s or "gn/detail/code" in s:
        return False
    if len(s) < 800 and "chameleon" in s:
        return True
    if "upass.10jqka.com.cn/login" in s and "gn/detail" not in s:
        return True
    return False


def _parse_concept_links(html: str) -> list[tuple[str, str]]:
    """返回 [(cid, name), ...]。"""
    pairs = re.findall(
        r"/gn/detail/code/(\d+)/\"[^>]*>([^<]+)<",
        html,
    )
    if not pairs:
        pairs = re.findall(
            r"gn/detail/code/(\d+)/[^>\"]*\"[^>]*>([^<]+)<",
            html,
        )
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for cid, name in pairs:
        cid = str(cid).strip()
        name = str(name).strip()
        if not cid or not name or cid in seen:
            continue
        if "展开" in name:
            continue
        seen.add(cid)
        out.append((cid, name))
    return out


def _parse_page_total(html: str) -> int:
    m = re.search(r'class="page_info">\s*\d+/(\d+)\s*<', html or "")
    if m:
        try:
            return max(1, int(m.group(1)))
        except ValueError:
            return 1
    pages = [int(x) for x in re.findall(r'changePage"\s+page="(\d+)"', html or "")]
    return max(pages) if pages else 1


def fetch_concept_catalog(*, delay: float = 0.35) -> list[dict[str, Any]]:
    """收集同花顺概念目录。"""
    home = _http_get(_GN_HOME, referer="https://q.10jqka.com.cn/")
    by_id: dict[str, str] = {}
    for cid, name in _parse_concept_links(home):
        by_id[cid] = name

    total_pages = _parse_page_total(home)
    for page in range(1, min(total_pages, 50) + 1):
        url = _INDEX_PAGE.format(page=page)
        try:
            html = _http_get(url, referer=_GN_HOME)
        except Exception as e:  # noqa: BLE001
            _log.debug("ths catalog page %s failed: %s", page, e)
            break
        if _is_login_wall(html):
            break
        for cid, name in _parse_concept_links(html):
            by_id.setdefault(cid, name)
        for cid in re.findall(r"gn/detail/code/(\d+)", html):
            by_id.setdefault(cid, by_id.get(cid) or f"概念{cid}")
        time.sleep(delay)

    rows: list[dict[str, Any]] = []
    for cid, name in sorted(by_id.items(), key=lambda x: x[1]):
        rows.append(
            {
                "source": "ths",
                "kind": "concept",
                "code": f"ths:{cid}",
                "name": name,
                "name_key": concept_name_key(name),
                "extra": {"ths_id": cid},
            }
        )
    return rows


def _sync_one_stock(code: str) -> dict[str, Any]:
    try:
        concepts, fetch_ok = fetch_ths_stock_concepts_result(code)
        if not fetch_ok:
            return {
                "ok": False,
                "code": code,
                "error": "fetch_failed",
                "skipped": True,
            }
        stats = reconcile_stock_ths_concepts(code, concepts)
        return {
            "ok": True,
            "code": code,
            "concepts": len(concepts),
            **stats,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "code": code, "error": str(e)}


def run_ths_concept_sync(
    *,
    delay: float = 0.05,
    workers: int = 6,
) -> dict[str, Any]:
    """同步入口：目录 + 全库个股同花顺概念严格对齐。"""
    started = time.time()
    _set_progress(
        active=True,
        phase="catalog",
        done=0,
        total=0,
        ok_count=0,
        failed=0,
        tagged=0,
        removed=0,
        skipped=0,
        message="抓取同花顺概念目录…",
        last_error=None,
    )
    catalog = fetch_concept_catalog(delay=max(delay, 0.2))
    n_cat = save_board_catalog(catalog)

    codes = list_cn_codes()
    total = len(codes)
    _set_progress(
        phase="stocks",
        done=0,
        total=total,
        message=f"同步个股同花顺概念 0/{total}",
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
                if int(row.get("concepts") or 0) == 0:
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
                        f"同步个股同花顺概念 {done}/{total} · "
                        f"新增 {tagged} · 移除 {removed} · 跳过 {skipped}"
                    ),
                )
            if delay > 0:
                time.sleep(delay / max(1, workers))

    finished = time.time()
    result = {
        "catalog": n_cat,
        "concepts": len(catalog),
        "stocks": total,
        "ok": ok,
        "failed": failed,
        "skipped": skipped,
        "tagged": tagged,
        "removed": removed,
        "empty_concepts": empty,
        "elapsed_sec": round(finished - started, 1),
        "samples": samples[:30],
        "note": "按同花顺个股概念页/接口严格对齐成份（多删少补）",
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
        message="同花顺概念同步完成",
        synced_at=finished,
        last_error=None,
    )
    return result


def start_ths_concept_sync(*, delay: float = 0.05) -> dict[str, Any]:
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
                run_ths_concept_sync(delay=delay)
            except Exception as e:  # noqa: BLE001
                _log.exception("ths concept sync crashed")
                _set_progress(
                    active=False,
                    phase="error",
                    last_error=str(e),
                    message="同花顺概念同步失败",
                )

        t = threading.Thread(target=_run, name="ths-concept-sync", daemon=True)
        _thread = t
        t.start()
    return {"ok": True, "started": True, **get_progress()}
