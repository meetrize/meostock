"""主线板块 leaders（设计方案 §4.3）：涨幅 Top + 扩散 + 生命周期启发式。

数据优先级：
1. 本地 board_catalog（定时同步，含 changePercent / 涨跌家数 / 领涨股）
2. 本库成份聚合补缺
3. 新浪板块榜兜底
4. 东财 clist（多 host）
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

_log = logging.getLogger("research.themes")
_SH = ZoneInfo("Asia/Shanghai")
_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_EM_HOSTS = (
    "https://push2delay.eastmoney.com/api/qt/clist/get",
    "https://push2.eastmoney.com/api/qt/clist/get",
    "https://82.push2.eastmoney.com/api/qt/clist/get",
)
_FS = {
    "industry": "m:90+t:2+f:!50",
    "concept": "m:90+t:3+f:!50",
}
_FIELDS = "f12,f14,f2,f3,f4,f8,f20,f104,f105,f128,f136"
_SINA_FLJK = "https://money.finance.sina.com.cn/q/view/newFLJK.php"
_SINA_PARAM = {"industry": "industry", "concept": "class"}


def _num(v: Any) -> float | None:
    try:
        if v is None or v == "" or v == "-":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _stage(pct: float | None, rise: float | None) -> str:
    """题材生命周期启发式：seed / ferment / climax / ebb（设计方案主线看板）。"""
    if pct is not None and pct >= 5 and (rise or 0) >= 10:
        return "climax"
    if pct is not None and pct >= 2:
        return "ferment"
    if pct is not None and pct < 0:
        return "ebb"
    return "seed"


def _normalize_row(row: dict[str, Any], board_type: str, *, source: str) -> dict[str, Any] | None:
    code = str(row.get("code") or "").strip()
    name = str(row.get("name") or "").strip()
    if not code or not name:
        return None
    pct = _num(row.get("changePercent"))
    rise = _num(row.get("riseCount"))
    fall = _num(row.get("fallCount"))
    return {
        "code": code,
        "name": name,
        "type": board_type,
        "changePercent": pct,
        "riseCount": int(rise) if rise is not None else None,
        "fallCount": int(fall) if fall is not None else None,
        "leadingStock": (str(row.get("leadingStock") or "").strip() or None),
        "leadingStockChangePercent": _num(row.get("leadingStockChangePercent")),
        "stage": _stage(pct, rise),
        "source": source,
        "memberCount": row.get("memberCount"),
    }


def _sort_by_pct(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows.sort(
        key=lambda x: (
            x.get("changePercent") is not None,
            x.get("changePercent") if x.get("changePercent") is not None else -1e18,
        ),
        reverse=True,
    )
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


def _from_local_db(board_type: str) -> tuple[list[dict[str, Any]], str | None]:
    """读本地目录；有涨幅则可直接作为主线。"""
    try:
        from cache import board_concepts as bcm

        kind = "industry" if board_type == "industry" else "concept"
        items = bcm.get_catalog_from_db(kind=kind, source="eastmoney") or []
        if not items:
            items = bcm.get_catalog_from_db(kind=kind, source="all") or []
        if not items:
            return [], None
        try:
            items = bcm.enrich_board_items_from_db(
                list(items),
                source="eastmoney",
                kind=kind,
                only_missing=True,
            )
        except Exception as exc:  # noqa: BLE001
            _log.debug("enrich board %s skipped: %s", board_type, exc)

        out: list[dict[str, Any]] = []
        for it in items:
            row = _normalize_row(it, board_type, source=f"db:{it.get('source') or 'eastmoney'}")
            if row:
                out.append(row)
        out = _sort_by_pct(out)
        with_pct = sum(1 for r in out if r.get("changePercent") is not None)
        if with_pct == 0:
            return out, "db_no_change_percent"
        return out, "db"
    except Exception as exc:  # noqa: BLE001
        _log.warning("local board catalog %s failed: %s", board_type, exc)
        return [], f"db:{exc}"


def _http_get_json(url: str, *, timeout: float = 10.0, headers: dict[str, str] | None = None) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept": "*/*",
            **(headers or {}),
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":
        import gzip

        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8", errors="replace"))


def _from_sina(board_type: str) -> list[dict[str, Any]]:
    param = _SINA_PARAM[board_type]
    url = f"{_SINA_FLJK}?{urllib.parse.urlencode({'param': param})}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": _BROWSER_UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "*/*",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=12.0) as resp:
        blob = resp.read()
    text = None
    for enc in ("gbk", "utf-8"):
        try:
            text = blob.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = blob.decode("utf-8", errors="replace")
    m = re.search(r"=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        raise RuntimeError("sina board payload missing")
    data = json.loads(m.group(1))
    rows: list[dict[str, Any]] = []
    for _, v in data.items():
        parts = str(v).split(",")
        if len(parts) < 12:
            continue
        code = parts[0].strip()
        name = parts[1].strip()
        if not code or not name:
            continue
        leading = ",".join(parts[12:]).strip() if len(parts) > 12 else parts[-1].strip()
        pct = _num(parts[5])
        rows.append(
            {
                "code": code,
                "name": name,
                "type": board_type,
                "changePercent": pct,
                "riseCount": None,
                "fallCount": None,
                "leadingStock": leading or None,
                "leadingStockChangePercent": _num(parts[9]),
                "stage": _stage(pct, None),
                "source": "sina",
            }
        )
    return _sort_by_pct(rows)


def _from_eastmoney(board_type: str, *, pz: int = 50) -> list[dict[str, Any]]:
    fs = _FS[board_type]
    params = {
        "pn": "1",
        "pz": str(pz),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": fs,
        "fields": _FIELDS,
    }
    qs = urllib.parse.urlencode(params)
    data: dict[str, Any] | None = None
    last_err: Exception | None = None
    for host in _EM_HOSTS:
        try:
            data = _http_get_json(
                f"{host}?{qs}",
                timeout=10.0,
                headers={"Referer": "https://quote.eastmoney.com/"},
            )
            break
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if data is None:
        raise last_err or RuntimeError("eastmoney board list failed")
    diff = (((data or {}).get("data") or {}).get("diff")) or []
    rows: list[dict[str, Any]] = []
    for row in diff:
        code = str(row.get("f12") or "").strip()
        name = str(row.get("f14") or "").strip()
        if not code or not name:
            continue
        pct = _num(row.get("f3"))
        rise = _num(row.get("f104"))
        rows.append(
            {
                "code": code,
                "name": name,
                "type": board_type,
                "changePercent": pct,
                "riseCount": int(rise) if rise is not None else None,
                "fallCount": int(r) if (r := _num(row.get("f105"))) is not None else None,
                "leadingStock": (str(row.get("f128") or "").strip() or None),
                "leadingStockChangePercent": _num(row.get("f136")),
                "stage": _stage(pct, rise),
                "source": "eastmoney",
            }
        )
    return _sort_by_pct(rows)


def _load_board(board_type: str, *, limit: int) -> tuple[list[dict[str, Any]], str, list[str]]:
    """返回 (rows, source_tag, errors)。"""
    errors: list[str] = []
    local, tag = _from_local_db(board_type)
    if local and tag == "db":
        return local[:limit], "db", errors
    if local and tag == "db_no_change_percent":
        errors.append(f"{board_type}: db catalog has no changePercent, try live")
    elif tag and tag.startswith("db:"):
        errors.append(f"{board_type}: {tag}")

    # 新浪兜底（首页涨跌榜，通常比东财 push2 稳）
    try:
        sina = _from_sina(board_type)
        if sina:
            return sina[:limit], "sina", errors
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{board_type}/sina: {exc}")

    # 东财实时
    try:
        em = _from_eastmoney(board_type, pz=max(limit, 50))
        if em:
            return em[:limit], "eastmoney", errors
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{board_type}/eastmoney: {exc}")

    # 库内无涨幅也总比空好（至少能跳转板块页）
    if local:
        return local[:limit], "db_stale", errors
    return [], "none", errors


def build_theme_leaders(*, limit: int = 12) -> dict[str, Any]:
    """主线看板：行业 + 概念各取一半，按涨幅合并 Top。

    展示字段对齐设计：涨幅、扩散（涨跌家数）、领涨股、生命周期 stage。
    资金净流入 / 估值分位标为后续（fund_flow_note / data_gaps）。
    """
    as_of = datetime.now(_SH).isoformat(timespec="seconds")
    half = max(1, limit // 2)
    industry, ind_src, ind_err = _load_board("industry", limit=max(half, limit))
    concept, con_src, con_err = _load_board("concept", limit=max(half, limit))
    errors = [*ind_err, *con_err]

    industry_top = industry[:half]
    concept_top = concept[:half]
    merged = _sort_by_pct([*industry_top, *concept_top])[:limit]

    gaps: list[str] = []
    if not merged:
        gaps.append("board_leaders")
    if ind_src in ("none",) or con_src in ("none",):
        gaps.append("board_remote")
    # 资金 / 估值分位尚未接入主线 API
    gaps.extend(["theme_fund_flow", "theme_valuation_percentile"])

    sources = {
        "industry": ind_src,
        "concept": con_src,
    }

    return {
        "ok": True,
        "as_of": as_of,
        "leaders": merged,
        "industry": industry_top,
        "concept": concept_top,
        "sources": sources,
        "errors": errors,
        "data_gaps": gaps if merged else ["board_leaders", *gaps],
        "disclaimer": "不构成投资建议；生命周期为规则启发式（seed/ferment/climax/ebb）。",
        "fund_flow_note": "板块资金净流入与估值分位仍为后续；当前主线以涨幅 + 涨跌家数扩散 + 领涨股为主",
        "display_hint": "点击可进入板块页查看成分与详情",
    }
