/**
 * Stock SDK 服务层
 * 封装 SDK 调用，提供缓存与错误处理
 *
 * 单位契约：经本层出口的金额字段统一为——市值:亿元、成交额/资金流:万元。
 * 东财板块接口原样透传 f20/f6（单位:元），在本层归一；腾讯 FullQuote.amount(万)、
 * totalMarketCap(亿)、fundFlow(万) 原生即符合契约，直接透传。页面不得再自行换算。
 */

import { StockSDK } from 'stock-sdk';
import { MemoryCache } from 'stock-sdk/cache';
import type {
  ConceptBoardConstituent,
  DividendDetail,
  SearchResult as SDKSearchResult,
} from 'stock-sdk';
import { normalizeStockCode } from '@/utils/format';

export type SearchEntityType = 'stock' | 'industry' | 'concept' | 'unsupported';

export interface AppSearchResult extends SDKSearchResult {
  entityType: SearchEntityType;
  isSupported: boolean;
  route: string | null;
  typeLabel: string;
}

const SEARCH_CATEGORY_LABELS: Record<string, string> = {
  stock: '股票',
  index: '指数',
  fund: '基金',
  bond: '债券',
  futures: '期货',
  option: '期权',
  other: '其他',
};

export function getSearchTypeLabel(item: Pick<SDKSearchResult, 'type' | 'category'>): string {
  return SEARCH_CATEGORY_LABELS[item.category ?? ''] ?? item.type;
}

/**
 * 统一的搜索实体路由解析：搜索结果与历史记录共用，避免两处映射漂移。
 * '行业板块'/'概念板块' 分支仅为兼容旧版本存下的搜索历史（SDK v2 搜索不再返回板块实体）。
 */
export function resolveSearchRoute(item: {
  code: string;
  market?: string;
  type?: string;
}): { entityType: SearchEntityType; route: string | null } {
  if (item.type === '行业板块') {
    return { entityType: 'industry', route: `/boards/industry/${item.code}` };
  }
  if (item.type === '概念板块') {
    return { entityType: 'concept', route: `/boards/concept/${item.code}` };
  }

  const normalizedCode = normalizeStockCode(item.code);
  if (
    item.market &&
    ['sh', 'sz', 'bj'].includes(item.market.toLowerCase()) &&
    /^(sh|sz|bj)\d{6}$/i.test(normalizedCode)
  ) {
    return { entityType: 'stock', route: `/s/${normalizedCode}` };
  }

  return { entityType: 'unsupported', route: null };
}

// SDK 单例
export const sdk = new StockSDK({
  timeout: 30000,
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },
  rateLimit: {
    requestsPerSecond: 4,
    maxBurst: 8,
  },
  circuitBreaker: {
    failureThreshold: 8,
    resetTimeout: 30000,
    halfOpenRequests: 1,
  },
});

// 内存缓存
const cache = new MemoryCache<unknown>({ maxSize: 300 });

// 默认 TTL 配置（毫秒）
// 优化：增加缓存时间以减少 API 请求频率
const DEFAULT_TTL = {
  boardList: 60000, // 板块列表 60s（从 30s 增加）
  constituents: 180000, // 成分股 3min（从 2min 增加）
  historyKline: 600000, // 历史 K 线 10min
  indicatorKline: 600000, // 指标 K 线 10min
  quotes: 5000, // 实时行情 5s（从 3s 增加）
  fundFlow: 30000, // 资金流 30s（从 10s 增加）
  timeline: 5000, // 分时 5s（从 3s 增加）
  dividends: 21600000, // 分红数据 6h
  capitalHistory: 30000, // 资金流历史 30s
  northbound: 30000, // 北向资金 30s
  stockChanges: 15000, // 异动池 15s
  boardChanges: 30000, // 板块异动 30s
  dragonTiger: 3600000, // 龙虎榜 1h
  blockTrade: 3600000, // 大宗交易 1h
  margin: 21600000, // 融资融券 6h
  marketSnapshot: 60000, // 全市场快照 60s（约 10+ 请求/次，Dashboard/Scanner/analysis 共享）
};

