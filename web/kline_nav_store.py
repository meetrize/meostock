"""短时 K 线翻页列表（进程内）：补 localStorage 在 iframe/局域网场景写入失败。"""

from __future__ import annotations

import threading
import time
from typing import Any

_TTL_SEC = 24 * 60 * 60
_MAX_ENTRIES = 200
_MAX_SYMBOLS = 500

_lock = threading.Lock()
_store: dict[str, dict[str, Any]] = {}


def _prune(now: float | None = None) -> None:
    ts = now if now is not None else time.time()
    dead = [k for k, v in _store.items() if ts - float(v.get("ts") or 0) > _TTL_SEC]
    for k in dead:
        _store.pop(k, None)
    if len(_store) <= _MAX_ENTRIES:
        return
    # 超限：丢最旧
    ordered = sorted(_store.items(), key=lambda kv: float(kv[1].get("ts") or 0))
    for k, _ in ordered[: max(0, len(_store) - _MAX_ENTRIES)]:
        _store.pop(k, None)


def put_nav(
    nav_id: str,
    symbols: list[str],
    index: int = 0,
) -> dict[str, Any] | None:
    nid = str(nav_id or "").strip()
    if not nid or len(nid) > 64:
        return None
    cleaned = [str(s or "").strip() for s in (symbols or []) if str(s or "").strip()]
    cleaned = cleaned[:_MAX_SYMBOLS]
    if len(cleaned) < 2:
        return None
    i = max(0, min(len(cleaned) - 1, int(index or 0)))
    now = time.time()
    payload = {"v": 1, "symbols": cleaned, "i": i, "ts": now}
    with _lock:
        _prune(now)
        _store[nid] = payload
    return {"id": nid, "count": len(cleaned), "i": i}


def get_nav(nav_id: str) -> dict[str, Any] | None:
    nid = str(nav_id or "").strip()
    if not nid:
        return None
    now = time.time()
    with _lock:
        _prune(now)
        row = _store.get(nid)
        if not row:
            return None
        if now - float(row.get("ts") or 0) > _TTL_SEC:
            _store.pop(nid, None)
            return None
        return {
            "id": nid,
            "v": 1,
            "symbols": list(row.get("symbols") or []),
            "i": int(row.get("i") or 0),
            "ts": row.get("ts"),
        }
