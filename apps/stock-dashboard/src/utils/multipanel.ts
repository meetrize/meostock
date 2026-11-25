/**
 * 打开多面板 / 单标的 K 线工具
 */

import { writeKlineNavList } from './klineNav';

export type OpenKlineToolOptions = {
  /** 当前筛选排序后的完整列表；长度 ≥ 2 时写入 localStorage 并附带 ?nav= */
  symbols?: string[];
  /** 与 symbols 对齐的锚定日（形态回测翻页） */
  dates?: string[];
  /** 当前标的在 symbols 中的下标 */
  index?: number;
  /** 锚定交易日 YYYY-MM-DD */
  date?: string;
  /** 形态窗口起点 YYYY-MM-DD（信号日区间高亮） */
  windowStart?: string;
  /** left = 命中日偏左看右侧 */
  bias?: 'left' | string;
};

/** 打开根路径 K 线工具（与行情页、详情页一致：/?symbol=&period=1d[&nav=][&date=][&bias=][&wstart=]） */
export function openKlineTool(
  symbol: string,
  period = '1d',
  options?: OpenKlineToolOptions
): void {
  const sym = String(symbol || '').trim();
  if (!sym) return;
  const qs = new URLSearchParams({ symbol: sym, period });
  const list = options?.symbols;
  if (list && list.length >= 2) {
    const navId = writeKlineNavList(list, options?.index ?? 0, options?.dates);
    if (navId) qs.set('nav', navId);
  }
  const date = String(options?.date || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) qs.set('date', date);
  const wstart = String(options?.windowStart || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(wstart)) qs.set('wstart', wstart);
  if (options?.bias === 'left') qs.set('bias', 'left');
  window.open(`/?${qs.toString()}`, '_blank', 'noopener,noreferrer');
}

/** 按标的数量选常用布局 */
export function pickMultipanelLayout(count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return '1x1';
  if (n === 2) return '1x2';
  if (n === 3) return '1+2';
  if (n <= 4) return '2x2';
  if (n <= 6) return '2x3';
  return '3x3';
}

export type MultipanelEntry = { symbol: string; date?: string };

export function buildMultipanelUrl(
  symbols: string[],
  options?: {
    period?: string;
    layout?: string;
    max?: number;
    dates?: string[];
    bias?: 'left' | string;
  }
): string {
  // 多面板页内可翻页，入口可带入较长列表（受 URL 长度约束，默认上限 200）
  const max = Math.min(500, Math.max(1, options?.max ?? 200));
  const list = [...new Set(symbols.map((s) => String(s || '').trim()).filter(Boolean))].slice(
    0,
    max
  );
  // 布局按「一屏格数」选常用预设，多余标的在多面板内翻页查看
  const layout = options?.layout || pickMultipanelLayout(Math.min(list.length || 1, 9));
  const period = options?.period || '1d';
  const qs = new URLSearchParams();
  qs.set('layout', layout);
  qs.set('period', period);
  if (list.length) qs.set('symbols', list.join(','));
  if (options?.bias === 'left') qs.set('bias', 'left');

  const dates = options?.dates;
  if (dates && dates.length && list.length >= 2) {
    const aligned = list.map((_, i) => {
      const d = String(dates[i] || '').trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
    });
    if (aligned.some(Boolean)) {
      const navId = writeKlineNavList(list, 0, aligned);
      if (navId) qs.set('nav', navId);
      // 短列表也塞进 query，便于无 nav 时回退
      if (list.length <= 30 && aligned.every(Boolean)) {
        qs.set('dates', aligned.join(','));
      }
    }
  }

  return `/multipanel?${qs.toString()}`;
}

export function openMultipanel(
  symbols: string[],
  options?: {
    period?: string;
    layout?: string;
    max?: number;
    dates?: string[];
    bias?: 'left' | string;
  }
): void {
  const url = buildMultipanelUrl(symbols, options);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** 按事件条目打开多面板（每格可带不同锚定日） */
export function openMultipanelEntries(
  entries: MultipanelEntry[],
  options?: { period?: string; layout?: string; max?: number; bias?: 'left' | string }
): void {
  const max = Math.min(500, Math.max(1, options?.max ?? 200));
  const cleaned = entries
    .map((e) => ({
      symbol: String(e.symbol || '').trim(),
      date: String(e.date || '').trim().slice(0, 10),
    }))
    .filter((e) => e.symbol)
    .slice(0, max);
  if (!cleaned.length) return;
  openMultipanel(
    cleaned.map((e) => e.symbol),
    {
      ...options,
      dates: cleaned.map((e) => e.date),
      bias: options?.bias ?? 'left',
    }
  );
}