function normalizeSearchResult(item: SDKSearchResult): AppSearchResult {
  const typeLabel = getSearchTypeLabel(item);
  // 详情页只接入了 A 股股票/指数；基金、债券等 category 一律标记不支持
  const categorySupported =
    item.category === undefined || ['stock', 'index'].includes(item.category);
  const { entityType, route } = categorySupported
    ? resolveSearchRoute(item)
    : { entityType: 'unsupported' as const, route: null };

  if (entityType === 'stock' && route) {
    return {
      ...item,
      code: normalizeStockCode(item.code),
      entityType,
      isSupported: true,
      route,
      typeLabel,
    };
  }

  return {
    ...item,
    entityType: 'unsupported',
    isSupported: false,
    route: null,
    typeLabel,
  };
}

/**
 * 生成缓存键
 */
function getCacheKey(method: string, ...args: unknown[]): string {
  return `${method}:${JSON.stringify(args)}`;
}

/**
 * 带缓存的 SDK 调用包装器
 */
function withCache<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  return cache.getOrFetch(key, fetcher, ttl) as Promise<T>;
}

// ========== 实时行情 API ==========

/**
 * 获取完整行情（A股/指数）
 */
export async function getFullQuotes(codes: string[], useCache = true) {
  const key = getCacheKey('getFullQuotes', codes);
  if (useCache) {
    return withCache(key, DEFAULT_TTL.quotes, () => sdk.quotes.cn(codes));
  }
  return sdk.quotes.cn(codes);
}

/**
 * 批量获取行情
 */
export async function getAllQuotesByCodes(
  codes: string[],
  options?: {
    batchSize?: number;
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }
) {
  return sdk.batch.byCodes(codes, options);
}

/**
 * 获取全部 A 股行情（60s 快照缓存；缓存命中时 onProgress 不会触发）
 */
export async function getAllAShareQuotes(options?: {
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
  force?: boolean;
}) {
  const key = getCacheKey('getAllAShareQuotes', options?.batchSize, options?.concurrency);
  if (options?.force) cache.delete(key);
  const result = await withCache(key, DEFAULT_TTL.marketSnapshot, () =>
    sdk.batch.cn({
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
      onProgress: options?.onProgress,
    })
  );
  // 缓存命中时补一次完成进度，便于 UI 蒙板收尾
  if (options?.onProgress && Array.isArray(result) && result.length) {
    options.onProgress(result.length, result.length);
  }
  return result;
}

/** 全部港股行情快照 */
export async function getAllHKQuotes(options?: {
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
  force?: boolean;
}) {
  const key = getCacheKey('getAllHKQuotes', options?.batchSize, options?.concurrency);
  if (options?.force) cache.delete(key);
  const result = await withCache(key, DEFAULT_TTL.marketSnapshot, () =>
    sdk.batch.hk({
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
      onProgress: options?.onProgress,
    })
  );
  if (options?.onProgress && Array.isArray(result) && result.length) {
    options.onProgress(result.length, result.length);
  }
  return result;
}

/** 全部美股行情快照 */
export async function getAllUSQuotes(options?: {
  batchSize?: number;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
  force?: boolean;
}) {
  const key = getCacheKey('getAllUSQuotes', options?.batchSize, options?.concurrency);
  if (options?.force) cache.delete(key);
  const result = await withCache(key, DEFAULT_TTL.marketSnapshot, () =>
    sdk.batch.us({
      batchSize: options?.batchSize,
      concurrency: options?.concurrency,
      onProgress: options?.onProgress,
    })
  );
  if (options?.onProgress && Array.isArray(result) && result.length) {
    options.onProgress(result.length, result.length);
  }
  return result;
}

/** 代码列表（轻量，用于行情页先出表再按页补齐） */
export async function getCnCodeList() {
  return withCache(getCacheKey('codes.cn'), 600000, () => sdk.codes.cn());
}

export async function getHkCodeList() {
  return withCache(getCacheKey('codes.hk'), 600000, () => sdk.codes.hk());
}

export async function getUsCodeList() {
  return withCache(getCacheKey('codes.us'), 600000, () => sdk.codes.us({ simple: true }));
}

export async function getFundCodeList() {
  return withCache(getCacheKey('codes.fund'), 600000, () => sdk.codes.fund());
}

export async function getFundQuotes(codes: string[]) {
  return sdk.quotes.fund(codes);
}

export async function getHkQuotes(codes: string[]) {
  return sdk.quotes.hk(codes);
}

export async function getUsQuotes(codes: string[]) {
  return sdk.quotes.us(codes);
}

