"""个股事件轴：news + calendar + 龙虎榜 + 大宗（聚合已有源）。"""

from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

_log = logging.getLogger("research.timeline")
_SH = ZoneInfo("Asia/Shanghai")


def _now_iso() -> str:
    return datetime.now(_SH).isoformat(timespec="seconds")


def _digits(code: str) -> str:
    m = re.search(r"(\d{6})", code or "")
    return m.group(1) if m else ""


def _norm(code: str) -> str:
    return (code or "").strip().upper()


def _code_match(item_code: str, want_digits: str) -> bool:
    if not want_digits:
        return False
    return _digits(item_code) == want_digits


def _fetch_news(symbol: str, *, limit: int = 15) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta: dict[str, Any] = {"source": "feedgen", "ok": False}
    token = (os.environ.get("FEEDGEN_SERVICE_TOKEN") or "").strip()
    if not token:
        meta["error"] = "FEEDGEN_SERVICE_TOKEN 未配置"
        meta["gap"] = True
        return [], meta
    try:
        # 复用 news 反代逻辑
        from news.api import _proxy_get

        status, data = _proxy_get(
            "/api/finance/articles-by-instrument",
            {
                "chart_symbol": symbol,
                "cursor": "",
                "limit": str(min(limit, 50)),
            },
        )
        if status >= 400:
            meta["error"] = (data or {}).get("error") or f"HTTP {status}"
            meta["gap"] = True
            return [], meta
        articles = data.get("articles") or data.get("items") or data.get("data") or []
        if not isinstance(articles, list):
            articles = []
        out: list[dict[str, Any]] = []
        for i, a in enumerate(articles[:limit]):
            if not isinstance(a, dict):
                continue
            eid = f"news_{a.get('id') or a.get('url') or i}"
            ts = a.get("published_at") or a.get("publishedAt") or a.get("date") or a.get("created_at")
            out.append(
                {
                    "id": eid,
                    "kind": "news",
                    "title": a.get("title") or a.get("headline") or "资讯",
                    "summary": (a.get("summary") or a.get("excerpt") or "")[:240],
                    "at": ts,
                    "url": a.get("url") or a.get("link"),
                    "source": a.get("source") or "feedgen",
                    "raw_ref": str(a.get("id") or ""),
                }
            )
        meta["ok"] = True
        meta["count"] = len(out)
        return out, meta
    except Exception as exc:  # noqa: BLE001
        _log.warning("news fetch failed: %s", exc)
        meta["error"] = str(exc)
        meta["gap"] = True
        return [], meta


def _fetch_calendar(code: str, name: str, *, days: int = 14) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta: dict[str, Any] = {"source": "fe_calendar", "ok": False}
    try:
        from fe_calendar.store import list_events

        today = date.today()
        dig = _digits(code)
        queries = [q for q in (name.strip() if name else "", dig) if q]
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for q in queries or [dig or code]:
            rows = list_events(
                from_day=today.isoformat(),
                to_day=(today + timedelta(days=days)).isoformat(),
                q=q,
                limit=30,
            )
            for r in rows:
                rid = str(r.get("id") or r.get("name") or "")
                if rid in seen:
                    continue
                seen.add(rid)
                eid = f"cal_{rid}"
                out.append(
                    {
                        "id": eid,
                        "kind": "calendar",
                        "title": r.get("name") or "日历事件",
                        "summary": (r.get("content") or r.get("sponsor") or "")[:240],
                        "at": r.get("start_at") or r.get("start_day"),
                        "importance": r.get("importance"),
                        "std_type": r.get("std_type_code") or r.get("fe_type"),
                        "source": r.get("source") or "calendar",
                    }
                )
        meta["ok"] = True
        meta["count"] = len(out)
        meta["note"] = "日历无股票代码字段，按名称/代码文本弱匹配"
        return out, meta
    except Exception as exc:  # noqa: BLE001
        _log.warning("calendar fetch failed: %s", exc)
        meta["error"] = str(exc)
        meta["gap"] = True
        return [], meta


