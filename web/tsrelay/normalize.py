"""字段与单位归一：对齐 dashboard 契约（成交额万元、市值亿元）。"""

from __future__ import annotations

from typing import Any


def _f(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return x


def _s(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def ts_code_to_display(ts_code: str) -> tuple[str, str]:
    """返回 (展示代码, klineSymbol 尽量对齐本应用)。"""
    code = _s(ts_code)
    if not code:
        return "", ""
    if code.endswith(".SZ"):
        pure = code[:-3]
        return pure, pure
    if code.endswith(".SH"):
        pure = code[:-3]
        return pure, pure
    if code.endswith(".BJ"):
        pure = code[:-3]
        return pure, pure
    if code.endswith(".HK"):
        pure = code[:-3].lstrip("0") or "0"
        padded = pure.zfill(5)
        return padded, f"hk{padded}"
    if "." in code:
        # 801010.SI / 885556.TI / 110075.SH 已处理；其余保留
        pure = code.split(".", 1)[0]
        return pure, code
    return code, code


def empty_quote(**extra: Any) -> dict[str, Any]:
    base = {
        "code": "",
        "name": "",
        "klineSymbol": "",
        "quoteReady": True,
        "price": None,
        "change": None,
        "changePercent": None,
        "volume": None,
        "amount": None,
        "pb": None,
        "pe": None,
        "totalMarketCap": None,
        "circulatingMarketCap": None,
        "open": None,
        "prevClose": None,
        "high": None,
        "low": None,
        "turnoverRate": None,
        "volumeRatio": None,
        "amplitude": None,
    }
    base.update(extra)
    return base


def quote_from_ohlc(
    *,
    ts_code: str,
    name: str = "",
    open_: Any = None,
    high: Any = None,
    low: Any = None,
    close: Any = None,
    pre_close: Any = None,
    change: Any = None,
    pct_chg: Any = None,
    vol: Any = None,
    amount: Any = None,
    amount_unit: str = "qian",  # qian=千元(股票daily) | wan=万元(转债/资金流常见)
    turnover_rate: Any = None,
) -> dict[str, Any]:
    disp, kline = ts_code_to_display(ts_code)
    c = _f(close)
    pc = _f(pre_close)
    ch = _f(change)
    pct = _f(pct_chg)
    if ch is None and c is not None and pc is not None:
        ch = c - pc
    if pct is None and c is not None and pc not in (None, 0):
        pct = (c - pc) / pc * 100.0
    amt = _f(amount)
    if amt is not None:
        if amount_unit == "qian":
            amt = amt / 10.0  # 千元 → 万元
        # wan: 已是万元
    return empty_quote(
        code=disp or ts_code,
        name=name or disp or ts_code,
        klineSymbol=kline or disp or ts_code,
        price=c,
        change=ch,
        changePercent=pct,
        volume=_f(vol),
        amount=amt,
        open=_f(open_),
        prevClose=pc,
        high=_f(high),
        low=_f(low),
        turnoverRate=_f(turnover_rate),
    )
