"""选股宝 flash-api：涨跌停池 + 题材概况。"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

POOL_URL = "https://flash-api.xuangubao.cn/api/pool/detail"
PLATE_URL = "https://flash-api.xuangubao.cn/api/plate/data"

POOLS = ("limit_up", "limit_down")

_PLATE_FIELDS = (
    "core_avg_pcp,plate_name,rise_count,fall_count,stay_count,limit_up_count"
)


def _http_get_json(url: str, *, referer: str, timeout: float = 20.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; mootdx-zt-history/0.1)",
            "Accept": "application/json",
            "Referer": referer,
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def fetch_pool_items(pool_name: str) -> list[dict[str, Any]]:
    if pool_name not in POOLS and pool_name not in (
        "yesterday_limit_up",
        "stock_chance",
        "limit_up_broken",
    ):
        raise ValueError(f"unsupported pool: {pool_name}")
    url = f"{POOL_URL}?{urllib.parse.urlencode({'pool_name': pool_name})}"
    payload = _http_get_json(url, referer="https://xuangubao.cn/")
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError(f"unexpected upstream payload for {pool_name}")
    out: list[dict[str, Any]] = []
    for it in items:
        if isinstance(it, dict):
            out.append(it)
    return out


def fetch_plate_data(plate_ids: list[str]) -> dict[str, dict[str, Any]]:
    """返回 plate_id -> 字段字典；失败返回空 dict。"""
    ids = [p for p in plate_ids if p and p.isdigit()]
    if not ids:
        return {}
    result: dict[str, dict[str, Any]] = {}
    # 上游批量上限保守分片
    for i in range(0, len(ids), 40):
        chunk = ids[i : i + 40]
        url = (
            f"{PLATE_URL}?"
            + urllib.parse.urlencode(
                {"plates": ",".join(chunk), "fields": _PLATE_FIELDS}
            )
        )
        try:
            payload = _http_get_json(url, referer="https://xuangutong.com.cn/")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            continue
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            continue
        for pid, row in data.items():
            if isinstance(row, dict):
                result[str(pid)] = row
    return result
