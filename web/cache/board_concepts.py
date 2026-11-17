"""A 股板块/概念：多源拉取、去重入库、后台全量同步。

kind:
  - concept: 概念
  - industry / region: 归入「板块」查询（board）
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from cache.db import _lock, get_conn, init_db

_log = logging.getLogger("quote-cache.board-concepts")

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
EM_CLIST = "https://push2.eastmoney.com/api/qt/clist/get"
_EM_BOARD_FIELDS = (
    "f12,f14,f2,f3,f4,f8,f20,f104,f105,f128,f136,f140,f141,f207,f208,f209"
)

_sync_lock = threading.Lock()
_sync_thread: threading.Thread | None = None
_progress: dict[str, Any] = {
    "active": False,
    "phase": "",
    "done": 0,
    "total": 0,
    "ok_count": 0,
    "failed": 0,
    "message": "",
    "synced_at": None,
    "last_error": None,
}


def _set_progress(**kwargs: Any) -> None:
    with _sync_lock:
        _progress.update(kwargs)


def get_sync_progress() -> dict[str, Any]:
    with _sync_lock:
        return dict(_progress)


def _http_get_bytes(url: str, *, timeout: float = 15.0, headers: dict[str, str] | None = None) -> bytes:
    req_headers = {
        "User-Agent": _BROWSER_UA,
        "Accept": "*/*",
        **(headers or {}),
    }
    req = urllib.request.Request(url, headers=req_headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _http_get_json(url: str, *, timeout: float = 12.0, headers: dict[str, str] | None = None) -> dict[str, Any]:
    raw = _http_get_bytes(url, timeout=timeout, headers=headers)
    if raw[:2] == b"\x1f\x8b":
        import gzip

        raw = gzip.decompress(raw)
    data = json.loads(raw.decode("utf-8", errors="replace"))
    if not isinstance(data, dict):
        raise ValueError("expected json object")
    return data


def _normalize_diff(diff: Any) -> list[dict[str, Any]]:
    if isinstance(diff, dict):
        return [v for v in diff.values() if isinstance(v, dict)]
    if isinstance(diff, list):
        return [x for x in diff if isinstance(x, dict)]
    return []


def _num_or_none(v: Any) -> float | None:
    if v is None or v == "" or v == "-":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def concept_name_key(name: str) -> str:
    s = str(name or "").strip()
    for suf in ("概念", "板块"):
        if len(s) > len(suf) and s.endswith(suf):
            s = s[: -len(suf)]
    return s.casefold()


def pure_a_share_code(raw: str) -> str:
    s = str(raw or "").strip()
    s = re.sub(r"^(sh|sz|bj)", "", s, flags=re.I)
    s = re.sub(r"\.(SH|SZ|BJ)$", "", s, flags=re.I)
    return "".join(ch for ch in s if ch.isdigit())


def _em_sec_prefix(code: str) -> str:
    """东财 F10 用 SH/SZ/BJ 前缀。北交所 92/8/4 须优先于沪市 9 开头判断。"""
    c = pure_a_share_code(code)
    if c.startswith("92") or c.startswith(("8", "4")):
        return f"BJ{c}"
    if c.startswith(("6", "9")):
        return f"SH{c}"
    return f"SZ{c}"


def _upsert_sync_meta(
    key: str,
    *,
    state: str,
    done: int = 0,
    total: int = 0,
    row_count: int | None = None,
    error: str | None = None,
    synced_at: float | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    init_db()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO board_sync_meta(
              key, synced_at, row_count, sync_state, last_error,
              progress_done, progress_total, detail_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              synced_at=excluded.synced_at,
              row_count=COALESCE(excluded.row_count, board_sync_meta.row_count),
              sync_state=excluded.sync_state,
              last_error=excluded.last_error,
              progress_done=excluded.progress_done,
              progress_total=excluded.progress_total,
              detail_json=excluded.detail_json
            """,
            (
                key,
                synced_at,
                int(row_count or 0),
                state,
                error,
                int(done),
                int(total),
                json.dumps(detail, ensure_ascii=False) if detail is not None else None,
            ),
        )
        conn.commit()


