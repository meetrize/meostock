"""AI 平台档案：一个平台 = 一套 provider + base_url + api_key，可挂多个模型。

模型（ai_provider_profile）通过 platform_id 归属平台并继承调用参数，
所以同一平台下新增模型只需填模型名，不必重复填 base_url / key。
"""

from __future__ import annotations

import json
import logging
import time
import uuid
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from cache.db import _lock, get_conn, init_db

_log = logging.getLogger("ai.platforms")

PROVIDERS = ("deepseek", "openai_compat")
DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com"

# 上游 /models 失败时的本地兜底（仅作勾选建议，不自动入库）
PRESET_MODELS: dict[str, list[dict[str, str]]] = {
    "deepseek": [
        {"id": "deepseek-chat", "owned_by": "deepseek"},
        {"id": "deepseek-flash", "owned_by": "deepseek"},
        {"id": "deepseek-reasoner", "owned_by": "deepseek"},
    ],
}


def mask_api_key(key: str | None) -> str:
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 4:
        return "****"
    return f"****{raw[-4:]}"


def normalize_provider(raw: str | None) -> str:
    p = (raw or "").strip().lower()
    if p in ("openai", "compat", "openai-compatible", "custom"):
        return "openai_compat"
    return p if p in PROVIDERS else "openai_compat"


def normalize_base_url(url: str | None, provider: str) -> str:
    u = (url or "").strip().rstrip("/")
    if not u and provider == "deepseek":
        return DEFAULT_DEEPSEEK_URL
    return u


def provider_label(provider: str | None) -> str:
    return "DeepSeek" if (provider or "") == "deepseek" else "OpenAI 兼容"


def provider_host(base_url: str) -> str:
    try:
        return (urlparse(base_url if "//" in base_url else f"//{base_url}").netloc or "").strip()
    except ValueError:
        return ""


def default_name(provider: str, base_url: str) -> str:
    if provider == "deepseek":
        return "DeepSeek"
    return provider_host(base_url) or provider_label(provider)


def public_row(row: dict[str, Any], *, models: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    key = str(row.get("api_key") or "")
    out: dict[str, Any] = {
        "id": row["id"],
        "name": row["name"],
        "provider": row["provider"],
        "base_url": row.get("base_url") or "",
        "has_api_key": bool(key.strip()),
        "api_key_masked": mask_api_key(key),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }
    if models is not None:
        out["models"] = models
        out["model_count"] = len(models)
    return out


def _rows(*, include_secret: bool) -> list[dict[str, Any]]:
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, name, provider, base_url, api_key, created_at, updated_at
            FROM ai_platform
            ORDER BY updated_at DESC
            """
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        item = dict(r)
        pub = public_row(item)
        if include_secret:
            pub["api_key"] = item.get("api_key") or ""
        out.append(pub)
    return out


def list_platforms(*, include_secret: bool = False) -> list[dict[str, Any]]:
    return _rows(include_secret=include_secret)


def platform_map(*, include_secret: bool = True) -> dict[str, dict[str, Any]]:
    return {str(p["id"]): p for p in _rows(include_secret=include_secret)}


def get_platform(platform_id: str, *, include_secret: bool = False) -> dict[str, Any] | None:
    pid = (platform_id or "").strip()
    if not pid:
        return None
    for p in _rows(include_secret=include_secret):
        if p["id"] == pid:
            return p
    return None


def create_platform(
    *, name: str | None = None, provider: str, base_url: str, api_key: str
) -> dict[str, Any]:
    init_db()
    prov = normalize_provider(provider)
    base = normalize_base_url(base_url, prov)
    key = (api_key or "").strip()
    if not base:
        raise ValueError("缺少 base_url")
    if not key:
        raise ValueError("缺少 api_key")
    name_s = (name or "").strip() or default_name(prov, base)
    pid = uuid.uuid4().hex
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO ai_platform(id, name, provider, base_url, api_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pid, name_s, prov, base, key, now, now),
        )
        conn.commit()
    return get_platform(pid) or {"id": pid, "name": name_s}


def count_platform_models(platform_id: str) -> int:
    init_db()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT COUNT(1) AS c FROM ai_provider_profile WHERE platform_id = ?",
            ((platform_id or "").strip(),),
        ).fetchone()
    return int(row["c"] if row is not None else 0)


def update_platform(
    platform_id: str,
    *,
    name: str | None = None,
    provider: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """更新平台；api_key 留空 = 不改。平台下的模型自动继承新端点。"""
    init_db()
    pid = (platform_id or "").strip()
    existing = get_platform(pid, include_secret=True)
    if not existing:
        raise KeyError("平台不存在")
    prov = normalize_provider(provider if provider is not None else existing["provider"])
    base = normalize_base_url(
        base_url if base_url is not None else str(existing.get("base_url") or ""), prov
    )
    key = (api_key or "").strip() or str(existing.get("api_key") or "")
    if not base:
        raise ValueError("缺少 base_url")
    if not key:
        raise ValueError("缺少 api_key")
    name_s = (name if name is not None else str(existing.get("name") or "")).strip() or default_name(
        prov, base
    )
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            UPDATE ai_platform
            SET name=?, provider=?, base_url=?, api_key=?, updated_at=?
            WHERE id=?
            """,
            (name_s, prov, base, key, now, pid),
        )
        conn.commit()
    return get_platform(pid) or existing


def delete_platform(platform_id: str) -> None:
    init_db()
    pid = (platform_id or "").strip()
    if not pid:
        raise ValueError("缺少 id")
    n = count_platform_models(pid)
    if n > 0:
        raise ValueError(f"该平台下还有 {n} 个模型，请先删除模型")
    conn = get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM ai_platform WHERE id = ?", (pid,))
        conn.commit()
        if not cur.rowcount:
            raise KeyError("平台不存在")


