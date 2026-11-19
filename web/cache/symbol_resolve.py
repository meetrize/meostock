"""批量将文本 token 解析为本库 symbol（代码/名称模糊匹配）。"""

from __future__ import annotations

import re
from typing import Any

from cache.db import _lock, get_conn, init_db

_MARKET_RANK = {
    "cn": 0,
    "fund": 1,
    "index": 2,
    "hk": 3,
    "us": 4,
}

_CODE_RE = re.compile(
    r"^(?:(?P<pre>sh|sz|bj|ss)[-_]?)?(?P<code>\d{6})(?:\.(?P<suf>sh|sz|bj|ss))?$",
    re.IGNORECASE,
)


def _norm_token(raw: str) -> str:
    return str(raw or "").strip()


def _parse_code_token(token: str) -> tuple[str | None, str | None]:
    """返回 (pure_code, preferred_prefix)。"""
    t = _norm_token(token)
    if not t:
        return None, None
    m = _CODE_RE.match(t.replace(" ", ""))
    if not m:
        # 纯 6 位
        if re.fullmatch(r"\d{6}", t):
            return t, None
        return None, None
    code = m.group("code")
    pre = (m.group("pre") or m.group("suf") or "").lower()
    if pre == "ss":
        pre = "sh"
    return code, pre or None


def _row_to_hit(row: Any) -> dict[str, Any]:
    market = str(row["market"] or "")
    code = str(row["code"] or "")
    symbol = str(row["symbol"] or "")
    name = str(row["name"] or "")
    return {
        "symbol": symbol,
        "code": code,
        "name": name,
        "market": market,
        "exchange": str(row["exchange"] or "") or None,
        "category": str(row["category"] or "") or None,
    }


def _rank_hit(hit: dict[str, Any], *, preferred_prefix: str | None = None) -> tuple:
    sym = str(hit.get("symbol") or "").lower()
    pref = 0
    if preferred_prefix and sym.startswith(preferred_prefix):
        pref = -1
    return (
        pref,
        _MARKET_RANK.get(str(hit.get("market") or ""), 9),
        str(hit.get("code") or ""),
    )


def _load_symbol_index() -> dict[str, Any]:
    init_db()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT market, code, symbol, name, exchange, category
            FROM symbol
            WHERE status = 'active'
            """
        ).fetchall()
    by_code: dict[str, list[dict[str, Any]]] = {}
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    name_contains: list[tuple[str, dict[str, Any]]] = []
    for r in rows:
        hit = _row_to_hit(r)
        code = hit["code"]
        sym = hit["symbol"].lower()
        name = hit["name"]
        by_code.setdefault(code, []).append(hit)
        by_symbol.setdefault(sym, []).append(hit)
        if name:
            by_name.setdefault(name, []).append(hit)
            name_contains.append((name, hit))
    return {
        "by_code": by_code,
        "by_symbol": by_symbol,
        "by_name": by_name,
        "name_contains": name_contains,
    }


def resolve_one_token(
    token: str,
    index: dict[str, Any],
    *,
    limit: int = 8,
) -> dict[str, Any]:
    raw = _norm_token(token)
    if not raw:
        return {
            "token": token,
            "confidence": "none",
            "best": None,
            "matches": [],
        }

    by_code = index["by_code"]
    by_symbol = index["by_symbol"]
    by_name = index["by_name"]
    name_contains = index["name_contains"]

    matches: list[dict[str, Any]] = []
    confidence = "none"
    preferred_prefix: str | None = None

    code, preferred_prefix = _parse_code_token(raw)
    if code:
        hits = list(by_code.get(code) or [])
        # 也试 symbol 精确
        low = raw.lower().replace("_", "")
        if low in by_symbol:
            for h in by_symbol[low]:
                if h not in hits:
                    hits.append(h)
        if preferred_prefix:
            sym_key = f"{preferred_prefix}{code}"
            if sym_key in by_symbol:
                for h in by_symbol[sym_key]:
                    if h not in hits:
                        hits.insert(0, h)
        hits.sort(key=lambda h: _rank_hit(h, preferred_prefix=preferred_prefix))
        matches = hits[:limit]
        if matches:
            confidence = "exact_code"
    else:
        # symbol 精确（期货/美股等）
        low = raw.lower()
        if low in by_symbol:
            matches = list(by_symbol[low])[:limit]
            confidence = "exact_code"
        elif raw in by_name:
            matches = list(by_name[raw])[:limit]
            confidence = "exact_name" if len(matches) == 1 else "fuzzy"
        else:
            # 名称双向包含：token⊂名称 或 名称⊂token（粘连文案如「华胜天成华为算力」）
            q = raw
            hits: list[tuple[int, int, int, dict[str, Any]]] = []
            seen: set[str] = set()
            for name, hit in name_contains:
                if not name:
                    continue
                key = f"{hit['market']}:{hit['code']}"
                if key in seen:
                    continue
                if q in name:
                    # token 是名称子串
                    mode = 0 if name.startswith(q) else 1
                    # 名称越短越贴（避免「银行」误伤过多时靠 limit 截断）
                    hits.append((mode, len(name), len(name), hit))
                    seen.add(key)
                elif len(q) >= 3 and len(name) >= 3 and name in q:
                    # 名称嵌在更长粘贴串里：优先更长名称、靠前出现
                    mode = 0 if q.startswith(name) else 1
                    hits.append((mode, -len(name), q.find(name), hit))
                    seen.add(key)
            hits.sort(key=lambda x: (x[0], x[1], x[2], _rank_hit(x[3])))
            matches = [h for _, __, ___, h in hits[:limit]]
            if matches:
                if len(matches) == 1 and matches[0]["name"] == q:
                    confidence = "exact_name"
                elif len(matches) == 1 and matches[0]["name"] in q:
                    confidence = "exact_name"
                else:
                    confidence = "fuzzy"

    # 代码前缀（4–5 位数字）
    if not matches and re.fullmatch(r"\d{4,5}", raw):
        hits = []
        for code_key, rows in by_code.items():
            if code_key.startswith(raw):
                hits.extend(rows)
        hits.sort(key=lambda h: _rank_hit(h))
        matches = hits[:limit]
        if matches:
            confidence = "fuzzy"

    best = matches[0] if matches else None
    # 多命中且非精确代码时降为 fuzzy
    if confidence == "exact_name" and len(matches) > 1:
        confidence = "fuzzy"
    if confidence == "exact_code" and len(matches) > 1 and not preferred_prefix:
        # 同代码多市场：仍算 exact，best 取 cn 优先
        pass

    return {
        "token": raw,
        "confidence": confidence if matches else "none",
        "best": best,
        "matches": matches,
    }


def resolve_tokens(
    tokens: list[str],
    *,
    limit_per_token: int = 8,
) -> list[dict[str, Any]]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for t in tokens or []:
        n = _norm_token(t)
        if not n:
            continue
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(n)
        if len(cleaned) >= 500:
            break
    if not cleaned:
        return []
    index = _load_symbol_index()
    return [
        resolve_one_token(t, index, limit=max(1, min(20, limit_per_token)))
        for t in cleaned
    ]