def list_cn_codes() -> list[str]:
    """优先 quote_snapshot，其次 symbol。"""
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT code FROM quote_snapshot
            WHERE market = 'cn'
            ORDER BY code
            """
        ).fetchall()
        if not rows:
            rows = conn.execute(
                """
                SELECT code FROM symbol
                WHERE market = 'cn' AND status = 'active'
                ORDER BY code
                """
            ).fetchall()
    out: list[str] = []
    seen: set[str] = set()
    for r in rows:
        pure = pure_a_share_code(str(r["code"] if hasattr(r, "keys") else r[0]))
        if pure and pure not in seen:
            seen.add(pure)
            out.append(pure)
    return out


def fetch_em_board_catalog(board_type: str) -> list[dict[str, Any]]:
    """东财行业/概念目录（全部分页）。"""
    fs = {
        "industry": "m:90+t:2+f:!50",
        "concept": "m:90+t:3+f:!50",
    }.get(board_type)
    if not fs:
        return []
    kind = "industry" if board_type == "industry" else "concept"
    rows: list[dict[str, Any]] = []
    total_hint = 0
    for pn in range(1, 12):
        params = {
            "pn": str(pn),
            "pz": "100",
            "po": "1",
            "np": "1",
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": "2",
            "invt": "2",
            "fid": "f3",
            "fs": fs,
            "fields": _EM_BOARD_FIELDS,
        }
        url = f"{EM_CLIST}?{urllib.parse.urlencode(params)}"
        try:
            data = _http_get_json(url, timeout=15.0)
        except Exception as e:  # noqa: BLE001
            if pn == 1:
                raise
            _log.warning("em catalog page %s failed: %s", pn, e)
            break
        if pn == 1:
            total_hint = int((((data or {}).get("data") or {}).get("total")) or 0)
        diff = _normalize_diff((((data or {}).get("data") or {}).get("diff")))
        if not diff:
            break
        for row in diff:
            code = str(row.get("f12") or "").strip()
            name = str(row.get("f14") or "").strip()
            if not code or not name:
                continue
            rows.append(
                {
                    "source": "eastmoney",
                    "kind": kind,
                    "code": code,
                    "name": name,
                    "name_key": concept_name_key(name),
                    "extra": {
                        "price": _num_or_none(row.get("f2")),
                        "change": _num_or_none(row.get("f4")),
                        "changePercent": _num_or_none(row.get("f3")),
                        "totalMarketCap": _num_or_none(row.get("f20")),
                        "turnoverRate": _num_or_none(row.get("f8")),
                        "riseCount": _num_or_none(row.get("f104")),
                        "fallCount": _num_or_none(row.get("f105")),
                        "leadingStock": (str(row.get("f128") or "").strip() or None),
                        "leadingStockChangePercent": _num_or_none(row.get("f136")),
                    },
                }
            )
        if len(diff) < 100:
            break
        if total_hint and len(rows) >= total_hint:
            break
    # 去重
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for row in rows:
        if row["code"] in seen:
            continue
        seen.add(row["code"])
        uniq.append(row)
    return uniq


def fetch_ths_concept_catalog() -> list[dict[str, Any]]:
    """同花顺概念目录。"""
    url = "https://q.10jqka.com.cn/gn/"
    raw = _http_get_bytes(
        url,
        timeout=20.0,
        headers={"Referer": "https://q.10jqka.com.cn/", "Accept": "text/html,*/*"},
    )
    text = raw.decode("gbk", errors="replace")
    pairs = re.findall(r"/gn/detail/code/(\d+)/[^>\"]*\"[^>]*>([^<]+)<", text)
    if not pairs:
        pairs = re.findall(r"/gn/detail/code/(\d+)/[^>]*>([^<]+)<", text)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cid, name in pairs:
        cid = str(cid).strip()
        name = str(name).strip()
        if not cid or not name or cid in seen:
            continue
        seen.add(cid)
        rows.append(
            {
                "source": "ths",
                "kind": "concept",
                "code": f"ths:{cid}",
                "name": name,
                "name_key": concept_name_key(name),
                "extra": {},
            }
        )
    return rows


def save_board_catalog(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        for row in rows:
            conn.execute(
                """
                INSERT INTO board_catalog(source, kind, code, name, name_key, extra_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, kind, code) DO UPDATE SET
                  name=excluded.name,
                  name_key=excluded.name_key,
                  extra_json=excluded.extra_json,
                  updated_at=excluded.updated_at
                """,
                (
                    row["source"],
                    row["kind"],
                    row["code"],
                    row["name"],
                    row["name_key"],
                    json.dumps(row.get("extra") or {}, ensure_ascii=False),
                    now,
                ),
            )
        conn.commit()
    return len(rows)


def fetch_em_stock_boards(code: str) -> list[dict[str, Any]]:
    pure = pure_a_share_code(code)
    if not pure:
        return []
    em_code = _em_sec_prefix(pure)
    url = (
        "https://emweb.securities.eastmoney.com/PC_HSF10/CoreConception/PageAjax"
        f"?code={urllib.parse.quote(em_code)}"
    )
    try:
        data = _http_get_json(
            url,
            timeout=12.0,
            headers={"Referer": "https://emweb.securities.eastmoney.com/"},
        )
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    for row in data.get("ssbk") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("BOARD_NAME") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "source": "eastmoney",
                "kind": "concept",
                "boardCode": str(row.get("BOARD_CODE") or "").strip() or None,
            }
        )
    try:
        q = urllib.parse.urlencode(
            {
                "reportName": "RPT_F10_CORETHEME_BOARDTYPE",
                "columns": "ALL",
                "filter": f'(SECURITY_CODE="{pure}")',
                "pageNumber": "1",
                "pageSize": "50",
                "sortTypes": "1",
                "sortColumns": "BOARD_RANK",
                "source": "WEB",
                "client": "WEB",
            }
        )
        typed = _http_get_json(
            f"https://datacenter-web.eastmoney.com/api/data/v1/get?{q}",
            timeout=12.0,
        )
        by_name = {
            str(x.get("BOARD_NAME") or "").strip(): x
            for x in ((typed.get("result") or {}).get("data") or [])
            if isinstance(x, dict)
        }
        for item in out:
            meta = by_name.get(item["name"]) or {}
            btype = str(meta.get("BOARD_TYPE") or "").strip()
            if btype == "行业":
                item["kind"] = "industry"
            elif btype == "板块":
                item["kind"] = "region"
            else:
                item["kind"] = "concept"
    except Exception:  # noqa: BLE001
        pass
    return out


def fetch_ths_stock_concepts(code: str) -> list[dict[str, Any]]:
    pure = pure_a_share_code(code)
    if not pure:
        return []
    url = f"https://basic.10jqka.com.cn/api/stockph/concept.php?code={urllib.parse.quote(pure)}"
    try:
        data = _http_get_json(
            url,
            timeout=12.0,
            headers={
                "Referer": "https://basic.10jqka.com.cn/",
                "Accept": "application/json,*/*",
            },
        )
    except Exception:  # noqa: BLE001
        return []
    status = data.get("status_code")
    if status is not None and int(status) != 0:
        return []
    out: list[dict[str, Any]] = []
    for row in data.get("data") or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "source": "ths",
                "kind": "concept",
                "boardCode": str(row.get("plateid") or row.get("cid") or "").strip() or None,
            }
        )
    return out


def merge_named_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for row in items:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        kind = str(row.get("kind") or "concept")
        # industry/region 统一可按 board 查询，但仍分种存储
        key = (concept_name_key(name), kind)
        src = str(row.get("source") or "unknown")
        if key not in buckets:
            buckets[key] = {
                "name": name,
                "name_key": key[0],
                "kind": kind,
                "sources": [src],
            }
            order.append(key)
            continue
        cur = buckets[key]
        if src not in cur["sources"]:
            cur["sources"].append(src)
        if len(name) > len(str(cur.get("name") or "")):
            cur["name"] = name
    return [buckets[k] for k in order]


def fetch_stock_items_merged(code: str) -> list[dict[str, Any]]:
    em_items: list[dict[str, Any]] = []
    ths_items: list[dict[str, Any]] = []
    try:
        em_items = fetch_em_stock_boards(code)
    except Exception:  # noqa: BLE001
        em_items = []
    try:
        ths_items = fetch_ths_stock_concepts(code)
    except Exception:  # noqa: BLE001
        ths_items = []
    return merge_named_items([*em_items, *ths_items])


def save_stock_items(code: str, items: list[dict[str, Any]]) -> int:
    pure = pure_a_share_code(code)
    if not pure:
        return 0
    init_db()
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM stock_board_map WHERE code = ?", (pure,))
        for item in items:
            conn.execute(
                """
                INSERT INTO stock_board_map(code, name_key, name, kind, sources_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    pure,
                    item["name_key"],
                    item["name"],
                    item["kind"],
                    json.dumps(item.get("sources") or [], ensure_ascii=False),
                    now,
                ),
            )
        conn.commit()
    return len(items)


