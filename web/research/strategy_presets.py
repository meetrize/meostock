"""策略选股预设 SSOT（StrategyPreset / RuleBlock）。

对齐 docs/炒股战法/多策略选股页评估与设计方案.md §5。
与 strategy_templates（六维研判桌权重）区分：本模块描述「扫描规则 + 文案」。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

PresetHorizon = Literal["short", "swing", "long"]
RiskLevel = Literal["low", "low_medium", "medium", "medium_high", "high"]
RunEngine = Literal["eod_intraday", "research_scanner", "pending"]

DISCLAIMER = "规则候选池，仅供观察与学习，不构成投资建议。"

# ---------------------------------------------------------------------------
# Rule op catalog（MVP：顶层 all = AND）
# ---------------------------------------------------------------------------

RULE_OPS: dict[str, dict[str, Any]] = {
    "quote.market_cap": {
        "domain": "quote",
        "label": "流通市值（亿）",
        "params": ["min", "max"],
    },
    "quote.change_percent": {
        "domain": "quote",
        "label": "涨跌幅（%）",
        "params": ["min", "max"],
    },
    "quote.turnover_rate": {
        "domain": "quote",
        "label": "换手率（%）",
        "params": ["min", "max"],
    },
    "quote.volume_ratio": {
        "domain": "quote",
        "label": "量比",
        "params": ["min"],
    },
    "quote.exclude_st": {
        "domain": "quote",
        "label": "排除 ST",
        "params": ["enabled"],
    },
    "intraday.timeline_above_avg": {
        "domain": "intraday",
        "label": "分时均线上方占比（%）",
        "params": ["min"],
    },
    "ma.bull_stack": {
        "domain": "ma",
        "label": "均线多头排列",
        "params": ["periods", "require_price_above"],
    },
    "ma.dual_coil": {
        "domain": "ma",
        "label": "双线粘合/发散",
        "params": ["slow", "slower", "max_gap_pct", "require_price_above"],
    },
    "ma.above": {
        "domain": "ma",
        "label": "股价站上均线",
        "params": ["period"],
    },
    "breakout.volume": {
        "domain": "breakout",
        "label": "放量突破",
        "params": ["lookback", "volume_multiple"],
    },
    "breakout.donchian": {
        "domain": "breakout",
        "label": "唐奇安通道突破",
        "params": ["n"],
    },
    "volume.shrink_pullback": {
        "domain": "volume",
        "label": "缩量回踩",
        "params": ["ma_period", "volume_ratio_max"],
    },
    "limit.board_count": {
        "domain": "limit",
        "label": "连板数区间",
        "params": ["min", "max"],
    },
    "board.theme_top_n": {
        "domain": "board",
        "label": "所属板块进入主线 TopN",
        "params": ["n"],
    },
    "fina.roe": {
        "domain": "fina",
        "label": "ROE（%）",
        "params": ["min", "years"],
    },
    "fina.growth": {
        "domain": "fina",
        "label": "业绩增速（%）",
        "params": ["revenue_min", "profit_min"],
    },
    "valuation.pe_pb_pct": {
        "domain": "valuation",
        "label": "PE/PB 截面分位上限",
        "params": ["pe_percentile_max", "pb_percentile_max"],
    },
    "valuation.dividend": {
        "domain": "valuation",
        "label": "股息率（%）",
        "params": ["min", "years"],
    },
    "valuation.peg": {
        "domain": "valuation",
        "label": "PEG 上限",
        "params": ["max"],
    },
    "risk.tradability": {
        "domain": "risk",
        "label": "标记不可成交",
        "params": ["require_flag"],
    },
}


def _block(op: str, **params: Any) -> dict[str, Any]:
    return {"op": op, "params": params}


def _copy(
    *,
    headline: str,
    one_liner: str,
    fit_when: str,
    avoid_when: str,
    how_to_buy: str,
    how_to_exit: str,
    position_hint: str,
) -> dict[str, str]:
    return {
        "headline": headline,
        "one_liner": one_liner,
        "fit_when": fit_when,
        "avoid_when": avoid_when,
        "how_to_buy": how_to_buy,
        "how_to_exit": how_to_exit,
        "position_hint": position_hint,
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Official presets（第一批 8 + custom 壳）
# ---------------------------------------------------------------------------

OFFICIAL_PRESETS: dict[str, dict[str, Any]] = {
    "eod_intraday_strength": {
        "id": "eod_intraday_strength",
        "name": "尾盘分时强势",
        "horizon": "short",
        "version": 1,
        "risk_level": "medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "eod_intraday",
        "tags": ["尾盘", "分时", "一日持股"],
        "environment": {
            "prefer": ["情绪活跃", "主线明确"],
            "avoid": ["缩量阴跌", "退潮期"],
        },
        "gates": {"block_on_emotion": ["retreat"]},
        "rules": {
            "all": [
                _block("quote.market_cap", min=50, max=200),
                _block("quote.volume_ratio", min=1.2),
                _block("quote.change_percent", min=3, max=5),
                _block("quote.turnover_rate", min=5, max=10),
                _block("quote.exclude_st", enabled=True),
                _block("intraday.timeline_above_avg", min=80),
            ]
        },
        "copy": _copy(
            headline="尾盘分时强势（一日持股）",
            one_liner="筛选尾盘仍站稳分时均线上方的中小盘强势股，作为短线观察池。",
            fit_when="成交活跃、题材有主线、涨停梯队尚可",
            avoid_when="情绪退潮、大盘缩量阴跌、独苗无板块效应",
            how_to_buy="以观察与尾盘确认主；不作为自动打板指令",
            how_to_exit="次日不及预期或分时转弱即退出；单笔亏损纪律收紧",
            position_hint="单票轻仓；同时持仓宜少，留现金",
        ),
        "result_columns": [
            "changePercent",
            "timelineAboveAvgRatio",
            "turnoverRate",
            "circulatingMarketCap",
            "volumeRatio",
        ],
        "sort_default": {"field": "timelineAboveAvgRatio", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "limit_up_watch": {
        "id": "limit_up_watch",
        "name": "涨停梯队观察",
        "horizon": "short",
        "version": 1,
        "risk_level": "high",
        "enabled_by_default": True,
        "runnable": False,
        "run_engine": "pending",
        "tags": ["涨停", "龙头", "观察池"],
        "environment": {
            "prefer": ["发酵/主升", "主线辨识度高"],
            "avoid": ["退潮", "监管压制连板"],
        },
        "gates": {"block_on_emotion": ["retreat"]},
        "rules": {
            "all": [
                _block("limit.board_count", min=1, max=3),
                _block("board.theme_top_n", n=5),
                _block("quote.exclude_st", enabled=True),
                _block("risk.tradability", require_flag=True),
            ]
        },
        "copy": _copy(
            headline="涨停梯队观察池",
            one_liner="从涨停结构中筛首板～三板、且落在当日主线板块内的标的，仅作观察。",
            fit_when="情绪启动/发酵、板块梯队完整",
            avoid_when="连板高度持续下降、炸板率上升、退潮期",
            how_to_buy="不自动给出打板指令；一字板标记为不可成交",
            how_to_exit="破板无承接、题材切换、情绪退潮即放弃",
            position_hint="高风险；默认不建议重仓，需人工确认龙头地位",
        ),
        "result_columns": ["board_count", "theme", "changePercent", "tradability"],
        "sort_default": {"field": "board_count", "order": "desc"},
        "outputs": {
            "allow_trade_card": False,
            "require_tradability_flag": True,
        },
    },
    "ma_bull_stack": {
        "id": "ma_bull_stack",
        "name": "均线多头波段",
        "horizon": "swing",
        "version": 1,
        "risk_level": "medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "ma_bull_stack",
        "tags": ["均线", "多头", "波段"],
        "environment": {
            "prefer": ["指数在中期均线上方或箱体震荡"],
            "avoid": ["单边急跌", "60日线走平向下"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block(
                    "ma.bull_stack",
                    periods=[5, 10, 20, 60],
                    require_price_above=60,
                ),
                _block("quote.exclude_st", enabled=True),
                _block("risk.tradability", require_flag=True),
            ]
        },
        "copy": _copy(
            headline="均线多头波段筛选",
            one_liner="要求短中期均线多头排列且股价站上 60 日线，作为波段右侧候选。",
            fit_when="中期趋势明确、板块有轮动主线",
            avoid_when="均线粘合后向下、高位乖离过大、系统性弱势",
            how_to_buy="优先回踩 20/60 日线缩量企稳后再确认；不抄看起来便宜的底",
            how_to_exit="有效跌破 60 日线或 20 日线走平向下则减仓/离场",
            position_hint="底仓为主，单票不宜过重；顺势加仓用正金字塔",
        ),
        "result_columns": ["above_ma60", "ma_stack", "changePercent", "amount"],
        "sort_default": {"field": "amount", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "dual_ma_coil": {
        "id": "dual_ma_coil",
        "name": "双线擒牛",
        "horizon": "swing",
        "version": 1,
        "risk_level": "medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "dual_ma_coil",
        "tags": ["双线", "60/89", "波段"],
        "environment": {
            "prefer": ["中长期均线粘合后向上"],
            "avoid": ["双线之下", "死叉确认"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block(
                    "ma.dual_coil",
                    slow=60,
                    slower=89,
                    max_gap_pct=3.0,
                    require_price_above=True,
                ),
                _block("quote.exclude_st", enabled=True),
            ]
        },
        "copy": _copy(
            headline="双线擒牛（60/89）",
            one_liner="中长期均线紧密粘合或向上发散，且股价站稳双线之上，关注主升前段。",
            fit_when="筹码充分换手后、有放量突破迹象",
            avoid_when="股价在双线之下、5/10 日死叉且无承接",
            how_to_buy="双线之上关注；突破放量更佳",
            how_to_exit="跌破双线或短均线死叉执行离场纪律",
            position_hint="波段仓位；趋势模糊时降仓",
        ),
        "result_columns": ["ma60", "ma89", "gap_pct", "changePercent"],
        "sort_default": {"field": "gap_pct", "order": "asc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "breakout_volume": {
        "id": "breakout_volume",
        "name": "放量突破",
        "horizon": "swing",
        "version": 1,
        "risk_level": "medium_high",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "breakout_volume",
        "tags": ["突破", "放量", "右侧"],
        "environment": {
            "prefer": ["量价齐升", "板块同步走强"],
            "avoid": ["无量假突破", "大盘弱势强行突破"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block("breakout.volume", lookback=20, volume_multiple=1.8),
                _block("quote.exclude_st", enabled=True),
                _block("risk.tradability", require_flag=True),
            ]
        },
        "copy": _copy(
            headline="放量突破筛选",
            one_liner="近 N 日新高或平台上沿伴随成交量放大，作为右侧突破观察池。",
            fit_when="趋势市、板块共振",
            avoid_when="震荡市假突破多、突破日长上影试盘",
            how_to_buy="突破当日或回踩不破再确认；牺牲部分利润换胜率",
            how_to_exit="跌回平台/箱体内视为假突破，立即离场",
            position_hint="试探仓确认后再加；单笔止损前置",
        ),
        "result_columns": ["breakout", "volume_multiple", "changePercent"],
        "sort_default": {"field": "volume_multiple", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "quality_value": {
        "id": "quality_value",
        "name": "质量+低估值",
        "horizon": "long",
        "version": 1,
        "risk_level": "low_medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "quality_value",
        "tags": ["质量", "估值", "长线"],
        "environment": {
            "prefer": ["估值低位", "防守风格"],
            "avoid": ["纯主题炒作高潮"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block("valuation.pe_pb_pct", pe_percentile_max=30, pb_percentile_max=40),
                _block("fina.roe", min=12, years=3),
                _block("quote.exclude_st", enabled=True),
                _block("risk.tradability", require_flag=True),
            ]
        },
        "copy": _copy(
            headline="质量+低估值筛选",
            one_liner="PE/PB 截面分位偏低，并尽量叠加 ROE 质量过滤，排除 ST。",
            fit_when="熊市/震荡、追求安全边际",
            avoid_when="价值陷阱（业绩持续下滑）未排除时",
            how_to_buy="分批建仓；先读懂商业模式再加大仓位",
            how_to_exit="以逻辑破坏/基本面恶化/估值极端为主，而非单纯跌价",
            position_hint="可作为长线观察池；单票受组合上限约束",
        ),
        "result_columns": ["pe_percentile", "pb_percentile", "roe", "pe", "pb"],
        "sort_default": {"field": "pe_percentile", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "dividend_roe": {
        "id": "dividend_roe",
        "name": "高股息+高ROE",
        "horizon": "long",
        "version": 1,
        "risk_level": "low_medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "dividend_roe",
        "tags": ["红利", "ROE", "长线"],
        "environment": {
            "prefer": ["利率下行", "震荡防守"],
            "avoid": ["成长抱团单边"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block("valuation.dividend", min=3, years=3),
                _block("fina.roe", min=10, years=3),
                _block("quote.exclude_st", enabled=True),
            ]
        },
        "copy": _copy(
            headline="高股息+高ROE双筛",
            one_liner="连续分红与较高 ROE 提供安全垫，避免股价下跌造成的被动高股息陷阱。",
            fit_when="无风险利率下行、市场震荡",
            avoid_when="分红不可持续、现金流无法覆盖分红",
            how_to_buy="股息率处于相对高位时分批纳入观察/建仓",
            how_to_exit="ROE 趋势恶化、分红覆盖失效、估值进入历史极高分位",
            position_hint="适合作为组合红利底仓候选，而非短线博弈",
        ),
        "result_columns": ["dividend_yield", "roe", "pe", "pb"],
        "sort_default": {"field": "dividend_yield", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
    "growth_trend": {
        "id": "growth_trend",
        "name": "成长趋势",
        "horizon": "long",
        "version": 1,
        "risk_level": "medium",
        "enabled_by_default": True,
        "runnable": True,
        "run_engine": "research_scanner",
        "scanner_template_id": "growth_trend",
        "tags": ["成长", "趋势", "PEG"],
        "environment": {
            "prefer": ["产业趋势明确", "牛市或复苏"],
            "avoid": ["景气证伪", "估值透支"],
        },
        "gates": {},
        "rules": {
            "all": [
                _block("fina.growth", revenue_min=15, profit_min=15),
                _block("ma.above", period=60),
                _block("valuation.peg", max=1.5),
                _block("quote.exclude_st", enabled=True),
            ]
        },
        "copy": _copy(
            headline="成长趋势筛选",
            one_liner="业绩增速达标、股价站上中期均线，并用 PEG 约束极端估值（数据缺失则降级）。",
            fit_when="产业景气向上、风格偏成长",
            avoid_when="增速靠一次性收益、高估值杀业绩",
            how_to_buy="确认内生增长后再分批；技术面仅作择时过滤",
            how_to_exit="景气证伪、PEG 严重失真、趋势破位且基本面恶化",
            position_hint="弹性仓；与红利/质量底仓搭配，控制单一赛道暴露",
        ),
        "result_columns": ["growth", "peg", "above_ma60", "pe"],
        "sort_default": {"field": "growth", "order": "desc"},
        "outputs": {
            "allow_trade_card": True,
            "require_tradability_flag": True,
        },
    },
}


def list_presets(*, horizon: str | None = None) -> list[dict[str, Any]]:
    rows = [deepcopy(v) for v in OFFICIAL_PRESETS.values()]
    if horizon:
        h = horizon.strip().lower()
        rows = [r for r in rows if r.get("horizon") == h]
    order = {"short": 0, "swing": 1, "long": 2}
    rows.sort(key=lambda r: (order.get(str(r.get("horizon")), 9), str(r.get("id"))))
    return rows


def get_preset(preset_id: str) -> dict[str, Any] | None:
    pid = (preset_id or "").strip()
    raw = OFFICIAL_PRESETS.get(pid)
    return deepcopy(raw) if raw else None


def _fmt_range(lo: Any, hi: Any, unit: str = "") -> str:
    left = "不限" if lo is None else f"{lo}{unit}"
    right = "不限" if hi is None else f"{hi}{unit}"
    return f"{left} ~ {right}"


def rule_block_to_sentence(block: dict[str, Any]) -> str:
    op = str(block.get("op") or "")
    p = dict(block.get("params") or {})
    meta = RULE_OPS.get(op, {})
    label = str(meta.get("label") or op)

    if op == "quote.market_cap":
        return f"{label}：{_fmt_range(p.get('min'), p.get('max'), '亿')}"
    if op in {"quote.change_percent", "quote.turnover_rate"}:
        return f"{label}：{_fmt_range(p.get('min'), p.get('max'), '%')}"
    if op == "quote.volume_ratio":
        return f"{label} ≥ {p.get('min', '-')}"
    if op == "quote.exclude_st":
        return f"{label}：{'开启' if p.get('enabled', True) else '关闭'}"
    if op == "intraday.timeline_above_avg":
        return f"{label} ≥ {p.get('min', '-')}%"
    if op == "ma.bull_stack":
        periods = p.get("periods") or [5, 10, 20, 60]
        above = p.get("require_price_above")
        extra = f"；价站上 MA{above}" if above else ""
        return f"{label}：{' > '.join(f'MA{x}' for x in periods)}{extra}"
    if op == "ma.dual_coil":
        return (
            f"{label}：MA{p.get('slow', 60)}/MA{p.get('slower', 89)}，"
            f"间距≤{p.get('max_gap_pct', '-')}%"
            + ("；价站上双线" if p.get("require_price_above") else "")
        )
    if op == "ma.above":
        return f"{label}：MA{p.get('period', 60)}"
    if op == "breakout.volume":
        return f"{label}：近 {p.get('lookback', '-')} 日，量≥{p.get('volume_multiple', '-')}×均量"
    if op == "breakout.donchian":
        return f"{label}：N={p.get('n', '-')}"
    if op == "volume.shrink_pullback":
        return f"{label}：回踩 MA{p.get('ma_period', '-')}，量比≤{p.get('volume_ratio_max', '-')}"
    if op == "limit.board_count":
        return f"{label}：{_fmt_range(p.get('min'), p.get('max'))}"
    if op == "board.theme_top_n":
        return f"{label}：Top {p.get('n', '-')}"
    if op == "fina.roe":
        return f"{label} ≥ {p.get('min', '-')}%（约 {p.get('years', '-')} 年）"
    if op == "fina.growth":
        return (
            f"{label}：营收≥{p.get('revenue_min', '-')}%，"
            f"净利≥{p.get('profit_min', '-')}%"
        )
    if op == "valuation.pe_pb_pct":
        return (
            f"{label}：PE≤{p.get('pe_percentile_max', '-')}%，"
            f"PB≤{p.get('pb_percentile_max', '-')}%"
        )
    if op == "valuation.dividend":
        return f"{label} ≥ {p.get('min', '-')}%（约 {p.get('years', '-')} 年）"
    if op == "valuation.peg":
        return f"{label} ≤ {p.get('max', '-')}"
    if op == "risk.tradability":
        return f"{label}：{'是' if p.get('require_flag', True) else '否'}"
    return f"{label}：{p}"


def build_conditions_checklist(rules: dict[str, Any] | None) -> list[str]:
    all_blocks = list((rules or {}).get("all") or [])
    return [rule_block_to_sentence(b) for b in all_blocks if isinstance(b, dict)]


def resolve_copy(
    preset: dict[str, Any],
    *,
    overrides: dict[str, Any] | None = None,
    locked_fields: list[str] | None = None,
) -> dict[str, Any]:
    """模板文案 + 规则派生条件清单；locked 字段不被规则刷新覆盖。"""
    base = dict(preset.get("copy") or {})
    locked = set(locked_fields or [])
    # 用户显式覆盖始终写入；locked 只阻止后续「规则派生」字段被自动刷新
    if overrides:
        for k, v in overrides.items():
            if v is not None:
                base[k] = v
    checklist = build_conditions_checklist(preset.get("rules"))
    if "conditions" not in locked:
        base["conditions"] = checklist
    base.setdefault("disclaimer", DISCLAIMER)
    return base


def apply_param_overrides(
    preset: dict[str, Any],
    param_overrides: dict[str, Any] | None,
) -> dict[str, Any]:
    """按 op 覆盖 params（浅合并）。用于前端改滑条后重算文案。"""
    out = deepcopy(preset)
    if not param_overrides:
        return out
    blocks = list((out.get("rules") or {}).get("all") or [])
    for block in blocks:
        if not isinstance(block, dict):
            continue
        op = str(block.get("op") or "")
        if op in param_overrides and isinstance(param_overrides[op], dict):
            merged = dict(block.get("params") or {})
            merged.update(param_overrides[op])
            block["params"] = merged
    out.setdefault("rules", {})["all"] = blocks
    return out


def eod_filters_from_preset(preset: dict[str, Any]) -> dict[str, Any]:
    """把 eod_intraday_strength 规则映射为前端 EndOfDayFilters。"""
    defaults = {
        "marketCapMin": 50,
        "marketCapMax": 200,
        "volumeRatioMin": 1.2,
        "changePercentMin": 3,
        "changePercentMax": 5,
        "turnoverRateMin": 5,
        "turnoverRateMax": 10,
        "excludeST": True,
        "timelineAboveAvgRatio": 80,
    }
    for block in (preset.get("rules") or {}).get("all") or []:
        if not isinstance(block, dict):
            continue
        op = block.get("op")
        p = dict(block.get("params") or {})
        if op == "quote.market_cap":
            defaults["marketCapMin"] = float(p.get("min") or 0)
            defaults["marketCapMax"] = None if p.get("max") is None else float(p["max"])
        elif op == "quote.volume_ratio":
            defaults["volumeRatioMin"] = float(p.get("min") or 0)
        elif op == "quote.change_percent":
            defaults["changePercentMin"] = float(p.get("min") or 0)
            defaults["changePercentMax"] = None if p.get("max") is None else float(p["max"])
        elif op == "quote.turnover_rate":
            defaults["turnoverRateMin"] = float(p.get("min") or 0)
            defaults["turnoverRateMax"] = None if p.get("max") is None else float(p["max"])
        elif op == "quote.exclude_st":
            defaults["excludeST"] = bool(p.get("enabled", True))
        elif op == "intraday.timeline_above_avg":
            defaults["timelineAboveAvgRatio"] = float(p.get("min") or 0)
    return defaults


def preset_rules_from_eod_filters(filters: dict[str, Any]) -> dict[str, Any]:
    return {
        "all": [
            _block(
                "quote.market_cap",
                min=filters.get("marketCapMin", 50),
                max=filters.get("marketCapMax", 200),
            ),
            _block("quote.volume_ratio", min=filters.get("volumeRatioMin", 1.2)),
            _block(
                "quote.change_percent",
                min=filters.get("changePercentMin", 3),
                max=filters.get("changePercentMax", 5),
            ),
            _block(
                "quote.turnover_rate",
                min=filters.get("turnoverRateMin", 5),
                max=filters.get("turnoverRateMax", 10),
            ),
            _block("quote.exclude_st", enabled=bool(filters.get("excludeST", True))),
            _block(
                "intraday.timeline_above_avg",
                min=filters.get("timelineAboveAvgRatio", 80),
            ),
        ]
    }


def schema_public() -> dict[str, Any]:
    return {
        "version": 1,
        "horizons": ["short", "swing", "long"],
        "risk_levels": ["low", "low_medium", "medium", "medium_high", "high"],
        "run_engines": ["eod_intraday", "research_scanner", "pending"],
        "rule_ops": RULE_OPS,
        "expression": {"mvp": "rules.all = AND of RuleBlocks"},
        "copy_fields": [
            "headline",
            "one_liner",
            "fit_when",
            "avoid_when",
            "how_to_buy",
            "how_to_exit",
            "position_hint",
            "conditions",
            "disclaimer",
        ],
        "disclaimer": DISCLAIMER,
    }
