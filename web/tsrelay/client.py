"""Tushare 中继 HTTP 客户端：主备切换、错误分流、轻量限流。"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import requests

_log = logging.getLogger("tushare-gateway")

PRIMARY_URL = os.environ.get(
    "TUSHARE_PRIMARY_URL", "https://tl.kaixin8.top/tushare/sdk"
).rstrip("/")
SECONDARY_URL = os.environ.get(
    "TUSHARE_SECONDARY_URL", "https://datahubco.com/api/tushare"
).rstrip("/")
TIMEOUT_SEC = float(os.environ.get("TUSHARE_TIMEOUT_SEC", "30"))
# 进程内最小间隔，避免打满约 200/min 额度
MIN_INTERVAL_SEC = float(os.environ.get("TUSHARE_MIN_INTERVAL_SEC", "0.35"))

# 不可降级 / 不可重试
_NO_FALLBACK = (
    "invalid_params",
    "unknown_api",
    "api_scope_denied",
    "unauthorized",
    "forbidden",
)


@dataclass
class QueryResult:
    ok: bool
    fields: list[str] = field(default_factory=list)
    items: list[list[Any]] = field(default_factory=list)
    source: str | None = None  # primary | secondary
    url: str | None = None
    error: str | None = None
    error_code: str | None = None
    http_status: int | None = None
    request_id: str | None = None
    retry_after: float | None = None
    msg: str | None = None

    def as_records(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in self.items:
            rec: dict[str, Any] = {}
            for i, key in enumerate(self.fields):
                rec[key] = row[i] if i < len(row) else None
            out.append(rec)
        return out


class TushareClient:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_at = 0.0
        self._session = requests.Session()

    def token(self) -> str | None:
        tok = (
            os.environ.get("TUSHARE_TOKEN")
            or os.environ.get("TUSHARE_RELAY_TOKEN")
            or os.environ.get("DATAHUBCO_TOKEN")
            or ""
        ).strip()
        return tok or None

    def configured(self) -> bool:
        return bool(self.token())

    def _throttle(self) -> None:
        with self._lock:
            now = time.monotonic()
            wait = MIN_INTERVAL_SEC - (now - self._last_at)
            if wait > 0:
                time.sleep(wait)
            self._last_at = time.monotonic()

    def _post(
        self,
        url: str,
        api_name: str,
        params: dict[str, Any],
        fields: str | None,
        token: str,
        label: str,
    ) -> QueryResult:
        self._throttle()
        body: dict[str, Any] = {
            "api_name": api_name,
            "token": token,
            "params": params or {},
        }
        if fields:
            body["fields"] = fields
        try:
            r = self._session.post(
                url,
                json=body,
                timeout=(5, TIMEOUT_SEC),
                allow_redirects=False,
            )
        except requests.Timeout as e:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                error=f"timeout: {e}",
                error_code="timeout",
            )
        except requests.RequestException as e:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                error=str(e),
                error_code="network",
            )

        rid = (
            r.headers.get("X-Datahub-Trace-Id")
            or r.headers.get("X-Request-Id")
            or r.headers.get("X-Relay-Request-Id")
        )
        retry_after = None
        if r.headers.get("Retry-After"):
            try:
                retry_after = float(r.headers["Retry-After"])
            except ValueError:
                retry_after = None

        if r.status_code == 401:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                http_status=401,
                error="unauthorized",
                error_code="unauthorized",
                request_id=rid,
            )
        if r.status_code == 403:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                http_status=403,
                error="forbidden",
                error_code="forbidden",
                request_id=rid,
            )
        if r.status_code == 429:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                http_status=429,
                error="rate_limited",
                error_code="rate_limited",
                request_id=rid,
                retry_after=retry_after,
            )

        try:
            payload = r.json()
        except Exception:
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                http_status=r.status_code,
                error=f"non-json body http={r.status_code}",
                error_code="bad_response",
                request_id=rid,
            )

        code = payload.get("code")
        msg = str(payload.get("msg") or "")
        if r.status_code != 200 or code not in (0, "0", None):
            err_code = self._classify_biz_error(msg, code, r.status_code)
            return QueryResult(
                ok=False,
                source=label,
                url=url,
                http_status=r.status_code,
                error=msg or f"business code={code}",
                error_code=err_code,
                request_id=rid,
                retry_after=retry_after,
                msg=msg,
            )

        data = payload.get("data") or {}
        fields_list = list(data.get("fields") or [])
        items = list(data.get("items") or [])
        return QueryResult(
            ok=True,
            fields=fields_list,
            items=items,
            source=label,
            url=url,
            http_status=r.status_code,
            request_id=rid,
            msg=msg or "ok",
        )

    @staticmethod
    def _classify_biz_error(msg: str, code: Any, http_status: int) -> str:
        text = (msg or "").lower()
        if "scope_denied" in text or "15000-point" in text:
            return "api_scope_denied"
        if "invalid_params" in text or "参数" in (msg or "") and "不合法" in (msg or ""):
            return "invalid_params"
        if "unknown_api" in text:
            return "unknown_api"
        if http_status in (502, 503, 504):
            return "upstream_busy"
        if "pool_exhausted" in text or "busy" in text or "暂不可用" in (msg or ""):
            return "upstream_busy"
        if code not in (0, "0", None):
            return f"biz_{code}"
        return "error"

    def query(
        self,
        api_name: str,
        params: dict[str, Any] | None = None,
        fields: str | None = None,
        *,
        prefer: str = "primary",
        allow_fallback: bool = True,
    ) -> QueryResult:
        token = self.token()
        if not token:
            return QueryResult(
                ok=False,
                error="TUSHARE_TOKEN 未配置",
                error_code="not_configured",
            )

        params = dict(params or {})
        # 去掉空字符串日期等
        params = {k: v for k, v in params.items() if v is not None and v != ""}

        order: list[tuple[str, str]]
        if prefer == "secondary":
            order = [("secondary", SECONDARY_URL), ("primary", PRIMARY_URL)]
        else:
            order = [("primary", PRIMARY_URL), ("secondary", SECONDARY_URL)]

        last: QueryResult | None = None
        for i, (label, url) in enumerate(order):
            if i > 0 and not allow_fallback:
                break
            res = self._post(url, api_name, params, fields, token, label)
            if res.ok:
                return res
            last = res
            if res.error_code in _NO_FALLBACK:
                return res
            if res.error_code in ("unauthorized", "forbidden", "not_configured"):
                return res
            _log.info(
                "tushare %s via %s failed (%s); %s",
                api_name,
                label,
                res.error_code,
                "try fallback" if i == 0 and allow_fallback else "stop",
            )
        return last or QueryResult(ok=False, error="no result", error_code="error")

    def health_ping(self) -> dict[str, Any]:
        """各源打一次 trade_cal（轻量）。"""
        token = self.token()
        out: dict[str, Any] = {
            "configured": bool(token),
            "primary_url": PRIMARY_URL,
            "secondary_url": SECONDARY_URL,
            "primary": None,
            "secondary": None,
        }
        if not token:
            return out
        for label, url in (("primary", PRIMARY_URL), ("secondary", SECONDARY_URL)):
            t0 = time.perf_counter()
            res = self._post(
                url,
                "trade_cal",
                {"exchange": "SSE", "start_date": "20261020", "end_date": "20261027"},
                "exchange,cal_date,is_open",
                token,
                label,
            )
            out[label] = {
                "ok": res.ok,
                "rows": len(res.items) if res.ok else 0,
                "ms": round((time.perf_counter() - t0) * 1000),
                "error": res.error,
                "error_code": res.error_code,
                "request_id": res.request_id,
            }
        return out


_client: TushareClient | None = None
_client_lock = threading.Lock()


def get_client() -> TushareClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = TushareClient()
        return _client