def get_stock_items_from_db(
    codes: list[str],
    *,
    category: str = "all",
) -> dict[str, list[dict[str, Any]]]:
    """category: all | concept | board（board=industry+region）。"""
    pure_list = []
    seen: set[str] = set()
    for c in codes:
        p = pure_a_share_code(c)
        if p and p not in seen:
            seen.add(p)
            pure_list.append(p)
    if not pure_list:
        return {}
    init_db()
    conn = get_conn()
    placeholders = ",".join("?" for _ in pure_list)
    if category == "concept":
        kind_sql = "AND kind = 'concept'"
    elif category == "board":
        kind_sql = "AND kind IN ('industry', 'region')"
    else:
        kind_sql = ""
    with _lock:
        rows = conn.execute(
            f"""
            SELECT code, name, kind, sources_json, name_key
            FROM stock_board_map
            WHERE code IN ({placeholders}) {kind_sql}
            ORDER BY code, kind, name
            """,
            pure_list,
        ).fetchall()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        code = str(r["code"])
        try:
            sources = json.loads(r["sources_json"] or "[]")
        except json.JSONDecodeError:
            sources = []
        out.setdefault(code, []).append(
            {
                "name": str(r["name"]),
                "sources": sources if isinstance(sources, list) else [],
                "kinds": [str(r["kind"])],
                "kind": str(r["kind"]),
            }
        )
    return out


