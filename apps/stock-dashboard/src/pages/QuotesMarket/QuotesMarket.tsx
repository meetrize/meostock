/**
 * 行情浏览：左侧市场类型，右侧可排序分页列表，点击行打开 K 线
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Check,
  RefreshCw,
  LayoutGrid,
  Database,
  Layers,
} from 'lucide-react';
import { Card, Loading, Empty, useToast } from '@/components/common';
import { useIsInWatchlist } from '@/hooks';
import { watchlistActions } from '@/services/watchlistStore';
import {
  getFullQuotes,
  getHkQuotes,
  getUsQuotes,
  getFundQuotes,
  getFuturesLastBar,
  getAllHKQuotes,
  getAllUSQuotes,
  getDomesticFuturesSpotMap,
} from '@/services/sdk';
import { useAppSettings } from '@/contexts';
import {
  formatPrice,
  formatPercent,
  formatAmount,
  formatVolume,
  formatMarketCap,
  getChangeColorClass,
  normalizeStockCode,
} from '@/utils/format';
import { openMultipanel } from '@/utils/multipanel';
import styles from './QuotesMarket.module.css';

type MarketId =
  | 'cn'
  | 'hk'
  | 'us'
  | 'futures'
  | 'fund'
  | 'index'
  | `yf:${string}`;

interface MarketDef {
  id: MarketId;
  label: string;
  group: 'stock-sdk' | 'yfinance';
}

interface QuoteRow {
  code: string;
  name: string;
  klineSymbol: string;
  /** 已尝试补齐行情（成功或失败），避免空数据死循环重试 */
  quoteReady?: boolean;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
  pb: number | null;
  pe: number | null;
  totalMarketCap: number | null;
  circulatingMarketCap: number | null;
  open: number | null;
  prevClose: number | null;
  high: number | null;
  low: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  amplitude: number | null;
}

type SortKey = keyof QuoteRow;

type SortState = { key: SortKey; dir: 1 | -1 };

const PAGE_SIZE = 20;

/** 非美股默认：涨幅降序 */
const DEFAULT_SORT: SortState = { key: 'changePercent', dir: -1 };
/** stock-sdk 美股默认：总市值降序 */
const US_DEFAULT_SORT: SortState = { key: 'totalMarketCap', dir: -1 };
const US_SORT_STORAGE_KEY = 'ui.quotesUsSort';

const QUOTE_SORT_KEYS = new Set<string>([
  'code',
  'name',
  'price',
  'change',
  'changePercent',
  'volume',
  'amount',
  'pb',
  'pe',
  'totalMarketCap',
  'circulatingMarketCap',
  'open',
  'prevClose',
  'high',
  'low',
  'turnoverRate',
  'volumeRatio',
  'amplitude',
]);

function readUsSort(): SortState {
  try {
    const raw = localStorage.getItem(US_SORT_STORAGE_KEY);
    if (!raw) return US_DEFAULT_SORT;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return US_DEFAULT_SORT;
    const key = (parsed as { key?: unknown }).key;
    const dir = (parsed as { dir?: unknown }).dir;
    if (typeof key === 'string' && QUOTE_SORT_KEYS.has(key) && (dir === 1 || dir === -1)) {
      return { key: key as SortKey, dir };
    }
  } catch {
    /* ignore */
  }
  return US_DEFAULT_SORT;
}

function writeUsSort(sort: SortState): void {
  try {
    localStorage.setItem(US_SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    /* ignore */
  }
}

function nextSortState(prev: SortState, key: SortKey): SortState {
  if (prev.key === key) {
    return { key, dir: prev.dir === 1 ? -1 : 1 };
  }
  return { key, dir: key === 'name' || key === 'code' ? 1 : -1 };
}

const MARKETS: MarketDef[] = [
  { id: 'cn', label: 'A股', group: 'stock-sdk' },
  { id: 'hk', label: '港股', group: 'stock-sdk' },
  { id: 'us', label: '美股', group: 'stock-sdk' },
  { id: 'futures', label: '期货', group: 'stock-sdk' },
  { id: 'fund', label: '基金', group: 'stock-sdk' },
  { id: 'index', label: '指数', group: 'stock-sdk' },
  { id: 'yf:COMMODITIES', label: '大宗商品', group: 'yfinance' },
  { id: 'yf:CURRENCIES', label: '外汇', group: 'yfinance' },
  { id: 'yf:CRYPTOCURRENCIES', label: '加密货币', group: 'yfinance' },
  { id: 'yf:RATES', label: '利率', group: 'yfinance' },
  { id: 'yf:US', label: '美国', group: 'yfinance' },
  { id: 'yf:EUROPE', label: '欧洲', group: 'yfinance' },
  { id: 'yf:ASIA', label: '亚洲', group: 'yfinance' },
  { id: 'yf:GB', label: '英国', group: 'yfinance' },
];

/** 按重要性排列的列 */
const COLUMNS: { key: SortKey; label: string; align?: 'left' | 'right' }[] = [
  { key: 'code', label: '代码', align: 'left' },
  { key: 'name', label: '名称', align: 'left' },
  { key: 'changePercent', label: '涨幅', align: 'right' },
  { key: 'price', label: '现价', align: 'right' },
  { key: 'change', label: '涨跌', align: 'right' },
  { key: 'volume', label: '成交量', align: 'right' },
  { key: 'amount', label: '成交额', align: 'right' },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'pe', label: '市盈率', align: 'right' },
  { key: 'pb', label: '市净率', align: 'right' },
  { key: 'totalMarketCap', label: '总市值', align: 'right' },
  { key: 'circulatingMarketCap', label: '流通市值', align: 'right' },
  { key: 'open', label: '今开', align: 'right' },
  { key: 'prevClose', label: '昨收', align: 'right' },
  { key: 'high', label: '最高', align: 'right' },
  { key: 'low', label: '最低', align: 'right' },
  { key: 'volumeRatio', label: '量比', align: 'right' },
  { key: 'amplitude', label: '振幅', align: 'right' },
];

