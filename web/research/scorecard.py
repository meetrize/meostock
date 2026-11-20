"""个股六维 Scorecard（Phase 2）。"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from cache import models as cache_models
from research.business_mode import get_business_mode, score_business_dim
from research.fina_probe import fetch_fina_indicator, probe_fina_access
from research.strategy_templates import DIM_META, resolve_template
from research.valuation import build_universe_stats, score_valuation

_SH = ZoneInfo("Asia/Shanghai")


def _now_iso() -> str:
    return datetime.now(_SH).isoformat(timespec="seconds")


def _f(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        if not math.isfinite(x):
            return None
        return x
    except (TypeError, ValueError):
        return None


def _norm_code(code: str) -> str:
    return (code or "").strip().upper()


def _digits(code: str) -> str:
    m = re.search(r"(\d{6})", code or "")
    return m.group(1) if m else ""


def _find_quote(code: str, quotes: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    want = _norm_code(code)
    dig = _digits(code)
    rows = quotes if quotes is not None else cache_models.read_snapshot("cn", codes=[code])
    for q in rows:
        c = str(q.get("code") or "").upper()
        if c == want or _digits(c) == dig:
            return q
    return None


def _score_fina(fina: dict[str, Any]) -> dict[str, Any]:
    if not fina.get("available"):
        return {
            "ok": False,
            "score": None,
            "label": "财务数据不可用",
            "reason": fina.get("reason") or "unavailable",
            "metrics": {},
            "source": "empty",
            "data_gap": True,
        }
    m = fina.get("metrics") or {}
    parts: list[float] = []
    # 粗糙教学向映射（非投资建议）
    roe = _f(m.get("roe"))
    if roe is not None:
        parts.append(max(0.0, min(100.0, roe * 5.0)))  # ROE 20% → 100
    gp = _f(m.get("grossprofit_margin"))
    if gp is not None:
        parts.append(max(0.0, min(100.0, gp * 2.0)))
    debt = _f(m.get("debt_to_assets"))
    if debt is not None:
        parts.append(max(0.0, min(100.0, 100.0 - debt)))
    ocf = _f(m.get("ocf_to_profit"))
    if ocf is not None:
        parts.append(max(0.0, min(100.0, 50.0 + ocf * 25.0)))
    score = round(sum(parts) / len(parts), 2) if parts else None
    label = "不足"
    if score is not None:
        if score >= 70:
            label = "质量较好"
        elif score >= 45:
            label = "中性"
        else:
            label = "偏弱"
    return {
        "ok": score is not None,
        "score": score,
        "label": label,
        "metrics": m,
        "as_of": fina.get("as_of"),
        "end_date": fina.get("end_date"),
        "history": fina.get("history") or [],
        "source": fina.get("source") or "tushare:fina_indicator",
        "data_gap": False,
    }


def _score_trend(quote: dict[str, Any] | None) -> dict[str, Any]:
    if not quote:
        return {"ok": False, "score": None, "label": "无行情", "data_gap": True}
    chg = _f(quote.get("changePercent"))
    # 无 K 线时用当日涨跌作极弱代理
    if chg is None:
        return {"ok": False, "score": None, "label": "缺动量", "data_gap": True}
    # 映射到 0–100：大涨偏趋势强，大跌偏弱；震荡居中
    score = max(0.0, min(100.0, 50.0 + chg * 5.0))
    if chg >= 3:
        label = "偏强"
    elif chg <= -3:
        label = "偏弱"
    else:
        label = "震荡/中性"
    return {
        "ok": True,
        "score": round(score, 2),
        "label": label,
        "change_percent": chg,
        "source": "quote_momentum_proxy",
        "note": "Phase 2 暂用当日涨跌代理；完整 MA/波段在后续接 K 线",
        "data_gap": True,  # 明确标注非完整技术态
    }


def _score_volume(quote: dict[str, Any] | None) -> dict[str, Any]:
    if not quote:
        return {"ok": False, "score": None, "label": "无行情", "data_gap": True}
    vr = _f(quote.get("volumeRatio"))
    to = _f(quote.get("turnoverRate"))
    parts: list[float] = []
    if vr is not None:
        # 量比 0.5–2 健康居中；过高过低扣分
        if 0.7 <= vr <= 1.8:
            parts.append(75.0)
        elif 0.4 <= vr <= 3.0:
            parts.append(55.0)
        else:
            parts.append(35.0)
    if to is not None:
        if 1.0 <= to <= 8.0:
            parts.append(70.0)
        elif to < 1.0:
            parts.append(45.0)
        else:
            parts.append(40.0)  # 极高换手偏情绪
    score = round(sum(parts) / len(parts), 2) if parts else None
    return {
        "ok": score is not None,
        "score": score,
        "label": "量价代理" if score is not None else "缺量价",
        "volume_ratio": vr,
        "turnover_rate": to,
        "source": "quote_volume_proxy",
        "data_gap": True,
    }


def _score_event_stub() -> dict[str, Any]:
    return {
        "ok": False,
        "score": None,
        "label": "事件轴待接入",
        "source": "stub",
        "data_gap": True,
        "note": "Phase 3 接入 news/calendar/top_list",
    }


def build_scorecard(
    code: str,
    *,
    strategy_template_id: str | None = "long",
    quotes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    tmpl = resolve_template(strategy_template_id)
    universe_quotes = quotes if quotes is not None else cache_models.read_snapshot("cn")
    quote = _find_quote(code, universe_quotes)
    universe = build_universe_stats(universe_quotes)

    biz_row = get_business_mode(code)
    biz = score_business_dim(biz_row["state"])
    biz["note"] = biz_row.get("note") or ""
    biz["updated_at"] = biz_row.get("updated_at")

    fina_raw = fetch_fina_indicator(code)
    fina = _score_fina(fina_raw)

    pe = _f((quote or {}).get("pe"))
    pb = _f((quote or {}).get("pb"))
    valuation = score_valuation(pe, pb, universe)

    trend = _score_trend(quote)
    volume = _score_volume(quote)
    event = _score_event_stub()

    dims_raw = {
        "business": biz,
        "fina": fina,
        "valuation": valuation,
        "trend": trend,
        "volume": volume,
        "event": event,
    }

    dims_out: dict[str, Any] = {}
    scored_parts: list[float] = []
    data_gaps: list[str] = []
    for key, mode in (tmpl.get("dims") or {}).items():
        meta = DIM_META.get(key, {"label": key, "key": key})
        raw = dims_raw.get(key) or {}
        enabled = mode == "on"
        weak = mode == "weak"
        # 商业模式不计入数值综合分
        numeric = raw.get("score")
        if enabled and key != "business" and isinstance(numeric, (int, float)):
            scored_parts.append(float(numeric))
        if raw.get("data_gap"):
            data_gaps.append(key)
        dims_out[key] = {
            **raw,
            "dim": key,
            "meta_key": meta["key"],
            "label_zh": meta["label"],
            "mode": mode,
            "enabled": enabled or weak,
            "counts_toward_total": enabled and key != "business",
            # 商业模式三态 pill
            "pill": (
                raw.get("label")
                if key == "business"
                else (
                    f"{numeric:.0f}"
                    if isinstance(numeric, (int, float))
                    else ("空" if raw.get("data_gap") else "—")
                )
            ),
        }

    total = round(sum(scored_parts) / len(scored_parts), 2) if scored_parts else None
    probe = probe_fina_access()

    return {
        "ok": True,
        "as_of": _now_iso(),
        "symbol": _norm_code(code),
        "name": (quote or {}).get("name") or "",
        "price": _f((quote or {}).get("price")),
        "change_percent": _f((quote or {}).get("changePercent")),
        "strategy_template": tmpl,
        "dimensions": dims_out,
        "total_score": total,
        "total_note": "总分仅用于排序，决策必须下钻证据；商业模式不计入数值分",
        "business_mode_state": biz.get("state"),
        "can_open_trade_card": biz.get("state") in ("clear", "doubt"),
        "fina_probe": {
            "mode": probe.get("mode"),
            "fina_indicator": probe.get("fina_indicator"),
            "hint": probe.get("hint"),
            "error_code": probe.get("error_code"),
        },
        "data_gaps": sorted(set(data_gaps)),
        "disclaimer": "不构成投资建议；财务无权限时估值用 PE/PB 全市场分位降级。",
    }