def get_catalog_from_db(
    *,
    kind: str = "concept",
    source: str = "all",
) -> list[dict[str, Any]]:
    """kind: concept|industry；source: eastmoney|ths|all。"""
    init_db()
    conn = get_conn()
    params: list[Any] = []
    where = ["kind = ?"]
    params.append(kind)
    if source in ("eastmoney", "ths", "sina"):
        where.append("source = ?")
        params.append(source)
    with _lock:
        rows = conn.execute(
            f"""
            SELECT source, kind, code, name, name_key, extra_json, updated_at
            FROM board_catalog
            WHERE {' AND '.join(where)}
            ORDER BY name
            """,
            params,
        ).fetchall()

    if source != "all":
        items = []
        for i, r in enumerate(rows, start=1):
            try:
                extra = json.loads(r["extra_json"] or "{}")
            except json.JSONDecodeError:
                extra = {}
            if not isinstance(extra, dict):
                extra = {}
            items.append(
                {
                    "rank": i,
                    "code": str(r["code"]),
                    "name": str(r["name"]),
                    "price": extra.get("price"),
                    "change": extra.get("change"),
                    "changePercent": extra.get("changePercent"),
                    "totalMarketCap": extra.get("totalMarketCap"),
                    "turnoverRate": extra.get("turnoverRate"),
                    "riseCount": extra.get("riseCount"),
                    "fallCount": extra.get("fallCount"),
                    "leadingStock": extra.get("leadingStock"),
                    "leadingStockChangePercent": extra.get("leadingStockChangePercent"),
                    "source": str(r["source"]),
                    "sources": [str(r["source"])],
                    "kind": str(r["kind"]),
                }
            )
        return items

    # 合并同名
    buckets: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for r in rows:
        name = str(r["name"])
        key = str(r["name_key"] or concept_name_key(name))
        src = str(r["source"])
        try:
            extra = json.loads(r["extra_json"] or "{}")
        except json.JSONDecodeError:
            extra = {}
        if not isinstance(extra, dict):
            extra = {}
        if key not in buckets:
            buckets[key] = {
                "code": str(r["code"]),
                "name": name,
                "source": src,
                "sources": [src],
                "kind": str(r["kind"]),
                **{
                    k: extra.get(k)
                    for k in (
                        "price",
                        "change",
                        "changePercent",
                        "totalMarketCap",
                        "turnoverRate",
                        "riseCount",
                        "fallCount",
                        "leadingStock",
                        "leadingStockChangePercent",
                    )
                },
            }
            order.append(key)
            continue
        cur = buckets[key]
        if src not in cur["sources"]:
            cur["sources"].append(src)
        if src == "eastmoney" or (
            "eastmoney" in cur["sources"] and cur.get("source") != "eastmoney"
        ):
            cur["code"] = str(r["code"])
            cur["source"] = "eastmoney"
            for field in (
                "price",
                "change",
                "changePercent",
                "totalMarketCap",
                "turnoverRate",
                "riseCount",
                "fallCount",
                "leadingStock",
                "leadingStockChangePercent",
            ):
                if extra.get(field) is not None:
                    cur[field] = extra.get(field)
        if len(name) > len(str(cur.get("name") or "")):
            cur["name"] = name
        cur["source"] = "eastmoney" if "eastmoney" in cur["sources"] else cur["sources"][0]

    items = []
    for i, key in enumerate(order, start=1):
        row = buckets[key]
        row["rank"] = i
        items.append(row)
    items.sort(
        key=lambda x: (
            x.get("changePercent") is not None,
            x.get("changePercent") if x.get("changePercent") is not None else -1e18,
            str(x.get("name") or ""),
        ),
        reverse=True,
    )
    for i, row in enumerate(items, start=1):
        row["rank"] = i
    return items


