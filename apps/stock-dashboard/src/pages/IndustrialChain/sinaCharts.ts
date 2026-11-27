/**
 * 新浪 A 股分时 / 日 K GIF（与 QuotesMarket 同源）
 */

import { parseStockCode } from '@/utils/format';

export function toSinaAshareSymbol(code: string | undefined | null): string | null {
  if (!code) return null;
  const raw = code.trim();
  if (!raw) return null;
  const { market, symbol } = parseStockCode(raw);
  if (!/^\d{6}$/.test(symbol)) return null;
  if (market !== 'sh' && market !== 'sz' && market !== 'bj') return null;
  return `${market}${symbol}`;
}

export function sinaMinChartUrl(sinaSymbol: string, bust?: number): string {
  const q = bust != null ? `?t=${bust}` : '';
  return `https://image.sinajs.cn/newchart/min/n/${sinaSymbol}.gif${q}`;
}

export function sinaDailyChartUrl(sinaSymbol: string, bust?: number): string {
  const q = bust != null ? `?t=${bust}` : '';
  return `https://image.sinajs.cn/newchart/daily/n/${sinaSymbol}.gif${q}`;
}