function emptyRow(partial: Partial<QuoteRow> & Pick<QuoteRow, 'code' | 'name' | 'klineSymbol'>): QuoteRow {
  return {
    price: null,
    change: null,
    changePercent: null,
    volume: null,
    amount: null,
    pb: null,
    pe: null,
    totalMarketCap: null,
    circulatingMarketCap: null,
    open: null,
    prevClose: null,
    high: null,
    low: null,
    turnoverRate: null,
    volumeRatio: null,
    amplitude: null,
    ...partial,
  };
}

function fromFullQuote(q: {
  code: string;
  name: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  amount?: number;
  pb?: number | null;
  pe?: number | null;
  totalMarketCap?: number | null;
  circulatingMarketCap?: number | null;
  open?: number;
  prevClose?: number;
  high?: number;
  low?: number;
  turnoverRate?: number | null;
  volumeRatio?: number | null;
  amplitude?: number | null;
  market?: string;
}): QuoteRow {
  const raw = normalizeStockCode(q.code) || q.code;
  let displayCode = raw.replace(/^(sh|sz|bj|hk|us)/i, '') || raw;
  let klineSymbol = raw;
  if (q.market === 'HK' || /^hk/i.test(raw)) {
    // K 线页用 hk00700，避免与 A 股数字码混淆
    const pure = (raw.replace(/^hk/i, '') || raw).replace(/\D/g, '') || raw;
    const padded = pure.length <= 5 ? pure.padStart(5, '0') : pure;
    displayCode = padded;
    klineSymbol = `hk${padded}`;
  } else if (q.market === 'US' || /^us/i.test(raw)) {
    // 行情常返回 AAPL.OQ；K 线要 usAAPL（去掉交易所后缀）
    let ticker = raw.replace(/^us/i, '').toUpperCase();
    ticker = ticker.replace(/\.(OQ|N|A|O|P|OB|PK|OTC)$/i, '');
    displayCode = ticker;
    klineSymbol = `us${ticker}`;
  }
  return emptyRow({
    code: displayCode,
    name: q.name,
    klineSymbol,
    price: q.price ?? null,
    change: q.change ?? null,
    changePercent: q.changePercent ?? null,
    volume: q.volume ?? null,
    amount: q.amount ?? null,
    pb: q.pb ?? null,
    pe: q.pe ?? null,
    totalMarketCap: q.totalMarketCap ?? null,
    circulatingMarketCap: q.circulatingMarketCap ?? null,
    open: q.open ?? null,
    prevClose: q.prevClose ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    turnoverRate: q.turnoverRate ?? null,
    volumeRatio: q.volumeRatio ?? null,
    amplitude: q.amplitude ?? null,
  });
}

interface CacheSnapshotMeta {
  asOf: number | null;
  syncedAt: number | null;
  stale: boolean;
  syncing: boolean;
  source: string | null;
  total: number;
}

interface CacheSyncProgress {
  active: boolean;
  syncing: boolean;
  job: 'single' | 'all' | string | null;
  marketsTotal: number;
  marketsDone: number;
  market: string | null;
  marketLabel: string | null;
  done: number;
  total: number;
  overallDone: number;
  overallTotal: number;
  okCount: number;
  failCount: number;
  message: string;
  source: string | null;
  errors: Array<{ market: string; error: string }>;
}