def _match_topic_items(
    items: list[dict[str, Any]],
    want_digits: str,
    *,
    kind: str,
    trade_date: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, it in enumerate(items):
        code = str(it.get("code") or it.get("klineSymbol") or "")
        if not _code_match(code, want_digits):
            continue
        eid = f"{kind}_{trade_date}_{want_digits}_{i}"
        if kind == "top_list":
            title = f"龙虎榜 · {it.get('reason') or '上榜'}"
            summary = (
                f"净买额 {it.get('netAmount')} · 买入 {it.get('lBuy')} · 卖出 {it.get('lSell')}"
            )
        else:
            title = "大宗交易"
            summary = (
                f"成交额 {it.get('amount')} · 买方 {it.get('buyer')} · 卖方 {it.get('seller')}"
            )
        out.append(
            {
                "id": eid,
                "kind": kind,
                "title": title,
                "summary": summary,
                "at": trade_date,
                "trade_date": trade_date,
                "payload": {
                    k: it.get(k)
                    for k in (
                        "pctChange",
                        "netAmount",
                        "amount",
                        "price",
                        "vol",
                        "buyer",
                        "seller",
                        "reason",
                    )
                    if it.get(k) is not None
                },
                "source": f"tushare:{kind}",
            }
        )
    return out


def _load_topic_for_code(
    market_id: str,
    kind: str,
    want_digits: str,
    *,
    lookback_days: int = 5,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta: dict[str, Any] = {"source": market_id, "ok": False}
    try:
        from tsrelay.markets import fetch_market, resolve_trade_date
        from tsrelay import store as ts_store

        info = resolve_trade_date(prefer_today=True)
        td = str(info.get("trade_date") or "")
        if not td:
            meta["error"] = "无交易日"
            meta["gap"] = True
            return [], meta

        out: list[dict[str, Any]] = []
        dates_tried: list[str] = []
        # 先缓存，再必要时拉一次最近交易日
        for offset in range(lookback_days):
            d = td
            if offset > 0:
                # 简单日历回退（非严格交易日）；缓存未命中则跳过
                try:
                    dt = datetime.strptime(td, "%Y%m%d") - timedelta(days=offset)
                    d = dt.strftime("%Y%m%d")
                except ValueError:
                    break
            dates_tried.append(d)
            snap = ts_store.get_snapshot(market_id, d)
            items = (snap or {}).get("items") if snap else None
            if items is None and offset == 0:
                fetched = fetch_market(market_id, d)
                if fetched.get("ok"):
                    items = fetched.get("items") or []
                    try:
                        ts_store.replace_snapshot(
                            market_id,
                            d,
                            table_kind=str(fetched.get("table") or "topic"),
                            label=str(fetched.get("label") or kind),
                            columns=list(fetched.get("columns") or []),
                            items=list(items),
                            source=str(fetched.get("source") or ""),
                        )
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    meta["fetch_error"] = fetched.get("error")
            if not items:
                continue
            out.extend(_match_topic_items(list(items), want_digits, kind=kind, trade_date=d))

        meta["ok"] = True
        meta["count"] = len(out)
        meta["dates_tried"] = dates_tried
        return out, meta
    except Exception as exc:  # noqa: BLE001
        _log.warning("%s load failed: %s", kind, exc)
        meta["error"] = str(exc)
        meta["gap"] = True
        return [], meta


def build_timeline(
    code: str,
    *,
    name: str | None = None,
    limit: int = 40,
) -> dict[str, Any]:
    sym = _norm(code)
    dig = _digits(sym)
    display_name = (name or "").strip()
    if not display_name:
        try:
            from cache import models as cache_models

            rows = cache_models.read_snapshot("cn", codes=[sym])
            if rows:
                display_name = str(rows[0].get("name") or "")
        except Exception:  # noqa: BLE001
            pass

    news, news_meta = _fetch_news(sym, limit=15)
    cal, cal_meta = _fetch_calendar(sym, display_name)
    top, top_meta = _load_topic_for_code("ts:top_list", "top_list", dig)
    block, block_meta = _load_topic_for_code("ts:block_trade", "block_trade", dig)

    events = [*news, *cal, *top, *block]

    def sort_key(e: dict[str, Any]) -> str:
        return str(e.get("at") or "")

    events.sort(key=sort_key, reverse=True)
    events = events[: max(1, min(limit, 100))]

    gaps: list[str] = []
    sources = {
        "news": news_meta,
        "calendar": cal_meta,
        "top_list": top_meta,
        "block_trade": block_meta,
    }
    for k, m in sources.items():
        if m.get("gap") or m.get("error"):
            gaps.append(k)

    evidence_ids = [str(e["id"]) for e in events if e.get("id")]

    return {
        "ok": True,
        "as_of": _now_iso(),
        "symbol": sym,
        "name": display_name,
        "events": events,
        "event_count": len(events),
        "evidence_ids": evidence_ids,
        "sources": sources,
        "data_gaps": gaps,
        "disclaimer": "不构成投资建议；日历为弱匹配，龙虎榜/大宗依赖专题缓存或即时拉取。",
    }
