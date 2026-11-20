"""策略说明书导出（Markdown / JSON）；未样本外验证标「实验性」。"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from research.backtest import RULE_NAME, RULE_VERSION, run_backtest
from research.behavior import detect_behavior_biases
from research.risk_rules import risk_rules_payload
from research.strategy_templates import resolve_template

_SH = ZoneInfo("Asia/Shanghai")


def build_strategy_spec(
    *,
    strategy_template_id: str = "long",
    symbol: str | None = None,
    include_backtest: bool = True,
    format: str = "json",
) -> dict[str, Any]:
    tmpl = resolve_template(strategy_template_id)
    backtest: dict[str, Any] | None = None
    experimental = True
    oos = False

    if include_backtest and symbol:
        backtest = run_backtest(
            template_id="ma_trend",
            symbol=symbol,
            params={"train_ratio": 0.7},
        )
        if backtest.get("ok"):
            experimental = bool(backtest.get("experimental", True))
            oos = bool(backtest.get("oos_validated"))
    else:
        # 无回测样本 → 一律实验性
        experimental = True

    behavior = detect_behavior_biases()
    rules = risk_rules_payload()

    spec = {
        "ok": True,
        "as_of": datetime.now(_SH).isoformat(timespec="seconds"),
        "title": f"策略说明书 · {tmpl.get('name') or strategy_template_id}",
        "strategy_template": tmpl,
        "rule": {
            "id": "ma_trend",
            "name": RULE_NAME,
            "version": RULE_VERSION,
        },
        "experimental": experimental,
        "experimental_label": "实验性" if experimental else "已样本外标注",
        "oos_validated": oos,
        "universe": "A 股单票（说明书示例）；全市场需另声明幸存者处理",
        "entry": "收盘价 > MA60 且 MA20 > MA60；涨停/一字不可成交则跳过",
        "exit": "收盘价 < MA60 或 MA20 < MA60；跌停不可卖则延迟；T+1",
        "risk": {
            "stop": "规则止损由 TradeCard.stop_rule 人工声明",
            "position_cap": rules.get("rules"),
        },
        "costs": {
            "commission_bps": 3,
            "stamp_tax_bps": 5,
            "slippage_bps": 5,
        },
        "validation": {
            "method": "time-series train/test split (train_ratio=0.7)",
            "walk_forward": "Phase4 最小：单次切割；完整 walk-forward 后续",
            "backtest_summary": (
                {
                    "train": (backtest or {}).get("train"),
                    "test": (backtest or {}).get("test"),
                    "assumptions": (backtest or {}).get("assumptions"),
                }
                if backtest and backtest.get("ok")
                else None
            ),
        },
        "behavior_notes": {
            "triggered": behavior.get("triggered_count"),
            "tags": behavior.get("suggested_attribution_tags"),
        },
        "symbol_example": symbol,
        "disclaimer": (
            "不构成投资建议。未完成样本外验证的规则标记为「实验性」，"
            "不得进入默认预设或作为产品结论展示。"
        ),
    }

    if format == "markdown":
        spec["markdown"] = _to_markdown(spec)
    return spec


def _to_markdown(spec: dict[str, Any]) -> str:
    exp = spec.get("experimental_label") or ""
    lines = [
        f"# {spec.get('title')}",
        "",
        f"> 状态：**{exp}** · 规则版本 `{spec.get('rule', {}).get('version')}`",
        "",
        f"- 生成时间：{spec.get('as_of')}",
        f"- 样本外验证：{'是' if spec.get('oos_validated') else '否'}",
        f"- 示例标的：{spec.get('symbol_example') or '—'}",
        "",
        "## 规则",
        f"- 名称：{spec.get('rule', {}).get('name')}",
        f"- 开仓：{spec.get('entry')}",
        f"- 平仓：{spec.get('exit')}",
        f"- 宇宙：{spec.get('universe')}",
        "",
        "## 成本假设",
        f"- {spec.get('costs')}",
        "",
        "## 验证",
        f"- 方法：{spec.get('validation', {}).get('method')}",
        f"- Walk-forward：{spec.get('validation', {}).get('walk_forward')}",
        "",
        "## 免责声明",
        spec.get("disclaimer") or "",
        "",
    ]
    bt = (spec.get("validation") or {}).get("backtest_summary") or {}
    if bt.get("train") or bt.get("test"):
        lines.extend(
            [
                "## 回测摘要",
                f"- 样本内：{bt.get('train')}",
                f"- 样本外：{bt.get('test')}",
                "",
            ]
        )
    return "\n".join(lines)
