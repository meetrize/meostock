"""最小风控规则口径（Phase 0 文档化；Phase 1 面板落地）。

持仓真相源：TradeCard(status=open) + 手动导入；watchlist 不参与计算。
"""

from __future__ import annotations

from typing import Any

# —— 默认阈值（可被策略模板覆盖）——
DEFAULT_SINGLE_NAME_MAX_PCT = 15.0  # 单票占总资产上限 %
DEFAULT_INDUSTRY_MAX_PCT = 40.0  # 单一行业暴露上限 %
DEFAULT_STOP_REQUIRED = True  # open 卡片必须有 stop_rule
DEFAULT_MAX_OPEN_POSITIONS = 10  # 同时持仓只数软上限

RISK_RULES_DOC = {
    "version": "p0.1",
    "as_of_note": "Phase 0 仅口径；执行与 UI 在 Phase 1",
    "holdings_source": {
        "truth": "TradeCard status=open + 手动导入 JSON/CSV",
        "not_holdings": "watchlist / favorites（观察池，不计入集中度）",
    },
    "rules": [
        {
            "id": "stop_line_required",
            "name": "单票止损线",
            "description": "每笔 open 交易卡片必须填写 stop_rule（价格线或逻辑证伪）。",
            "default": DEFAULT_STOP_REQUIRED,
            "violation": "missing_stop",
        },
        {
            "id": "single_name_cap",
            "name": "单票仓位上限",
            "description": f"单票市值占组合总资产 ≤ {DEFAULT_SINGLE_NAME_MAX_PCT}%（新手建议）。",
            "default_pct": DEFAULT_SINGLE_NAME_MAX_PCT,
            "violation": "single_name_overweight",
        },
        {
            "id": "concentration_cap",
            "name": "组合集中度",
            "description": (
                f"单一行业暴露 ≤ {DEFAULT_INDUSTRY_MAX_PCT}%；"
                f"同时 open 持仓建议 ≤ {DEFAULT_MAX_OPEN_POSITIONS} 只。"
            ),
            "industry_max_pct": DEFAULT_INDUSTRY_MAX_PCT,
            "max_open_positions": DEFAULT_MAX_OPEN_POSITIONS,
            "violation": "concentration_breach",
        },
        {
            "id": "violation_counter",
            "name": "违规计数",
            "description": (
                "结案或复盘时统计：无止损开仓、超单票上限、超行业上限、"
                "浮亏加仓（Phase 4 行为偏差）等次数；目标 → 0。"
            ),
            "violation": "discipline_violation",
        },
    ],
}


def risk_rules_payload() -> dict[str, Any]:
    return dict(RISK_RULES_DOC)