/** 国内期货主连：无独立 quotes，用最近日 K 近似（东财 push2his，偶发不可达） */
export async function getFuturesLastBar(symbol: string) {
  const rows = await sdk.futures.kline(symbol, { period: 'daily' });
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[rows.length - 1];
}

/** 全球期货实时行情（文档 futures.globalSpot；东财源） */
export async function getFuturesGlobalSpot(options?: { pageSize?: number; force?: boolean }) {
  const key = getCacheKey('futures.globalSpot', options?.pageSize);
  if (options?.force) cache.delete(key);
  return withCache(key, DEFAULT_TTL.quotes, () =>
    sdk.futures.globalSpot({ pageSize: options?.pageSize })
  );
}

/** 东财期货交易所 market id（主连/合约列表，CORS *，push2 不通时仍可用） */
const FUTURES_EXCHANGE_MID: Record<string, number> = {
  SHFE: 113,
  DCE: 114,
  CZCE: 115,
  CFFEX: 8,
  INE: 142,
  GFEX: 225,
};

/** 中金所主连：目录用 IFM 等，futsseapi 用数字 dm */
const CFFEX_MAIN_ALIAS: Record<string, string> = {
  ifm: '040130',
  ihm: '070130',
  icm: '060130',
  imm: '150130',
  tfm: '050130',
  tm: '110130',
  tlm: '140130',
  tsm: '130130',
};

export interface DomesticFuturesSpot {
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  amount: number | null;
}

/**
 * 国内期货现货快照（futsseapi，按交易所一次拉全表）。
 * 目录主连码如 AUM/RBM 对应接口 dm=aum/rbm（大小写不敏感）。
 */
