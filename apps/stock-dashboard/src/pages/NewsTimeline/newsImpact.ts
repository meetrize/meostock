/**
 * 资讯 → 交易日映射与日涨跌 / T+N 计算（按市场时区）
 */

export type KlineBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type SessionTag = 'pre' | 'session' | 'post' | 'weekend';

export type MarketKind = 'cn' | 'hk' | 'us' | 'other';

export type ImpactRow = {
  sessionTag: SessionTag;
  /** 消息映射到的交易日 YYYY-MM-DD */
  tradeDate: string;
  /** 当日涨跌幅 %（未收盘日可为实时涨跌） */
  t0: number | null;
  t1: number | null;
  t5: number | null;
  /** 相对「映射日」的说明 */
  mapLabel: '当日' | '次日' | '下交易日';
  /** 日线尚未落地（待开盘/待收盘），t0 可能来自实时行情 */
  pending?: boolean;
  t0Live?: boolean;
};

export type ImpactOptions = {
  market?: MarketKind;
  /** 今日未收盘时，用快照涨跌幅作为 T0 兜底 */
  liveChangePercent?: number | null;
};

type TzParts = { ymd: string; hour: number; minute: number; weekday: number };

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function inferMarketKind(symbol: string): MarketKind {
  const s = String(symbol || '').trim().toLowerCase();
  if (s.startsWith('hk') || /^\d{1,5}$/.test(s)) return 'hk';
  if (s.startsWith('us') || /^[a-z][a-z0-9.\-]{0,9}$/i.test(symbol)) return 'us';
  if (/^(sh|sz|bj)\d{6}$/.test(s) || /^\d{6}$/.test(s)) return 'cn';
  if (s.startsWith('yf:') || s.startsWith('fut:')) return 'other';
  return 'other';
}

function marketTimeZone(kind: MarketKind): string {
  if (kind === 'us') return 'America/New_York';
  if (kind === 'hk') return 'Asia/Hong_Kong';
  return 'Asia/Shanghai';
}

/** 收盘时刻（含）：该分钟起算盘后 */
function marketCloseMinutes(kind: MarketKind): number {
  if (kind === 'us') return 16 * 60; // 16:00 ET
  if (kind === 'hk') return 16 * 60; // 16:00 HKT
  return 15 * 60; // A 股 15:00
}

function marketOpenMinutes(_kind: MarketKind): number {
  return 9 * 60 + 30;
}

export function zonedParts(ms: number, timeZone: string): TzParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const wd = get('weekday');
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    ymd: `${y}-${m}-${d}`,
    hour,
    minute,
    weekday: weekdayMap[wd] ?? 0,
  };
}

export function zonedYmd(ms: number, timeZone: string): string {
  return zonedParts(ms, timeZone).ymd;
}

/** @deprecated 兼容旧调用：默认上海 */
export function shanghaiYmd(ms: number): string {
  return zonedYmd(ms, 'Asia/Shanghai');
}

export function shanghaiParts(ms: number): TzParts {
  return zonedParts(ms, 'Asia/Shanghai');
}

export function barYmd(bar: KlineBar, market: MarketKind = 'cn'): string {
  const ts = Number(bar.timestamp);
  const ms = ts > 1e12 ? ts : ts * 1000;
  return zonedYmd(ms, marketTimeZone(market));
}

export function buildDayIndex(bars: KlineBar[], market: MarketKind = 'cn'): Map<string, number> {
  const sorted = [...bars].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const map = new Map<string, number>();
  sorted.forEach((b, i) => map.set(barYmd(b, market), i));
  return map;
}

export function sortedBars(bars: KlineBar[]): KlineBar[] {
  return [...bars].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

function pct(prev: number, next: number): number | null {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === 0) return null;
  return ((next - prev) / prev) * 100;
}

function dayReturn(bars: KlineBar[], idx: number): number | null {
  if (idx <= 0 || idx >= bars.length) {
    if (idx === 0 && bars.length) {
      const b = bars[0];
      return pct(b.open, b.close);
    }
    return null;
  }
  return pct(bars[idx - 1].close, bars[idx].close);
}

function forwardReturn(bars: KlineBar[], fromIdx: number, n: number): number | null {
  const to = fromIdx + n;
  if (fromIdx < 0 || to >= bars.length) return null;
  return pct(bars[fromIdx].close, bars[to].close);
}

function addCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * 将发稿时间映射到「消息落地」交易日（市场本地时区）。
 * - 盘前：当日
 * - 盘中：当日
 * - 盘后 / 非交易日：下一交易日
 */
