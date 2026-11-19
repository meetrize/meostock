/**
 * 个股详情等：优先 /api/cache/kline 秒开，本地 addIndicators；失败再回退 stock-sdk。
 */

import { addIndicators, type HistoryKline, type IndicatorOptions } from 'stock-sdk';
import { getKlineWithIndicators } from '@/services/sdk';
import { getSettings } from '@/services/storage';
import type { KlinePeriod, QuoteSource } from '@/types';

const PERIOD_TO_CACHE: Record<KlinePeriod, string> = {
  daily: '1d',
  weekly: '1w',
  monthly: '1M',
};

function tsToShanghaiYmd(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function resolveSource(override?: QuoteSource): QuoteSource {
  if (override === 'auto' || override === 'local' || override === 'network') {
    return override;
  }
  const s = getSettings().quoteSource;
  return s === 'local' || s === 'network' ? s : 'auto';
}

function mapCacheBarsToHistory(
  symbol: string,
  bars: Array<Record<string, unknown>>
): HistoryKline[] {
  const code = symbol.replace(/^(sh|sz|bj|hk|us)/i, '') || symbol;
  const out: HistoryKline[] = [];
  for (const b of bars) {
    const ts = Number(b.timestamp);
    const date =
      (typeof b.date === 'string' && b.date.slice(0, 10)) ||
      (Number.isFinite(ts) ? tsToShanghaiYmd(ts) : '');
    if (!date) continue;
    const open = Number(b.open);
    const close = Number(b.close);
    const high = Number(b.high);
    const low = Number(b.low);
    if (![open, close, high, low].every(Number.isFinite)) continue;
    const volume = Number(b.volume);
    const amount = Number(b.amount);
    out.push({
      date,
      timestamp: Number.isFinite(ts) ? ts : null,
      tz: 'Asia/Shanghai',
      code,
      open,
      close,
      high,
      low,
      volume: Number.isFinite(volume) ? volume : null,
      amount: Number.isFinite(amount) ? amount : null,
      amplitude: null,
      changePercent: null,
      change: null,
      turnoverRate: null,
    });
  }
  return out;
}

/**
 * 日/周/月 K + 指标：local_first 读本机缓存后本地算指标；无缓存再走 sdk。
 */
export async function getKlineWithIndicatorsPreferCache(
  symbol: string,
  options: {
    period: KlinePeriod;
    adjust?: '' | 'qfq' | 'hfq';
    startDate?: string;
    indicators?: IndicatorOptions;
    source?: QuoteSource;
  }
) {
  const source = resolveSource(options.source);
  const cachePeriod = PERIOD_TO_CACHE[options.period] || '1d';
  const qs = new URLSearchParams({
    symbol,
    period: cachePeriod,
    limit: '1200',
  });
  if (source === 'local') {
    qs.set('cache_only', '1');
  } else {
    // network / auto：有盘立即返回，过期后台刷（对齐 SparkQuote / 多面板）
    qs.set('local_first', '1');
  }

  try {
    const res = await fetch(`/api/cache/kline?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && Array.isArray(data.bars) && data.bars.length > 0) {
      let bars = mapCacheBarsToHistory(symbol, data.bars as Array<Record<string, unknown>>);
      if (options.startDate) {
        const start = options.startDate;
        bars = bars.filter((b) => b.date >= start);
      }
      if (bars.length > 0) {
        return addIndicators(bars, options.indicators);
      }
    }
    if (source === 'local') {
      return [];
    }
  } catch {
    if (source === 'local') return [];
  }

  return getKlineWithIndicators(symbol, {
    period: options.period,
    adjust: options.adjust,
    startDate: options.startDate,
    indicators: options.indicators,
  });
}
