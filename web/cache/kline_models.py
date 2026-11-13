"""K 线本地缓存读写（二期 L3）。"""

from __future__ import annotations

import time
from typing import Any

from cache.db import _lock, get_conn
from cache.kline_time import (
    DAY_LIKE_PERIODS,
    canonicalize_bar_ts,
    collapse_day_like_bars,
)


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
    bars = collapse_day_like_bars(market, period, bars, symbol=symbol)
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


def _bars_payload(
    market: str,
    symbol: str,
    period: str,
    bars: list[dict[str, Any]],
    source: str,
) -> list[tuple[Any, ...]]:
    # 先按交易日折叠，避免同日 00:00 / 09:30 各写一根
    normalized = [
        {**b, "source": b.get("source") or source}
        for b in (bars or [])
        if isinstance(b, dict)
    ]
    collapsed = collapse_day_like_bars(market, period, normalized, symbol=symbol)
    payload: list[tuple[Any, ...]] = []
    seen_ts: set[int] = set()
    for b in collapsed:
        try:
            ts = canonicalize_bar_ts(
                market, period, int(b.get("timestamp") or 0), symbol=symbol
            )
        except (TypeError, ValueError):
            continue
        if ts <= 0 or ts in seen_ts:
            continue
        seen_ts.add(ts)
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
    return payload


def reconcile_day_like_bars(market: str, symbol: str, period: str) -> int:
    """清理某序列同日重复时间戳，统一到开盘 09:30。返回删除根数。"""
    if period not in DAY_LIKE_PERIODS:
        return 0
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
        if not rows:
            return 0
        bars = [
            {
                "timestamp": int(r["ts"]),
                "open": r["open"],
                "high": r["high"],
                "low": r["low"],
                "close": r["close"],
                "volume": r["volume"],
                "amount": r["amount"],
                "source": r["source"],
            }
            for r in rows
        ]
        collapsed = collapse_day_like_bars(market, period, bars, symbol=symbol)
        if len(collapsed) == len(bars) and all(
            int(b["timestamp"])
            == canonicalize_bar_ts(market, period, int(b["timestamp"]), symbol=symbol)
            for b in bars
        ):
            return 0
        old_n = len(bars)
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "DELETE FROM kline_bar WHERE market=? AND symbol=? AND period=?",
                (market, symbol, period),
            )
            payload = [
                (
                    market,
                    symbol,
                    period,
                    int(b["timestamp"]),
                    b.get("open"),
                    b.get("high"),
                    b.get("low"),
                    b.get("close"),
                    b.get("volume"),
                    b.get("amount"),
                    b.get("source"),
                )
                for b in collapsed
            ]
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
                UPDATE kline_meta SET bar_count=?
                WHERE market=? AND symbol=? AND period=?
                """,
                (len(payload), market, symbol, period),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return max(0, old_n - len(collapsed))


def replace_kline_bars(
    market: str,
    symbol: str,
    period: str,
    bars: list[dict[str, Any]],
    *,
    source: str,
    name: str | None = None,
) -> int:
    """全量替换某标的某周期（会丢掉更早历史；优先用 upsert_kline_bars）。"""
    now = time.time()
    conn = get_conn()
    payload = _bars_payload(market, symbol, period, bars, source)
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
                  source, sync_state, last_error, last_access_at, history_exhausted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, 0)
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


def upsert_kline_bars(
    market: str,
    symbol: str,
    period: str,
    bars: list[dict[str, Any]],
    *,
    source: str,
    name: str | None = None,
    history_exhausted: bool | None = None,
    touch_as_of: bool = True,
) -> int:
    """合并写入 K 线（不删更早历史）。返回本次 upsert 根数。"""
    now = time.time()
    conn = get_conn()
    payload = _bars_payload(market, symbol, period, bars, source)
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if payload:
                conn.executemany(
                    """
                    INSERT INTO kline_bar(
                      market, symbol, period, ts, open, high, low, close, volume, amount, source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(market, symbol, period, ts) DO UPDATE SET
                      open = excluded.open,
                      high = excluded.high,
                      low = excluded.low,
                      close = excluded.close,
                      volume = excluded.volume,
                      amount = COALESCE(excluded.amount, kline_bar.amount),
                      source = excluded.source
                    """,
                    payload,
                )
            total = conn.execute(
                "SELECT COUNT(*) AS c FROM kline_bar WHERE market=? AND symbol=? AND period=?",
                (market, symbol, period),
            ).fetchone()["c"]
            as_of_val = now if touch_as_of else None
            conn.execute(
                """
                INSERT INTO kline_meta(
                  market, symbol, period, name, as_of, synced_at, bar_count,
                  source, sync_state, last_error, last_access_at, history_exhausted
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, 0)
                ON CONFLICT(market, symbol, period) DO UPDATE SET
                  name = COALESCE(excluded.name, kline_meta.name),
                  as_of = COALESCE(?, kline_meta.as_of),
                  synced_at = excluded.synced_at,
                  bar_count = excluded.bar_count,
                  source = COALESCE(excluded.source, kline_meta.source),
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
                    int(total),
                    source,
                    now,
                    as_of_val,
                ),
            )
            if history_exhausted is not None:
                conn.execute(
                    """
                    UPDATE kline_meta SET history_exhausted=?
                    WHERE market=? AND symbol=? AND period=?
                    """,
                    (1 if history_exhausted else 0, market, symbol, period),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    # 折叠同日旧时间戳（00:00 vs 09:30），在锁外再清一次该序列
    if period in DAY_LIKE_PERIODS:
        reconcile_day_like_bars(market, symbol, period)
        meta = get_kline_meta(market, symbol, period)
        if meta:
            return int(meta.get("bar_count") or len(payload))
    return len(payload)


def set_history_exhausted(
    market: str, symbol: str, period: str, exhausted: bool = True
) -> None:
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO kline_meta(
              market, symbol, period, history_exhausted, sync_state, last_access_at
            ) VALUES (?, ?, ?, ?, 'idle', ?)
            ON CONFLICT(market, symbol, period) DO UPDATE SET
              history_exhausted = excluded.history_exhausted
            """,
            (market, symbol, period, 1 if exhausted else 0, time.time()),
        )
        conn.commit()


def read_kline_bars_before(
    market: str,
    symbol: str,
    period: str,
    before_ts_ms: int,
    *,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """读盘：严格早于 before_ts 的最近 limit 根（升序返回）。"""
    n = max(1, min(int(limit or 500), 1000))
    cut = int(before_ts_ms)
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            """
            SELECT ts, open, high, low, close, volume, amount, source
            FROM kline_bar
            WHERE market=? AND symbol=? AND period=? AND ts < ?
            ORDER BY ts DESC
            LIMIT ?
            """,
            (market, symbol, period, cut, n),
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
    bars = collapse_day_like_bars(market, period, bars, symbol=symbol)
    if len(bars) > n:
        bars = bars[-n:]
    return bars


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
