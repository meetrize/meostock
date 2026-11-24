"""Research Workbench HTTP API（Phase 0–3）。"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from research import __version__
from research.ai_brief import generate_brief
from research.backtest import run_backtest
from research.behavior import detect_behavior_biases
from research.business_mode import get_business_mode, set_business_mode
from research.cards_close import close_card
from research.cards_store import delete_card, get_card, import_cards, list_cards, upsert_card
from research.consistency import check_consistency
from research.fina_probe import probe_fina_access
from research.portfolio_risk import build_portfolio_risk
from research.review import build_review_report
from research.risk_rules import risk_rules_payload
from research.pattern_events import (
    cancel_scan as cancel_pattern_scan,
    get_progress as get_pattern_progress,
    get_results as get_pattern_results,
    start_scan as start_pattern_scan,
)
from research.scanner_run import list_scan_templates, run_scanner
from research.scorecard import build_scorecard
from research.strategy_presets import (
    apply_param_overrides,
    get_preset,
    list_presets,
    resolve_copy,
    schema_public,
)
from research.strategy_spec import build_strategy_spec
from research.strategy_templates import list_templates
from research.themes import build_theme_leaders
from research.thermometer import build_market_thermometer
from research.timeline import build_timeline

router = APIRouter(prefix="/api/research", tags=["research"])
_log = logging.getLogger("research")
_SH = ZoneInfo("Asia/Shanghai")


def _now_iso() -> str:
    return datetime.now(_SH).isoformat(timespec="seconds")


class CardBody(BaseModel):
    id: str | None = None
    symbol: str = Field(..., min_length=1)
    thesis: str | None = None
    evidence: list[str] | None = None
    pricing: str | None = None
    upside_downside: str | None = None
    position_pct: float | None = None
    stop_rule: str | None = None
    falsify_conditions: list[str] | None = None
    status: str | None = "draft"
    strategy_template_id: str | None = None
    entry_price: float | None = None
    entry_date: str | None = None
    target_price: float | None = None
    business_mode_state: str | None = "unverified"
    attribution_tags: list[str] | None = None
    exit_price: float | None = None
    exit_date: str | None = None
    exit_reason: str | None = None
    holding_period_days: int | None = None
    pnl_pct: float | None = None


class ImportBody(BaseModel):
    cards: list[dict[str, Any]] = Field(default_factory=list)


class BusinessModeBody(BaseModel):
    state: str = Field(..., description="clear|doubt|unverified")
    note: str | None = ""


class ScannerRunBody(BaseModel):
    template_id: str = "quality_value"
    params: dict[str, Any] | None = None
    # { "volume.price_sync_rise": { require_ma20_up: false, ... }, "quote.exclude_st": { enabled: true } }
    rule_param_overrides: dict[str, Any] | None = None


class PatternEventsRunBody(BaseModel):
    preset_id: str = "volume_price_rise"
    rule_param_overrides: dict[str, Any] | None = None
    exclude_st: bool = True
    min_bars: int = 80
    max_bars_per_symbol: int = 600
    concurrency: int = 6
    dedupe: str = "run"


class CloseCardBody(BaseModel):
    status: str = "closed"
    exit_price: float | None = None
    exit_date: str | None = None
    exit_reason: str = Field(..., min_length=1)
    attribution_tags: list[str] | None = None
    attribution_note: str | None = None
    falsify_triggered: list[str] | None = None


class BriefBody(BaseModel):
    symbol: str = Field(..., min_length=1)
    strategy_template_id: str | None = "long"
    user_question: str | None = None
    raw_model_text: str | None = None


class BacktestBody(BaseModel):
    symbol: str = Field(..., min_length=1)
    template_id: str = "ma_trend"
    name: str | None = ""
    params: dict[str, Any] | None = None


class StrategySpecBody(BaseModel):
    strategy_template_id: str = "long"
    symbol: str | None = None
    include_backtest: bool = True
    format: str = "json"


class ResolveCopyBody(BaseModel):
    preset_id: str = Field(..., min_length=1)
    param_overrides: dict[str, Any] | None = None
    copy_overrides: dict[str, Any] | None = None
    locked_fields: list[str] | None = None


@router.get("/health")
def research_health() -> JSONResponse:
    probe = {}
    try:
        probe = probe_fina_access()
    except Exception as exc:  # noqa: BLE001
        probe = {"ok": False, "error": str(exc)}
    return JSONResponse(
        {
            "ok": True,
            "service": "research-workbench",
            "version": __version__,
            "phase": "4",
            "as_of": _now_iso(),
            "capabilities": [
                "health",
                "regime_placeholder",
                "risk_rules",
                "ai_validate",
                "market_thermometer",
                "theme_leaders",
                "trade_cards",
                "portfolio_risk",
                "scorecard",
                "consistency",
                "scanner_run",
                "business_mode",
                "fina_probe",
                "timeline",
                "ai_brief",
                "cards_close",
                "review_report",
                "backtest",
                "behavior_bias",
                "strategy_spec",
                "strategy_presets",
            ],
            "fina_probe": {
                "mode": probe.get("mode"),
                "fina_indicator": probe.get("fina_indicator"),
                "hint": probe.get("hint"),
            },
            "pending": [],
        }
    )


@router.get("/regime")
def research_regime() -> JSONResponse:
    """宏观占位 + 嵌入温度摘要。"""
    as_of = _now_iso()
    thermo: dict[str, Any] = {}
    try:
        thermo = build_market_thermometer()
    except Exception as exc:  # noqa: BLE001
        _log.warning("regime thermo failed: %s", exc)
    payload: dict[str, Any] = {
        "ok": True,
        "as_of": as_of,
        "phase": "p1",
        "regime": {
            "liquidity": "neutral",
            "risk_appetite": (
                "high"
                if (thermo.get("temperature") or 0) >= 65
                else "low"
                if (thermo.get("temperature") or 100) <= 35
                else "neutral"
            ),
            "position_bias": (
                "offensive"
                if (thermo.get("temperature") or 0) >= 65
                else "defensive"
                if (thermo.get("temperature") or 100) <= 35
                else "neutral"
            ),
            "label": thermo.get("stage") or "数据接入中",
        },
        "market": {
            "temperature": thermo.get("temperature"),
            "stage": thermo.get("stage"),
            "stage_def": thermo.get("stage_def"),
        },
        "data_gaps": ["macro_domestic_series", *(thermo.get("data_gaps") or [])],
        "disclaimer": "不构成投资建议；宏观仍为占位，温度来自规则引擎。",
    }
    return JSONResponse(payload)


@router.get("/risk-rules")
def research_risk_rules() -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "as_of": _now_iso(), **risk_rules_payload()})
    except Exception as exc:  # noqa: BLE001
        _log.exception("risk rules failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/market-thermometer")
def research_market_thermometer() -> JSONResponse:
    try:
        return JSONResponse(build_market_thermometer())
    except Exception as exc:  # noqa: BLE001
        _log.exception("thermometer failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/themes/leaders")
def research_theme_leaders(
    limit: int = Query(12, ge=1, le=40),
) -> JSONResponse:
    try:
        return JSONResponse(build_theme_leaders(limit=limit))
    except Exception as exc:  # noqa: BLE001
        _log.exception("theme leaders failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/portfolio/risk")
def research_portfolio_risk(
    cash: float | None = Query(None, description="现金占比或金额（相对单位）"),
) -> JSONResponse:
    try:
        payload = build_portfolio_risk(cash=cash)
        payload["as_of"] = _now_iso()
        return JSONResponse(payload)
    except Exception as exc:  # noqa: BLE001
        _log.exception("portfolio risk failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/cards")
def research_cards_list(
    status: str | None = Query(None, description="draft|open|closed|…"),
    symbol: str | None = Query(None),
) -> JSONResponse:
    try:
        return JSONResponse(
            {
                "ok": True,
                "as_of": _now_iso(),
                "cards": list_cards(status=status, symbol=symbol),
            }
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("list cards failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/cards/{card_id}")
def research_cards_get(card_id: str) -> JSONResponse:
    card = get_card(card_id)
    if not card:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    return JSONResponse({"ok": True, "card": card})


@router.post("/cards")
def research_cards_upsert(body: CardBody) -> JSONResponse:
    try:
        card = upsert_card(body.model_dump(exclude_none=True))
        return JSONResponse({"ok": True, "card": card})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("upsert card failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/cards/import")
def research_cards_import(body: ImportBody) -> JSONResponse:
    try:
        result = import_cards(body.cards)
        return JSONResponse({"ok": True, **result})
    except Exception as exc:  # noqa: BLE001
        _log.exception("import cards failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.delete("/cards/{card_id}")
def research_cards_delete(card_id: str) -> JSONResponse:
    try:
        deleted = delete_card(card_id)
        if not deleted:
            return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
        return JSONResponse({"ok": True, "deleted": card_id})
    except Exception as exc:  # noqa: BLE001
        _log.exception("delete card failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/fina/probe")
def research_fina_probe(
    force: bool = Query(False, description="强制刷新探测缓存"),
) -> JSONResponse:
    try:
        return JSONResponse({"ok": True, "as_of": _now_iso(), **probe_fina_access(force=force)})
    except Exception as exc:  # noqa: BLE001
        _log.exception("fina probe failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/strategy-templates")
def research_strategy_templates() -> JSONResponse:
    return JSONResponse({"ok": True, "templates": list_templates()})


@router.get("/strategy-presets/schema")
def research_strategy_presets_schema() -> JSONResponse:
    return JSONResponse({"ok": True, **schema_public()})


@router.get("/strategy-presets")
def research_strategy_presets(
    horizon: str | None = Query(None, description="short|swing|long"),
) -> JSONResponse:
    return JSONResponse({"ok": True, "presets": list_presets(horizon=horizon)})


@router.get("/strategy-presets/{preset_id}")
def research_strategy_preset_get(preset_id: str) -> JSONResponse:
    preset = get_preset(preset_id)
    if not preset:
        return JSONResponse({"ok": False, "error": "preset not found"}, status_code=404)
    copy = resolve_copy(preset)
    return JSONResponse({"ok": True, "preset": preset, "resolved_copy": copy})


@router.post("/strategy-presets/resolve-copy")
def research_strategy_presets_resolve_copy(body: ResolveCopyBody) -> JSONResponse:
    preset = get_preset(body.preset_id)
    if not preset:
        return JSONResponse({"ok": False, "error": "preset not found"}, status_code=404)
    patched = apply_param_overrides(preset, body.param_overrides)
    copy = resolve_copy(
        patched,
        overrides=body.copy_overrides,
        locked_fields=body.locked_fields,
    )
    return JSONResponse(
        {
            "ok": True,
            "preset_id": body.preset_id,
            "rules": patched.get("rules"),
            "resolved_copy": copy,
            "conditions": copy.get("conditions") or [],
        }
    )


@router.get("/stock/{code}/scorecard")
def research_stock_scorecard(
    code: str,
    strategy_template_id: str | None = Query("long"),
) -> JSONResponse:
    try:
        return JSONResponse(
            build_scorecard(code, strategy_template_id=strategy_template_id)
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("scorecard failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/stock/{code}/consistency")
def research_stock_consistency(
    code: str,
    strategy_template_id: str | None = Query("long"),
) -> JSONResponse:
    try:
        return JSONResponse(
            check_consistency(code, strategy_template_id=strategy_template_id)
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("consistency failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/stock/{code}/business-mode")
def research_business_mode_get(code: str) -> JSONResponse:
    return JSONResponse({"ok": True, **get_business_mode(code)})


@router.put("/stock/{code}/business-mode")
def research_business_mode_put(code: str, body: BusinessModeBody) -> JSONResponse:
    try:
        row = set_business_mode(code, body.state, note=body.note or "")
        return JSONResponse({"ok": True, **row})
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("set business mode failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/scanner/templates")
def research_scanner_templates() -> JSONResponse:
    return JSONResponse({"ok": True, "templates": list_scan_templates()})


@router.post("/scanner/run")
def research_scanner_run(body: ScannerRunBody) -> JSONResponse:
    try:
        return JSONResponse(
            run_scanner(
                body.template_id,
                params=body.params,
                rule_param_overrides=body.rule_param_overrides,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("scanner run failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/stock/{code}/timeline")
def research_stock_timeline(
    code: str,
    limit: int = Query(40, ge=1, le=100),
) -> JSONResponse:
    try:
        return JSONResponse(build_timeline(code, limit=limit))
    except Exception as exc:  # noqa: BLE001
        _log.exception("timeline failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/ai/brief")
def research_ai_brief(body: BriefBody) -> JSONResponse:
    try:
        payload = generate_brief(
            body.symbol,
            strategy_template_id=body.strategy_template_id or "long",
            user_question=body.user_question,
            raw_model_text=body.raw_model_text,
        )
        status = 200 if payload.get("ok") else 422
        return JSONResponse(payload, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("ai brief failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/cards/{card_id}/close")
def research_cards_close(card_id: str, body: CloseCardBody) -> JSONResponse:
    try:
        result = close_card(
            card_id,
            status=body.status,
            exit_price=body.exit_price,
            exit_date=body.exit_date,
            exit_reason=body.exit_reason,
            attribution_tags=body.attribution_tags,
            attribution_note=body.attribution_note,
            falsify_triggered=body.falsify_triggered,
        )
        return JSONResponse(result)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        _log.exception("close card failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/review/report")
def research_review_report(
    strategy_template_id: str | None = Query(None),
    benchmark: str | None = Query(None),
) -> JSONResponse:
    try:
        return JSONResponse(
            build_review_report(
                strategy_template_id=strategy_template_id,
                benchmark=benchmark,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("review report failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/pattern-events/run")
def research_pattern_events_run(body: PatternEventsRunBody) -> JSONResponse:
    try:
        return JSONResponse(
            start_pattern_scan(
                {
                    "preset_id": body.preset_id,
                    "rule_param_overrides": body.rule_param_overrides,
                    "exclude_st": body.exclude_st,
                    "min_bars": body.min_bars,
                    "max_bars_per_symbol": body.max_bars_per_symbol,
                    "concurrency": body.concurrency,
                    "dedupe": body.dedupe,
                }
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("pattern-events run failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/pattern-events/progress")
def research_pattern_events_progress() -> JSONResponse:
    return JSONResponse({"ok": True, "progress": get_pattern_progress()})


@router.get("/pattern-events/results")
def research_pattern_events_results(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    sort: str = Query("signal_date_desc"),
) -> JSONResponse:
    return JSONResponse(get_pattern_results(offset=offset, limit=limit, sort=sort))


@router.post("/pattern-events/cancel")
def research_pattern_events_cancel() -> JSONResponse:
    return JSONResponse(cancel_pattern_scan())


@router.post("/backtest/run")
def research_backtest_run(body: BacktestBody) -> JSONResponse:
    try:
        payload = run_backtest(
            template_id=body.template_id,
            symbol=body.symbol,
            name=body.name or "",
            params=body.params,
        )
        status = 200 if payload.get("ok") else 422
        return JSONResponse(payload, status_code=status)
    except Exception as exc:  # noqa: BLE001
        _log.exception("backtest failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.get("/behavior/report")
def research_behavior_report() -> JSONResponse:
    try:
        return JSONResponse(detect_behavior_biases())
    except Exception as exc:  # noqa: BLE001
        _log.exception("behavior report failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)


@router.post("/strategy/spec")
def research_strategy_spec(body: StrategySpecBody) -> JSONResponse:
    try:
        return JSONResponse(
            build_strategy_spec(
                strategy_template_id=body.strategy_template_id,
                symbol=body.symbol,
                include_backtest=body.include_backtest,
                format=body.format,
            )
        )
    except Exception as exc:  # noqa: BLE001
        _log.exception("strategy spec failed")
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
