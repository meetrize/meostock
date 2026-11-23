"""研判对象模型草案（设计方案 §7.2；Phase 0 仅 schema，未落业务库）。"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ScopeType = Literal["stock", "board", "market", "macro"]
Direction = Literal["bullish", "neutral", "bearish", "insufficient_data"]
Horizon = Literal["1d", "1w", "1m", "1y"]
Confidence = Literal["high", "medium", "low"]
TradeCardStatus = Literal["draft", "open", "closed", "cancelled", "stopped"]
BusinessModeState = Literal["clear", "doubt", "unverified"]  # 清晰 / 存疑 / 未验证


class Scope(TypedDict, total=False):
    id: str
    type: ScopeType
    name: str
    meta: dict[str, Any]


class MetricDefinition(TypedDict, total=False):
    key: str
    name: str
    formula: str
    unit: str
    source: str
    frequency: str
    caveats: str


class MetricSnapshot(TypedDict, total=False):
    scope_id: str
    metric_key: str
    value: float | int | str | None
    unit: str
    as_of: str
    source: str
    period: str
    disclose_at: str
    adjusted: str
    restated: bool
    version: str


class Signal(TypedDict, total=False):
    id: str
    scope_id: str
    dim: str
    score: float | None
    label: str
    rule_id: str
    inputs: list[Any]
    version: str


class Evidence(TypedDict, total=False):
    id: str
    kind: Literal["metric", "news", "ann", "ai"]
    ref: str
    excerpt: str
    as_of: str


class AiBriefPayload(TypedDict, total=False):
    direction: Direction
    horizon: Horizon
    as_of: str
    data_gaps: list[str]
    summary: str
    evidence_ids: list[str]
    falsify_if: list[str]
    confidence: Confidence
    confidence_basis: str


class TradeCard(TypedDict, total=False):
    id: str
    symbol: str
    thesis: str
    evidence: list[str]
    pricing: str
    upside_downside: str
    position_pct: float
    stop_rule: str
    falsify_conditions: list[str]
    status: TradeCardStatus
    strategy_template_id: str
    entry_price: float | None
    entry_date: str | None
    target_price: float | None
    holding_period_days: int | None
    exit_price: float | None
    exit_date: str | None
    exit_reason: str | None
    pnl_pct: float | None
    attribution_tags: list[str]
    business_mode_state: BusinessModeState


class StrategyTemplate(TypedDict, total=False):
    id: str
    rules_json: dict[str, Any]
    universe: str


class RuleBlock(TypedDict, total=False):
    """选股规则积木：op + params。MVP 仅顶层 AND。"""

    op: str
    params: dict[str, Any]


class StrategyCopy(TypedDict, total=False):
    headline: str
    one_liner: str
    fit_when: str
    avoid_when: str
    how_to_buy: str
    how_to_exit: str
    position_hint: str
    conditions: list[str]
    disclaimer: str


class StrategyPreset(TypedDict, total=False):
    """策略扫描预设（与六维 StrategyTemplate 分离）。"""

    id: str
    name: str
    horizon: Literal["short", "swing", "long"]
    version: int
    risk_level: str
    enabled_by_default: bool
    runnable: bool
    run_engine: str
    scanner_template_id: str
    tags: list[str]
    environment: dict[str, Any]
    gates: dict[str, Any]
    rules: dict[str, Any]
    copy: StrategyCopy
    result_columns: list[str]
    sort_default: dict[str, str]
    outputs: dict[str, Any]


class PortfolioSnapshot(TypedDict, total=False):
    id: str
    holdings: list[dict[str, Any]]
    exposures: dict[str, Any]
    drawdown: float | None
    as_of: str


class AgentScopeContext(TypedDict, total=False):
    """Agent 研判上下文（设计方案 §6.3）。"""

    scope_type: ScopeType
    scope_id: str
    visible_signals: list[str]
    as_of: str
    strategy_template_id: str
    user_question: str