def _run_full_sync(*, force: bool = False) -> None:
    try:
        _set_progress(
            active=True,
            phase="catalog",
            done=0,
            total=3,
            ok_count=0,
            failed=0,
            message="同步板块/概念目录…",
            last_error=None,
        )
        _upsert_sync_meta("full", state="running", done=0, total=0, error=None)

        # 1) 目录
        catalogs: list[dict[str, Any]] = []
        for label, fetcher in (
            ("eastmoney-concept", lambda: fetch_em_board_catalog("concept")),
            ("eastmoney-industry", lambda: fetch_em_board_catalog("industry")),
            ("ths-concept", fetch_ths_concept_catalog),
        ):
            try:
                part = fetcher()
                catalogs.extend(part)
                _log.info("catalog %s: %s", label, len(part))
            except Exception as e:  # noqa: BLE001
                _log.warning("catalog %s failed: %s", label, e)
            _set_progress(done=_progress["done"] + 1, total=3)

        n_cat = save_board_catalog(catalogs)
        _upsert_sync_meta(
            "catalog",
            state="idle",
            row_count=n_cat,
            synced_at=time.time(),
            done=3,
            total=3,
        )

        # 2) 个股全量
        codes = list_cn_codes()
        total = len(codes)
        _set_progress(
            phase="stocks",
            done=0,
            total=total,
            ok_count=0,
            failed=0,
            message=f"同步个股板块/概念 0/{total}",
        )
        _upsert_sync_meta("stocks", state="running", done=0, total=total)

        ok = 0
        failed = 0
        workers = 6

        def _one(c: str) -> tuple[str, int, bool]:
            try:
                items = fetch_stock_items_merged(c)
                if items:
                    save_stock_items(c, items)
                    return c, len(items), True
                # 空也写库清旧数据
                save_stock_items(c, [])
                return c, 0, True
            except Exception as e:  # noqa: BLE001
                _log.debug("stock %s failed: %s", c, e)
                return c, 0, False

        done = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = [pool.submit(_one, c) for c in codes]
            for fut in as_completed(futs):
                _code, _n, success = fut.result()
                done += 1
                if success:
                    ok += 1
                else:
                    failed += 1
                if done % 20 == 0 or done == total:
                    _set_progress(
                        done=done,
                        total=total,
                        ok_count=ok,
                        failed=failed,
                        message=f"同步个股板块/概念 {done}/{total}",
                    )
                    _upsert_sync_meta(
                        "stocks",
                        state="running",
                        done=done,
                        total=total,
                        row_count=ok,
                    )

        now = time.time()
        _upsert_sync_meta(
            "stocks",
            state="idle",
            done=total,
            total=total,
            row_count=ok,
            synced_at=now,
        )
        _upsert_sync_meta(
            "full",
            state="idle",
            done=total,
            total=total,
            row_count=ok,
            synced_at=now,
            detail={"catalog": n_cat, "stocks_ok": ok, "stocks_failed": failed},
        )
        _set_progress(
            active=False,
            phase="done",
            done=total,
            total=total,
            ok_count=ok,
            failed=failed,
            message="同步完成",
            synced_at=now,
        )
    except Exception as e:  # noqa: BLE001
        _log.exception("full board/concept sync failed")
        _upsert_sync_meta("full", state="error", error=str(e))
        _set_progress(active=False, phase="error", last_error=str(e), message="同步失败")


def get_codes_by_concept_names(
    names: list[str],
    *,
    kind: str = "concept",
    match: str = "and",
) -> list[str]:
    """按概念/板块名反查股票代码。match=and 需同时命中全部名称。"""
    keys: list[str] = []
    seen: set[str] = set()
    for n in names:
        k = concept_name_key(n)
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    if not keys:
        return []
    init_db()
    conn = get_conn()
    kind_sql = ""
    params: list[Any] = list(keys)
    if kind == "concept":
        kind_sql = "AND kind = 'concept'"
    elif kind == "board":
        kind_sql = "AND kind IN ('industry', 'region')"
    placeholders = ",".join("?" for _ in keys)
    with _lock:
        rows = conn.execute(
            f"""
            SELECT code, name_key
            FROM stock_board_map
            WHERE name_key IN ({placeholders}) {kind_sql}
            """,
            params,
        ).fetchall()
    by_code: dict[str, set[str]] = {}
    for r in rows:
        by_code.setdefault(str(r["code"]), set()).add(str(r["name_key"]))
    need = set(keys)
    out: list[str] = []
    for code, hit in by_code.items():
        if match == "and":
            if need.issubset(hit):
                out.append(code)
        elif hit & need:
            out.append(code)
    out.sort()
    return out


