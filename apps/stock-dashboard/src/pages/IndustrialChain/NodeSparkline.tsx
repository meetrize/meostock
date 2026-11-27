/**
 * 关系图谱节点：轻量 30 日收盘 SVG sparkline（视口内加载 + 共享缓存）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeStockCode } from '@/utils/format';
import { getSettings } from '@/services/storage';

type SparkBar = { close: number };

const CACHE_TTL_MS = 90_000;
const MAX_BARS = 30;
const cache = new Map<string, { at: number; closes: number[] }>();
const inflight = new Map<string, Promise<number[]>>();

async function fetchCloses(symbol: string): Promise<number[]> {
  const key = normalizeStockCode(symbol) || symbol;
  if (!key) return [];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.closes;
  const existing = inflight.get(key);
  if (existing) return existing;

  const source = getSettings().quoteSource;
  const qs = new URLSearchParams({
    symbol: key,
    period: '1d',
    max_bars: String(MAX_BARS),
    slim: '1',
    defer_live: '1',
  });
  if (source === 'local') qs.set('cache_only', '1');
  else qs.set('local_first', '1');

  const promise = (async () => {
    try {
      const res = await fetch(`/api/cache/kline?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !Array.isArray(data.bars)) return [];
      const closes = (data.bars as SparkBar[])
        .map((b) => Number(b.close))
        .filter((n) => Number.isFinite(n))
        .slice(-MAX_BARS);
      cache.set(key, { at: Date.now(), closes });
      return closes;
    } catch {
      return [];
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function buildPath(closes: number[], w: number, h: number): string {
  if (closes.length < 2) return '';
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 1;
  const innerH = h - pad * 2;
  const step = (w - 2) / (closes.length - 1);
  return closes
    .map((c, i) => {
      const x = 1 + i * step;
      const y = pad + (1 - (c - min) / span) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function NodeSparkline({
  symbol,
  tone = 0,
  className,
}: {
  symbol: string;
  /** 今日涨跌：>0 上涨色，<0 下跌色 */
  tone?: number | null;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [closes, setCloses] = useState<number[]>([]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { root: null, rootMargin: '80px', threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !symbol) return;
    let cancelled = false;
    void fetchCloses(symbol).then((rows) => {
      if (!cancelled) setCloses(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, symbol]);

  const w = 168;
  const h = 22;
  const d = useMemo(() => buildPath(closes, w, h), [closes]);
  const stroke =
    tone != null && tone > 0
      ? 'var(--color-rise, #ef4444)'
      : tone != null && tone < 0
        ? 'var(--color-fall, #22c55e)'
        : 'var(--text-tertiary, #94a3b8)';

  return (
    <div ref={hostRef} className={className} aria-hidden>
      {d ? (
        <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      ) : (
        <div style={{ height: h }} />
      )}
    </div>
  );
}