def _models_endpoint_candidates(base_url: str) -> list[str]:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return []
    if base.endswith("/v1"):
        return [f"{base}/models"]
    return [f"{base}/v1/models", f"{base}/models"]


def discover_remote_models(
    *,
    base_url: str,
    api_key: str,
    provider: str | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """请求 OpenAI 兼容 GET {base}/models，返回 {ok, models, source, error?}。"""
    key = (api_key or "").strip()
    if not key:
        return {"ok": False, "models": [], "source": "none", "error": "缺少 api_key"}
    last_err = ""
    for url in _models_endpoint_candidates(base_url):
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            items = data.get("data") if isinstance(data, dict) else None
            if not isinstance(items, list):
                last_err = "响应缺少 data 列表"
                continue
            models: list[dict[str, str]] = []
            seen: set[str] = set()
            for it in items:
                if not isinstance(it, dict):
                    continue
                mid = str(it.get("id") or "").strip()
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                models.append(
                    {
                        "id": mid,
                        "owned_by": str(it.get("owned_by") or it.get("ownedBy") or ""),
                    }
                )
            models.sort(key=lambda m: m["id"].lower())
            return {"ok": True, "models": models, "source": "remote", "url": url}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
            last_err = f"HTTP {e.code}: {body[:200]}"
            _log.warning("discover models %s failed: %s", url, last_err)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            _log.warning("discover models %s failed: %s", url, e)

    presets = PRESET_MODELS.get(normalize_provider(provider), [])
    if presets:
        return {
            "ok": False,
            "models": list(presets),
            "source": "preset",
            "error": last_err or "拉取失败，已提供本地预设",
        }
    return {
        "ok": False,
        "models": [],
        "source": "none",
        "error": last_err or "拉取模型列表失败",
    }


def discover_platform_models(platform_id: str) -> dict[str, Any]:
    plat = get_platform(platform_id, include_secret=True)
    if not plat:
        raise KeyError("平台不存在")
    result = discover_remote_models(
        base_url=str(plat.get("base_url") or ""),
        api_key=str(plat.get("api_key") or ""),
        provider=str(plat.get("provider") or ""),
    )
    result["platform_id"] = plat["id"]
    result["platform_name"] = plat.get("name")
    return result


def _balance_endpoint_candidates(base_url: str | None) -> list[str]:
    """余额接口仅官方 DeepSeek 提供；优先官方域名，再尝试配置里的 deepseek host。"""
    official = [
        "https://api.deepseek.com/user/balance",
        "https://api.deepseek.com/v1/user/balance",
    ]
    out: list[str] = list(official)
    base = (base_url or "").strip().rstrip("/")
    if base and "deepseek.com" in base.lower():
        root = base[:-3] if base.endswith("/v1") else base
        for u in (f"{root}/user/balance", f"{root}/v1/user/balance"):
            if u not in out:
                out.append(u)
    return out


def fetch_deepseek_balance(
    *,
    api_key: str,
    base_url: str | None = None,
    timeout: float = 20.0,
) -> dict[str, Any]:
    """GET /user/balance → {ok, is_available, balances[{currency,total_balance,...}], display, error?}。"""
    key = (api_key or "").strip()
    if not key:
        return {"ok": False, "error": "缺少 api_key", "balances": []}

    last_err = ""
    for url in _balance_endpoint_candidates(base_url):
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            if not isinstance(data, dict):
                last_err = "响应不是 JSON 对象"
                continue
            infos = data.get("balance_infos")
            balances: list[dict[str, Any]] = []
            if isinstance(infos, list):
                for it in infos:
                    if not isinstance(it, dict):
                        continue
                    currency = str(it.get("currency") or "").strip() or "CNY"
                    total = str(it.get("total_balance") or "").strip()
                    if not total:
                        continue
                    balances.append(
                        {
                            "currency": currency,
                            "total_balance": total,
                            "granted_balance": str(it.get("granted_balance") or ""),
                            "topped_up_balance": str(it.get("topped_up_balance") or ""),
                        }
                    )
            # 展示优先 CNY，否则第一条
            pick = next((b for b in balances if b["currency"] == "CNY"), None)
            if not pick and balances:
                pick = balances[0]
            if pick:
                sym = "¥" if pick["currency"] == "CNY" else (
                    "$" if pick["currency"] == "USD" else f"{pick['currency']} "
                )
                display = f"{sym}{pick['total_balance']}"
            else:
                display = "—"
            return {
                "ok": True,
                "is_available": bool(data.get("is_available")),
                "balances": balances,
                "display": display,
                "url": url,
            }
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else str(e.reason)
            last_err = f"HTTP {e.code}: {body[:200]}"
            _log.warning("deepseek balance %s failed: %s", url, last_err)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
            _log.warning("deepseek balance %s failed: %s", url, e)

    return {
        "ok": False,
        "error": last_err or "查询余额失败",
        "balances": [],
        "display": None,
    }


def fetch_platform_balance(platform_id: str) -> dict[str, Any]:
    plat = get_platform(platform_id, include_secret=True)
    if not plat:
        raise KeyError("平台不存在")
    if normalize_provider(str(plat.get("provider") or "")) != "deepseek":
        raise ValueError("仅 DeepSeek 平台支持余额查询")
    result = fetch_deepseek_balance(
        api_key=str(plat.get("api_key") or ""),
        base_url=str(plat.get("base_url") or ""),
    )
    result["platform_id"] = plat["id"]
    result["platform_name"] = plat.get("name")
    return result