async function postCacheSync(market: MarketId): Promise<void> {
  const res = await fetch('/api/cache/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market: String(market), force: true, background: true }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '同步请求失败');
}

async function postCacheSyncAll(): Promise<{ marketsTotal: number }> {
  const res = await fetch('/api/cache/sync-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '同步全部失败');
  return { marketsTotal: Number(data.markets_total) || 0 };
}

async function fetchCacheSyncProgress(): Promise<CacheSyncProgress> {
  const res = await fetch('/api/cache/sync/progress');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '进度读取失败');
  return {
    active: Boolean(data.active),
    syncing: Boolean(data.syncing),
    job: data.job ?? null,
    marketsTotal: Number(data.markets_total) || 0,
    marketsDone: Number(data.markets_done) || 0,
    market: data.market ? String(data.market) : null,
    marketLabel: data.market_label ? String(data.market_label) : null,
    done: Number(data.done) || 0,
    total: Number(data.total) || 0,
    overallDone: Number(data.overall_done) || 0,
    overallTotal: Number(data.overall_total) || 0,
    okCount: Number(data.ok_count) || 0,
    failCount: Number(data.fail_count) || 0,
    message: String(data.message || ''),
    source: data.source ? String(data.source) : null,
    errors: Array.isArray(data.errors) ? data.errors : [],
  };
}

/** 轮询后台同步进度，直到结束；返回最终进度 */
async function waitCacheSync(
  onProgress: (p: CacheSyncProgress) => void,
  signal?: { cancelled: boolean }
): Promise<CacheSyncProgress> {
  let last: CacheSyncProgress | null = null;
  const deadline = Date.now() + 30 * 60_000;
  // 等任务真正开始
  for (let i = 0; i < 40; i++) {
    if (signal?.cancelled) break;
    last = await fetchCacheSyncProgress();
    onProgress(last);
    if (last.active || last.syncing) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  while (Date.now() < deadline) {
    if (signal?.cancelled) break;
    last = await fetchCacheSyncProgress();
    onProgress(last);
    if (!last.active && !last.syncing) break;
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!last) last = await fetchCacheSyncProgress();
  return last;
}

function itemToQuoteRow(item: Record<string, unknown>): QuoteRow {
  return emptyRow({
    code: String(item.code || ''),
    name: String(item.name || item.code || ''),
    klineSymbol: String(item.klineSymbol || item.code || ''),
    quoteReady: item.quoteReady !== false,
    price: (item.price as number | null) ?? null,
    change: (item.change as number | null) ?? null,
    changePercent: (item.changePercent as number | null) ?? null,
    volume: (item.volume as number | null) ?? null,
    amount: (item.amount as number | null) ?? null,
    pb: (item.pb as number | null) ?? null,
    pe: (item.pe as number | null) ?? null,
    totalMarketCap: (item.totalMarketCap as number | null) ?? null,
    circulatingMarketCap: (item.circulatingMarketCap as number | null) ?? null,
    open: (item.open as number | null) ?? null,
    prevClose: (item.prevClose as number | null) ?? null,
    high: (item.high as number | null) ?? null,
    low: (item.low as number | null) ?? null,
    turnoverRate: (item.turnoverRate as number | null) ?? null,
    volumeRatio: (item.volumeRatio as number | null) ?? null,
    amplitude: (item.amplitude as number | null) ?? null,
  });
}

/** 同源本地缓存快照；syncing 时短轮询直到行数稳定或超时 */
async function fetchCacheSnapshot(
  market: MarketId,
  force = false,
  onProgress?: ProgressFn
): Promise<{ rows: QuoteRow[]; meta: CacheSnapshotMeta }> {
  const qs = new URLSearchParams({ market: String(market) });
  if (force) qs.set('force', '1');

  const loadOnce = async () => {
    const res = await fetch(`/api/cache/snapshot?${qs}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '本地缓存读取失败');
    const items = (data.items || []) as Array<Record<string, unknown>>;
    const rows = items.map(itemToQuoteRow);
    const meta: CacheSnapshotMeta = {
      asOf: typeof data.as_of === 'number' ? data.as_of : null,
      syncedAt: typeof data.synced_at === 'number' ? data.synced_at : null,
      stale: Boolean(data.stale),
      syncing: Boolean(data.syncing),
      source: data.source ? String(data.source) : null,
      total: Number(data.total) || rows.length,
    };
    return { rows, meta };
  };

  let { rows, meta } = await loadOnce();
  onProgress?.(rows.length, Math.max(meta.total, rows.length, 1));

  // 已有缓存：立刻返回，后台 sync 不阻塞首屏（期货/yf 以前会在此干等）
  if (rows.length > 0) {
    return { rows, meta };
  }

  // 冷启动无数据：短轮询等待首批落库
  const deadline = Date.now() + 45_000;
  let stable = 0;
  let lastLen = 0;
  while (meta.syncing && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const next = await loadOnce();
    rows = next.rows;
    meta = next.meta;
    onProgress?.(rows.length, Math.max(meta.total, rows.length, 1));
    if (rows.length > 0) {
      return { rows, meta };
    }
    if (rows.length === lastLen) {
      stable += 1;
      if (stable >= 6) break;
    } else {
      stable = 0;
      lastLen = rows.length;
    }
    if (!meta.syncing) break;
  }

  if (!rows.length && meta.syncing) {
    throw new Error('行情同步中，请稍后刷新');
  }
  if (!rows.length) {
    throw new Error(
      '本地缓存暂无数据。若设置了「仅本地」请改为「自动」或总览菜单切回「缓存（优先快照）」后再刷新'
    );
  }
  return { rows, meta };
}

/** 把前端补齐的行情写回本机 SQLite */
async function persistQuotesToCache(market: MarketId, rows: QuoteRow[]): Promise<void> {
  const items = rows
    .filter((r) => r.quoteReady && r.price != null)
    .map((r) => ({
      code: r.code,
      name: r.name,
      klineSymbol: r.klineSymbol,
      quoteReady: true,
      price: r.price,
      change: r.change,
      changePercent: r.changePercent,
      open: r.open,
      prevClose: r.prevClose,
      high: r.high,
      low: r.low,
      volume: r.volume,
      amount: r.amount,
      turnoverRate: r.turnoverRate,
      volumeRatio: r.volumeRatio,
      amplitude: r.amplitude,
      pe: r.pe,
      pb: r.pb,
      totalMarketCap: r.totalMarketCap,
      circulatingMarketCap: r.circulatingMarketCap,
    }));
  if (!items.length) return;
  try {
    await fetch('/api/cache/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market: String(market), items, source: 'client' }),
    });
  } catch {
    /* 忽略回写失败 */
  }
}

function formatCacheTime(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return '--';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function applyQuotePatch(row: QuoteRow, patch: Partial<QuoteRow>): QuoteRow {
  const nextName =
    patch.name && patch.name !== row.code
      ? patch.name
      : row.name !== row.code
        ? row.name
        : patch.name || row.name;
  return {
    ...row,
    ...patch,
    // 保留列表侧的代码/K 线符号（指数带 sh/sz 前缀等）
    code: row.code,
    klineSymbol: row.klineSymbol,
    name: nextName,
    quoteReady: true,
  };
}

function mergeQuoteMap(
  prev: QuoteRow[],
  map: Map<string, Partial<QuoteRow>>,
  requested: QuoteRow[]
): QuoteRow[] {
  const requestedCodes = new Set(requested.map((r) => r.code));
  return prev.map((row) => {
    const hit =
      map.get(row.code) ||
      map.get(row.klineSymbol) ||
      map.get(row.code.replace(/^0+/, '') || row.code);
    if (hit) return applyQuotePatch(row, hit);
    // 已请求但无数据：标记 ready，避免死循环
    if (requestedCodes.has(row.code) && !row.quoteReady) {
      return { ...row, quoteReady: true };
    }
    return row;
  });
}

type ProgressFn = (done: number, total: number) => void;

/** 按市场批量补齐行情，返回 code → patch */
async function fetchQuotesForMarket(
  market: MarketId,
  rows: QuoteRow[],
  onProgress?: ProgressFn,
  force = false
): Promise<Map<string, Partial<QuoteRow>>> {
  const map = new Map<string, Partial<QuoteRow>>();
  if (!rows.length) return map;
  const codes = rows.map((r) => r.code);
  const total = rows.length;
  onProgress?.(0, total);

  if (String(market).startsWith('yf:')) {
    const qs = new URLSearchParams({ symbols: codes.join(',') });
    if (force) qs.set('refresh', '1');
    const qRes = await fetch(`/api/yf/quotes?${qs}`);
    const qData = await qRes.json();
    if (!qData.ok) {
      onProgress?.(total, total);
      return map;
    }
    for (const q of (qData.quotes || []) as Array<Record<string, number | null | string>>) {
      map.set(String(q.code), {
        price: (q.price as number | null) ?? null,
        change: (q.change as number | null) ?? null,
        changePercent: (q.changePercent as number | null) ?? null,
        open: (q.open as number | null) ?? null,
        prevClose: (q.prevClose as number | null) ?? null,
        high: (q.high as number | null) ?? null,
        low: (q.low as number | null) ?? null,
        volume: (q.volume as number | null) ?? null,
        amount: (q.amount as number | null) ?? null,
        amplitude: (q.amplitude as number | null) ?? null,
      });
    }
    onProgress?.(total, total);
    return map;
  }

  if (market === 'cn' || market === 'index') {
    const req = rows.map((r) => r.klineSymbol || r.code);
    const quotes = await getFullQuotes(req, false);
    for (const q of quotes) {
      const row = fromFullQuote(q);
      map.set(row.code, row);
      map.set(String(q.code).replace(/^(sh|sz|bj)/i, ''), row);
    }
    onProgress?.(total, total);
    return map;
  }

  if (market === 'hk') {
    const req = codes.map((c) => c.replace(/\D/g, '').padStart(5, '0'));
    const quotes = await getHkQuotes(req);
    for (const q of quotes) {
      const row = fromFullQuote({ ...q, market: 'HK' });
      map.set(row.code, row);
      map.set(row.code.replace(/^0+/, '') || row.code, row);
    }
    onProgress?.(total, total);
    return map;
  }

  if (market === 'us') {
    const quotes = await getUsQuotes(codes);
    for (const q of quotes) {
      const row = fromFullQuote({ ...q, market: 'US' });
      map.set(row.code, row);
      map.set(String(q.code).replace(/\.\w+$/, ''), row);
    }
    onProgress?.(total, total);
    return map;
  }

  if (market === 'fund') {
    const quotes = await getFundQuotes(codes);
    for (const q of quotes) {
      map.set(q.code, {
        name: q.name,
        price: q.nav ?? null,
        change: q.change ?? null,
        changePercent: q.change ?? null,
        prevClose: q.accNav ?? null,
      });
    }
    onProgress?.(total, total);
    return map;
  }

  if (market === 'futures') {
    // 优先 futsseapi 现货（push2his/kline 常断）；再按需回退日 K
    try {
      const spot = await getDomesticFuturesSpotMap({ force });
      let done = 0;
      for (const r of rows) {
        const hit = spot.get(r.code.toLowerCase());
        if (hit && hit.price != null) {
          map.set(r.code, {
            name: hit.name || r.name,
            price: hit.price,
            change: hit.change,
            changePercent: hit.changePercent,
            open: hit.open,
            high: hit.high,
            low: hit.low,
            prevClose: hit.prevClose,
            volume: hit.volume,
            amount: hit.amount,
          });
        }
        done += 1;
        onProgress?.(done, total);
      }
    } catch {
      /* spot 失败再走日 K */
    }

    const missing = rows.filter((r) => !map.has(r.code));
    if (missing.length) {
      let done = rows.length - missing.length;
      const concurrency = 4;
      for (let i = 0; i < missing.length; i += concurrency) {
        const chunk = missing.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (r) => {
            try {
              const last = await getFuturesLastBar(r.code);
              if (!last) return;
              map.set(r.code, {
                name: last.name || r.name,
                price: last.close ?? null,
                change: last.change ?? null,
                changePercent: last.changePercent ?? null,
                open: last.open ?? null,
                high: last.high ?? null,
                low: last.low ?? null,
                volume: last.volume ?? null,
                amount: last.amount != null ? Number(last.amount) / 10000 : null,
                amplitude: last.amplitude ?? null,
                prevClose:
                  last.close != null && last.change != null
                    ? Number(last.close) - Number(last.change)
                    : null,
              });
            } catch {
              /* ignore */
            } finally {
              done += 1;
              onProgress?.(done, total);
            }
          })
        );
      }
    }
    onProgress?.(total, total);
    return map;
  }

  onProgress?.(total, total);
  return map;
}

async function loadFromSdkBatch(
  m: 'hk' | 'us',
  onProgress?: ProgressFn,
  force = false
): Promise<{ rows: QuoteRow[]; meta: CacheSnapshotMeta }> {
  // 文档 quotes.hk / quotes.us 同源腾讯；全市场用 batch（与 sdk.ts getAll* 一致）
  const quotes =
    m === 'hk'
      ? await getAllHKQuotes({ onProgress, force })
      : await getAllUSQuotes({ onProgress, force });
  const marketTag = m === 'hk' ? 'HK' : 'US';
  const rows = (Array.isArray(quotes) ? quotes : []).map((q) => {
    const row = fromFullQuote({ ...(q as Parameters<typeof fromFullQuote>[0]), market: marketTag });
    return { ...row, quoteReady: true };
  });
  void persistQuotesToCache(m, rows);
  const now = Date.now() / 1000;
  return {
    rows,
    meta: {
      asOf: now,
      syncedAt: now,
      stale: false,
      syncing: false,
      source: 'stock-sdk',
      total: rows.length,
    },
  };
}

/** 港美：只读一次缓存，空/失败立刻返回 null（避免冷启动干等 45s） */
async function peekCacheSnapshot(market: 'hk' | 'us'): Promise<{
  rows: QuoteRow[];
  meta: CacheSnapshotMeta;
} | null> {
  try {
    const qs = new URLSearchParams({ market });
    const res = await fetch(`/api/cache/snapshot?${qs}`);
    const data = await res.json();
    if (!data.ok) return null;
    const items = (data.items || []) as Array<Record<string, unknown>>;
    if (!items.length) return null;
    return {
      rows: items.map(itemToQuoteRow),
      meta: {
        asOf: typeof data.as_of === 'number' ? data.as_of : null,
        syncedAt: typeof data.synced_at === 'number' ? data.synced_at : null,
        stale: Boolean(data.stale),
        syncing: Boolean(data.syncing),
        source: data.source ? String(data.source) : null,
        total: Number(data.total) || items.length,
      },
    };
  } catch {
    return null;
  }
}

async function loadMarketRows(
  m: MarketId,
  onProgress?: ProgressFn,
  force = false
): Promise<{ rows: QuoteRow[]; meta: CacheSnapshotMeta }> {
  // 优先本机 SQLite；港美东财 clist 失败时回退浏览器 stock-sdk（腾讯源，见文档 quotes）
  if (m === 'hk' || m === 'us') {
    if (!force) {
      const cached = await peekCacheSnapshot(m);
      if (cached?.rows.length) return cached;
    }
    return loadFromSdkBatch(m, onProgress, force);
  }
  return fetchCacheSnapshot(m, force, onProgress);
}

function watchlistCodeOf(row: QuoteRow, market: MarketId): string | null {
  // 自选页主要吃 A 股 FullQuote；港美也可存代码，yfinance/期货暂不支持
  if (String(market).startsWith('yf:') || market === 'futures') return null;
  if (market === 'cn' || market === 'fund' || market === 'index') {
    return normalizeStockCode(row.klineSymbol) || row.code;
  }
  if (market === 'hk') {
    const c = row.code.replace(/\D/g, '') || row.code;
    return c.padStart(5, '0');
  }
  if (market === 'us') return row.code;
  return null;
}

function compareValues(a: unknown, b: unknown, dir: 1 | -1): number {
  const av = a;
  const bv = b;
  const aNull = av === null || av === undefined || av === '';
  const bNull = bv === null || bv === undefined || bv === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * dir;
  }
  return String(av).localeCompare(String(bv), 'zh-CN') * dir;
}

function formatCell(key: SortKey, row: QuoteRow): ReactNode {
  switch (key) {
    case 'code':
      return row.code;
    case 'name':
      return row.name;
    case 'changePercent':
      return (
        <span className={getChangeColorClass(row.changePercent)}>
          {formatPercent(row.changePercent)}
        </span>
      );
    case 'change':
      return (
        <span className={getChangeColorClass(row.change)}>
          {row.change == null || Number.isNaN(row.change)
            ? '--'
            : `${row.change > 0 ? '+' : ''}${row.change.toFixed(2)}`}
        </span>
      );
    case 'price':
    case 'open':
    case 'prevClose':
    case 'high':
    case 'low':
      return formatPrice(row[key]);
    case 'volume':
      return formatVolume(row.volume);
    case 'amount':
      return formatAmount(row.amount);
    case 'pb':
    case 'pe':
    case 'volumeRatio':
      return row[key] == null || Number.isNaN(row[key] as number)
        ? '--'
        : (row[key] as number).toFixed(2);
    case 'turnoverRate':
    case 'amplitude':
      return formatPercent(row[key] as number | null, false);
    case 'totalMarketCap':
    case 'circulatingMarketCap':
      return formatMarketCap(row[key] as number | null);
    default:
      return '--';
  }
}

export function QuotesMarket() {
  const toast = useToast();
  const isInWatchlist = useIsInWatchlist();
  const { settings } = useAppSettings();
  const [market, setMarket] = useState<MarketId>('cn');
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [loadHint, setLoadHint] = useState('加载中…');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [cacheMeta, setCacheMeta] = useState<CacheSnapshotMeta | null>(null);
  const [cacheSyncing, setCacheSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<CacheSyncProgress | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<1 | -1>(DEFAULT_SORT.dir);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  /** 刷新后下一次补行情跳过服务端日 K 缓存 */
  const forceQuotesRef = useRef(false);
  /** 离开美股前记住的非美股排序，切回其他市场时恢复 */
  const nonUsSortRef = useRef<SortState>(DEFAULT_SORT);
  const syncAbortRef = useRef<{ cancelled: boolean } | null>(null);

  const loadMarket = useCallback(async (m: MarketId, force = false) => {
    const label = MARKETS.find((x) => x.id === m)?.label || String(m);
    const fullSnap = m === 'cn' || m === 'hk' || m === 'us';
    setLoading(true);
    setPageLoading(false);
    setError('');
    setCacheMeta(null);
    setLoadHint(
      force
        ? `正在刷新${label}本地缓存…`
        : fullSnap
          ? `正在加载${label}行情（本地缓存）…`
          : `正在加载${label}列表…`
    );
    setProgress({ done: 0, total: 0 });
    try {
      const { rows: next, meta } = await loadMarketRows(
        m,
        (done, total) => {
          setProgress({ done, total });
          setLoadHint(`正在同步${label}行情 ${done}/${total}…`);
        },
        force
      );
      setRows(next);
      setCacheMeta(meta);
      setPage(1);
      if (fullSnap) {
        setLoadHint(
          meta.stale || meta.syncing
            ? `${label}已显示缓存（${next.length} 只），后台同步中…`
            : `${label}行情加载完成（${next.length} 只）`
        );
        setProgress({ done: next.length, total: next.length });
      } else {
        setLoadHint('列表已就绪，正在加载行情…');
        setProgress({ done: 0, total: Math.min(PAGE_SIZE, next.length) });
      }
    } catch (e) {
      setRows([]);
      setCacheMeta(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarket(market, false);
  }, [market, loadMarket]);

  const handleRefresh = () => {
    if (loading || pageLoading || cacheSyncing) return;
    forceQuotesRef.current = true;
    void loadMarket(market, true);
  };

  const runCacheSync = useCallback(
    async (mode: 'current' | 'all') => {
      if (cacheSyncing || loading || pageLoading) return;
      const signal = { cancelled: false };
      syncAbortRef.current = signal;
      setCacheSyncing(true);
      setSyncProgress({
        active: true,
        syncing: true,
        job: mode === 'all' ? 'all' : 'single',
        marketsTotal: mode === 'all' ? MARKETS.length : 1,
        marketsDone: 0,
        market: mode === 'current' ? String(market) : null,
        marketLabel: mode === 'current' ? MARKETS.find((x) => x.id === market)?.label || String(market) : null,
        done: 0,
        total: 0,
        overallDone: 0,
        overallTotal: mode === 'all' ? MARKETS.length : 1,
        okCount: 0,
        failCount: 0,
        message: mode === 'all' ? '正在排队同步全部市场…' : '正在排队同步当前市场…',
        source: null,
        errors: [],
      });
      try {
        if (mode === 'all') {
          await postCacheSyncAll();
        } else {
          await postCacheSync(market);
        }
        const final = await waitCacheSync((p) => {
          if (!signal.cancelled) setSyncProgress(p);
        }, signal);
        if (signal.cancelled) return;
        setSyncProgress(final);
        const fail = final.failCount;
        const ok = final.okCount;
        if (fail > 0 && ok === 0) {
          toast.error(final.message || '同步失败');
        } else if (fail > 0) {
          toast.info(final.message || `部分失败：成功 ${ok}，失败 ${fail}`);
        } else {
          toast.success(final.message || '同步完成');
        }
        // 同步完成后刷新当前市场列表
        forceQuotesRef.current = true;
        await loadMarket(market, false);
      } catch (e) {
        if (!signal.cancelled) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!signal.cancelled) {
          setCacheSyncing(false);
          setSyncProgress(null);
        }
        if (syncAbortRef.current === signal) syncAbortRef.current = null;
      }
    },
    [cacheSyncing, loading, pageLoading, market, loadMarket, toast]
  );

  useEffect(() => {
    return () => {
      if (syncAbortRef.current) syncAbortRef.current.cancelled = true;
    };
  }, []);

  const showOverlay = loading || pageLoading || cacheSyncing;
  const syncOverallDone = syncProgress?.overallDone ?? 0;
  const syncOverallTotal = syncProgress?.overallTotal ?? 0;
  const overlayDone = cacheSyncing
    ? syncOverallDone
    : progress.done;
  const overlayTotal = cacheSyncing
    ? syncOverallTotal
    : progress.total;
  const progressPct =
    overlayTotal > 0
      ? Math.min(100, Math.round((overlayDone / overlayTotal) * 1000) / 10)
      : loading || cacheSyncing
        ? 8
        : 0;
  const overlayHint = cacheSyncing
    ? syncProgress?.message || '正在同步缓存…'
    : loadHint;
  const overlayMeta = (() => {
    if (cacheSyncing && syncProgress) {
      const parts: string[] = [];
      if (syncProgress.job === 'all' && syncProgress.marketsTotal > 0) {
        parts.push(`市场 ${syncProgress.marketsDone}/${syncProgress.marketsTotal}`);
      }
      if (syncProgress.total > 0) {
        parts.push(
          `${syncProgress.marketLabel || '当前'} ${syncProgress.done}/${syncProgress.total}`
        );
      }
      parts.push(`合计 ${syncOverallDone}/${Math.max(syncOverallTotal, 1)}（${progressPct}%）`);
      if (syncProgress.source) parts.push(`源 ${syncProgress.source}`);
      return parts.join(' · ');
    }
    if (overlayTotal > 0) {
      return `${overlayDone} / ${overlayTotal}（${progressPct}%）`;
    }
    return '准备中…';
  })();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.klineSymbol.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pageNeedRows = pageRows.filter((r) => !r.quoteReady);
  const pageNeedKey = pageNeedRows.map((r) => r.code).join(',');

  // 所有市场：先出列表，再补当前页行情（蒙板进度）
  useEffect(() => {
    if (!pageNeedKey) {
      setPageLoading(false);
      return;
    }
    const needRows = pageNeedRows;
    let cancelled = false;
    setPageLoading(true);
    setLoadHint(`正在加载第 ${currentPage} 页行情…`);
    setProgress({ done: 0, total: needRows.length });
    const forceQuotes = forceQuotesRef.current;
    forceQuotesRef.current = false;
    (async () => {
      try {
        const map = await fetchQuotesForMarket(
          market,
          needRows,
          (done, total) => {
            if (!cancelled) setProgress({ done, total });
          },
          forceQuotes
        );
        if (cancelled) return;
        const patched = needRows
          .map((r) => {
            const hit =
              map.get(r.code) ||
              map.get(r.klineSymbol) ||
              map.get(r.code.replace(/^0+/, '') || r.code);
            return hit ? applyQuotePatch(r, hit) : null;
          })
          .filter((r): r is QuoteRow => r != null);
        setRows((prev) => mergeQuoteMap(prev, map, needRows));
        void persistQuotesToCache(market, patched);
        setLoadHint('行情加载完成');
        setProgress({ done: needRows.length, total: needRows.length });
      } catch {
        if (!cancelled) {
          setRows((prev) => mergeQuoteMap(prev, new Map(), needRows));
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, currentPage, pageNeedKey]);

  // 后台按批补齐（A/H/美已全量快照；基金/期货/yf 只补 quoteReady=false 的）
  useEffect(() => {
    if (market === 'cn' || market === 'hk' || market === 'us') return;
    if (!rows.length) return;
    const pending = rows.filter((r) => !r.quoteReady);
    if (!pending.length) return;
    const bgLimit = market === 'fund' ? 200 : pending.length;
    const queue = pending.slice(0, bgLimit);
    let cancelled = false;
    (async () => {
      const batch = market === 'futures' ? 8 : market.toString().startsWith('yf:') ? 12 : 20;
      for (let i = 0; i < queue.length; i += batch) {
        if (cancelled) return;
        const chunk = queue.slice(i, i + batch);
        try {
          const map = await fetchQuotesForMarket(market, chunk);
          if (cancelled) return;
          const patched = chunk
            .map((r) => {
              const hit = map.get(r.code) || map.get(r.klineSymbol);
              return hit ? applyQuotePatch(r, hit) : null;
            })
            .filter((r): r is QuoteRow => r != null);
          setRows((prev) => mergeQuoteMap(prev, map, chunk));
          void persistQuotesToCache(market, patched);
        } catch {
          if (!cancelled) setRows((prev) => mergeQuoteMap(prev, new Map(), chunk));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在切换市场/列表就绪时跑
  }, [market, rows.length]);

  const handleSort = (key: SortKey) => {
    const next = nextSortState({ key: sortKey, dir: sortDir }, key);
    setSortKey(next.key);
    setSortDir(next.dir);
    if (market === 'us') {
      writeUsSort(next);
    } else {
      nonUsSortRef.current = next;
    }
    setPage(1);
  };

  const selectMarket = (next: MarketId) => {
    if (next === market) return;
    if (market === 'us') {
      writeUsSort({ key: sortKey, dir: sortDir });
    } else {
      nonUsSortRef.current = { key: sortKey, dir: sortDir };
    }
    if (next === 'us') {
      const us = readUsSort();
      setSortKey(us.key);
      setSortDir(us.dir);
    } else {
      const other = nonUsSortRef.current;
      setSortKey(other.key);
      setSortDir(other.dir);
    }
    setMarket(next);
  };

  const openKline = (row: QuoteRow) => {
    const url = `/?symbol=${encodeURIComponent(row.klineSymbol)}&period=1d`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /** 用当前筛选排序结果打开多面板（可超一屏，多面板内翻页） */
  const openMultipanelFromPage = () => {
    const codes = sorted.map((r) => r.klineSymbol).filter(Boolean);
    if (!codes.length) {
      toast.info('当前列表暂无标的');
      return;
    }
    openMultipanel(codes, { period: '1d' });
  };

  const handleToggleWatchlist = (e: React.MouseEvent, row: QuoteRow) => {
    e.stopPropagation();
    const code = watchlistCodeOf(row, market);
    if (!code) {
      toast.info('当前市场暂不支持加入自选（自选主要面向 A 股）');
      return;
    }
    if (isInWatchlist(code)) {
      watchlistActions.remove(code);
      toast.success(`已将 ${row.name} 移出自选`);
      return;
    }
    watchlistActions.add(code);
    toast.success(`已将 ${row.name} 加入自选`);
  };

  const sdkMarkets = MARKETS.filter((m) => m.group === 'stock-sdk');
  const yfMarkets = MARKETS.filter((m) => m.group === 'yfinance');
  const activeLabel = MARKETS.find((m) => m.id === market)?.label || market;

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h3>市场类型</h3>
          <button
            type="button"
            className={styles.syncAllBtn}
            onClick={() => void runCacheSync('all')}
            disabled={cacheSyncing || loading || pageLoading}
            title="同步全部市场最新缓存（失败时自动切新浪等备用源）"
          >
            <Layers size={13} />
            同步所有
          </button>
        </div>
        <div className={styles.groupBlock}>
          <div className={styles.groupLabel}>stock-sdk</div>
          {sdkMarkets.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.marketItem} ${market === m.id ? styles.active : ''}`}
              onClick={() => selectMarket(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className={styles.groupBlock}>
          <div className={styles.groupLabel}>yfinance</div>
          {yfMarkets.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${styles.marketItem} ${market === m.id ? styles.active : ''}`}
              onClick={() => selectMarket(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.main}>
        <Card
          title={`${activeLabel}行情`}
          extra={
            <div className={styles.toolbar}>
              <input
                className={styles.search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索代码/名称"
              />
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={openMultipanelFromPage}
                disabled={loading || pageRows.length === 0}
                title="用当前筛选列表打开多面板（超出一屏可翻页）"
              >
                <LayoutGrid size={14} />
                多面板
              </button>
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={() => void runCacheSync('current')}
                disabled={cacheSyncing || loading || pageLoading}
                title="同步当前市场最新缓存（失败时自动切新浪等备用源）"
              >
                <Database size={14} className={cacheSyncing ? styles.spin : undefined} />
                同步缓存
              </button>
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={handleRefresh}
                disabled={loading || pageLoading || cacheSyncing}
                title="重新加载当前市场列表"
              >
                <RefreshCw
                  size={14}
                  className={loading || pageLoading ? styles.spin : undefined}
                />
                刷新
              </button>
              <span className={styles.count}>共 {sorted.length} 条</span>
              {cacheMeta && (
                <span
                  className={styles.cacheHint}
                  title={`模式 ${settings.cacheMode || 'balanced'} · 源 ${cacheMeta.source || '--'}`}
                >
                  {cacheMeta.syncing ? '同步中 · ' : cacheMeta.stale ? '缓存 · ' : ''}
                  {formatCacheTime(cacheMeta.asOf ?? cacheMeta.syncedAt)}
                </span>
              )}
            </div>
          }
        >
          <div className={styles.panel}>
            {showOverlay && (
              <div className={styles.overlay} role="status" aria-live="polite">
                <div className={styles.overlayCard}>
                  <Loading size="md" text={overlayHint} />
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressBar}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className={styles.progressMeta}>{overlayMeta}</div>
                </div>
              </div>
            )}
          {error ? (
            <Empty title="加载失败" description={error} />
          ) : !loading && sorted.length === 0 ? (
            <Empty title="暂无数据" description="换一个市场或清空搜索试试" />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.actionCol} />
                      {COLUMNS.map((col) => {
                        const active = sortKey === col.key;
                        return (
                          <th
                            key={col.key}
                            className={col.align === 'left' ? styles.left : styles.right}
                            onClick={() => handleSort(col.key)}
                          >
                            <span className={styles.thInner}>
                              {col.label}
                              {active ? (
                                sortDir === 1 ? (
                                  <ArrowUp size={12} />
                                ) : (
                                  <ArrowDown size={12} />
                                )
                              ) : (
                                <ArrowUpDown size={12} className={styles.thIconMuted} />
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const wlCode = watchlistCodeOf(row, market);
                      const starred = wlCode ? isInWatchlist(wlCode) : false;
                      return (
                        <tr
                          key={`${row.klineSymbol}-${row.code}`}
                          onClick={() => openKline(row)}
                          title="打开 K 线图"
                        >
                          <td className={styles.actionCol}>
                            <button
                              type="button"
                              className={`${styles.addBtn} ${starred ? styles.added : ''}`}
                              title={
                                wlCode
                                  ? starred
                                    ? '移出自选'
                                    : '加入自选'
                                  : '当前市场暂不支持自选'
                              }
                              onClick={(e) => handleToggleWatchlist(e, row)}
                            >
                              {starred ? <Check size={14} /> : <Plus size={14} />}
                            </button>
                          </td>
                          {COLUMNS.map((col) => (
                            <td
                              key={col.key}
                              className={col.align === 'left' ? styles.left : styles.right}
                            >
                              {formatCell(col.key, row)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} />
                  上一页
                </button>
                <span className={styles.pageInfo}>
                  第 {currentPage} / {totalPages} 页 · 每页 {PAGE_SIZE} 条
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
          </div>
        </Card>
      </div>
    </div>
  );
}
