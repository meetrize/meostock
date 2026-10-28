/**
 * 总览 Portal：按 market 读本地缓存 / Tushare 专题
 */

import type { FullQuote } from 'stock-sdk';
import { cacheItemToFullQuote } from '@/services/quoteCache';
import { fetchTushareMarket, type TushareMarketResult } from '@/services/tushare';

export type MarketSnapshotResult = {
  ok: boolean;
  market: string;
  items: FullQuote[];
  syncedAt: number | null;
  asOf: number | null;
  stale: boolean;
  syncing: boolean;
  source: string | null;
  offline?: boolean;
  error?: string;
};

export async function fetchMarketSnapshot(
  market: string,
  opts?: { force?: boolean; codes?: string[] }
): Promise<MarketSnapshotResult> {
  const qs = new URLSearchParams({ market });
  if (opts?.force) qs.set('force', '1');
  if (opts?.codes?.length) qs.set('codes', opts.codes.slice(0, 200).join(','));
  try {
    const res = await fetch(`/api/cache/snapshot?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        market,
        items: [],
        syncedAt: null,
        asOf: null,
        stale: true,
        syncing: false,
        source: null,
        error: data.error || `snapshot ${res.status}`,
      };
    }
    const raw = Array.isArray(data.items) ? data.items : [];
    return {
      ok: true,
      market,
      // 保留原始 code（AUM / ^DJI），klineSymbol 仅作回退，避免 yf:/fut: 前缀导致精选匹配失败
      items: raw.map((it: Record<string, unknown>) => {
        const q = cacheItemToFullQuote(it);
        const rawCode = String(it.code || '').trim();
        return rawCode ? { ...q, code: rawCode } : q;
      }),
      syncedAt: typeof data.synced_at === 'number' ? data.synced_at : null,
      asOf: typeof data.as_of === 'number' ? data.as_of : null,
      stale: Boolean(data.stale),
      syncing: Boolean(data.syncing),
      source: data.source ? String(data.source) : null,
      offline: Boolean(data.offline),
    };
  } catch (e) {
    return {
      ok: false,
      market,
      items: [],
      syncedAt: null,
      asOf: null,
      stale: true,
      syncing: false,
      source: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type TopicSnapshotResult = TushareMarketResult & {
  items: Array<Record<string, unknown>>;
};

export async function fetchTopicMarket(
  id: string,
  tradeDate?: string
): Promise<TopicSnapshotResult> {
  const data = await fetchTushareMarket(id, tradeDate);
  return {
    ...data,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

/** 去掉 yf:/fut: 等前缀，便于 curated 与缓存 code/klineSymbol 对齐 */
function bareSymbol(code: string): string {
  return String(code || '')
    .trim()
    .replace(/^(yf:|fut:)/i, '');
}

function codesMatch(quoteCode: string, want: string): boolean {
  const a = String(quoteCode || '').trim();
  const b = String(want || '').trim();
  if (!a || !b) return false;
  if (a === b || a.toUpperCase() === b.toUpperCase()) return true;
  const ba = bareSymbol(a);
  const bb = bareSymbol(b);
  return ba === bb || ba.toUpperCase() === bb.toUpperCase();
}

/** 在多市场结果中按 curated 顺序取报价 */
export function pickCuratedQuotes(
  byMarket: Record<string, FullQuote[]>,
  curated: Array<{ market: string; code: string; name: string }>
): FullQuote[] {
  const out: FullQuote[] = [];
  for (const c of curated) {
    const list = byMarket[c.market] || [];
    const hit =
      list.find((q) => codesMatch(q.code, c.code)) ||
      list.find((q) => String(q.name) === c.name);
    if (hit) {
      const price = Number(hit.price);
      // 无有效价时仍展示占位，避免把 0 当成真实报价
      out.push({
        ...hit,
        code: bareSymbol(hit.code) || c.code,
        name: c.name || hit.name,
        price: Number.isFinite(price) ? price : 0,
      });
    } else {
      out.push({
        code: c.code,
        name: c.name,
        price: 0,
        change: 0,
        changePercent: 0,
        volume: 0,
        amount: 0,
      } as FullQuote);
    }
  }
  return out;
}
