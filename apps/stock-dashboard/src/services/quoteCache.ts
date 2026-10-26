/**
 * 同源行情缓存封装（三期）：优先 /api/cache/snapshot，按 quoteSource 回退 sdk。
 */

import type { FullQuote } from 'stock-sdk';
import { getSettings } from '@/services/storage';
import { getAllAShareQuotes, getAllQuotesByCodes, getFullQuotes } from '@/services/sdk';
import { normalizeStockCode } from '@/utils/format';
import type { QuoteSource } from '@/types';

export type { QuoteSource };

function resolveSource(override?: QuoteSource): QuoteSource {
  if (override === 'auto' || override === 'local' || override === 'network') {
    return override;
  }
  const s = getSettings().quoteSource;
  return s === 'local' || s === 'network' ? s : 'auto';
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 将缓存行转为 FullQuote（字段对齐看板列表/热力） */
export function cacheItemToFullQuote(item: Record<string, unknown>): FullQuote {
  const code = String(item.klineSymbol || item.code || '');
  const normalized = normalizeStockCode(code) || code;
  return {
    code: normalized,
    name: String(item.name || item.code || ''),
    price: num(item.price) ?? 0,
    change: num(item.change) ?? 0,
    changePercent: num(item.changePercent) ?? 0,
    volume: num(item.volume) ?? 0,
    amount: num(item.amount) ?? 0,
    open: num(item.open) ?? undefined,
    prevClose: num(item.prevClose) ?? undefined,
    high: num(item.high) ?? undefined,
    low: num(item.low) ?? undefined,
    turnoverRate: num(item.turnoverRate) ?? undefined,
    volumeRatio: num(item.volumeRatio) ?? undefined,
    amplitude: num(item.amplitude) ?? undefined,
    pe: num(item.pe) ?? undefined,
    pb: num(item.pb) ?? undefined,
    totalMarketCap: num(item.totalMarketCap) ?? undefined,
    circulatingMarketCap: num(item.circulatingMarketCap) ?? undefined,
  } as FullQuote;
}

async function fetchSnapshotItems(
  market: string,
  opts?: { codes?: string[]; force?: boolean }
): Promise<{ items: FullQuote[]; fromCache: boolean; offline?: boolean }> {
  const qs = new URLSearchParams({ market });
  if (opts?.force) qs.set('force', '1');
  if (opts?.codes?.length) {
    qs.set('codes', opts.codes.slice(0, 500).join(','));
  }
  const res = await fetch(`/api/cache/snapshot?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `cache snapshot ${res.status}`);
  }
  const raw = Array.isArray(data.items) ? data.items : [];
  return {
    items: raw.map((it: Record<string, unknown>) => cacheItemToFullQuote(it)),
    fromCache: true,
    offline: Boolean(data.offline),
  };
}

/**
 * 按代码取行情：auto 先缓存再 sdk；local 只缓存；network 只 sdk。
 */
export async function getQuotesByCodesPreferCache(
  codes: string[],
  options?: {
    source?: QuoteSource;
    force?: boolean;
    batchSize?: number;
    concurrency?: number;
  }
): Promise<FullQuote[]> {
  const list = codes.map((c) => normalizeStockCode(c) || c).filter(Boolean);
  if (!list.length) return [];

  const source = resolveSource(options?.source);

  if (source === 'network') {
    return getAllQuotesByCodes(list, {
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
    });
  }

  try {
    const { items } = await fetchSnapshotItems('cn', {
      codes: list,
      force: options?.force && source === 'auto',
    });
    // 按请求顺序对齐；缺的在 auto 下用 sdk 补
    const map = new Map<string, FullQuote>();
    items.forEach((q) => {
      if (!q?.code) return;
      const n = normalizeStockCode(q.code) || q.code;
      map.set(n, q);
      map.set(q.code, q);
      map.set(q.code.toLowerCase(), q);
      // 纯数字仅在无冲突时挂上，避免指数/个股同号互相覆盖
      const digits = n.replace(/^(sh|sz|bj)/i, '');
      if (digits && !map.has(digits)) map.set(digits, q);
    });

    const ordered: FullQuote[] = [];
    const missing: string[] = [];
    for (const code of list) {
      const normalized = normalizeStockCode(code) || code;
      let hit = map.get(code) || map.get(normalized);
      if (!hit && !/^(sh|sz|bj)/i.test(code)) {
        hit = map.get(code.replace(/^(sh|sz|bj)/i, ''));
      }
      if (hit) ordered.push({ ...hit, code: normalized });
      else missing.push(code);
    }

    if (source === 'local' || missing.length === 0) {
      return ordered;
    }

    const live = await getAllQuotesByCodes(missing, {
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
    });
    return ordered.concat(live);
  } catch {
    if (source === 'local') return [];
    return getAllQuotesByCodes(list, {
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
    });
  }
}

/**
 * 按代码取完整行情：优先本地 snapshot，否则 getFullQuotes。
 * ``market`` 默认 cn；总览指数等请传 ``index``，避免 sh000001 被 cn 表里的 000001（平安银行）误匹配。
 */
export async function getFullQuotesPreferCache(
  codes: string[],
  options?: { source?: QuoteSource; useSdkCache?: boolean; market?: string }
): Promise<FullQuote[]> {
  const list = codes.map((c) => normalizeStockCode(c) || c).filter(Boolean);
  if (!list.length) return [];
  const source = resolveSource(options?.source);
  const market = (options?.market || 'cn').toLowerCase();

  if (source === 'network') {
    return alignQuotesToRequestedCodes(
      list,
      await getFullQuotes(list, options?.useSdkCache !== false)
    );
  }

  try {
    const { items } = await fetchSnapshotItems(market, { codes: list });
    if (items.length > 0) {
      const out = alignQuotesToRequestedCodes(list, items);
      if (source === 'local' || out.length === list.length) return out;
    }
    if (source === 'local') return items;
  } catch {
    if (source === 'local') return [];
  }
  return alignQuotesToRequestedCodes(
    list,
    await getFullQuotes(list, options?.useSdkCache !== false)
  );
}

function quoteDigits(code: string): string {
  return (normalizeStockCode(code) || code).replace(/^(sh|sz|bj)/i, '').toLowerCase();
}

function quoteMarket(code: string): string {
  const m = (normalizeStockCode(code) || code).match(/^(sh|sz|bj)/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 按请求代码对齐，并把 ``quote.code`` 写成带前缀的请求码（详情页路由用）。
 *
 * stock-sdk ``quotes.cn`` 对指数常返回无前缀码（如 ``000001``=上证指数），
 * 而 ``normalizeStockCode('000001')`` 会误判为 ``sz000001``（平安银行规则）。
 * 因此：精确匹配失败时，若该六位码在本次结果集中唯一，则按数字对齐到请求前缀；
 * 多条冲突时再按市场前缀筛选，避免 sh000001 吃到深市个股。
 */
function alignQuotesToRequestedCodes(
  requested: string[],
  items: FullQuote[]
): FullQuote[] {
  const map = new Map<string, FullQuote>();
  const byDigits = new Map<string, FullQuote[]>();

  for (const q of items) {
    if (!q?.code) continue;
    const raw = String(q.code);
    const n = normalizeStockCode(raw) || raw;
    map.set(n, q);
    map.set(raw, q);
    map.set(raw.toLowerCase(), q);
    const digits = quoteDigits(raw);
    if (!digits) continue;
    if (!map.has(digits)) map.set(digits, q);
    const list = byDigits.get(digits) || [];
    list.push(q);
    byDigits.set(digits, list);
  }

  const out: FullQuote[] = [];
  for (const code of requested) {
    const normalized = normalizeStockCode(code) || code;
    let hit = map.get(code) || map.get(normalized);

    if (!hit) {
      const digits = quoteDigits(normalized);
      const reqMarket = quoteMarket(normalized);
      const candidates = byDigits.get(digits) || [];

      if (candidates.length === 1) {
        // 结果集内六位码唯一：覆盖 SDK 指数无前缀 / 误判 sz 的情况
        hit = candidates[0];
      } else if (candidates.length > 1) {
        hit =
          (reqMarket
            ? candidates.find((q) => quoteMarket(String(q.code)) === reqMarket)
            : undefined) ||
          candidates.find((q) => !/^(sh|sz|bj)/i.test(String(q.code))) ||
          (!reqMarket ? map.get(digits) : undefined);
      } else if (!reqMarket) {
        hit = map.get(digits);
      }
    }

    if (!hit) continue;
    out.push({ ...hit, code: normalized });
  }
  return out;
}

/** 全 A 快照：优先缓存表，network 走 sdk.batch.cn */
export async function getAllASharePreferCache(options?: {
  source?: QuoteSource;
  force?: boolean;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<FullQuote[]> {
  const source = resolveSource(options?.source);

  if (source === 'network') {
    return getAllAShareQuotes({
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
      onProgress: options?.onProgress,
      force: options?.force,
    });
  }

  try {
    const { items } = await fetchSnapshotItems('cn', { force: options?.force && source === 'auto' });
    if (items.length > 0) {
      options?.onProgress?.(items.length, items.length);
      return items;
    }
    if (source === 'local') return [];
  } catch {
    if (source === 'local') return [];
  }
  return getAllAShareQuotes({
    batchSize: options?.batchSize,
    concurrency: options?.concurrency,
    onProgress: options?.onProgress,
    force: options?.force,
  });
}

export async function syncQuoteSourceToServer(source: QuoteSource): Promise<void> {
  const res = await fetch('/api/cache/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || '同步行情源失败');
  }
}
