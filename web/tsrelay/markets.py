"""按行情节点拉取并归一 Tushare 数据。"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Callable

from tsrelay.catalog import MARKET_SPECS
from tsrelay.client import QueryResult, get_client
from tsrelay.normalize import _f, _s, quote_from_ohlc, ts_code_to_display

_log = logging.getLogger("tushare-gateway")

Handler = Callable[[str], dict[str, Any]]


def _q(
    api: str,
    params: dict[str, Any],
    fields: str,
    *,
    prefer: str = "primary",
    allow_fallback: bool = True,
) -> QueryResult:
    return get_client().query(
        api, params, fields, prefer=prefer, allow_fallback=allow_fallback
    )


def resolve_trade_date(preferred: str | None = None) -> dict[str, Any]:
    """取上一开市日；若 preferred 有值则校验后返回。"""
    today = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
    res = _q(
        "trade_cal",
        {"exchange": "SSE", "start_date": start, "end_date": today, "is_open": "1"},
        "exchange,cal_date,is_open",
    )
    open_days: list[str] = []
    if res.ok:
        for rec in res.as_records():
            d = _s(rec.get("cal_date"))
            if d:
                open_days.append(d)
        open_days.sort()
    last = open_days[-1] if open_days else None
    # 专题多为日终数据：若最近开市日=今天，默认用上一开市日，避免盘中空表
    prev = open_days[-2] if len(open_days) >= 2 else last
    if preferred:
        chosen = preferred
    elif last == today and prev:
        chosen = prev
    else:
        chosen = last
    return {
        "ok": bool(chosen),
        "trade_date": chosen,
        "last_open": last,
        "prev_open": prev,
        "open_days": open_days[-15:],
        "source": res.source,
        "error": None if chosen else (res.error or "无法解析交易日"),
    }


def _fail(msg: str, code: str = "error", **extra: Any) -> dict[str, Any]:
    return {"ok": False, "error": msg, "error_code": code, "items": [], **extra}


def _ok(
    items: list[dict[str, Any]],
    *,
    trade_date: str | None,
    source: str | None,
    table: str,
    columns: list[dict[str, Any]],
    label: str,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ok": True,
        "label": label,
        "table": table,
        "columns": columns,
        "trade_date": trade_date,
        "source": source,
        "total": len(items),
        "items": items,
        "meta": meta or {},
    }


def _need_date(trade_date: str | None) -> str | None:
    if trade_date:
        return None
    info = resolve_trade_date()
    return info.get("trade_date")


# ---- handlers ----


def handle_cb(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:cb"]
    # 名称表（备源常更稳）
    basic = _q(
        "cb_basic",
        {"limit": 5000},
        "ts_code,bond_short_name,stk_code,list_date",
        prefer="secondary",
    )
    name_map: dict[str, str] = {}
    if basic.ok:
        for r in basic.as_records():
            name_map[_s(r.get("ts_code"))] = _s(r.get("bond_short_name"))

    daily = _q(
        "cb_daily",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,pre_close,open,high,low,close,change,pct_chg,vol,amount,bond_over_rate,cb_value",
    )
    if not daily.ok:
        return _fail(daily.error or "cb_daily 失败", daily.error_code or "error")
    items = []
    for r in daily.as_records():
        ts = _s(r.get("ts_code"))
        row = quote_from_ohlc(
            ts_code=ts,
            name=name_map.get(ts, ts),
            open_=r.get("open"),
            high=r.get("high"),
            low=r.get("low"),
            close=r.get("close"),
            pre_close=r.get("pre_close"),
            change=r.get("change"),
            pct_chg=r.get("pct_chg"),
            vol=r.get("vol"),
            amount=r.get("amount"),
            amount_unit="wan",
        )
        row["bondOverRate"] = _f(r.get("bond_over_rate"))
        row["extra"] = _f(r.get("cb_value"))
        items.append(row)
    return _ok(
        items,
        trade_date=trade_date,
        source=daily.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_opt(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:opt"]
    res = _q(
        "opt_basic",
        {"exchange": "SSE", "limit": 3000},
        "ts_code,name,exchange,call_put,exercise_price,list_date,delist_date",
    )
    # 上交所不够再补深交所
    rows = res.as_records() if res.ok else []
    src = res.source
    if res.ok:
        res2 = _q(
            "opt_basic",
            {"exchange": "SZSE", "limit": 3000},
            "ts_code,name,exchange,call_put,exercise_price,list_date,delist_date",
        )
        if res2.ok:
            rows.extend(res2.as_records())
    elif not res.ok:
        return _fail(res.error or "opt_basic 失败", res.error_code or "error")
    items = []
    for r in rows:
        ts = _s(r.get("ts_code"))
        disp, _ = ts_code_to_display(ts)
        items.append(
            {
                "code": disp or ts,
                "name": _s(r.get("name")) or ts,
                "exchange": _s(r.get("exchange")),
                "callPut": _s(r.get("call_put")),
                "exercisePrice": _f(r.get("exercise_price")),
                "listDate": _s(r.get("list_date")),
                "delistDate": _s(r.get("delist_date")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=src,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
        meta={"note": "合约基础列表；日行情可后续按需补齐"},
    )


def handle_limit(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:limit"]
    res = _q(
        "limit_list_d",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,name,close,pct_chg,limit,fd_amount,first_time,last_time,open_times,limit_times",
    )
    if not res.ok:
        return _fail(res.error or "limit_list_d 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "name": _s(r.get("name")),
                "klineSymbol": kline,
                "close": _f(r.get("close")),
                "pctChg": _f(r.get("pct_chg")),
                "limit": _s(r.get("limit")),
                "fdAmount": _f(r.get("fd_amount")),
                "firstTime": _s(r.get("first_time")),
                "lastTime": _s(r.get("last_time")),
                "openTimes": _f(r.get("open_times")),
                "limitTimes": _f(r.get("limit_times")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_stk_limit(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:stk_limit"]
    res = _q(
        "stk_limit",
        {"trade_date": trade_date, "limit": 8000},
        "trade_date,ts_code,up_limit,down_limit",
    )
    if not res.ok:
        return _fail(res.error or "stk_limit 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "klineSymbol": kline,
                "upLimit": _f(r.get("up_limit")),
                "downLimit": _f(r.get("down_limit")),
                "tradeDate": _s(r.get("trade_date")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_new_share(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:new_share"]
    end = trade_date
    start = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=120)).strftime(
        "%Y%m%d"
    )
    res = _q(
        "new_share",
        {"start_date": start, "end_date": end, "limit": 500},
        "ts_code,sub_code,name,ipo_date,issue_date,amount,market_amount,price",
    )
    if not res.ok:
        return _fail(res.error or "new_share 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "name": _s(r.get("name")),
                "klineSymbol": kline,
                "ipoDate": _s(r.get("ipo_date")),
                "issueDate": _s(r.get("issue_date")),
                "price": _f(r.get("price")),
                "amount": _f(r.get("amount")),
                "marketAmount": _f(r.get("market_amount")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
        meta={"range": f"{start}-{end}"},
    )


def handle_suspend(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:suspend"]
    res = _q(
        "suspend_d",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,suspend_timing,suspend_type",
    )
    if not res.ok:
        return _fail(res.error or "suspend_d 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "name": disp,
                "klineSymbol": kline,
                "suspendType": _s(r.get("suspend_type")),
                "suspendTiming": _s(r.get("suspend_timing")),
                "tradeDate": _s(r.get("trade_date")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_sw(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:sw"]
    # 按日拉申万；若接口要 ts_code，则用一级行业样本
    res = _q(
        "sw_daily",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,name,open,high,low,close,change,pct_change,vol,amount",
    )
    if not res.ok or not res.items:
        # 回退：若干一级行业代码
        samples = [
            "801010.SI",
            "801020.SI",
            "801030.SI",
            "801040.SI",
            "801050.SI",
            "801080.SI",
            "801110.SI",
            "801120.SI",
            "801130.SI",
            "801140.SI",
            "801150.SI",
            "801160.SI",
            "801170.SI",
            "801180.SI",
            "801200.SI",
            "801210.SI",
            "801230.SI",
            "801710.SI",
            "801720.SI",
            "801730.SI",
            "801740.SI",
            "801750.SI",
            "801760.SI",
            "801770.SI",
            "801780.SI",
            "801790.SI",
            "801880.SI",
            "801890.SI",
        ]
        rows: list[dict[str, Any]] = []
        src = res.source
        for code in samples:
            one = _q(
                "sw_daily",
                {"ts_code": code, "trade_date": trade_date},
                "ts_code,trade_date,name,open,high,low,close,change,pct_change,vol,amount",
            )
            if one.ok and one.items:
                rows.extend(one.as_records())
                src = one.source
        if not rows:
            return _fail(res.error or "sw_daily 无数据", res.error_code or "empty")
        records = rows
        source = src
    else:
        records = res.as_records()
        source = res.source

    items = []
    for r in records:
        ts = _s(r.get("ts_code"))
        items.append(
            quote_from_ohlc(
                ts_code=ts,
                name=_s(r.get("name")) or ts,
                open_=r.get("open"),
                high=r.get("high"),
                low=r.get("low"),
                close=r.get("close"),
                change=r.get("change"),
                pct_chg=r.get("pct_change") if r.get("pct_change") is not None else r.get("pct_chg"),
                vol=r.get("vol"),
                amount=r.get("amount"),
                amount_unit="wan",
            )
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_ths(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:ths"]
    res = _q(
        "ths_index",
        {"exchange": "A", "type": "N", "limit": 500},
        "ts_code,name,count,exchange,type",
        allow_fallback=False,  # datahubco 目录通常无 ths_index
    )
    if not res.ok:
        # 再试不带 type
        res = _q(
            "ths_index",
            {"limit": 500},
            "ts_code,name,count,exchange,type",
            allow_fallback=False,
        )
    if not res.ok:
        return _fail(res.error or "ths_index 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, _ = ts_code_to_display(ts)
        items.append(
            {
                "code": disp or ts,
                "name": _s(r.get("name")),
                "type": _s(r.get("type")),
                "count": _f(r.get("count")),
                "exchange": _s(r.get("exchange")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
        meta={"note": "板块目录；日行情 ths_daily 有数后再增强"},
    )


def handle_dc(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:dc"]
    res = _q(
        "dc_index",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,name,close,pct_change,leading,amount",
        allow_fallback=False,
    )
    if not res.ok:
        return _fail(res.error or "dc_index 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, _ = ts_code_to_display(ts)
        amt = _f(r.get("amount"))
        # 未知单位：保持原值，前端按数字展示
        items.append(
            {
                "code": disp or ts,
                "name": _s(r.get("name")),
                "pctChange": _f(r.get("pct_change")),
                "close": _f(r.get("close")),
                "leading": _s(r.get("leading")),
                "amount": amt,
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_top_list(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:top_list"]
    res = _q(
        "top_list",
        {"trade_date": trade_date, "limit": 5000},
        "trade_date,ts_code,name,close,pct_change,turnover_rate,amount,l_sell,l_buy,net_amount,reason",
    )
    if not res.ok:
        return _fail(res.error or "top_list 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "name": _s(r.get("name")),
                "klineSymbol": kline,
                "close": _f(r.get("close")),
                "pctChange": _f(r.get("pct_change")),
                "turnoverRate": _f(r.get("turnover_rate")),
                "amount": _f(r.get("amount")),
                "lBuy": _f(r.get("l_buy")),
                "lSell": _f(r.get("l_sell")),
                "netAmount": _f(r.get("net_amount")),
                "reason": _s(r.get("reason")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_block_trade(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:block_trade"]
    res = _q(
        "block_trade",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,price,vol,amount,buyer,seller",
    )
    if not res.ok:
        return _fail(res.error or "block_trade 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "klineSymbol": kline,
                "price": _f(r.get("price")),
                "vol": _f(r.get("vol")),
                "amount": _f(r.get("amount")),
                "buyer": _s(r.get("buyer")),
                "seller": _s(r.get("seller")),
                "tradeDate": _s(r.get("trade_date")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_margin(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:margin"]
    res = _q(
        "margin",
        {"trade_date": trade_date},
        "trade_date,exchange_id,rzye,rzmre,rzche,rqye,rqmcl,rzrqye",
    )
    if not res.ok:
        return _fail(res.error or "margin 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        items.append(
            {
                "exchange": _s(r.get("exchange_id")),
                "rzye": _f(r.get("rzye")),
                "rzmre": _f(r.get("rzmre")),
                "rzche": _f(r.get("rzche")),
                "rqye": _f(r.get("rqye")),
                "rqmcl": _f(r.get("rqmcl")),
                "rzrqye": _f(r.get("rzrqye")),
                "tradeDate": _s(r.get("trade_date")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_margin_detail(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:margin_detail"]
    res = _q(
        "margin_detail",
        {"trade_date": trade_date, "limit": 5000},
        "trade_date,ts_code,name,rzye,rzmre,rzche,rqye,rqmcl,rzrqye",
    )
    if not res.ok:
        return _fail(res.error or "margin_detail 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "name": _s(r.get("name")),
                "klineSymbol": kline,
                "rzye": _f(r.get("rzye")),
                "rzmre": _f(r.get("rzmre")),
                "rzche": _f(r.get("rzche")),
                "rqye": _f(r.get("rqye")),
                "rqmcl": _f(r.get("rqmcl")),
                "rzrqye": _f(r.get("rzrqye")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_moneyflow(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:moneyflow"]
    res = _q(
        "moneyflow",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,buy_sm_amount,sell_sm_amount,buy_md_amount,sell_md_amount,"
        "buy_lg_amount,sell_lg_amount,buy_elg_amount,sell_elg_amount,net_mf_amount",
    )
    if not res.ok:
        return _fail(res.error or "moneyflow 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        disp, kline = ts_code_to_display(ts)
        items.append(
            {
                "code": disp,
                "klineSymbol": kline,
                "buySmAmount": _f(r.get("buy_sm_amount")),
                "sellSmAmount": _f(r.get("sell_sm_amount")),
                "buyMdAmount": _f(r.get("buy_md_amount")),
                "sellMdAmount": _f(r.get("sell_md_amount")),
                "buyLgAmount": _f(r.get("buy_lg_amount")),
                "sellLgAmount": _f(r.get("sell_lg_amount")),
                "buyElgAmount": _f(r.get("buy_elg_amount")),
                "sellElgAmount": _f(r.get("sell_elg_amount")),
                "netMfAmount": _f(r.get("net_mf_amount")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
        meta={"unit": "万元"},
    )


def handle_hsgt(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:hsgt"]
    start = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=30)).strftime(
        "%Y%m%d"
    )
    res = _q(
        "moneyflow_hsgt",
        {"start_date": start, "end_date": trade_date},
        "trade_date,ggt_ss,ggt_sz,hgt,sgt,north_money,south_money",
        allow_fallback=True,
    )
    if not res.ok:
        # 部分服务只要 trade_date
        res = _q(
            "moneyflow_hsgt",
            {"trade_date": trade_date},
            "trade_date,ggt_ss,ggt_sz,hgt,sgt,north_money,south_money",
        )
    if not res.ok:
        return _fail(res.error or "moneyflow_hsgt 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        items.append(
            {
                "tradeDate": _s(r.get("trade_date")),
                "ggtSs": _f(r.get("ggt_ss")),
                "ggtSz": _f(r.get("ggt_sz")),
                "hgt": _f(r.get("hgt")),
                "sgt": _f(r.get("sgt")),
                "northMoney": _f(r.get("north_money")),
                "southMoney": _f(r.get("south_money")),
            }
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


def handle_etf(trade_date: str) -> dict[str, Any]:
    spec = MARKET_SPECS["ts:etf"]
    res = _q(
        "fund_daily",
        {"trade_date": trade_date, "limit": 5000},
        "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount",
    )
    if not res.ok:
        return _fail(res.error or "fund_daily 失败", res.error_code or "error")
    items = []
    for r in res.as_records():
        ts = _s(r.get("ts_code"))
        items.append(
            quote_from_ohlc(
                ts_code=ts,
                name=ts,
                open_=r.get("open"),
                high=r.get("high"),
                low=r.get("low"),
                close=r.get("close"),
                pre_close=r.get("pre_close"),
                change=r.get("change"),
                pct_chg=r.get("pct_chg"),
                vol=r.get("vol"),
                amount=r.get("amount"),
                amount_unit="qian",
            )
        )
    return _ok(
        items,
        trade_date=trade_date,
        source=res.source,
        table=spec["table"],
        columns=spec["columns"],
        label=spec["label"],
    )


HANDLERS: dict[str, Handler] = {
    "cb": handle_cb,
    "opt": handle_opt,
    "limit": handle_limit,
    "stk_limit": handle_stk_limit,
    "new_share": handle_new_share,
    "suspend": handle_suspend,
    "sw": handle_sw,
    "ths": handle_ths,
    "dc": handle_dc,
    "top_list": handle_top_list,
    "block_trade": handle_block_trade,
    "margin": handle_margin,
    "margin_detail": handle_margin_detail,
    "moneyflow": handle_moneyflow,
    "hsgt": handle_hsgt,
    "etf": handle_etf,
}


def fetch_market(market_id: str, trade_date: str | None = None) -> dict[str, Any]:
    if market_id.startswith("ts:ph:"):
        leaf_hint = "一期占位，请见开发计划 P1/P2"
        return {
            "ok": True,
            "placeholder": True,
            "label": market_id,
            "table": "topic",
            "columns": [],
            "trade_date": trade_date,
            "items": [],
            "total": 0,
            "hint": leaf_hint,
        }

    spec = MARKET_SPECS.get(market_id)
    if not spec:
        return _fail(f"未知市场: {market_id}", "unknown_market")

    td = trade_date or _need_date(None)
    if not td:
        return _fail("无法确定交易日，请检查 Token / trade_cal", "no_trade_date")

    handler_name = spec["handler"]
    fn = HANDLERS.get(handler_name)
    if not fn:
        return _fail(f"未实现 handler: {handler_name}", "not_implemented")

    try:
        return fn(td)
    except Exception as e:  # noqa: BLE001
        _log.exception("fetch_market %s failed", market_id)
        return _fail(str(e), "exception")
