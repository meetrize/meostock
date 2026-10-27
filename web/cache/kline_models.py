"""K 线本地缓存读写（二期 L3）。"""

from __future__ import annotations

import time
from typing import Any

from cache.db import _lock, get_conn


def touch_access(market: str, symbol: str, period: str) -> None:
    now = time.time()
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO kline_meta(market, symbol, period, last_access_at, sync_state)
            VALUES (?, ?, ?, ?, 'idle')
            ON CONFLICT(market, symbol, period) DO UPDATE SET
              last_access_at = excluded.last_access_at
            """,
            (market, symbol, period, now),
        )
        conn.commit()


def get_kline_meta(market: str, symbol: str, period: str) -> dict[str, Any] | None:
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT * FROM kline_meta WHERE market=? AND symbol=? AND period=?",
            (market, symbol, period),
        ).fetchone()
    return dict(row) if row else None


def read_kline_bars(
    market: str,
    symbol: str,
    period: str,
    *,
    limit: int = 800,
) -> list[dict[str, Any]]:
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT ts, open, high, low, close, volume, amount, source
            FROM kline_bar
            WHERE market=? AND symbol=? AND period=?
            ORDER BY ts ASC
            """,
            (market, symbol, period),
        ).fetchall()
    bars = [
        {
            "timestamp": int(r["ts"]),
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"] if r["volume"] is not None else 0,
            "amount": r["amount"],
            "source": r["source"],
        }
        for r in rows
    ]
    if limit > 0 and len(bars) > limit:
        bars = bars[-limit:]
    return bars


def read_last_kline_bars(
    market: str,
    symbol: str,
    period: str,
    *,
    limit: int = 2,
) -> list[dict[str, Any]]:
    """按时间倒序取末 N 根，再正序返回（用于现价/昨收）。"""
    n = max(int(limit), 1)
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT ts, open, high, low, close, volume, amount, source
            FROM kline_bar
            WHERE market=? AND symbol=? AND period=?
            ORDER BY ts DESC
            LIMIT ?
            """,
            (market, symbol, period, n),
        ).fetchall()
    bars = [
        {
            "timestamp": int(r["ts"]),
            "open": r["open"],
            "high": r["high"],
            "low": r["low"],
            "close": r["close"],
            "volume": r["volume"] if r["volume"] is not None else 0,
            "amount": r["amount"],
            "source": r["source"],
        }
        for r in reversed(rows)
    ]
    return bars


def replace_kline_bars(
    market: str,
    symbol: str,
    period: str,
    bars: list[dict[str, Any]],
    *,
    source: str,
    name: str | None = None,
) -> int:
    """全量替换某标的某周期（按需缓存体量小，实现简单可靠）。"""
    now = time.time()
    conn = get_conn()
    payload: list[tuple[Any, ...]] = []
    for b in bars:
        try:
            ts = int(b.get("timestamp") or 0)
        except (TypeError, ValueError):
            continue
        if ts <= 0:
            continue
        payload.append(
            (
                market,
                symbol,
                period,
                ts,
                b.get("open"),
                b.get("high"),
                b.get("low"),
                b.get("close"),
                b.get("volume"),
                b.get("amount"),
                source,
            )
        )
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "DELETE FROM kline_bar WHERE market=? AND symbol=? AND period=?",
                (market, symbol, period),
            )
            if payload:
                conn.executemany(
                    """
                    INSERT INTO kline_bar(
                      market, symbol, period, ts, open, high, low, close, volume, amount, source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    payload,
                )
            conn.execute(
                """
                INSERT INTO kline_meta(
                  market, symbol, period, name, as_of, synced_at, bar_count,
                  source, sync_state, last_error, last_access_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?)
                ON CONFLICT(market, symbol, period) DO UPDATE SET
                  name = COALESCE(excluded.name, kline_meta.name),
                  as_of = excluded.as_of,
                  synced_at = excluded.synced_at,
                  bar_count = excluded.bar_count,
                  source = excluded.source,
                  sync_state = 'idle',
                  last_error = NULL,
                  last_access_at = excluded.last_access_at
                """,
                (
                    market,
                    symbol,
                    period,
                    name,
                    now,
                    now,
                    len(payload),
                    source,
                    now,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return len(payload)


def set_kline_error(market: str, symbol: str, period: str, err: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO kline_meta(
              market, symbol, period, sync_state, last_error, last_access_at
            ) VALUES (?, ?, ?, 'error', ?, ?)
            ON CONFLICT(market, symbol, period) DO UPDATE SET
              sync_state = 'error',
              last_error = excluded.last_error
            """,
            (market, symbol, period, err[:500], time.time()),
        )
        conn.commit()


def gc_kline(
    *,
    max_age_days: float = 30.0,
    max_series: int = 200,
) -> dict[str, Any]:
    """清理久未访问或超量的 K 线序列（meta + bars）。"""
    now = time.time()
    cutoff = now - max(1.0, float(max_age_days)) * 86400.0
    max_series = max(10, int(max_series))
    conn = get_conn()
    removed_age = 0
    removed_lru = 0
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            stale = conn.execute(
                """
                SELECT market, symbol, period FROM kline_meta
                WHERE COALESCE(last_access_at, 0) < ?
                """,
                (cutoff,),
            ).fetchall()
            for r in stale:
                conn.execute(
                    "DELETE FROM kline_bar WHERE market=? AND symbol=? AND period=?",
                    (r["market"], r["symbol"], r["period"]),
                )
                conn.execute(
                    "DELETE FROM kline_meta WHERE market=? AND symbol=? AND period=?",
                    (r["market"], r["symbol"], r["period"]),
                )
                removed_age += 1

            keep = conn.execute(
                """
                SELECT market, symbol, period FROM kline_meta
                ORDER BY COALESCE(last_access_at, 0) DESC
                """
            ).fetchall()
            if len(keep) > max_series:
                for r in keep[max_series:]:
                    conn.execute(
                        "DELETE FROM kline_bar WHERE market=? AND symbol=? AND period=?",
                        (r["market"], r["symbol"], r["period"]),
                    )
                    conn.execute(
                        "DELETE FROM kline_meta WHERE market=? AND symbol=? AND period=?",
                        (r["market"], r["symbol"], r["period"]),
                    )
                    removed_lru += 1

            left = conn.execute("SELECT COUNT(*) AS c FROM kline_meta").fetchone()["c"]
            bars = conn.execute("SELECT COUNT(*) AS c FROM kline_bar").fetchone()["c"]
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {
        "ok": True,
        "removed_age": removed_age,
        "removed_lru": removed_lru,
        "removed_series": removed_age + removed_lru,
        "remaining_series": int(left),
        "remaining_bars": int(bars),
        "max_age_days": max_age_days,
        "max_series": max_series,
    }
