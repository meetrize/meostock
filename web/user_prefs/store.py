"""user_pref 读写（LWW：较大 rev / 较新 updated_at）。"""

from __future__ import annotations

import json
import time
from typing import Any

from cache.db import _lock, get_conn, init_db


def _now() -> float:
    return time.time()


def _encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _decode(raw: str) -> Any:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw


def list_prefs(user_id: str, namespace: str) -> list[dict[str, Any]]:
    init_db()
    ns = str(namespace or "").strip() or "dashboard"
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT key, value_json, updated_at, rev
            FROM user_pref
            WHERE user_id = ? AND namespace = ?
            ORDER BY key
            """,
            (user_id, ns),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "key": r["key"],
                "value": _decode(r["value_json"]),
                "updated_at": r["updated_at"],
                "rev": int(r["rev"]),
            }
        )
    return out


def upsert_prefs(
    user_id: str,
    namespace: str,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """批量 upsert。客户端可传 base_rev；冲突时服务端以较大 rev / 较新时间为准。"""
    init_db()
    ns = str(namespace or "").strip() or "dashboard"
    now = _now()
    results: list[dict[str, Any]] = []
    conn = get_conn()
    with _lock:
        for item in items:
            key = str(item.get("key") or "").strip()
            if not key or len(key) > 200:
                continue
            value = item.get("value")
            base_rev = item.get("base_rev")
            existing = conn.execute(
                """
                SELECT value_json, updated_at, rev FROM user_pref
                WHERE user_id = ? AND namespace = ? AND key = ?
                """,
                (user_id, ns, key),
            ).fetchone()
            if existing is None:
                rev = 1
                conn.execute(
                    """
                    INSERT INTO user_pref(user_id, namespace, key, value_json, updated_at, rev)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, ns, key, _encode(value), now, rev),
                )
                results.append(
                    {"key": key, "value": value, "updated_at": now, "rev": rev}
                )
                continue

            cur_rev = int(existing["rev"])
            # 客户端带 base_rev 且落后于服务端 → 保留服务端（LWW 偏服务端）
            if base_rev is not None:
                try:
                    br = int(base_rev)
                except (TypeError, ValueError):
                    br = -1
                if br < cur_rev:
                    results.append(
                        {
                            "key": key,
                            "value": _decode(existing["value_json"]),
                            "updated_at": existing["updated_at"],
                            "rev": cur_rev,
                            "conflict": True,
                        }
                    )
                    continue

            new_rev = cur_rev + 1
            conn.execute(
                """
                UPDATE user_pref
                SET value_json = ?, updated_at = ?, rev = ?
                WHERE user_id = ? AND namespace = ? AND key = ?
                """,
                (_encode(value), now, new_rev, user_id, ns, key),
            )
            results.append(
                {"key": key, "value": value, "updated_at": now, "rev": new_rev}
            )
        conn.commit()
    return results


def import_prefs(
    user_id: str,
    namespace: str,
    items: list[dict[str, Any]],
    *,
    mode: str = "merge",
) -> dict[str, Any]:
    """导入本机快照。merge=服务端空则写入；overwrite=覆盖。"""
    init_db()
    ns = str(namespace or "").strip() or "dashboard"
    now = _now()
    written = 0
    skipped = 0
    conn = get_conn()
    with _lock:
        for item in items:
            key = str(item.get("key") or "").strip()
            if not key or len(key) > 200:
                continue
            value = item.get("value")
            existing = conn.execute(
                """
                SELECT rev FROM user_pref
                WHERE user_id = ? AND namespace = ? AND key = ?
                """,
                (user_id, ns, key),
            ).fetchone()
            if existing and mode != "overwrite":
                skipped += 1
                continue
            if existing:
                new_rev = int(existing["rev"]) + 1
                conn.execute(
                    """
                    UPDATE user_pref
                    SET value_json = ?, updated_at = ?, rev = ?
                    WHERE user_id = ? AND namespace = ? AND key = ?
                    """,
                    (_encode(value), now, new_rev, user_id, ns, key),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO user_pref(user_id, namespace, key, value_json, updated_at, rev)
                    VALUES (?, ?, ?, ?, ?, 1)
                    """,
                    (user_id, ns, key, _encode(value), now),
                )
            written += 1
        conn.commit()
    return {"written": written, "skipped": skipped, "mode": mode}
