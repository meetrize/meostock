"""Tushare 财务权限探测与可选 fina_indicator 拉取。"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

_log = logging.getLogger("research.fina")

_PROBE_CACHE: dict[str, Any] = {"ts": 0.0, "result": None}
_PROBE_TTL = 3600.0


def to_ts_code(code: str) -> str | None:
    raw = (code or "").strip().upper()
    m = re.search(r"(\d{6})", raw)
    if not m:
        return None
    sym = m.group(1)
    if sym.startswith(("5", "6", "9")):
        return f"{sym}.SH"
    if sym.startswith(("0", "1", "2", "3")):
        return f"{sym}.SZ"
    if sym.startswith(("4", "8")):
        return f"{sym}.BJ"
    return f"{sym}.SH"


def probe_fina_access(*, force: bool = False) -> dict[str, Any]:
    """探测 fina_indicator 是否可用（积分/权限）。结果缓存 1h。"""
    now = time.time()
    if (
        not force
        and _PROBE_CACHE["result"] is not None
        and now - float(_PROBE_CACHE["ts"] or 0) < _PROBE_TTL
    ):
        return dict(_PROBE_CACHE["result"])

    out: dict[str, Any] = {
        "ok": True,
        "configured": False,
        "fina_indicator": False,
        "error": None,
        "error_code": None,
        "mode": "degraded_pe_pb",
        "hint": "无财务权限时估值维用行情 PE/PB 分位，财务维空态",
    }
    try:
        from tsrelay.client import get_client

        client = get_client()
        out["configured"] = bool(client.configured())
        if not out["configured"]:
            out["error"] = "TUSHARE_TOKEN 未配置"
            out["error_code"] = "not_configured"
            _PROBE_CACHE.update(ts=now, result=out)
            return out

        # 用一只大盘样本探测
        res = client.query(
            "fina_indicator",
            {"ts_code": "600519.SH", "limit": 1},
            "ts_code,end_date,roe,grossprofit_margin,debt_to_assets,ocf_to_profit",
        )
        if res.ok and (res.as_records() or []):
            out["fina_indicator"] = True
            out["mode"] = "fina_indicator"
            out["hint"] = "已具备 fina_indicator 权限"
        else:
            out["fina_indicator"] = False
            out["error"] = res.error
            out["error_code"] = res.error_code
            out["mode"] = "degraded_pe_pb"
    except Exception as exc:  # noqa: BLE001
        _log.warning("fina probe failed: %s", exc)
        out["error"] = str(exc)
        out["error_code"] = "probe_error"

    _PROBE_CACHE.update(ts=now, result=out)
    return out


def fetch_fina_indicator(code: str) -> dict[str, Any]:
    """拉取单票最近一期财务指标；失败返回 available=False。"""
    probe = probe_fina_access()
    ts_code = to_ts_code(code)
    if not ts_code:
        return {"available": False, "reason": "bad_code", "probe": probe}
    if not probe.get("fina_indicator"):
        return {
            "available": False,
            "reason": "no_permission",
            "probe": probe,
            "ts_code": ts_code,
        }
    try:
        from tsrelay.client import get_client

        res = get_client().query(
            "fina_indicator",
            {"ts_code": ts_code, "limit": 8},
            "ts_code,ann_date,end_date,roe,grossprofit_margin,netprofit_margin,"
            "debt_to_assets,ocf_to_profit,roa,current_ratio",
        )
        if not res.ok:
            return {
                "available": False,
                "reason": res.error_code or "query_failed",
                "error": res.error,
                "ts_code": ts_code,
                "probe": probe,
            }
        rows = res.as_records() or []
        if not rows:
            return {
                "available": False,
                "reason": "empty",
                "ts_code": ts_code,
                "probe": probe,
            }
        latest = rows[0]
        return {
            "available": True,
            "ts_code": ts_code,
            "as_of": latest.get("ann_date") or latest.get("end_date"),
            "end_date": latest.get("end_date"),
            "metrics": {
                "roe": _num(latest.get("roe")),
                "grossprofit_margin": _num(latest.get("grossprofit_margin")),
                "netprofit_margin": _num(latest.get("netprofit_margin")),
                "debt_to_assets": _num(latest.get("debt_to_assets")),
                "ocf_to_profit": _num(latest.get("ocf_to_profit")),
                "roa": _num(latest.get("roa")),
            },
            "history": [
                {
                    "end_date": r.get("end_date"),
                    "roe": _num(r.get("roe")),
                    "grossprofit_margin": _num(r.get("grossprofit_margin")),
                }
                for r in rows[:5]
            ],
            "source": "tushare:fina_indicator",
            "probe": probe,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "reason": "exception",
            "error": str(exc),
            "ts_code": ts_code,
            "probe": probe,
        }


def _num(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None
