/**
 * 主要指数：6 个独立面板的代码与名称
 */

export const MAIN_INDEX_PANELS = [
  { code: 'sh000001', type: 'index.sh000001' as const, name: '上证指数' },
  { code: 'sz399001', type: 'index.sz399001' as const, name: '深证成指' },
  { code: 'sz399006', type: 'index.sz399006' as const, name: '创业板指' },
  { code: 'sh000688', type: 'index.sh000688' as const, name: '科创50' },
  { code: 'sh000300', type: 'index.sh000300' as const, name: '沪深300' },
  { code: 'sh000016', type: 'index.sh000016' as const, name: '上证50' },
] as const;

export type IndexWidgetType = (typeof MAIN_INDEX_PANELS)[number]['type'];

export const MAIN_INDEX_CODES = MAIN_INDEX_PANELS.map((p) => p.code);

export function isIndexWidgetType(type: string): type is IndexWidgetType {
  return MAIN_INDEX_PANELS.some((p) => p.type === type);
}

export function getIndexCodeByType(type: IndexWidgetType): string {
  return MAIN_INDEX_PANELS.find((p) => p.type === type)!.code;
}