def list_bj_codes() -> list[str]:
    """北交所代码（92/8/4）。"""
    return [
        c
        for c in list_cn_codes()
        if c.startswith("92") or c.startswith(("8", "4"))
    ]


def _source_sql_clause(source: str | None) -> tuple[str, list[Any]]:
    """sources_json 含某源；source=None/all 不过滤。"""
    if source in (None, "", "all"):
        return "", []
    return "AND instr(lower(sources_json), ?) > 0", [str(source).lower()]


def aggregate_concept_stats_from_db(
    *,
    source: str | None = "ths",
) -> dict[str, dict[str, Any]]:
    """按概念 name_key 聚合成份行情（本库 quote_snapshot）。

    返回 name_key -> {changePercent, riseCount, fallCount, leadingStock, ...}
    效率：一次 SQL，适合板块列表批量补字段。
    """
    init_db()
    conn = get_conn()
    src_sql, src_params = _source_sql_clause(source)
    with _lock:
        # 基础聚合
        rows = conn.execute(
            f"""
            SELECT
              m.name_key AS name_key,
              MAX(m.name) AS name,
              COUNT(*) AS member_count,
              AVG(q.change_percent) AS avg_change_percent,
              SUM(CASE WHEN q.change_percent > 0 THEN 1 ELSE 0 END) AS rise_count,
              SUM(CASE WHEN q.change_percent < 0 THEN 1 ELSE 0 END) AS fall_count,
              SUM(q.total_market_cap) AS total_market_cap,
              AVG(q.turnover_rate) AS avg_turnover_rate
            FROM stock_board_map m
            JOIN quote_snapshot q
              ON q.market = 'cn' AND q.code = m.code
            WHERE m.kind = 'concept' {src_sql}
            GROUP BY m.name_key
            """,
            src_params,
        ).fetchall()
        leaders = conn.execute(
            f"""
            SELECT name_key, stock_name, change_percent FROM (
              SELECT
                m.name_key AS name_key,
                q.name AS stock_name,
                q.change_percent AS change_percent,
                ROW_NUMBER() OVER (
                  PARTITION BY m.name_key
                  ORDER BY q.change_percent DESC NULLS LAST
                ) AS rn
              FROM stock_board_map m
              JOIN quote_snapshot q
                ON q.market = 'cn' AND q.code = m.code
              WHERE m.kind = 'concept' {src_sql}
            ) t
            WHERE rn = 1
            """,
            src_params,
        ).fetchall()
    lead_map = {
        str(r["name_key"]): {
            "leadingStock": str(r["stock_name"] or "") or None,
            "leadingStockChangePercent": (
                float(r["change_percent"])
                if r["change_percent"] is not None
                else None
            ),
        }
        for r in leaders
    }
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = str(r["name_key"])
        lead = lead_map.get(key) or {}
        out[key] = {
            "name": str(r["name"] or ""),
            "memberCount": int(r["member_count"] or 0),
            "changePercent": (
                float(r["avg_change_percent"])
                if r["avg_change_percent"] is not None
                else None
            ),
            "riseCount": int(r["rise_count"] or 0),
            "fallCount": int(r["fall_count"] or 0),
            "totalMarketCap": (
                float(r["total_market_cap"])
                if r["total_market_cap"] is not None
                else None
            ),
            "turnoverRate": (
                float(r["avg_turnover_rate"])
                if r["avg_turnover_rate"] is not None
                else None
            ),
            "leadingStock": lead.get("leadingStock"),
            "leadingStockChangePercent": lead.get("leadingStockChangePercent"),
            "statsSource": "db_aggregate",
        }
    return out


