"""同花顺概念目录 + 成分股翻页同步，标注本库股票。

流程：
1. 打开 https://q.10jqka.com.cn/gn/ 收集概念（首页分类链 + 尽量翻页涨跌榜）
2. 打开每个 https://q.10jqka.com.cn/gn/detail/code/{id}/ 翻页成分
3. 仅对本库已有股票写入/合并 stock_board_map（source=ths, kind=concept）

说明：成分深分页（约第 6 页起）常要求同花顺登录，未登录时尽量抓取可访问页。
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from cache.board_concepts import (
    concept_name_key,
    list_cn_codes,
    pure_a_share_code,
    save_board_catalog,
)
from cache.db import _lock, get_conn, init_db

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
    s = html or ""
    if "upass.10jqka.com.cn/login" in s:
        return True
    if len(s) < 400 and "chameleon" in s:
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


def _parse_stock_codes(html: str) -> list[str]:
    codes = re.findall(r"stockpage\.10jqka\.com\.cn/(\d{6})/?", html or "")
    out: list[str] = []
    seen: set[str] = set()
    for c in codes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    # 表格纯代码兜底
    for c in re.findall(r">(\d{6})<", html or ""):
        if c.startswith(("00", "30", "60", "68", "8", "4", "92")) and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _parse_concept_name(html: str, fallback: str = "", *, cid: str = "") -> str:
    # 详情页自链上的概念名最稳
    if cid:
        m = re.search(
            rf'/gn/detail/code/{re.escape(cid)}/"[^>]*>\s*([^<]+)\s*<',
            html or "",
        )
        if m:
            name = m.group(1).strip()
            if name:
                return name
    for pat in (
        r'class="board-tit"[^>]*>\s*([^<]+)\s*<',
        r"<h3[^>]*>\s*([^<]{2,40})\s*</h3>",
    ):
        m = re.search(pat, html or "")
        if m:
            name = m.group(1).strip()
            if name and name not in ("板块简介", "成分股涨跌排行榜", "提示"):
                return name
    return fallback


def fetch_concept_catalog(*, delay: float = 0.35) -> list[dict[str, Any]]:
    """收集同花顺概念目录。"""
    home = _http_get(_GN_HOME, referer="https://q.10jqka.com.cn/")
    by_id: dict[str, str] = {}
    for cid, name in _parse_concept_links(home):
        by_id[cid] = name

    # 尽量翻页涨跌榜（未登录时常 401，失败则跳过）
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
        # 涨跌榜表格也可能只有 code 链接
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


def fetch_concept_members(
    cid: str,
    *,
    delay: float = 0.35,
    max_pages: int = 40,
) -> tuple[str, list[str], dict[str, Any]]:
    """抓取单个概念全部可访问页的成分代码。返回 (name, codes, meta)。"""
    detail_url = _DETAIL.format(code=cid)
    html = _http_get(detail_url, referer=_GN_HOME)
    if _is_login_wall(html):
        raise RuntimeError("同花顺要求登录，无法打开概念详情")
    name = _parse_concept_name(html, fallback="", cid=cid)
    pages = min(_parse_page_total(html), max_pages)
    codes = list(_parse_stock_codes(html))
    truncated = False
    for page in range(2, pages + 1):
        time.sleep(delay)
        url = _DETAIL_PAGE.format(page=page, code=cid)
        try:
            part = _http_get(url, referer=detail_url)
        except urllib.error.HTTPError as e:
            truncated = True
            _log.debug("ths members page %s/%s http %s", cid, page, e.code)
            break
        except Exception as e:  # noqa: BLE001
            truncated = True
            _log.debug("ths members page %s/%s failed: %s", cid, page, e)
            break
        if _is_login_wall(part) or "m-table" not in part:
            truncated = True
            break
        more = _parse_stock_codes(part)
        if not more:
            truncated = True
            break
        for c in more:
            if c not in codes:
                codes.append(c)
    meta = {
        "pages": pages,
        "fetched": len(codes),
        "truncated": truncated,
    }
    return name, codes, meta


def upsert_stock_concept_source(
    code: str,
    *,
    name: str,
    source: str = "ths",
    kind: str = "concept",
) -> bool:
    """给本库股票合并写入概念来源（不覆盖其他源）。"""
    pure = pure_a_share_code(code)
    name = str(name or "").strip()
    if not pure or not name:
        return False
    key = concept_name_key(name)
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT sources_json, name FROM stock_board_map
            WHERE code = ? AND name_key = ? AND kind = ?
            """,
            (pure, key, kind),
        ).fetchone()
        if row:
            try:
                sources = json.loads(row["sources_json"] or "[]")
            except json.JSONDecodeError:
                sources = []
            if not isinstance(sources, list):
                sources = []
            if source not in sources:
                sources.append(source)
            # 名称取更长者
            cur_name = str(row["name"] or name)
            if len(name) > len(cur_name):
                cur_name = name
            conn.execute(
                """
                UPDATE stock_board_map
                SET name = ?, sources_json = ?, updated_at = ?
                WHERE code = ? AND name_key = ? AND kind = ?
                """,
                (
                    cur_name,
                    json.dumps(sources, ensure_ascii=False),
                    now,
                    pure,
                    key,
                    kind,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO stock_board_map(code, name_key, name, kind, sources_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    pure,
                    key,
                    name,
                    kind,
                    json.dumps([source], ensure_ascii=False),
                    now,
                ),
            )
        conn.commit()
    return True


def _local_code_set() -> set[str]:
    return set(list_cn_codes())


def run_ths_concept_sync(*, delay: float = 0.35) -> dict[str, Any]:
    """同步入口（同步执行，供线程调用）。"""
    started = time.time()
    _set_progress(
        active=True,
        phase="catalog",
        done=0,
        total=0,
        ok_count=0,
        failed=0,
        tagged=0,
        message="抓取同花顺概念目录…",
        last_error=None,
    )
    catalog = fetch_concept_catalog(delay=delay)
    n_cat = save_board_catalog(catalog)
    local_codes = _local_code_set()
    total = len(catalog)
    _set_progress(
        phase="members",
        done=0,
        total=total,
        message=f"同步概念成分 0/{total}",
    )

    ok = 0
    failed = 0
    tagged = 0
    truncated_concepts = 0
    details: list[dict[str, Any]] = []

    for i, row in enumerate(catalog, start=1):
        cid = str((row.get("extra") or {}).get("ths_id") or "").strip()
        if not cid:
            code = str(row.get("code") or "")
            cid = code.replace("ths:", "") if code.startswith("ths:") else ""
        name = str(row.get("name") or "")
        if not cid:
            failed += 1
            continue
        try:
            got_name, members, meta = fetch_concept_members(cid, delay=delay)
            use_name = got_name or name
            if meta.get("truncated"):
                truncated_concepts += 1
            hit = 0
            for sc in members:
                if sc not in local_codes:
                    continue
                if upsert_stock_concept_source(sc, name=use_name, source="ths", kind="concept"):
                    hit += 1
                    tagged += 1
            ok += 1
            if i <= 20 or hit > 0:
                details.append(
                    {
                        "id": cid,
                        "name": use_name,
                        "members": len(members),
                        "tagged": hit,
                        "truncated": bool(meta.get("truncated")),
                    }
                )
        except Exception as e:  # noqa: BLE001
            failed += 1
            _log.warning("ths concept %s (%s) failed: %s", cid, name, e)
            details.append({"id": cid, "name": name, "error": str(e)})
        _set_progress(
            done=i,
            total=total,
            ok_count=ok,
            failed=failed,
            tagged=tagged,
            message=f"同步概念成分 {i}/{total} · 已标注 {tagged}",
        )
        time.sleep(delay)

    finished = time.time()
    result = {
        "catalog": n_cat,
        "concepts": total,
        "ok": ok,
        "failed": failed,
        "tagged": tagged,
        "truncated_concepts": truncated_concepts,
        "elapsed_sec": round(finished - started, 1),
        "samples": details[:30],
        "note": "未登录时成分深分页可能被同花顺拦截，已尽量抓取可访问页",
    }
    _set_progress(
        active=False,
        phase="done",
        done=total,
        total=total,
        ok_count=ok,
        failed=failed,
        tagged=tagged,
        message="同花顺概念同步完成",
        synced_at=finished,
        last_error=None,
    )
    return result


def start_ths_concept_sync(*, delay: float = 0.35) -> dict[str, Any]:
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
