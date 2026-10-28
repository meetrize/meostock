/**
 * 数据来源轨 × 市场对照（与 web/cache/source_lanes.py 对齐）
 */

export type SourceLane = 'em-sina' | 'lazy-catalog' | 'yfinance' | 'tushare' | 'placeholder';

export const LANE_META: Record<
  SourceLane,
  { label: string; title: string; colorVar: string }
> = {
  'em-sina': { label: '东财', title: '东财/新浪', colorVar: 'var(--lane-em, #3b82f6)' },
  'lazy-catalog': { label: '目录', title: '目录补价', colorVar: 'var(--lane-lazy, #06b6d4)' },
  yfinance: { label: 'Yahoo', title: 'Yahoo Finance', colorVar: 'var(--lane-yf, #a855f7)' },
  tushare: { label: 'Tushare', title: 'Tushare 中继', colorVar: 'var(--lane-ts, #f59e0b)' },
  placeholder: { label: '占位', title: '二期占位', colorVar: 'var(--lane-ph, #94a3b8)' },
};

export const LANE_ORDER: SourceLane[] = ['em-sina', 'lazy-catalog', 'yfinance', 'tushare'];

export function laneOf(marketId: string): SourceLane {
  const m = (marketId || '').trim();
  if (m.startsWith('ts:ph:') || m.startsWith('ts:placeholder')) return 'placeholder';
  if (m.startsWith('ts:')) return 'tushare';
  if (m.toLowerCase().startsWith('yf:')) return 'yfinance';
  const low = m.toLowerCase();
  if (low === 'cn' || low === 'hk' || low === 'us') return 'em-sina';
  if (low === 'fund' || low === 'index' || low === 'futures') return 'lazy-catalog';
  return 'placeholder';
}

export function marketsForLane(lane: SourceLane): string[] {
  switch (lane) {
    case 'em-sina':
      return ['cn', 'hk', 'us'];
    case 'lazy-catalog':
      return ['fund', 'index', 'futures'];
    case 'yfinance':
      return [
        'yf:METALS',
        'yf:COMMODITIES',
        'yf:CURRENCIES',
        'yf:CRYPTOCURRENCIES',
        'yf:RATES',
        'yf:US',
        'yf:EUROPE',
        'yf:ASIA',
        'yf:GB',
      ];
    case 'tushare':
      return [
        'ts:limit',
        'ts:stk_limit',
        'ts:suspend',
        'ts:new_share',
        'ts:sw',
        'ts:ths',
        'ts:dc',
        'ts:etf',
        'ts:cb',
        'ts:opt',
        'ts:moneyflow',
        'ts:hsgt',
        'ts:top_list',
        'ts:block_trade',
        'ts:margin',
        'ts:margin_detail',
      ];
    default:
      return [];
  }
}
