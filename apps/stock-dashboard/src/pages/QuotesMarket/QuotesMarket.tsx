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
import { useAppSettings, useSyncStatus } from '@/contexts';
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
import {
  fetchTushareCatalog,
  fetchTushareMarket,
  fetchTushareTradeDate,
  isTushareMarketId,
  type TushareCol,
  type TushareNavGroup,
} from '@/services/tushare';
import { LANE_META, laneOf } from '@/services/sourceLanes';
import styles from './QuotesMarket.module.css';

/** 原 cache/sdk 市场 + Tushare 节点（ts:*） */
type MarketId = string;

interface MarketDef {
  id: MarketId;
  label: string;
  group: 'stock-sdk' | 'yfinance' | 'tushare';
  kind?: 'legacy' | 'tushare' | 'placeholder';
  table?: 'quote' | 'topic';
  hint?: string;
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

type SortKey = string;

type SortState = { key: SortKey; dir: 1 | -1 };

type TopicRow = Record<string, unknown> & {
  code?: string;
  name?: string;
  klineSymbol?: string;
};

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

const FALLBACK_TREE: TushareNavGroup[] = [
  {
    id: 'g_cn',
    label: '沪深京',
    children: [
      { id: 'cn', label: '全部A股', kind: 'legacy', table: 'quote' },
      { id: 'ts:limit', label: '涨跌停', kind: 'tushare', table: 'topic' },
      { id: 'ts:stk_limit', label: '涨跌停价', kind: 'tushare', table: 'topic' },
      { id: 'ts:suspend', label: '停复牌', kind: 'tushare', table: 'topic' },
      { id: 'ts:new_share', label: '新股', kind: 'tushare', table: 'topic' },
    ],
  },
  {
    id: 'g_board',
    label: '板块指数',
    children: [
      { id: 'ts:sw', label: '申万行业', kind: 'tushare', table: 'quote' },
      { id: 'ts:ths', label: '同花顺板块', kind: 'tushare', table: 'topic' },
      { id: 'ts:dc', label: '东财板块', kind: 'tushare', table: 'topic' },
    ],
  },
  {
    id: 'g_index',
    label: '指数 / 基金 / 衍生品',
    children: [
      { id: 'index', label: '国内指数', kind: 'legacy', table: 'quote' },
      { id: 'fund', label: '公募/场内基金', kind: 'legacy', table: 'quote' },
      { id: 'ts:etf', label: 'ETF日线', kind: 'tushare', table: 'quote' },
      { id: 'futures', label: '国内期货', kind: 'legacy', table: 'quote' },
      { id: 'ts:cb', label: '可转债', kind: 'tushare', table: 'quote' },
      { id: 'ts:opt', label: '期权合约', kind: 'tushare', table: 'topic' },
    ],
  },
  {
    id: 'g_flow',
    label: '资金与异动',
    children: [
      { id: 'ts:moneyflow', label: '个股资金流', kind: 'tushare', table: 'topic' },
      { id: 'ts:hsgt', label: '沪深港通', kind: 'tushare', table: 'topic' },
      { id: 'ts:top_list', label: '龙虎榜', kind: 'tushare', table: 'topic' },
      { id: 'ts:block_trade', label: '大宗交易', kind: 'tushare', table: 'topic' },
      { id: 'ts:margin', label: '两融汇总', kind: 'tushare', table: 'topic' },
      { id: 'ts:margin_detail', label: '两融明细', kind: 'tushare', table: 'topic' },
    ],
  },
  {
    id: 'g_hkus',
    label: '港美与扩展',
    children: [
      { id: 'hk', label: '港股', kind: 'legacy', table: 'quote' },
      { id: 'us', label: '美股', kind: 'legacy', table: 'quote' },
      { id: 'yf:METALS', label: '贵金属/能源', kind: 'legacy', table: 'quote' },
      { id: 'yf:COMMODITIES', label: '大宗商品', kind: 'legacy', table: 'quote' },
      { id: 'yf:CURRENCIES', label: '外汇', kind: 'legacy', table: 'quote' },
      { id: 'yf:CRYPTOCURRENCIES', label: '加密货币', kind: 'legacy', table: 'quote' },
      { id: 'yf:RATES', label: '利率', kind: 'legacy', table: 'quote' },
      { id: 'yf:US', label: '美国', kind: 'legacy', table: 'quote' },
      { id: 'yf:EUROPE', label: '欧洲', kind: 'legacy', table: 'quote' },
      { id: 'yf:ASIA', label: '亚洲', kind: 'legacy', table: 'quote' },
      { id: 'yf:GB', label: '英国', kind: 'legacy', table: 'quote' },
    ],
  },
  {
    id: 'g_research',
    label: '专题（二期）',
    children: [
      {
        id: 'ts:ph:fina',
        label: '财务与股东',
        kind: 'placeholder',
        table: 'topic',
        hint: '一期占位：财务/股东见开发计划 P2',
      },
      {
        id: 'ts:ph:news',
        label: '资讯公告',
        kind: 'placeholder',
        table: 'topic',
        hint: '一期占位：资讯额度单独评估',
      },
      {
        id: 'ts:ph:macro',
        label: '宏观利率',
        kind: 'placeholder',
        table: 'topic',
        hint: '一期占位：宏观列入 P1',
      },
    ],
  },
];

function flattenNav(tree: TushareNavGroup[]): MarketDef[] {
  const out: MarketDef[] = [];
  for (const g of tree) {
    for (const c of g.children || []) {
      out.push({
        id: c.id,
        label: c.label,
        group: c.kind === 'legacy' ? (c.id.startsWith('yf:') ? 'yfinance' : 'stock-sdk') : 'tushare',
        kind: c.kind,
        table: c.table,
        hint: c.hint,
      });
    }
  }
  return out;
}

/** 按重要性排列的列（本地 cache 行情默认） */
const COLUMNS: TushareCol[] = [
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

function isLegacyMarket(m: MarketId): boolean {
  return !isTushareMarketId(m);
}

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

function numOf(row: TopicRow, key: string): number | null {
  const v = row[key];
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatCell(key: SortKey, row: TopicRow): ReactNode {
  switch (key) {
    case 'code':
      return String(row.code ?? '--');
    case 'name':
      return String(row.name ?? '--');
    case 'changePercent':
    case 'pctChg':
    case 'pctChange': {
      const n = numOf(row, key) ?? numOf(row, 'changePercent');
      return <span className={getChangeColorClass(n)}>{formatPercent(n)}</span>;
    }
    case 'change': {
      const n = numOf(row, 'change');
      return (
        <span className={getChangeColorClass(n)}>
          {n == null ? '--' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`}
        </span>
      );
    }
    case 'price':
    case 'open':
    case 'prevClose':
    case 'high':
    case 'low':
    case 'close':
    case 'upLimit':
    case 'downLimit':
    case 'exercisePrice':
      return formatPrice(numOf(row, key));
    case 'volume':
      return formatVolume(numOf(row, 'volume'));
    case 'amount':
    case 'fdAmount':
    case 'lBuy':
    case 'lSell':
    case 'netAmount':
    case 'netMfAmount':
    case 'rzye':
    case 'rzmre':
    case 'rzche':
    case 'rqye':
    case 'rzrqye':
    case 'buySmAmount':
    case 'sellSmAmount':
    case 'buyMdAmount':
    case 'sellMdAmount':
    case 'buyLgAmount':
    case 'sellLgAmount':
    case 'buyElgAmount':
    case 'sellElgAmount':
    case 'northMoney':
    case 'southMoney':
    case 'hgt':
    case 'sgt':
    case 'ggtSs':
    case 'ggtSz':
      return formatAmount(numOf(row, key));
    case 'pb':
    case 'pe':
    case 'volumeRatio':
    case 'bondOverRate':
    case 'extra':
    case 'vol':
    case 'rqmcl':
    case 'openTimes':
    case 'limitTimes':
    case 'count': {
      const n = numOf(row, key);
      return n == null ? '--' : n.toFixed(key === 'count' || key === 'openTimes' || key === 'limitTimes' ? 0 : 2);
    }
    case 'turnoverRate':
    case 'amplitude':
      return formatPercent(numOf(row, key), false);
    case 'totalMarketCap':
    case 'circulatingMarketCap':
      return formatMarketCap(numOf(row, key));
    default: {
      const v = row[key];
      if (v == null || v === '') return '--';
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '--';
      return String(v);
    }
  }
}

function quoteToTopic(row: QuoteRow): TopicRow {
  return { ...row };
}

export function QuotesMarket() {
  const toast = useToast();
  const isInWatchlist = useIsInWatchlist();
  const { settings } = useAppSettings();
  const {
    tracks,
    softVersion,
    completedLanes,
    requestSyncMarket,
    requestSyncLane,
  } = useSyncStatus();
  const [navTree, setNavTree] = useState<TushareNavGroup[]>(FALLBACK_TREE);
  const markets = useMemo(() => flattenNav(navTree), [navTree]);
  const [market, setMarket] = useState<MarketId>('cn');
  const [rows, setRows] = useState<TopicRow[]>([]);
  const [activeColumns, setActiveColumns] = useState<TushareCol[]>(COLUMNS);
  const [tableKind, setTableKind] = useState<'quote' | 'topic'>('quote');
  const [tradeDate, setTradeDate] = useState('');
  const [tradeDateInput, setTradeDateInput] = useState('');
  const [placeholderHint, setPlaceholderHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [loadHint, setLoadHint] = useState('加载中…');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [cacheMeta, setCacheMeta] = useState<CacheSnapshotMeta | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<1 | -1>(DEFAULT_SORT.dir);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  /** 刷新后下一次补行情跳过服务端日 K 缓存 */
  const forceQuotesRef = useRef(false);
  /** 离开美股前记住的非美股排序，切回其他市场时恢复 */
  const nonUsSortRef = useRef<SortState>(DEFAULT_SORT);
  const marketLane = laneOf(market);
  const laneTrack = tracks.find((t) => t.lane === marketLane);
  const nodeSyncing = Boolean(laneTrack?.active);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cat = await fetchTushareCatalog();
      if (!cancelled && cat?.tree?.length) setNavTree(cat.tree);
      const td = await fetchTushareTradeDate();
      if (!cancelled && td.trade_date) {
        setTradeDate(td.trade_date);
        setTradeDateInput(td.trade_date);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMarket = useCallback(
    async (m: MarketId, force = false, dateOverride?: string, soft = false) => {
      const def = markets.find((x) => x.id === m);
      const label = def?.label || String(m);
      if (!soft) {
        setLoading(true);
        setPageLoading(false);
        setError('');
        setCacheMeta(null);
        setPlaceholderHint('');
        setProgress({ done: 0, total: 0 });
      }

      // 占位节点
      if (def?.kind === 'placeholder' || m.startsWith('ts:ph:')) {
        setRows([]);
        setTableKind('topic');
        setActiveColumns([]);
        setPlaceholderHint(def?.hint || '一期占位，后续迭代开通');
        setLoadHint(label);
        setLoading(false);
        return;
      }

      // Tushare 专题 / 新市场
      if (isTushareMarketId(m)) {
        const td = dateOverride || tradeDateInput || tradeDate;
        if (!soft) setLoadHint(`正在加载${label}${td ? `（${td}）` : ''}…`);
        try {
          const data = await fetchTushareMarket(m, td || undefined);
          if (!data.ok) {
            if (!soft) {
              setRows([]);
              setError(data.error || '加载失败');
              setActiveColumns(COLUMNS);
              setTableKind('topic');
            }
            return;
          }
          if (data.placeholder) {
            setRows([]);
            setPlaceholderHint(data.hint || '一期占位');
            setActiveColumns([]);
            setTableKind('topic');
            setLoadHint(label);
            return;
          }
          if (data.trade_date) {
            setTradeDate(data.trade_date);
            setTradeDateInput(data.trade_date);
          }
          const cols = (data.columns && data.columns.length ? data.columns : COLUMNS) as TushareCol[];
          setActiveColumns(cols);
          setTableKind((data.table as 'quote' | 'topic') || 'topic');
          setRows((data.items || []) as TopicRow[]);
          setCacheMeta({
            asOf: typeof data.as_of === 'number' ? data.as_of : Date.now() / 1000,
            syncedAt:
              typeof data.synced_at === 'number' ? data.synced_at : Date.now() / 1000,
            stale: Boolean(data.stale),
            syncing: Boolean(data.syncing),
            source: data.source ? `tushare:${data.source}` : 'tushare',
            total: data.total || (data.items || []).length,
          });
          if (!soft) setPage(1);
          setLoadHint(`${label}加载完成（${data.total ?? data.items?.length ?? 0} 条）`);
          setProgress({
            done: data.total || 0,
            total: data.total || 0,
          });
        } catch (e) {
          if (!soft) {
            setRows([]);
            setError(e instanceof Error ? e.message : String(e));
          }
        } finally {
          if (!soft) setLoading(false);
        }
        return;
      }

      // 本地 cache / sdk 原路径
      const fullSnap = m === 'cn' || m === 'hk' || m === 'us';
      if (!soft) {
        setActiveColumns(COLUMNS);
        setTableKind('quote');
        setLoadHint(
          force
            ? `正在刷新${label}本地缓存…`
            : fullSnap
              ? `正在加载${label}行情（本地缓存）…`
              : `正在加载${label}列表…`
        );
      }
      try {
        const { rows: next, meta } = await loadMarketRows(
          m,
          (done, total) => {
            setProgress({ done, total });
            setLoadHint(`正在同步${label}行情 ${done}/${total}…`);
          },
          force
        );
        setRows(next.map(quoteToTopic));
        setCacheMeta(meta);
        if (!soft) setPage(1);
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
        if (!soft) {
          setRows([]);
          setCacheMeta(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!soft) setLoading(false);
      }
    },
    [markets, tradeDate, tradeDateInput]
  );

  useEffect(() => {
    loadMarket(market, false);
    // 仅市场切换触发；交易日由手动应用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  // 后台同步完成后 softReload 当前市场（无蒙层）
  useEffect(() => {
    if (!softVersion || !completedLanes.length) return;
    if (!completedLanes.includes(marketLane)) return;
    void loadMarket(market, false, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softVersion]);

  const handleRefresh = () => {
    if (loading || pageLoading) return;
    forceQuotesRef.current = true;
    void loadMarket(market, true);
  };

  const handleSyncNode = useCallback(async () => {
    if (nodeSyncing || marketLane === 'placeholder') return;
    try {
      await requestSyncMarket(
        market,
        isTushareMarketId(market)
          ? { tradeDate: tradeDateInput || tradeDate || undefined }
          : undefined
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [
    nodeSyncing,
    marketLane,
    requestSyncMarket,
    market,
    tradeDateInput,
    tradeDate,
    toast,
  ]);

  const handleSyncCurrentLane = useCallback(async () => {
    if (nodeSyncing || marketLane === 'placeholder') return;
    try {
      await requestSyncLane(marketLane);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [nodeSyncing, marketLane, requestSyncLane, toast]);

  // 仅首次空表加载显示蒙层；同步绝不挡 UI
  const showOverlay = (loading || pageLoading) && rows.length === 0 && !placeholderHint;
  const overlayDone = progress.done;
  const overlayTotal = progress.total;
  const progressPct =
    overlayTotal > 0
      ? Math.min(100, Math.round((overlayDone / overlayTotal) * 1000) / 10)
      : loading
        ? 8
        : 0;
  const overlayHint = loadHint;
  const overlayMeta =
    overlayTotal > 0 ? `${overlayDone} / ${overlayTotal}（${progressPct}%）` : '准备中…';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const code = String(r.code ?? '').toLowerCase();
      const name = String(r.name ?? '').toLowerCase();
      const kline = String(r.klineSymbol ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || kline.includes(q);
    });
  }, [rows, query]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pageNeedRows = useMemo(() => {
    if (!isLegacyMarket(market) || market === 'cn' || market === 'hk' || market === 'us') {
      return [] as QuoteRow[];
    }
    return pageRows
      .filter((r) => r.quoteReady === false)
      .map((r) => r as unknown as QuoteRow);
  }, [market, pageRows]);
  const pageNeedKey = pageNeedRows.map((r) => r.code).join(',');

  // 本地 lazy 市场：先出列表，再补当前页行情
  useEffect(() => {
    if (!isLegacyMarket(market) || !pageNeedKey) {
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
        setRows((prev) =>
          mergeQuoteMap(
            prev.map((x) => x as unknown as QuoteRow),
            map,
            needRows
          ).map(quoteToTopic)
        );
        void persistQuotesToCache(market, patched);
        setLoadHint('行情加载完成');
        setProgress({ done: needRows.length, total: needRows.length });
      } catch {
        if (!cancelled) {
          setRows((prev) =>
            mergeQuoteMap(
              prev.map((x) => x as unknown as QuoteRow),
              new Map(),
              needRows
            ).map(quoteToTopic)
          );
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

  // 后台按批补齐（仅本地 lazy 市场）
  useEffect(() => {
    if (!isLegacyMarket(market)) return;
    if (market === 'cn' || market === 'hk' || market === 'us') return;
    if (!rows.length) return;
    const pending = rows
      .filter((r) => r.quoteReady === false)
      .map((r) => r as unknown as QuoteRow);
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
          setRows((prev) =>
            mergeQuoteMap(
              prev.map((x) => x as unknown as QuoteRow),
              map,
              chunk
            ).map(quoteToTopic)
          );
          void persistQuotesToCache(market, patched);
        } catch {
          if (!cancelled) {
            setRows((prev) =>
              mergeQuoteMap(
                prev.map((x) => x as unknown as QuoteRow),
                new Map(),
                chunk
              ).map(quoteToTopic)
            );
          }
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

  const openKline = (row: TopicRow) => {
    const sym = String(row.klineSymbol || row.code || '');
    if (!sym) {
      toast.info('当前行无可打开的 K 线标的');
      return;
    }
    const url = `/?symbol=${encodeURIComponent(sym)}&period=1d`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /** 用当前筛选排序结果打开多面板（可超一屏，多面板内翻页） */
  const openMultipanelFromPage = () => {
    const codes = sorted
      .map((r) => String(r.klineSymbol || r.code || ''))
      .filter(Boolean);
    if (!codes.length) {
      toast.info('当前列表暂无标的');
      return;
    }
    openMultipanel(codes, { period: '1d' });
  };

  const handleToggleWatchlist = (e: React.MouseEvent, row: TopicRow) => {
    e.stopPropagation();
    if (!isLegacyMarket(market)) {
      toast.info('Tushare 专题表暂不支持加入自选');
      return;
    }
    const code = watchlistCodeOf(row as unknown as QuoteRow, market);
    if (!code) {
      toast.info('当前市场暂不支持加入自选（自选主要面向 A 股）');
      return;
    }
    if (isInWatchlist(code)) {
      watchlistActions.remove(code);
      toast.success(`已将 ${String(row.name || code)} 移出自选`);
      return;
    }
    watchlistActions.add(code);
    toast.success(`已将 ${String(row.name || code)} 加入自选`);
  };

  const activeLabel = markets.find((m) => m.id === market)?.label || market;
  const showTradeDate = isTushareMarketId(market);
  const canSyncNode = marketLane !== 'placeholder';

  const applyTradeDate = () => {
    const d = tradeDateInput.replace(/\D/g, '');
    if (d.length !== 8) {
      toast.info('请输入 YYYYMMDD 交易日');
      return;
    }
    setTradeDate(d);
    setTradeDateInput(d);
    void loadMarket(market, true, d);
  };

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h3>行情分类</h3>
          <button
            type="button"
            className={styles.syncAllBtn}
            onClick={() => void handleSyncCurrentLane()}
            disabled={nodeSyncing || marketLane === 'placeholder'}
            title={`同步本轨：${LANE_META[marketLane].title}（进度见顶栏）`}
          >
            <Layers size={13} />
            同步本轨
          </button>
        </div>
        <div className={styles.navScroll}>
          {navTree.map((g) => (
            <div key={g.id} className={styles.groupBlock}>
              <div className={styles.groupLabel}>{g.label}</div>
              {(g.children || []).map((m) => {
                const lane = laneOf(m.id);
                const meta = LANE_META[lane];
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`${styles.marketItem} ${market === m.id ? styles.active : ''}`}
                    onClick={() => selectMarket(m.id)}
                    title={`${meta.title} · ${m.id}`}
                  >
                    <span
                      className={styles.laneBadge}
                      style={{ background: meta.colorVar }}
                      aria-hidden
                    />
                    <span className={styles.marketLabel}>{m.label}</span>
                    <span className={styles.laneTag}>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      <div className={styles.main}>
        <Card
          title={`${activeLabel}行情`}
          extra={
            <div className={styles.toolbar}>
              {showTradeDate && (
                <div className={styles.tradeDateBox}>
                  <input
                    className={styles.tradeDateInput}
                    value={tradeDateInput}
                    onChange={(e) => setTradeDateInput(e.target.value)}
                    placeholder="YYYYMMDD"
                    title="Tushare 交易日"
                  />
                  <button
                    type="button"
                    className={styles.refreshBtn}
                    onClick={applyTradeDate}
                    disabled={loading}
                  >
                    应用日期
                  </button>
                </div>
              )}
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
                disabled={loading || pageRows.length === 0 || tableKind !== 'quote'}
                title="用当前筛选列表打开多面板（超出一屏可翻页）"
              >
                <LayoutGrid size={14} />
                多面板
              </button>
              {canSyncNode && (
                <button
                  type="button"
                  className={styles.refreshBtn}
                  onClick={() => void handleSyncNode()}
                  disabled={nodeSyncing}
                  title="后台同步本节点（进度见顶栏，不打断浏览）"
                >
                  <Database size={14} className={nodeSyncing ? styles.spin : undefined} />
                  同步本节点
                </button>
              )}
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={handleRefresh}
                disabled={loading || pageLoading}
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
                  title={`模式 ${settings.cacheMode || 'balanced'} · 源 ${cacheMeta.source || '--'} · ${LANE_META[marketLane].title}`}
                >
                  {nodeSyncing || cacheMeta.syncing
                    ? '后台同步中 · '
                    : cacheMeta.stale
                      ? '缓存 · '
                      : ''}
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
          ) : placeholderHint ? (
            <Empty title={activeLabel} description={placeholderHint} />
          ) : !loading && sorted.length === 0 ? (
            <Empty
              title="暂无数据"
              description={
                showTradeDate
                  ? '该交易日可能无事件，或可换日期重试'
                  : '换一个市场或清空搜索试试'
              }
            />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.actionCol} />
                      {activeColumns.map((col) => {
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
                    {pageRows.map((row, index) => {
                      const wlCode = isLegacyMarket(market)
                        ? watchlistCodeOf(row as unknown as QuoteRow, market)
                        : null;
                      const starred = wlCode ? isInWatchlist(wlCode) : false;
                      return (
                        <tr
                          key={`${String(row.klineSymbol || "")}~${String(row.code || "")}~${String(row.tradeDate || row.reason || index)}`}
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
                          {activeColumns.map((col) => (
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