export function mapNewsToTradeDate(
  publishedAt: string | null | undefined,
  tradingDays: string[],
  market: MarketKind = 'cn',
): { tradeDate: string; sessionTag: SessionTag; mapLabel: ImpactRow['mapLabel'] } | null {
  if (!publishedAt) return null;
  const ms = new Date(publishedAt).getTime();
  if (!Number.isFinite(ms)) return null;

  const tz = marketTimeZone(market);
  const { ymd, hour, minute, weekday } = zonedParts(ms, tz);
  const mins = hour * 60 + minute;
  const openM = marketOpenMinutes(market);
  const closeM = marketCloseMinutes(market);
  const daySet = new Set(tradingDays);
  const lastDay = tradingDays.length ? tradingDays[tradingDays.length - 1] : '';

  const nextTrading = (fromYmd: string, inclusive: boolean): string | null => {
    const start = inclusive ? fromYmd : addCalendarDays(fromYmd, 1);
    for (const d of tradingDays) {
      if (d >= start) return d;
    }
    // 日线尚未覆盖：若目标不早于最后一根，视为「待落地」的未来交易日
    if (lastDay && start > lastDay) return start;
    // 日历空洞但晚于最后一根：用 start 本身占位
    if (lastDay && fromYmd > lastDay) return inclusive ? fromYmd : start;
    return null;
  };

  const isWeekend = weekday === 0 || weekday === 6;
  const isTradingCalendarDay = daySet.has(ymd);

  if (isWeekend || !isTradingCalendarDay) {
    // 周末 / 休市：下一交易日；若日线未到则占位到「下一日历日」供 pending 逻辑
    let td = nextTrading(ymd, false);
    if (!td && lastDay && ymd >= lastDay) {
      // 例如周五盘后无下一根、或今日尚未开盘无当日 bar
      td = isWeekend ? addCalendarDays(ymd, weekday === 6 ? 2 : 1) : ymd;
      // 周五→下周一
      if (weekday === 5 && mins >= closeM) td = addCalendarDays(ymd, 3);
      if (weekday === 6) td = addCalendarDays(ymd, 2);
      if (weekday === 0) td = addCalendarDays(ymd, 1);
    }
    if (!td) return null;
    return {
      tradeDate: td,
      sessionTag: isWeekend ? 'weekend' : 'post',
      mapLabel: '下交易日',
    };
  }

  if (mins < openM) {
    return { tradeDate: ymd, sessionTag: 'pre', mapLabel: '当日' };
  }
  if (mins >= closeM) {
    const td = nextTrading(ymd, false);
    if (!td) return null;
    return { tradeDate: td, sessionTag: 'post', mapLabel: '次日' };
  }
  return { tradeDate: ymd, sessionTag: 'session', mapLabel: '当日' };
}

export function computeImpact(
  publishedAt: string | null | undefined,
  barsAsc: KlineBar[],
  options: ImpactOptions = {},
): ImpactRow | null {
  const market = options.market || 'cn';
  if (!publishedAt) return null;

  const tradingDays = barsAsc.map((b) => barYmd(b, market));
  // 无日线时仍尝试用「今天」+ 实时涨跌
  if (!tradingDays.length) {
    const tz = marketTimeZone(market);
    const ms = new Date(publishedAt).getTime();
    if (!Number.isFinite(ms)) return null;
    const ymd = zonedYmd(ms, tz);
    const live = options.liveChangePercent;
    const liveOk = live != null && Number.isFinite(live);
    return {
      sessionTag: 'pre',
      tradeDate: ymd,
      t0: liveOk ? Number(live) : null,
      t1: null,
      t5: null,
      mapLabel: '当日',
      pending: true,
      t0Live: liveOk,
    };
  }

  const mapped = mapNewsToTradeDate(publishedAt, tradingDays, market);
  if (!mapped) return null;

  const idxMap = new Map(tradingDays.map((d, i) => [d, i]));
  const idx = idxMap.get(mapped.tradeDate);
  const lastDay = tradingDays[tradingDays.length - 1];

  if (idx == null) {
    const pending = !!lastDay && mapped.tradeDate > lastDay;
    const live = options.liveChangePercent;
    const liveOk = pending && live != null && Number.isFinite(live);
    return {
      sessionTag: mapped.sessionTag,
      tradeDate: mapped.tradeDate,
      t0: liveOk ? Number(live) : null,
      t1: null,
      t5: null,
      mapLabel: mapped.mapLabel,
      pending,
      t0Live: liveOk || undefined,
    };
  }

  return {
    sessionTag: mapped.sessionTag,
    tradeDate: mapped.tradeDate,
    t0: dayReturn(barsAsc, idx),
    t1: forwardReturn(barsAsc, idx, 1),
    t5: forwardReturn(barsAsc, idx, 5),
    mapLabel: mapped.mapLabel,
  };
}

export function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export type ReviewMark = 'bull' | 'bear' | 'priced' | '';

const REVIEW_KEY = 'meostock.newsReviewMarks.v1';

export function loadReviewMarks(symbol: string): Record<string, ReviewMark> {
  try {
    const raw = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') as Record<
      string,
      Record<string, ReviewMark>
    >;
    return raw[symbol] || {};
  } catch {
    return {};
  }
}

export function saveReviewMark(symbol: string, articleId: number, mark: ReviewMark) {
  try {
    const raw = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}') as Record<
      string,
      Record<string, ReviewMark>
    >;
    if (!raw[symbol]) raw[symbol] = {};
    if (!mark) delete raw[symbol][String(articleId)];
    else raw[symbol][String(articleId)] = mark;
    localStorage.setItem(REVIEW_KEY, JSON.stringify(raw));
  } catch {
    /* ignore */
  }
}
