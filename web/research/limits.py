"""涨跌停幅度与可成交判定（与前端 analysis.ts 对齐）。"""

from __future__ import annotations

import re
from typing import Any

_LIMIT_TOLERANCE = 0.2


def _pure_symbol(code: str) -> str:
    c = (code or "").strip().upper()
    c = re.sub(r"^(SH|SZ|BJ)\.?|^(\d{0,2}\.)?", "", c, flags=re.I)
    c = c.replace(".SH", "").replace(".SZ", "").replace(".BJ", "")
    m = re.search(r"(\d{6})", c)
    return m.group(1) if m else c


def get_limit_percent(code: str, name: str = "") -> float:
    sym = _pure_symbol(code)
    if re.match(r"^(300|301|688|689)", sym):
        return 20.0
    if re.match(r"^(4|8|92)", sym):
        return 30.0
    if "ST" in (name or "").upper():
        return 5.0
    return 10.0


def is_limit_up(code: str, name: str, change_percent: float | None) -> bool:
    if change_percent is None:
        return False
    return change_percent >= get_limit_percent(code, name) - _LIMIT_TOLERANCE


def is_limit_down(code: str, name: str, change_percent: float | None) -> bool:
    if change_percent is None:
        return False
    return change_percent <= -(get_limit_percent(code, name) - _LIMIT_TOLERANCE)


def is_one_word_board(quote: dict[str, Any]) -> bool:
    """一字板近似：开=高=低=收 且已涨停/跌停。"""
    o, h, low, p = quote.get("open"), quote.get("high"), quote.get("low"), quote.get("price")
    try:
        fo, fh, fl, fp = float(o), float(h), float(low), float(p)
    except (TypeError, ValueError):
        return False
    if min(fo, fh, fl, fp) <= 0:
        return False
    flat = abs(fo - fh) < 1e-6 and abs(fh - fl) < 1e-6 and abs(fl - fp) < 1e-6
    if not flat:
        return False
    code = str(quote.get("code") or "")
    name = str(quote.get("name") or "")
    pct = quote.get("changePercent")
    try:
        fpct = float(pct) if pct is not None else None
    except (TypeError, ValueError):
        fpct = None
    return is_limit_up(code, name, fpct) or is_limit_down(code, name, fpct)


def tradability(quote: dict[str, Any]) -> dict[str, Any]:
    """信号可成立但未必可成交。"""
    code = str(quote.get("code") or "")
    name = str(quote.get("name") or "")
    pct = quote.get("changePercent")
    try:
        fpct = float(pct) if pct is not None else None
    except (TypeError, ValueError):
        fpct = None
    reasons: list[str] = []
    if is_limit_up(code, name, fpct) and is_one_word_board(quote):
        reasons.append("一字涨停")
    elif is_limit_up(code, name, fpct):
        reasons.append("涨停")
    if is_limit_down(code, name, fpct):
        reasons.append("跌停")
    price = quote.get("price")
    try:
        if price is not None and float(price) <= 0:
            reasons.append("停牌或无报价")
    except (TypeError, ValueError):
        reasons.append("无报价")
    tradable = len(reasons) == 0
    return {
        "tradable": tradable,
        "reasons": reasons,
        "limitPercent": get_limit_percent(code, name),
        "label": "可成交" if tradable else f"信号成立但不可成交（{'/'.join(reasons)}）",
    }
