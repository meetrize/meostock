"""缓存表读写。"""

from __future__ import annotations

import time
from typing import Any

from cache.db import _lock, get_conn
from cache.ttl import normalize_mode


def get_config(key: str, default: str | None = None) -> str | None:
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT value FROM cache_config WHERE key = ?", (key,)
        ).fetchone()
    if row is None:
        return default
    return str(row["value"])


def set_config(key: str, value: str) -> None:
    conn = get_conn()
    now = time.time()
    with _lock:
        conn.execute(
            """
            INSERT INTO cache_config(key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now),
        )
        conn.commit()


def get_mode() -> str:
    return normalize_mode(get_config("mode", "balanced"))


def set_mode(mode: str) -> str:
    m = normalize_mode(mode)
    set_config("mode", m)
    return m


QUOTE_SOURCES = ("auto", "local", "network")


def normalize_quote_source(source: str | None) -> str:
    s = (source or "auto").strip().lower()
    return s if s in QUOTE_SOURCES else "auto"


def get_quote_source() -> str:
    return normalize_quote_source(get_config("quote_source", "auto"))


def set_quote_source(source: str) -> str:
    s = normalize_quote_source(source)
    set_config("quote_source", s)
    return s


def get_market_meta(market: str) -> dict[str, Any] | None:
    conn = get_conn()
    with _lock:
        row = conn.execute(
            "SELECT * FROM market_meta WHERE market = ?", (market,)
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def list_market_meta() -> list[dict[str, Any]]:
    conn = get_conn()
    with _lock:
        rows = conn.execute("SELECT * FROM market_meta ORDER BY market").fetchall()
    return [dict(r) for r in rows]


def upsert_market_meta(market: str, **fields: Any) -> None:
    conn = get_conn()
    existing = get_market_meta(market) or {}
    merged = {
        "market": market,
        "snapshot_as_of": existing.get("snapshot_as_of"),
        "snapshot_synced_at": existing.get("snapshot_synced_at"),
        "symbols_synced_at": existing.get("symbols_synced_at"),
        "row_count": existing.get("row_count") or 0,
        "source": existing.get("source"),
        "sync_state": existing.get("sync_state") or "idle",
        "last_error": existing.get("last_error"),
        "etag": existing.get("etag"),
    }
    merged.update({k: v for k, v in fields.items() if k != "market"})
    with _lock:
        conn.execute(
            """
            INSERT INTO market_meta(
              market, snapshot_as_of, snapshot_synced_at, symbols_synced_at,
              row_count, source, sync_state, last_error, etag
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(market) DO UPDATE SET
              snapshot_as_of = excluded.snapshot_as_of,
              snapshot_synced_at = excluded.snapshot_synced_at,
              symbols_synced_at = excluded.symbols_synced_at,
              row_count = excluded.row_count,
              source = excluded.source,
              sync_state = excluded.sync_state,
              last_error = excluded.last_error,
              etag = excluded.etag
            """,
            (
                market,
                merged["snapshot_as_of"],
                merged["snapshot_synced_at"],
                merged["symbols_synced_at"],
                int(merged["row_count"] or 0),
                merged["source"],
                merged["sync_state"],
                merged["last_error"],
                merged["etag"],
            ),
        )
        conn.commit()


def replace_snapshot(market: str, rows: list[dict[str, Any]], *, source: str) -> int:
    """事务替换某市场全部快照，并更新 meta。"""
    now = time.time()
    as_of = now
    conn = get_conn()
    payload: list[tuple[Any, ...]] = []
    for r in rows:
        payload.append(
            (
                market,
                str(r.get("code") or ""),
                str(r.get("name") or ""),
                r.get("price"),
                r.get("change"),
                r.get("changePercent"),
                r.get("open"),
                r.get("prevClose"),
                r.get("high"),
                r.get("low"),
                r.get("volume"),
                r.get("amount"),
                r.get("turnoverRate"),
                r.get("volumeRatio"),
                r.get("amplitude"),
                r.get("pe"),
                r.get("pb"),
                r.get("totalMarketCap"),
                r.get("circulatingMarketCap"),
                r.get("klineSymbol"),
                1 if r.get("quoteReady", True) else 0,
                as_of,
                source,
                now,
            )
        )
    with _lock:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("DELETE FROM quote_snapshot WHERE market = ?", (market,))
            conn.executemany(
                """
                INSERT INTO quote_snapshot(
                  market, code, name, price, change_amt, change_percent,
                  open, prev_close, high, low, volume, amount,
                  turnover_rate, volume_ratio, amplitude, pe, pb,
                  total_market_cap, circulating_market_cap, kline_symbol,
                  quote_ready, as_of, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                payload,
            )
            # 同步写入 symbol 表（active）
            sym_rows = [
                (
                    market,
                    str(r.get("code") or ""),
                    str(r.get("klineSymbol") or r.get("code") or ""),
                    str(r.get("name") or ""),
                    None,
                    "stock" if market in ("cn", "hk", "us") else market,
                    "active",
                    None,
                    now,
                    now,
                )
                for r in rows
                if r.get("code")
            ]
            if sym_rows:
                conn.executemany(
                    """
                    INSERT INTO symbol(
                      market, code, symbol, name, exchange, category, status,
                      extra_json, updated_at, last_seen_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(market, code) DO UPDATE SET
                      symbol = excluded.symbol,
                      name = excluded.name,
                      status = 'active',
                      updated_at = excluded.updated_at,
                      last_seen_at = excluded.last_seen_at
                    """,
                    sym_rows,
                )
            conn.execute(
                """
                INSERT INTO market_meta(
                  market, snapshot_as_of, snapshot_synced_at, symbols_synced_at,
                  row_count, source, sync_state, last_error, etag
                ) VALUES (?, ?, ?, ?, ?, ?, 'idle', NULL, NULL)
                ON CONFLICT(market) DO UPDATE SET
                  snapshot_as_of = excluded.snapshot_as_of,
                  snapshot_synced_at = excluded.snapshot_synced_at,
                  symbols_synced_at = excluded.symbols_synced_at,
                  row_count = excluded.row_count,
                  source = excluded.source,
                  sync_state = 'idle',
                  last_error = NULL
                """,
                (market, as_of, now, now, len(payload), source),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return len(payload)


def upsert_snapshot_rows(market: str, rows: list[dict[str, Any]], *, source: str) -> int:
    """懒加载市场：按行 upsert，不删其它行。"""
    if not rows:
        return 0
    now = time.time()
    conn = get_conn()
    payload: list[tuple[Any, ...]] = []
    for r in rows:
        payload.append(
            (
                market,
                str(r.get("code") or ""),
                str(r.get("name") or ""),
                r.get("price"),
                r.get("change"),
                r.get("changePercent"),
                r.get("open"),
                r.get("prevClose"),
                r.get("high"),
                r.get("low"),
                r.get("volume"),
                r.get("amount"),
                r.get("turnoverRate"),
                r.get("volumeRatio"),
                r.get("amplitude"),
                r.get("pe"),
                r.get("pb"),
                r.get("totalMarketCap"),
                r.get("circulatingMarketCap"),
                r.get("klineSymbol"),
                1 if r.get("quoteReady", True) else 0,
                now,
                source,
                now,
            )
        )
    with _lock:
        conn.executemany(
            """
            INSERT INTO quote_snapshot(
              market, code, name, price, change_amt, change_percent,
              open, prev_close, high, low, volume, amount,
              turnover_rate, volume_ratio, amplitude, pe, pb,
              total_market_cap, circulating_market_cap, kline_symbol,
              quote_ready, as_of, source, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(market, code) DO UPDATE SET
              name = excluded.name,
              price = excluded.price,
              change_amt = excluded.change_amt,
              change_percent = excluded.change_percent,
              open = excluded.open,
              prev_close = excluded.prev_close,
              high = excluded.high,
              low = excluded.low,
              volume = excluded.volume,
              amount = excluded.amount,
              turnover_rate = excluded.turnover_rate,
              volume_ratio = excluded.volume_ratio,
              amplitude = excluded.amplitude,
              pe = excluded.pe,
              pb = excluded.pb,
              total_market_cap = excluded.total_market_cap,
              circulating_market_cap = excluded.circulating_market_cap,
              kline_symbol = excluded.kline_symbol,
              quote_ready = excluded.quote_ready,
              as_of = excluded.as_of,
              source = excluded.source,
              updated_at = excluded.updated_at
            """,
            payload,
        )
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM quote_snapshot WHERE market = ?", (market,)
        ).fetchone()["c"]
        conn.execute(
            """
            INSERT INTO market_meta(
              market, snapshot_as_of, snapshot_synced_at, symbols_synced_at,
              row_count, source, sync_state, last_error, etag
            ) VALUES (?, ?, ?, NULL, ?, ?, 'idle', NULL, NULL)
            ON CONFLICT(market) DO UPDATE SET
              snapshot_as_of = excluded.snapshot_as_of,
              snapshot_synced_at = excluded.snapshot_synced_at,
              row_count = excluded.row_count,
              source = excluded.source,
              sync_state = 'idle',
              last_error = NULL
            """,
            (market, now, now, int(count), source),
        )
        conn.commit()
    return len(payload)


def _code_match_keys(raw: str) -> set[str]:
    """生成用于匹配 code / kline_symbol 的候选键。"""
    s = (raw or "").strip()
    if not s:
        return set()
    low = s.lower()
    keys = {s, low, s.upper()}
    # sh600036 / sz000001 / bj8xxxxx / hk00700 / usAAPL
    for pfx in ("sh", "sz", "bj", "hk", "us"):
        if low.startswith(pfx) and len(low) > len(pfx):
            body = s[len(pfx) :]
            keys.add(body)
            keys.add(body.lower())
            keys.add(body.upper())
            keys.add(f"{pfx}{body}")
            keys.add(f"{pfx}{body.lower()}")
    # 纯数字 → 可能带交易所前缀
    digits = "".join(ch for ch in s if ch.isdigit())
    if digits:
        keys.add(digits)
        for pfx in ("sh", "sz", "bj"):
            keys.add(f"{pfx}{digits}")
    return {k for k in keys if k}


def read_snapshot(
    market: str,
    *,
    codes: list[str] | None = None,
) -> list[dict[str, Any]]:
    conn = get_conn()
    with _lock:
        rows = conn.execute(
            "SELECT * FROM quote_snapshot WHERE market = ?", (market,)
        ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(row_to_quote_item(dict(r)))
    if not codes:
        return out

    wanted: set[str] = set()
    for c in codes:
        wanted |= _code_match_keys(c)
    if not wanted:
        return []

    filtered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in out:
        code = str(item.get("code") or "")
        kline = str(item.get("klineSymbol") or "")
        keys = _code_match_keys(code) | _code_match_keys(kline)
        if keys & wanted:
            uid = code or kline
            if uid in seen:
                continue
            seen.add(uid)
            filtered.append(item)
    return filtered


def row_to_quote_item(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": r.get("code"),
        "name": r.get("name") or "",
        "klineSymbol": r.get("kline_symbol") or r.get("code"),
        "quoteReady": bool(r.get("quote_ready", 1)),
        "price": r.get("price"),
        "change": r.get("change_amt"),
        "changePercent": r.get("change_percent"),
        "volume": r.get("volume"),
        "amount": r.get("amount"),
        "pb": r.get("pb"),
        "pe": r.get("pe"),
        "totalMarketCap": r.get("total_market_cap"),
        "circulatingMarketCap": r.get("circulating_market_cap"),
        "open": r.get("open"),
        "prevClose": r.get("prev_close"),
        "high": r.get("high"),
        "low": r.get("low"),
        "turnoverRate": r.get("turnover_rate"),
        "volumeRatio": r.get("volume_ratio"),
        "amplitude": r.get("amplitude"),
    }


def clear_market(market: str | None, what: str = "snapshot") -> None:
    conn = get_conn()
    with _lock:
        if market:
            if what in ("snapshot", "all"):
                conn.execute("DELETE FROM quote_snapshot WHERE market = ?", (market,))
                conn.execute(
                    """
                    UPDATE market_meta SET snapshot_as_of = NULL, snapshot_synced_at = NULL,
                      row_count = 0, sync_state = 'idle', last_error = NULL
                    WHERE market = ?
                    """,
                    (market,),
                )
            if what == "all":
                conn.execute("DELETE FROM symbol WHERE market = ?", (market,))
                conn.execute("DELETE FROM market_meta WHERE market = ?", (market,))
        else:
            if what in ("snapshot", "all"):
                conn.execute("DELETE FROM quote_snapshot")
                conn.execute(
                    """
                    UPDATE market_meta SET snapshot_as_of = NULL, snapshot_synced_at = NULL,
                      row_count = 0, sync_state = 'idle', last_error = NULL
                    """
                )
            if what == "all":
                conn.execute("DELETE FROM symbol")
                conn.execute("DELETE FROM market_meta")
        conn.commit()


def dump_status(mode: str) -> dict[str, Any]:
    metas = list_market_meta()
    now = time.time()
    markets = []
    for m in metas:
        as_of = m.get("snapshot_as_of")
        age = (now - float(as_of)) if as_of else None
        markets.append(
            {
                "market": m["market"],
                "as_of": as_of,
                "synced_at": m.get("snapshot_synced_at"),
                "age_sec": age,
                "row_count": m.get("row_count") or 0,
                "source": m.get("source"),
                "sync_state": m.get("sync_state"),
                "last_error": m.get("last_error"),
            }
        )
    return {
        "ok": True,
        "mode": mode,
        "quote_source": get_quote_source(),
        "db": str(__import__("cache.db", fromlist=["db_path"]).db_path()),
        "markets": markets,
    }
