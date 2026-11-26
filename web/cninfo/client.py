"""巨潮资讯 HTTP 客户端：股票列表 + 历史公告分页。"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

_log = logging.getLogger("cninfo.client")

STOCK_LIST_URL = "http://www.cninfo.com.cn/new/data/szse_stock.json"
QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
STATIC_PDF_BASE = "https://static.cninfo.com.cn/"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
PAGE_SIZE = 30


def market_of(code: str) -> tuple[str, str]:
    """返回 (column, plate)。"""
    c = str(code or "").strip()
    if c.startswith(("4", "8")):
        return "bj", "bj"
    if c.startswith(("5", "6", "9")):
        return "sse", "sh"
    return "szse", "sz"


def pdf_url(adjunct_url: str | None) -> str:
    rel = str(adjunct_url or "").strip().lstrip("/")
    if not rel:
        return ""
    if rel.lower().startswith("http://") or rel.lower().startswith("https://"):
        return rel
    return STATIC_PDF_BASE + rel


def _request_json(
    url: str,
    *,
    data: bytes | None = None,
    timeout: float = 25.0,
    retries: int = 3,
) -> Any:
    last_err: Exception | None = None
    for attempt in range(max(1, retries)):
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "http://www.cninfo.com.cn",
                "Referer": "http://www.cninfo.com.cn/new/disclosure/stock",
            },
            method="POST" if data is not None else "GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            _log.warning("cninfo request failed attempt=%s url=%s err=%s", attempt + 1, url, e)
            if attempt + 1 < retries:
                time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(str(last_err or "cninfo request failed"))


def fetch_stock_list(*, timeout: float = 40.0) -> list[dict[str, str]]:
    """拉全市场列表，仅保留 A 股。"""
    payload = _request_json(STOCK_LIST_URL, timeout=timeout)
    raw = payload.get("stockList") if isinstance(payload, dict) else payload
    if not isinstance(raw, list):
        raise RuntimeError("cninfo stock list invalid")
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if str(item.get("category") or "").strip() != "A股":
            continue
        code = str(item.get("code") or "").strip()
        org_id = str(item.get("orgId") or "").strip()
        if len(code) < 6 or not org_id:
            continue
        code6 = code[-6:] if len(code) > 6 else code
        if not code6.isdigit():
            continue
        column, plate = market_of(code6)
        out.append(
            {
                "code": code6,
                "org_id": org_id,
                "name": str(item.get("zwjc") or "").strip(),
                "market": column,
                "category": "A股",
                "plate": plate,
            }
        )
    return out


def query_announcements(
    *,
    code: str,
    org_id: str,
    page_num: int = 1,
    page_size: int = PAGE_SIZE,
    se_date: str = "",
    timeout: float = 25.0,
) -> dict[str, Any]:
    """分页查询单只股票公告。se_date 形如 YYYY-MM-DD~YYYY-MM-DD。"""
    code6 = str(code).strip()[-6:]
    column, plate = market_of(code6)
    form = {
        "stock": f"{code6},{org_id}",
        "tabName": "fulltext",
        "pageSize": str(max(1, min(int(page_size), 50))),
        "pageNum": str(max(1, int(page_num))),
        "column": column,
        "category": "",
        "plate": plate,
        "seDate": se_date or "",
        "searchkey": "",
        "secid": "",
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    body = urllib.parse.urlencode(form).encode("utf-8")
    payload = _request_json(QUERY_URL, data=body, timeout=timeout)
    if not isinstance(payload, dict):
        raise RuntimeError("cninfo query invalid payload")
    return payload


def normalize_announcement(item: dict[str, Any], *, code: str, org_id: str) -> dict[str, Any] | None:
    aid = str(item.get("announcementId") or "").strip()
    if not aid:
        return None
    title = str(item.get("announcementTitle") or "").strip()
    # 去掉标题里偶发的 HTML 高亮标签
    if "<" in title:
        title = (
            title.replace("<em>", "")
            .replace("</em>", "")
            .replace("<EM>", "")
            .replace("</EM>", "")
        )
    try:
        ts = int(item.get("announcementTime") or 0)
    except (TypeError, ValueError):
        ts = 0
    adjunct = str(item.get("adjunctUrl") or "").strip()
    return {
        "announcement_id": aid,
        "code": str(code).strip()[-6:],
        "org_id": str(item.get("orgId") or org_id or "").strip() or None,
        "title": title,
        "announce_time_ms": ts,
        "adjunct_url": adjunct or None,
        "adjunct_type": str(item.get("adjunctType") or "").strip() or None,
    }