def enrich_board_items_from_db(
    items: list[dict[str, Any]],
    *,
    source: str | None = "ths",
    only_missing: bool = True,
) -> list[dict[str, Any]]:
    """把本库聚合行情填到板块列表项（按 name_key 对齐）。"""
    if not items:
        return items
    stats = aggregate_concept_stats_from_db(source=source)
    if not stats:
        return items
    for item in items:
        key = concept_name_key(str(item.get("name") or ""))
        st = stats.get(key)
        if not st:
            continue
        for field in (
            "changePercent",
            "riseCount",
            "fallCount",
            "totalMarketCap",
            "turnoverRate",
            "leadingStock",
            "leadingStockChangePercent",
        ):
            if only_missing and item.get(field) is not None:
                continue
            if st.get(field) is not None:
                item[field] = st.get(field)
        item["memberCount"] = st.get("memberCount")
        item["statsSource"] = st.get("statsSource")
    # 有聚合涨跌时按涨跌幅重排
    items.sort(
        key=lambda x: (
            x.get("changePercent") is not None,
            x.get("changePercent") if x.get("changePercent") is not None else -1e18,
        ),
        reverse=True,
    )
    for i, row in enumerate(items, start=1):
        row["rank"] = i
    return items


def get_concept_board_from_db(
    code: str,
    *,
    source: str = "ths",
) -> dict[str, Any] | None:
    """按 ths:ID / 名称 取概念元信息 + 聚合行情。"""
    raw = str(code or "").strip()
    if not raw:
        return None
    init_db()
    conn = get_conn()
    name = ""
    board_code = raw
    name_key = ""
    with _lock:
        if raw.startswith("ths:") or raw.isdigit():
            cid = raw.replace("ths:", "")
            row = conn.execute(
                """
                SELECT code, name, name_key FROM board_catalog
                WHERE source = 'ths' AND kind = 'concept'
                  AND (code = ? OR code = ?)
                LIMIT 1
                """,
                (f"ths:{cid}", cid),
            ).fetchone()
            if row:
                board_code = str(row["code"])
                name = str(row["name"])
                name_key = str(row["name_key"])
        if not name_key:
            name_key = concept_name_key(raw)
            row = conn.execute(
                """
                SELECT code, name, name_key FROM board_catalog
                WHERE kind = 'concept' AND name_key = ?
                ORDER BY CASE source WHEN 'ths' THEN 0 ELSE 1 END
                LIMIT 1
                """,
                (name_key,),
            ).fetchone()
            if row:
                board_code = str(row["code"])
                name = str(row["name"])
                name_key = str(row["name_key"])
    if not name_key:
        return None
    stats = aggregate_concept_stats_from_db(source=source).get(name_key) or {}
    return {
        "rank": 0,
        "code": board_code,
        "name": name or stats.get("name") or raw,
        "price": None,
        "change": None,
        "changePercent": stats.get("changePercent"),
        "totalMarketCap": stats.get("totalMarketCap"),
        "turnoverRate": stats.get("turnoverRate"),
        "riseCount": stats.get("riseCount"),
        "fallCount": stats.get("fallCount"),
        "leadingStock": stats.get("leadingStock"),
        "leadingStockChangePercent": stats.get("leadingStockChangePercent"),
        "memberCount": stats.get("memberCount"),
        "source": source,
        "sources": [source],
        "statsSource": stats.get("statsSource") or "db_aggregate",
        "nameKey": name_key,
    }


def get_concept_constituents_from_db(
    code: str,
    *,
    source: str = "ths",
) -> dict[str, Any]:
    """同花顺/库内概念成份：map ∩ 本库行情。"""
    meta = get_concept_board_from_db(code, source=source)
    if not meta:
        return {"board": None, "items": []}
    name_key = str(meta.get("nameKey") or concept_name_key(str(meta.get("name") or "")))
    init_db()
    conn = get_conn()
    src_sql, src_params = _source_sql_clause(source)
    with _lock:
        rows = conn.execute(
            f"""
            SELECT
              m.code AS code,
              q.name AS name,
              q.price AS price,
              q.change_percent AS change_percent,
              q.amount AS amount,
              q.turnover_rate AS turnover_rate,
              q.pe AS pe,
              q.total_market_cap AS total_market_cap
            FROM stock_board_map m
            LEFT JOIN quote_snapshot q
              ON q.market = 'cn' AND q.code = m.code
            WHERE m.kind = 'concept' AND m.name_key = ? {src_sql}
            ORDER BY q.change_percent DESC NULLS LAST, m.code
            """,
            [name_key, *src_params],
        ).fetchall()
    items = []
    for i, r in enumerate(rows, start=1):
        items.append(
            {
                "rank": i,
                "code": str(r["code"]),
                "name": str(r["name"] or r["code"]),
                "price": float(r["price"]) if r["price"] is not None else None,
                "changePercent": (
                    float(r["change_percent"])
                    if r["change_percent"] is not None
                    else None
                ),
                "amount": float(r["amount"]) if r["amount"] is not None else None,
                "turnoverRate": (
                    float(r["turnover_rate"])
                    if r["turnover_rate"] is not None
                    else None
                ),
                "pe": float(r["pe"]) if r["pe"] is not None else None,
                "totalMarketCap": (
                    float(r["total_market_cap"])
                    if r["total_market_cap"] is not None
                    else None
                ),
            }
        )
    return {"board": meta, "items": items}


