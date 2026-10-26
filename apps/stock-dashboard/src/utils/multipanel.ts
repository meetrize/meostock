/**
 * 打开多面板 K 线页（/multipanel）
 */

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

export function buildMultipanelUrl(
  symbols: string[],
  options?: { period?: string; layout?: string; max?: number }
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
  return `/multipanel?${qs.toString()}`;
}

export function openMultipanel(
  symbols: string[],
  options?: { period?: string; layout?: string; max?: number }
): void {
  const url = buildMultipanelUrl(symbols, options);
  window.open(url, '_blank', 'noopener,noreferrer');
}
