/**
 * 同源行情缓存封装（三期）：优先 /api/cache/snapshot，按 quoteSource 回退 sdk。
 * 自选等混合列表按代码推断 cn/hk/us，分别打对应市场快照。
 */

import type { FullQuote } from 'stock-sdk';
import { getSettings } from '@/services/storage';
import {
  getAllAShareQuotes,
  getAllQuotesByCodes,
  getFullQuotes,
  getHkQuotes,
  getUsQuotes,
} from '@/services/sdk';
import {
  inferQuoteCacheMarket,
  normalizeStockCode,
  type QuoteCacheMarket,
} from '@/utils/format';
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

function groupCodesByCacheMarket(codes: string[]): Record<QuoteCacheMarket, string[]> {
  const groups: Record<QuoteCacheMarket, string[]> = { cn: [], hk: [], us: [] };
  for (const code of codes) {
    groups[inferQuoteCacheMarket(code)].push(code);
  }
  return groups;
}

/** SDK 港美接口要裸码：usAAPL→AAPL，hk00700→00700 */
function toSdkBareCode(code: string, market: QuoteCacheMarket): string {
  const n = normalizeStockCode(code) || code;
  if (market === 'us') return n.replace(/^us/i, '');
  if (market === 'hk') {
    const digits = n.replace(/^hk/i, '').replace(/\D/g, '') || n;
    return digits.padStart(5, '0');
  }
  return n;
}

function indexQuoteIntoMap(map: Map<string, FullQuote>, q: FullQuote): void {
  if (!q?.code) return;
  const raw = String(q.code);
  const n = normalizeStockCode(raw) || raw;
  map.set(n, q);
  map.set(raw, q);
  map.set(raw.toLowerCase(), q);
  map.set(n.toLowerCase(), q);

  const bare = n.replace(/^(sh|sz|bj|hk|us)/i, '');
  if (bare && !map.has(bare)) map.set(bare, q);
  if (bare) {
    const upper = bare.toUpperCase();
    const lower = bare.toLowerCase();
    if (!map.has(upper)) map.set(upper, q);
    if (!map.has(lower)) map.set(lower, q);
  }
}

function lookupQuote(map: Map<string, FullQuote>, code: string): FullQuote | undefined {
  const normalized = normalizeStockCode(code) || code;
  return (
    map.get(code) ||
    map.get(normalized) ||
    map.get(code.toLowerCase()) ||
    map.get(normalized.toLowerCase()) ||
    map.get(normalized.replace(/^(sh|sz|bj|hk|us)/i, '')) ||
    map.get(normalized.replace(/^(sh|sz|bj|hk|us)/i, '').toUpperCase())
  );
}

async function fetchLiveQuotesForMarket(
  market: QuoteCacheMarket,
  codes: string[],
  options?: { batchSize?: number; concurrency?: number }
): Promise<FullQuote[]> {
  if (!codes.length) return [];

  if (market === 'us') {
    const bare = codes.map((c) => toSdkBareCode(c, 'us'));
    const quotes = await getUsQuotes(bare);
    return quotes.map((q) => {
      const ticker = String(q.code || '').replace(US_EXCHANGE_SUFFIX_RE, '');
      const normalized = normalizeStockCode(`us${ticker}`) || `us${ticker}`;
      return { ...(q as unknown as FullQuote), code: normalized };
    });
  }

  if (market === 'hk') {
    const bare = codes.map((c) => toSdkBareCode(c, 'hk'));
    const quotes = await getHkQuotes(bare);
    return quotes.map((q) => {
      const digits = String(q.code || '').replace(/\D/g, '') || String(q.code || '');
      const padded = digits.padStart(5, '0');
      const normalized = normalizeStockCode(`hk${padded}`) || `hk${padded}`;
      return { ...(q as unknown as FullQuote), code: normalized };
    });
  }

  return getAllQuotesByCodes(codes, {
    batchSize: options?.batchSize,
    concurrency: options?.concurrency,
  });
}

const US_EXCHANGE_SUFFIX_RE = /\.(OQ|N|A|O|P|OB|PK|OTC)$/i;

function collectUniqueQuotes(map: Map<string, FullQuote>): FullQuote[] {
  const uniqueQuotes: FullQuote[] = [];
  const seen = new Set<string>();
  for (const q of map.values()) {
    const key = normalizeStockCode(q.code) || q.code;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueQuotes.push(q);
  }
  return uniqueQuotes;
}

async function loadCacheIntoMap(
  groups: Record<QuoteCacheMarket, string[]>,
  map: Map<string, FullQuote>,
  options?: { force?: boolean; source?: QuoteSource }
): Promise<Record<QuoteCacheMarket, string[]>> {
  const source = options?.source ?? 'auto';
  const missingByMarket: Record<QuoteCacheMarket, string[]> = { cn: [], hk: [], us: [] };

  await Promise.all(
    (Object.keys(groups) as QuoteCacheMarket[]).map(async (market) => {
      const codes = groups[market];
      if (!codes.length) return;
      try {
        const { items } = await fetchSnapshotItems(market, {
          codes,
          force: options?.force && source === 'auto',
        });
        items.forEach((q) => indexQuoteIntoMap(map, q));
      } catch {
        missingByMarket[market].push(...codes);
        return;
      }
      for (const code of codes) {
        if (!lookupQuote(map, code)) {
          missingByMarket[market].push(code);
        }
      }
    })
  );

  return missingByMarket;
}