export async function getDomesticFuturesSpotMap(options?: {
  force?: boolean;
}): Promise<Map<string, DomesticFuturesSpot>> {
  const key = getCacheKey('futures.domesticSpot');
  if (options?.force) cache.delete(key);

  const cached = await withCache(key, DEFAULT_TTL.quotes, async () => {
    const mids = Object.values(FUTURES_EXCHANGE_MID);
    const field = 'dm,sc,name,p,zde,zdf,o,h,l,zjsj,vol,cje';
    const pages = await Promise.all(
      mids.map(async (mid) => {
        const url =
          `https://futsseapi.eastmoney.com/list/${mid}` +
          `?orderBy=zdf&sort=desc&pageSize=500&pageIndex=0` +
          `&token=12345678567890ab&field=${encodeURIComponent(field)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`futsseapi ${mid} HTTP ${res.status}`);
        const data = (await res.json()) as {
          list?: Array<Record<string, unknown>>;
        };
        return Array.isArray(data.list) ? data.list : [];
      })
    );

    const out: Record<string, DomesticFuturesSpot> = {};
    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '' || v === '-') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    for (const row of pages.flat()) {
      const dm = String(row.dm || '')
        .trim()
        .toLowerCase();
      if (!dm) continue;
      const amountYuan = num(row.cje);
      const spot: DomesticFuturesSpot = {
        code: dm.toUpperCase(),
        name: String(row.name || dm),
        price: num(row.p),
        change: num(row.zde),
        changePercent: num(row.zdf),
        open: num(row.o),
        high: num(row.h),
        low: num(row.l),
        prevClose: num(row.zjsj),
        volume: num(row.vol),
        amount: amountYuan != null ? amountYuan / 10000 : null,
      };
      out[dm] = spot;
    }
    // 目录码 IFM → 040130 等
    for (const [alias, dm] of Object.entries(CFFEX_MAIN_ALIAS)) {
      const hit = out[dm];
      if (hit) out[alias] = { ...hit, code: alias.toUpperCase() };
    }
    return out;
  });

  return new Map(Object.entries(cached));
}

// ========== K 线数据 API ==========

/**
 * 获取历史 K 线
 */
export async function getHistoryKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getHistoryKline', symbol, options);
  return withCache(key, DEFAULT_TTL.historyKline, () =>
    sdk.kline.cn(symbol, options)
  );
}

/**
 * 获取带指标的 K 线
 */
export async function getKlineWithIndicators(
  symbol: string,
  options?: Parameters<typeof sdk.kline.withIndicators>[1]
) {
  const key = getCacheKey('getKlineWithIndicators', symbol, options);
  return withCache(key, DEFAULT_TTL.indicatorKline, () =>
    sdk.kline.withIndicators(symbol, options)
  );
}

/**
 * 获取分钟 K 线
 */
export async function getMinuteKline(
  symbol: string,
  options?: {
    period?: '1' | '5' | '15' | '30' | '60';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  return sdk.kline.cnMinute(symbol, options);
}

/**
 * 获取当日分时
 */
export async function getTodayTimeline(code: string) {
  return sdk.quotes.timeline(code);
}

// ========== 板块 API ==========

// 东财板块口径归一：f20(元)→亿、f6(元)→万，对齐本层单位契约
function normalizeBoardUnits<T extends { totalMarketCap: number | null }>(board: T): T {
  return {
    ...board,
    totalMarketCap:
      board.totalMarketCap === null ? null : board.totalMarketCap / 1e8,
  };
}

function normalizeConstituentUnits<T extends { amount: number | null }>(row: T): T {
  return {
    ...row,
    amount: row.amount === null ? null : row.amount / 1e4,
  };
}

export type BoardDataSource = 'eastmoney' | 'ths' | 'all' | 'sina';

export type BoardListItem = {
  rank: number;
  code: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  totalMarketCap: number | null;
  turnoverRate: number | null;
  riseCount: number | null;
  fallCount: number | null;
  leadingStock: string | null;
  leadingStockChangePercent: number | null;
  source?: BoardDataSource | string;
  sources?: string[];
};

export type StockConceptSource = 'eastmoney' | 'ths' | string;

export type StockConceptItem = {
  name: string;
  sources: StockConceptSource[];
  kinds?: string[];
};

/** 本机代理：支持 source=eastmoney|ths|all */
async function fetchBoardListFromServer(
  type: 'industry' | 'concept',
  source: BoardDataSource = 'eastmoney'
): Promise<BoardListItem[]> {
  const res = await fetch(
    `/api/board/list?type=${encodeURIComponent(type)}&source=${encodeURIComponent(source)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.items)) {
    throw new Error(data?.error || `board list ${res.status}`);
  }
  return data.items as BoardListItem[];
}

async function loadBoardList(
  type: 'industry' | 'concept',
  source: BoardDataSource = 'eastmoney'
) {
  // 优先本机代理：东财不通时服务端秒级回退新浪；避免浏览器直连 push2 长时间重试导致面板空白
  try {
    const items = await fetchBoardListFromServer(type, source);
    if (items.length > 0) {
      return items.map((item) =>
        normalizeBoardUnits({
          ...item,
          riseCount: item.riseCount ?? null,
          fallCount: item.fallCount ?? null,
        })
      );
    }
  } catch (error) {
    console.warn(`[sdk] /api/board/list ${type} source=${source} failed`, error);
  }

  if (source === 'ths' || source === 'all') {
    return [];
  }

  const rows =
    type === 'industry'
      ? await sdk.board.industry.list()
      : await sdk.board.concept.list();
  return (rows || []).map(normalizeBoardUnits);
}

/**
 * 获取行业板块列表
 */
export async function getIndustryList(source: BoardDataSource = 'eastmoney') {
  const key = getCacheKey('getIndustryList', source);
  return withCache(key, DEFAULT_TTL.boardList, () => loadBoardList('industry', source));
}

/**
 * 获取概念板块列表（source: eastmoney | ths | all）
 */
export async function getConceptList(source: BoardDataSource = 'eastmoney') {
  const key = getCacheKey('getConceptList', source);
  return withCache(key, DEFAULT_TTL.boardList, () => loadBoardList('concept', source));
}

function mapDbConstituents(
  items: BoardDetailDb['items']
): ConceptBoardConstituent[] {
  return (items || []).map((row) =>
    normalizeConstituentUnits({
      rank: row.rank,
      code: row.code,
      name: row.name,
      price: row.price,
      changePercent: row.changePercent,
      amount: row.amount ?? null,
      turnoverRate: row.turnoverRate ?? null,
      pe: row.pe ?? null,
    } as ConceptBoardConstituent)
  );
}

function isDbBoardCode(code: string): boolean {
  const c = decodeURIComponent(String(code || '').trim());
  return c.startsWith('ths:') || /^BK\d+/i.test(c);
}

/**
 * 获取行业成分股（BK 优先本库）
 */
export async function getIndustryConstituents(symbol: string) {
  const code = String(symbol || '').trim();
  if (isDbBoardCode(code)) {
    const key = getCacheKey('getIndustryConstituentsDb', code);
    return withCache(key, DEFAULT_TTL.constituents, async () => {
      try {
        const detail = await getBoardDetailFromDb('industry', decodeURIComponent(code));
        const mapped = mapDbConstituents(detail.items);
        if (mapped.length > 0) return mapped;
      } catch {
        /* fallback sdk */
      }
      return (await sdk.board.industry.constituents(symbol)).map(normalizeConstituentUnits);
    });
  }
  const key = getCacheKey('getIndustryConstituents', symbol);
  return withCache(key, DEFAULT_TTL.constituents, async () =>
    (await sdk.board.industry.constituents(symbol)).map(normalizeConstituentUnits)
  );
}

/**
 * 获取概念成分股（ths:/BK 优先本库）
 */
export async function getConceptConstituents(
  symbol: string
): Promise<ConceptBoardConstituent[]> {
  const code = String(symbol || '').trim();
  if (isDbBoardCode(code)) {
    const key = getCacheKey('getConceptConstituentsDb', code);
    return withCache(key, DEFAULT_TTL.constituents, async () => {
      try {
        const detail = await getBoardDetailFromDb('concept', decodeURIComponent(code));
        const mapped = mapDbConstituents(detail.items);
        if (mapped.length > 0) return mapped;
      } catch {
        /* fallback sdk */
      }
      if (code.startsWith('ths:') || code.startsWith('ths%3A')) {
        throw new Error('同花顺概念库内成份为空');
      }
      return (await sdk.board.concept.constituents(symbol)).map(normalizeConstituentUnits);
    });
  }
  const key = getCacheKey('getConceptConstituents', symbol);
  return withCache(key, DEFAULT_TTL.constituents, async () =>
    (await sdk.board.concept.constituents(symbol)).map(normalizeConstituentUnits)
  );
}

export type BoardDetailDb = {
  board: BoardListItem & { memberCount?: number; nameKey?: string; statsSource?: string };
  items: Array<{
    rank: number;
    code: string;
    name: string;
    price: number | null;
    changePercent: number | null;
    amount?: number | null;
    turnoverRate?: number | null;
    pe?: number | null;
  }>;
};

/** 本库概念详情（同花顺成份聚合） */
export async function getBoardDetailFromDb(
  type: 'concept' | 'industry',
  code: string
): Promise<BoardDetailDb> {
  const res = await fetch(
    `/api/board/detail?type=${encodeURIComponent(type)}&code=${encodeURIComponent(code)}&source=auto`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !data.board) {
    throw new Error(data?.error || `board detail ${res.status}`);
  }
  return {
    board: data.board as BoardDetailDb['board'],
    items: (data.items || []) as BoardDetailDb['items'],
  };
}

/**
 * 获取行业 K 线
 */
export async function getIndustryKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getIndustryKline', symbol, options);
  return withCache(key, DEFAULT_TTL.historyKline, () =>
    sdk.board.industry.kline(symbol, options)
  );
}

/**
 * 获取概念 K 线
 */
export async function getConceptKline(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getConceptKline', symbol, options);
  return withCache(key, DEFAULT_TTL.historyKline, () =>
    sdk.board.concept.kline(symbol, options)
  );
}

/**
 * 获取行业分钟 K 线
 */
export async function getIndustryMinuteKline(
  symbol: string,
  options?: { period?: '1' | '5' | '15' | '30' | '60' }
) {
  return sdk.board.industry.minuteKline(symbol, options);
}

/**
 * 获取概念分钟 K 线
 */
export async function getConceptMinuteKline(
  symbol: string,
  options?: { period?: '1' | '5' | '15' | '30' | '60' }
) {
  return sdk.board.concept.minuteKline(symbol, options);
}

/**
 * 获取行业 Spot 指标
 */
export async function getIndustrySpot(symbol: string) {
  return sdk.board.industry.spot(symbol);
}

/**
 * 获取概念 Spot 指标
 */
export async function getConceptSpot(symbol: string) {
  return sdk.board.concept.spot(symbol);
}

// ========== 资金与大单 API ==========

/**
 * 获取资金流向
 */
export async function getFundFlow(codes: string[]) {
  const key = getCacheKey('getFundFlow', codes);
  return withCache(key, DEFAULT_TTL.fundFlow, () => sdk.quotes.fundFlow(codes));
}

/**
 * 获取盘口大单
 */
export async function getPanelLargeOrder(codes: string[]) {
  const key = getCacheKey('getPanelLargeOrder', codes);
  return withCache(key, DEFAULT_TTL.fundFlow, () =>
    sdk.quotes.largeOrder(codes)
  );
}

/**
 * 获取个股历史资金流
 */
export async function getIndividualFundFlow(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
  }
) {
  const key = getCacheKey('getIndividualFundFlow', symbol, options);
  return withCache(key, DEFAULT_TTL.capitalHistory, () =>
    sdk.fundFlow.individual(symbol, options)
  );
}

/**
 * 获取大盘资金流
 */
export async function getMarketFundFlow() {
  const key = getCacheKey('getMarketFundFlow');
  return withCache(key, DEFAULT_TTL.capitalHistory, () => sdk.fundFlow.market());
}

/**
 * 获取个股资金流排行
 */
export async function getFundFlowRank(options?: {
  indicator?: 'today' | '3day' | '5day' | '10day';
}) {
  const key = getCacheKey('getFundFlowRank', options);
  return withCache(key, DEFAULT_TTL.fundFlow, () => sdk.fundFlow.rank(options));
}

/**
 * 获取板块资金流排行
 */
export async function getSectorFundFlowRank(options?: {
  indicator?: 'today' | '3day' | '5day' | '10day';
  sectorType?: 'industry' | 'concept' | 'region';
}) {
  const key = getCacheKey('getSectorFundFlowRank', options);
  return withCache(key, DEFAULT_TTL.fundFlow, () =>
    sdk.fundFlow.sectorRank(options)
  );
}

/**
 * 获取单个板块历史资金流
 */
export async function getSectorFundFlowHistory(
  symbol: string,
  options?: {
    period?: 'daily' | 'weekly' | 'monthly';
  }
) {
  const key = getCacheKey('getSectorFundFlowHistory', symbol, options);
  return withCache(key, DEFAULT_TTL.capitalHistory, () =>
    sdk.fundFlow.sectorHistory(symbol, options)
  );
}

/**
 * 获取北向/南向资金汇总
 */
export async function getNorthboundFlowSummary() {
  const key = getCacheKey('getNorthboundFlowSummary');
  return withCache(key, DEFAULT_TTL.northbound, () => sdk.northbound.summary());
}

/**
 * 获取北向/南向资金历史
 */
export async function getNorthboundHistory(
  direction: 'north' | 'south' = 'north',
  options?: {
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getNorthboundHistory', direction, options);
  return withCache(key, DEFAULT_TTL.northbound, () =>
    sdk.northbound.history(direction, options)
  );
}

/**
 * 获取个股北向持仓历史
 */
export async function getNorthboundIndividual(
  symbol: string,
  options?: {
    startDate?: string;
    endDate?: string;
  }
) {
  const key = getCacheKey('getNorthboundIndividual', symbol, options);
  return withCache(key, DEFAULT_TTL.northbound, () =>
    sdk.northbound.individual(symbol, options)
  );
}

/**
 * 获取涨停股池
 */
export async function getZTPool(
  type: 'zt' | 'yesterday' | 'strong' | 'sub_new' | 'broken' | 'dt' = 'zt',
  date?: string
) {
  const key = getCacheKey('getZTPool', type, date);
  return withCache(key, DEFAULT_TTL.stockChanges, () => sdk.marketEvent.ztPool(type, date));
}

/**
 * 获取盘口异动
 */
export async function getStockChanges(
  type:
    | 'rocket_launch'
    | 'quick_rebound'
    | 'large_buy'
    | 'limit_up_seal'
    | 'limit_down_open'
    | 'big_buy_order'
    | 'auction_up'
    | 'high_open_5d'
    | 'gap_up'
    | 'high_60d'
    | 'surge_60d'
    | 'accelerate_down'
    | 'high_dive'
    | 'large_sell'
    | 'limit_down_seal'
    | 'limit_up_open'
    | 'big_sell_order'
    | 'auction_down'
    | 'low_open_5d'
    | 'gap_down'
    | 'low_60d'
    | 'drop_60d' = 'large_buy'
) {
  const key = getCacheKey('getStockChanges', type);
  return withCache(key, DEFAULT_TTL.stockChanges, () => sdk.marketEvent.stockChanges(type));
}

/**
 * 获取板块异动
 */
export async function getBoardChanges() {
  const key = getCacheKey('getBoardChanges');
  return withCache(key, DEFAULT_TTL.boardChanges, () => sdk.marketEvent.boardChanges());
}

/**
 * 获取龙虎榜详情
 */
export async function getDragonTigerDetail(options: {
  startDate: string;
  endDate: string;
}) {
  const key = getCacheKey('getDragonTigerDetail', options);
  return withCache(key, DEFAULT_TTL.dragonTiger, () => sdk.dragonTiger.detail(options));
}

/**
 * 获取大宗交易明细
 */
export async function getBlockTradeDetail(options?: {
  startDate?: string;
  endDate?: string;
}) {
  const key = getCacheKey('getBlockTradeDetail', options);
  return withCache(key, DEFAULT_TTL.blockTrade, () => sdk.blockTrade.detail(options));
}

/**
 * 获取融资融券账户统计
 */
export async function getMarginAccountInfo() {
  const key = getCacheKey('getMarginAccountInfo');
  return withCache(key, DEFAULT_TTL.margin, () => sdk.margin.accountInfo());
}

// ========== 搜索 API ==========

/**
 * 搜索股票/板块
 * @param keyword - 搜索关键词
 * @returns 搜索结果列表
 */
export async function search(keyword: string) {
  const results = await sdk.search(keyword);
  return results.map(normalizeSearchResult);
}

/**
 * 批量查询所属行业（经本机 /api/stock-industries 代理东财 f100）
 * 返回纯数字代码 → 行业名
 */
export async function getStockIndustries(codes: string[]): Promise<Record<string, string>> {
  const unique = [
    ...new Set(
      codes
        .map((c) => normalizeStockCode(c).replace(/^(sh|sz|bj)/i, ''))
        .filter(Boolean)
    ),
  ];
  if (!unique.length) return {};

  const cacheKey = getCacheKey('getStockIndustries', unique.slice().sort());
  return withCache(cacheKey, 10 * 60 * 1000, async () => {
    const url = `/api/stock-industries?codes=${encodeURIComponent(unique.join(','))}`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const payload = (await res.json()) as {
      ok?: boolean;
      industries?: Record<string, string>;
    };
    return payload.ok ? payload.industries ?? {} : {};
  });
}

function mapConceptPayload(
  concepts: Record<string, StockConceptItem[] | string[]> | undefined
): Record<string, StockConceptItem[]> {
  const mapped: Record<string, StockConceptItem[]> = {};
  if (!concepts) return mapped;
  for (const [code, items] of Object.entries(concepts)) {
    if (!items?.length) continue;
    if (typeof items[0] === 'string') {
      mapped[code] = (items as string[]).map((name) => ({
        name,
        sources: ['eastmoney'],
      }));
    } else {
      mapped[code] = items as StockConceptItem[];
    }
  }
  return mapped;
}

/**
 * 按个股批量查询所属概念（优先读库；缺失再联网）。category 默认概念。
 */
export async function getStockConcepts(
  codes: string[],
  category: 'concept' | 'board' | 'all' = 'concept'
): Promise<Record<string, StockConceptItem[]>> {
  const unique = [
    ...new Set(
      codes
        .map((c) => normalizeStockCode(c).replace(/^(sh|sz|bj)/i, ''))
        .filter(Boolean)
    ),
  ];
  if (!unique.length) return {};

  const out: Record<string, StockConceptItem[]> = {};
  const chunkSize = 40;

  const fetchChunk = async (
    chunk: string[]
  ): Promise<Record<string, StockConceptItem[]>> => {
    // 1) 优先本地库
    try {
      const dbRes = await fetch(
        `/api/cache/board-concepts/stock?category=${encodeURIComponent(category)}&codes=${encodeURIComponent(chunk.join(','))}`
      );
      if (dbRes.ok) {
        const dbPayload = (await dbRes.json()) as {
          ok?: boolean;
          concepts?: Record<string, StockConceptItem[]>;
          boards?: Record<string, StockConceptItem[]>;
          items?: Record<string, StockConceptItem[]>;
        };
        if (dbPayload.ok) {
          const fromDb =
            category === 'board'
              ? dbPayload.boards
              : category === 'all'
                ? dbPayload.items
                : dbPayload.concepts;
          const mapped = mapConceptPayload(fromDb);
          const missing = chunk.filter((c) => !mapped[c]?.length);
          if (!missing.length) return mapped;
          // 库缺的再走统一接口补齐
          const liveRes = await fetch(
            `/api/stock-concepts?category=${encodeURIComponent(category)}&codes=${encodeURIComponent(missing.join(','))}`
          );
          if (liveRes.ok) {
            const livePayload = (await liveRes.json()) as {
              ok?: boolean;
              concepts?: Record<string, StockConceptItem[] | string[]>;
              boards?: Record<string, StockConceptItem[] | string[]>;
              items?: Record<string, StockConceptItem[] | string[]>;
            };
            const liveBucket =
              category === 'board'
                ? livePayload.boards
                : category === 'all'
                  ? livePayload.items
                  : livePayload.concepts;
            Object.assign(mapped, mapConceptPayload(liveBucket));
          }
          return mapped;
        }
      }
    } catch {
      /* fall through */
    }

    const res = await fetch(
      `/api/stock-concepts?category=${encodeURIComponent(category)}&codes=${encodeURIComponent(chunk.join(','))}`
    );
    if (!res.ok) return {};
    const payload = (await res.json()) as {
      ok?: boolean;
      concepts?: Record<string, StockConceptItem[] | string[]>;
      boards?: Record<string, StockConceptItem[] | string[]>;
      items?: Record<string, StockConceptItem[] | string[]>;
    };
    if (!payload.ok) return {};
    const bucket =
      category === 'board'
        ? payload.boards
        : category === 'all'
          ? payload.items
          : payload.concepts;
    return mapConceptPayload(bucket);
  };

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const cacheKey = getCacheKey(
      'getStockConceptsChunk',
      `${category}:${chunk.slice().sort().join(',')}`
    );
    let part = await withCache(cacheKey, 10 * 60 * 1000, () => fetchChunk(chunk));
    if (!Object.keys(part).length) {
      part = await fetchChunk(chunk);
    }
    Object.assign(out, part);
  }
  return out;
}

export type BoardConceptSyncProgress = {
  active: boolean;
  phase?: string;
  done?: number;
  total?: number;
  ok_count?: number;
  failed?: number;
  message?: string;
  synced_at?: number | null;
  last_error?: string | null;
};

/** 启动板块/概念全量入库同步 */
export async function startBoardConceptsSync(force = false): Promise<BoardConceptSyncProgress> {
  const res = await fetch(
    `/api/cache/board-concepts/sync?force=${force ? 1 : 0}`,
    { method: 'POST' }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `sync ${res.status}`);
  return data as BoardConceptSyncProgress;
}

export async function getBoardConceptsSyncProgress(): Promise<BoardConceptSyncProgress> {
  const res = await fetch('/api/cache/board-concepts/sync/progress');
  const data = await res.json().catch(() => ({}));
  return (data || {}) as BoardConceptSyncProgress;
}

export async function getBoardConceptsStats(): Promise<{
  catalog?: number;
  stocks?: number;
  concept_rows?: number;
  board_rows?: number;
}> {
  const res = await fetch('/api/cache/board-concepts/stats');
  const data = await res.json().catch(() => ({}));
  return data || {};
}

/** 按概念名反查成分股代码（读库，用于行情概念过滤） */
export async function getCodesByConceptNames(
  names: string[],
  options?: { category?: 'concept' | 'board' | 'all'; match?: 'and' | 'or' }
): Promise<string[]> {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!uniq.length) return [];
  const category = options?.category ?? 'concept';
  const match = options?.match ?? 'and';
  const res = await fetch(
    `/api/cache/board-concepts/by-name?category=${encodeURIComponent(category)}&match=${encodeURIComponent(match)}&names=${encodeURIComponent(uniq.join(','))}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.codes)) return [];
  return data.codes as string[];
}

/** 补同步北交所个股概念/板块 */
export async function startBoardConceptsBjSync(): Promise<BoardConceptSyncProgress & { codes?: number }> {
  const res = await fetch('/api/cache/board-concepts/sync-bj', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `sync-bj ${res.status}`);
  return data as BoardConceptSyncProgress & { codes?: number };
}

// ========== 其他 API ==========

/**
 * 获取分红派息详情
 */
export async function getDividendDetail(symbol: string): Promise<DividendDetail[]> {
  const key = getCacheKey('getDividendDetail', symbol);
  return withCache(key, DEFAULT_TTL.dividends, () => sdk.reference.dividendDetail(symbol));
}

/**
 * 获取交易日历
 */
export async function getTradingCalendar() {
  const key = getCacheKey('getTradingCalendar');
  return withCache(key, 3600000, () => sdk.reference.tradingCalendar()); // 1 小时缓存
}
