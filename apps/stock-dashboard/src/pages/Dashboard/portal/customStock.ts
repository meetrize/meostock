/**
 * Portal 自定义个股面板：config 约定与上限
 */

import { normalizeStockCode } from '@/utils/format';
import type { PortalWidgetInstance } from './types';

export const CUSTOM_STOCK_WIDGET_TYPE = 'stock.custom' as const;

export type CustomStockMarket = 'cn' | 'hk' | 'us';

export interface CustomStockConfig {
  market: CustomStockMarket;
  code: string;
  klineSymbol: string;
  name: string;
}

export function isCustomStockWidget(
  widget: Pick<PortalWidgetInstance, 'type'>
): boolean {
  return widget.type === CUSTOM_STOCK_WIDGET_TYPE;
}

export function readCustomStockConfig(
  widget: PortalWidgetInstance
): CustomStockConfig | null {
  const cfg = widget.config ?? {};
  const marketRaw = String(cfg.market || '').toLowerCase();
  const market: CustomStockMarket | null =
    marketRaw === 'cn' || marketRaw === 'hk' || marketRaw === 'us'
      ? marketRaw
      : null;
  // 再归一一次：纠正历史写入的 usSOXL.AM 等脏代码
  const code =
    normalizeStockCode(String(cfg.code || '')) ||
    String(cfg.code || '').trim();
  const klineSymbol =
    normalizeStockCode(
      String(cfg.klineSymbol || cfg.code || '').trim() || code
    ) || code;
  const name =
    (typeof cfg.name === 'string' && cfg.name.trim()) ||
    widget.title ||
    code;
  if (!market || !code || !klineSymbol) return null;
  return { market, code, klineSymbol, name };
}

export function buildCustomStockConfig(input: {
  market: CustomStockMarket;
  code: string;
  name: string;
  klineSymbol?: string;
}): CustomStockConfig {
  const code = normalizeStockCode(input.code) || input.code.trim();
  const klineSymbol =
    normalizeStockCode((input.klineSymbol || code).trim()) || code;
  return {
    market: input.market,
    code,
    klineSymbol,
    name: input.name.trim() || code,
  };
}