async function fetchQuotesMultiMarket(
  list: string[],
  options?: {
    source?: QuoteSource;
    force?: boolean;
    batchSize?: number;
    concurrency?: number;
    /** 本地快照就绪后立即回调（不等待联网补缺），用于自选等先秒开 */
    onPartial?: (quotes: FullQuote[]) => void;
  }
): Promise<FullQuote[]> {
  const source = resolveSource(options?.source);
  const groups = groupCodesByCacheMarket(list);
  const map = new Map<string, FullQuote>();

  // network 也先读本机快照：少量代码秒开，再叠加实时（避免东财偶发拖垮首屏）
  const missingAfterCache = await loadCacheIntoMap(groups, map, {
    force: options?.force,
    source: source === 'network' ? 'auto' : source,
  });

  const partial = alignQuotesToRequestedCodes(list, collectUniqueQuotes(map));
  if (partial.length > 0) {
    options?.onPartial?.(partial);
  }

  if (source === 'local') {
    return partial;
  }

  // auto：只补缺；network：对全部代码再拉一遍实时（缓存已通过 onPartial 露出）
  const liveTargets: Record<QuoteCacheMarket, string[]> =
    source === 'network' ? groups : missingAfterCache;

  const liveParts = await Promise.all(
    (Object.keys(liveTargets) as QuoteCacheMarket[]).map((market) =>
      liveTargets[market].length
        ? fetchLiveQuotesForMarket(market, liveTargets[market], options)
        : Promise.resolve([] as FullQuote[])
    )
  );
  liveParts.flat().forEach((q) => indexQuoteIntoMap(map, q));
  return alignQuotesToRequestedCodes(list, collectUniqueQuotes(map));
}

/**
 * 按代码取行情：auto / network 均先缓存再 sdk；local 只缓存。
 * 可用 onPartial 在快照命中后立刻上屏。自动按 cn/hk/us 分市场请求。
 */
export async function getQuotesByCodesPreferCache(
  codes: string[],
  options?: {
    source?: QuoteSource;
    force?: boolean;
    batchSize?: number;
    concurrency?: number;
    onPartial?: (quotes: FullQuote[]) => void;
  }
): Promise<FullQuote[]> {
  const list = codes.map((c) => normalizeStockCode(c) || c).filter(Boolean);
  if (!list.length) return [];
  return fetchQuotesMultiMarket(list, options);
}

/**
 * 按代码取完整行情：优先本地 snapshot，否则按市场回退 SDK。
 * ``market`` 为 ``index`` 时整表走指数快照；其余情况按代码自动分 cn/hk/us。
 */
export async function getFullQuotesPreferCache(
  codes: string[],
  options?: {
    source?: QuoteSource;
    useSdkCache?: boolean;
    market?: string;
    onPartial?: (quotes: FullQuote[]) => void;
  }
): Promise<FullQuote[]> {
  const list = codes.map((c) => normalizeStockCode(c) || c).filter(Boolean);
  if (!list.length) return [];
  const source = resolveSource(options?.source);
  const marketOpt = (options?.market || '').toLowerCase();

  // 总览指数：固定 index 表，避免 sh000001 被 cn 个股误匹配
  if (marketOpt === 'index') {
    let cached: FullQuote[] = [];
    try {
      const { items } = await fetchSnapshotItems('index', { codes: list });
      cached = alignQuotesToRequestedCodes(list, items);
      if (source === 'local') return cached;
      if (source === 'auto' && cached.length === list.length) return cached;
    } catch {
      if (source === 'local') return [];
    }
    const live = await getFullQuotes(list, options?.useSdkCache !== false);
    return alignQuotesToRequestedCodes(list, live.length ? live : cached);
  }

  // 显式单市场（如 portal 只拉 hk）仍支持；未指定则按代码拆分
  if (marketOpt === 'cn' || marketOpt === 'hk' || marketOpt === 'us') {
    let cached: FullQuote[] = [];
    try {
      const { items } = await fetchSnapshotItems(marketOpt, { codes: list });
      cached = alignQuotesToRequestedCodes(list, items);
      if (source === 'local') return cached;
      if (source === 'auto' && cached.length === list.length) return cached;
      if (source === 'auto' && cached.length > 0) {
        const missing = list.filter((c) => !cached.some((q) => q.code === c));
        const live = await fetchLiveQuotesForMarket(marketOpt, missing);
        return alignQuotesToRequestedCodes(list, cached.concat(live));
      }
    } catch {
      if (source === 'local') return [];
    }
    const live = await fetchLiveQuotesForMarket(marketOpt, list);
    return alignQuotesToRequestedCodes(list, live.length ? live : cached);
  }

  return fetchQuotesMultiMarket(list, {
    source: options?.source,
    onPartial: options?.onPartial,
  });
}

function quoteDigits(code: string): string {
  return (normalizeStockCode(code) || code).replace(/^(sh|sz|bj|hk|us)/i, '').toLowerCase();
}

function quoteMarket(code: string): string {
  const m = (normalizeStockCode(code) || code).match(/^(sh|sz|bj|hk|us)/i);
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
    indexQuoteIntoMap(map, { ...q, code: n });
    const digits = quoteDigits(raw);
    if (!digits) continue;
    const list = byDigits.get(digits) || [];
    list.push(q);
    byDigits.set(digits, list);
  }

  const out: FullQuote[] = [];
  for (const code of requested) {
    const normalized = normalizeStockCode(code) || code;
    let hit = lookupQuote(map, code);

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
          candidates.find((q) => !/^(sh|sz|bj|hk|us)/i.test(String(q.code))) ||
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
