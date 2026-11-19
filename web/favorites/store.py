"""收藏夹 SQLite CRUD。"""

from __future__ import annotations

import time
import uuid
from typing import Any

from cache.db import _lock, get_conn, init_db

_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS bookmark_favorite (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  favicon_url TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmark_sort ON bookmark_favorite (sort_order);
"""


def ensure_table() -> None:
    init_db()
    conn = get_conn()
    with _lock:
        conn.executescript(_TABLE_SQL)
        conn.commit()


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "url": row["url"],
        "title": row["title"] or "",
        "favicon_url": row["favicon_url"],
        "note": row["note"] or "",
        "sort_order": int(row["sort_order"] or 0),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_favorites() -> list[dict[str, Any]]:
    ensure_table()
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT id, url, title, favicon_url, note, sort_order, created_at, updated_at
            FROM bookmark_favorite
            ORDER BY sort_order ASC, created_at ASC
            """
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_favorite(item_id: str) -> dict[str, Any] | None:
    ensure_table()
    conn = get_conn()
    with _lock:
        row = conn.execute(
            """
            SELECT id, url, title, favicon_url, note, sort_order, created_at, updated_at
            FROM bookmark_favorite WHERE id = ?
            """,
            (item_id,),
        ).fetchone()
    return _row_to_dict(row) if row else None


def create_favorite(
    *,
    url: str,
    title: str,
    favicon_url: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    ensure_table()
    now = time.time()
    item_id = uuid.uuid4().hex
    conn = get_conn()
    with _lock:
        cur = conn.execute("SELECT COALESCE(MAX(sort_order), -1) FROM bookmark_favorite")
        max_order = int(cur.fetchone()[0])
        sort_order = max_order + 1
        conn.execute(
            """
            INSERT INTO bookmark_favorite
              (id, url, title, favicon_url, note, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                url.strip(),
                (title or "").strip() or url.strip(),
                (favicon_url or "").strip() or None,
                (note or "").strip() or None,
                sort_order,
                now,
                now,
            ),
        )
        conn.commit()
    item = get_favorite(item_id)
    assert item is not None
    return item


def update_favorite(
    item_id: str,
    *,
    url: str | None = None,
    title: str | None = None,
    favicon_url: str | None = None,
    note: str | None = None,
    set_favicon: bool = False,
    set_note: bool = False,
) -> dict[str, Any] | None:
    ensure_table()
    existing = get_favorite(item_id)
    if not existing:
        return None
    now = time.time()
    next_url = url.strip() if url is not None else existing["url"]
    next_title = title.strip() if title is not None else existing["title"]
    next_favicon = (
        ((favicon_url or "").strip() or None) if set_favicon else existing["favicon_url"]
    )
    next_note = ((note or "").strip() or None) if set_note else existing["note"]

    conn = get_conn()
    with _lock:
        conn.execute(
            """
            UPDATE bookmark_favorite
            SET url = ?, title = ?, favicon_url = ?, note = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_url, next_title or next_url, next_favicon, next_note, now, item_id),
        )
        conn.commit()
    return get_favorite(item_id)


def delete_favorite(item_id: str) -> bool:
    ensure_table()
    conn = get_conn()
    with _lock:
        cur = conn.execute("DELETE FROM bookmark_favorite WHERE id = ?", (item_id,))
        conn.commit()
        return cur.rowcount > 0


def reorder_favorites(ids: list[str]) -> list[dict[str, Any]]:
    """按传入 id 顺序重排；未出现的条目排在末尾并保持相对顺序。"""
    ensure_table()
    existing = list_favorites()
    by_id = {x["id"]: x for x in existing}
    ordered: list[str] = []
    seen: set[str] = set()
    for i in ids:
        if i in by_id and i not in seen:
            ordered.append(i)
            seen.add(i)
    for x in existing:
        if x["id"] not in seen:
            ordered.append(x["id"])
            seen.add(x["id"])

    now = time.time()
    conn = get_conn()
    with _lock:
        for idx, item_id in enumerate(ordered):
            conn.execute(
                "UPDATE bookmark_favorite SET sort_order = ?, updated_at = ? WHERE id = ?",
                (idx, now, item_id),
            )
        conn.commit()
    return list_favorites()
