"""组合风控：止损线 / 集中度 / 行业暴露 / 违规计数。"""

from __future__ import annotations

from typing import Any

from cache import models as cache_models
from cache.board_concepts import get_stock_items_from_db, pure_a_share_code
from research.cards_store import list_cards
from research.risk_rules import (
    DEFAULT_INDUSTRY_MAX_PCT,
    DEFAULT_MAX_OPEN_POSITIONS,
    DEFAULT_SINGLE_NAME_MAX_PCT,
    risk_rules_payload,
)


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _quote_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    rows = cache_models.read_snapshot("cn", codes=symbols)
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        code = str(r.get("code") or "").upper()
        out[code] = r
        # 也索引纯数字
        digits = "".join(ch for ch in code if ch.isdigit())
        if digits:
            out[digits] = r
    return out


def build_portfolio_risk(*, cash: float | None = None) -> dict[str, Any]:
    open_cards = list_cards(status="open")
    symbols = [str(c.get("symbol") or "") for c in open_cards]
    quotes = _quote_map(symbols)

    holdings: list[dict[str, Any]] = []
    gross = 0.0
    for c in open_cards:
        sym = str(c.get("symbol") or "").upper()
        q = quotes.get(sym) or quotes.get("".join(ch for ch in sym if ch.isdigit()))
        price = _f((q or {}).get("price"))
        entry = _f(c.get("entry_price"))
        pos_pct = _f(c.get("position_pct")) or 0.0
        # 市值代理：若有 entry 与 position_pct，用组合相对权重；绝对市值未知时用权重
        weight = pos_pct
        mv = weight  # 相对单位
        gross += max(weight, 0.0)
        stop = str(c.get("stop_rule") or "").strip()
        holdings.append(
            {
                "id": c.get("id"),
                "symbol": sym,
                "name": (q or {}).get("name"),
                "price": price,
                "entry_price": entry,
                "position_pct": pos_pct,
                "stop_rule": stop or None,
                "has_stop": bool(stop),
                "pnl_pct": (
                    round((price - entry) / entry * 100.0, 2)
                    if price is not None and entry not in (None, 0)
                    else None
                ),
            }
        )

    total_assets = gross + (cash or 0.0)
    # 集中度：按声明的 position_pct 归一
    denom = total_assets if total_assets > 0 else (gross if gross > 0 else 1.0)
    violations: list[dict[str, Any]] = []
    for h in holdings:
        pct = float(h.get("position_pct") or 0)
        share = 100.0 * pct / denom if denom else pct
        h["weight_pct"] = round(share, 2)
        if not h.get("has_stop"):
            violations.append(
                {
                    "code": "missing_stop",
                    "symbol": h["symbol"],
                    "message": "缺少止损线",
                }
            )
        if share > DEFAULT_SINGLE_NAME_MAX_PCT + 1e-6:
            violations.append(
                {
                    "code": "single_name_overweight",
                    "symbol": h["symbol"],
                    "message": f"单票权重 {share:.1f}% > {DEFAULT_SINGLE_NAME_MAX_PCT}%",
                }
            )

    if len(holdings) > DEFAULT_MAX_OPEN_POSITIONS:
        violations.append(
            {
                "code": "concentration_breach",
                "symbol": "*",
                "message": (
                    f"同时持仓 {len(holdings)} 只 > 建议上限 {DEFAULT_MAX_OPEN_POSITIONS}"
                ),
            }
        )

    max_weight = max((h.get("weight_pct") or 0) for h in holdings) if holdings else 0.0

    # 行业暴露（本地 stock_board_map；缺映射标 unknown）
    pure_codes = [pure_a_share_code(h["symbol"]) for h in holdings]
    pure_codes = [c for c in pure_codes if c]
    board_map: dict[str, list[dict[str, Any]]] = {}
    try:
        board_map = get_stock_items_from_db(pure_codes, category="board") if pure_codes else {}
    except Exception:  # noqa: BLE001
        board_map = {}

    industry_weights: dict[str, float] = {}
    for h in holdings:
        pure = pure_a_share_code(h["symbol"])
        boards = board_map.get(pure) or []
        industries = [b for b in boards if b.get("kind") == "industry"]
        industry_name = (industries[0].get("name") if industries else None) or "未知行业"
        h["industry"] = industry_name
        w = float(h.get("weight_pct") or 0)
        industry_weights[industry_name] = industry_weights.get(industry_name, 0.0) + w

    industry_exposure = [
        {"industry": k, "weight_pct": round(v, 2)}
        for k, v in sorted(industry_weights.items(), key=lambda x: -x[1])
    ]
    max_industry = industry_exposure[0]["weight_pct"] if industry_exposure else 0.0
    if max_industry > DEFAULT_INDUSTRY_MAX_PCT + 1e-6:
        top = industry_exposure[0]
        violations.append(
            {
                "code": "industry_overweight",
                "symbol": "*",
                "message": (
                    f"行业「{top['industry']}」暴露 {top['weight_pct']:.1f}% "
                    f"> {DEFAULT_INDUSTRY_MAX_PCT}%"
                ),
            }
        )

    # 浮亏加仓提示（相对 entry；教学向）
    rebalance_hints: list[str] = []
    underwater = [
        h
        for h in holdings
        if isinstance(h.get("pnl_pct"), (int, float)) and float(h["pnl_pct"]) <= -10
    ]
    if underwater:
        rebalance_hints.append(
            f"{len(underwater)} 只浮亏≥10%，复盘时检查是否违规加仓（行为偏差见 Phase 4）"
        )
    if max_weight > DEFAULT_SINGLE_NAME_MAX_PCT:
        rebalance_hints.append("最大单票超限，建议减仓或提高现金缓冲")
    if max_industry > DEFAULT_INDUSTRY_MAX_PCT:
        rebalance_hints.append("行业集中度偏高，考虑跨行业再平衡")

    return {
        "ok": True,
        "holdings": holdings,
        "open_count": len(holdings),
        "gross_weight": round(gross, 2),
        "cash": cash,
        "max_single_weight_pct": round(max_weight, 2),
        "industry_exposure": industry_exposure,
        "max_industry_weight_pct": round(max_industry, 2),
        "rebalance_hints": rebalance_hints,
        "violations": violations,
        "violation_count": len(violations),
        "rules": risk_rules_payload(),
        "watchlist_note": "watchlist 为观察池，不计入本面板",
        "disclaimer": "不构成投资建议；仓位以交易卡片声明的 position_pct 计算。",
    }