def _run_codes_sync(codes: list[str], *, label: str = "codes") -> None:
    try:
        uniq: list[str] = []
        seen: set[str] = set()
        for c in codes:
            p = pure_a_share_code(c)
            if p and p not in seen:
                seen.add(p)
                uniq.append(p)
        total = len(uniq)
        _set_progress(
            active=True,
            phase="stocks",
            done=0,
            total=total,
            ok_count=0,
            failed=0,
            message=f"补同步{label} 0/{total}",
            last_error=None,
        )
        ok = 0
        failed = 0
        done = 0

        def _one(c: str) -> bool:
            try:
                items = fetch_stock_items_merged(c)
                save_stock_items(c, items)
                return True
            except Exception:  # noqa: BLE001
                return False

        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = [pool.submit(_one, c) for c in uniq]
            for fut in as_completed(futs):
                success = fut.result()
                done += 1
                if success:
                    ok += 1
                else:
                    failed += 1
                if done % 10 == 0 or done == total:
                    _set_progress(
                        done=done,
                        total=total,
                        ok_count=ok,
                        failed=failed,
                        message=f"补同步{label} {done}/{total}",
                    )
        _set_progress(
            active=False,
            phase="done",
            done=total,
            total=total,
            ok_count=ok,
            failed=failed,
            message=f"补同步{label}完成",
            synced_at=time.time(),
        )
    except Exception as e:  # noqa: BLE001
        _log.exception("codes board/concept sync failed")
        _set_progress(active=False, phase="error", last_error=str(e), message="补同步失败")


def start_full_sync(*, force: bool = False) -> dict[str, Any]:
    global _sync_thread
    with _sync_lock:
        if _progress.get("active") and _sync_thread and _sync_thread.is_alive():
            return {"ok": True, "started": False, "reason": "already_running", **get_sync_progress()}
        t = threading.Thread(
            target=_run_full_sync,
            kwargs={"force": force},
            name="board-concepts-sync",
            daemon=True,
        )
        _sync_thread = t
        t.start()
    return {"ok": True, "started": True, **get_sync_progress()}


def start_bj_resync() -> dict[str, Any]:
    """修复北交所前缀后，补拉北交所个股概念/板块。"""
    global _sync_thread
    codes = list_bj_codes()
    with _sync_lock:
        if _progress.get("active") and _sync_thread and _sync_thread.is_alive():
            return {"ok": True, "started": False, "reason": "already_running", **get_sync_progress()}
        t = threading.Thread(
            target=_run_codes_sync,
            kwargs={"codes": codes, "label": "北交所"},
            name="board-concepts-bj-sync",
            daemon=True,
        )
        _sync_thread = t
        t.start()
    return {
        "ok": True,
        "started": True,
        "codes": len(codes),
        **get_sync_progress(),
    }


def db_stats() -> dict[str, Any]:
    init_db()
    conn = get_conn()
    with _lock:
        cat = conn.execute("SELECT COUNT(*) AS c FROM board_catalog").fetchone()["c"]
        maps = conn.execute("SELECT COUNT(*) AS c FROM stock_board_map").fetchone()["c"]
        stocks = conn.execute(
            "SELECT COUNT(DISTINCT code) AS c FROM stock_board_map"
        ).fetchone()["c"]
        concepts = conn.execute(
            "SELECT COUNT(*) AS c FROM stock_board_map WHERE kind='concept'"
        ).fetchone()["c"]
        boards = conn.execute(
            "SELECT COUNT(*) AS c FROM stock_board_map WHERE kind IN ('industry','region')"
        ).fetchone()["c"]
        meta = conn.execute(
            "SELECT key, synced_at, row_count, sync_state, last_error, progress_done, progress_total FROM board_sync_meta"
        ).fetchall()
    return {
        "catalog": int(cat or 0),
        "map_rows": int(maps or 0),
        "stocks": int(stocks or 0),
        "concept_rows": int(concepts or 0),
        "board_rows": int(boards or 0),
        "meta": [
            {
                "key": r["key"],
                "synced_at": r["synced_at"],
                "row_count": r["row_count"],
                "sync_state": r["sync_state"],
                "last_error": r["last_error"],
                "progress_done": r["progress_done"],
                "progress_total": r["progress_total"],
            }
            for r in meta
        ],
    }
