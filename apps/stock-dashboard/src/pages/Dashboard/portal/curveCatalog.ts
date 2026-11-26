/**
 * Portal 日线面积图能力注册（CurveSpec）。
 * 新面板：进 sparkCatalog/indexCatalog 后在此（或自动聚合）声明 klineSymbol + eodLane，
 * 即可进入批量加速与盘后补全（后端 cache/portal_curves.py 需同步）。
 */

import { MAIN_INDEX_PANELS, isIndexWidgetType } from './indexCatalog';
import {
  SPARK_PANELS,
  getSparkPanel,
  isSparkWidgetType,
  type SparkPanelDef,
} from './sparkCatalog';
import type { PortalWidgetInstance } from './types';

export type PortalEodLane = 'cn' | 'asia' | 'eu' | 'us' | 'crypto';

export interface CurveSpec {
  type: string;
  name: string;
  klineSymbol: string;
  eodLane: PortalEodLane;
}

const SPARK_EOD_LANE: Record<SparkPanelDef['group'], PortalEodLane> = {
  global: 'us', // 默认；亚太/欧股下面覆盖
  futures: 'cn',
  metals: 'us',
  fx: 'us',
  crypto: 'crypto',
  rates: 'us',
};

const SPARK_EOD_OVERRIDE: Partial<Record<string, PortalEodLane>> = {
  'spark.hsi': 'asia',
  'spark.n225': 'asia',
  'spark.ks11': 'asia',
  'spark.gdaxi': 'eu',
  'spark.ftse': 'eu',
  'spark.stoxx50e': 'eu',
};

function sparkEodLane(p: SparkPanelDef): PortalEodLane {
  return SPARK_EOD_OVERRIDE[p.type] || SPARK_EOD_LANE[p.group] || 'us';
}

const INDEX_SPECS: CurveSpec[] = MAIN_INDEX_PANELS.map((p) => ({
  type: p.type,
  name: p.name,
  klineSymbol: p.code,
  eodLane: 'cn',
}));

const SPARK_SPECS: CurveSpec[] = SPARK_PANELS.map((p) => ({
  type: p.type,
  name: p.name,
  klineSymbol: p.klineSymbol,
  eodLane: sparkEodLane(p),
}));

const BY_TYPE = new Map<string, CurveSpec>(
  [...INDEX_SPECS, ...SPARK_SPECS].map((s) => [s.type, s])
);

const BY_SYMBOL = new Map<string, CurveSpec>();
for (const s of [...INDEX_SPECS, ...SPARK_SPECS]) {
  if (!BY_SYMBOL.has(s.klineSymbol)) BY_SYMBOL.set(s.klineSymbol, s);
}

export function listPortalCurveSpecs(): CurveSpec[] {
  return [...INDEX_SPECS, ...SPARK_SPECS];
}

export function getCurveSpecByType(type: string): CurveSpec | null {
  return BY_TYPE.get(type) || null;
}

export function getCurveSpecBySymbol(symbol: string): CurveSpec | null {
  return BY_SYMBOL.get(symbol) || null;
}

/** 当前布局内需要面积图的 klineSymbol（去重，保序） */
export function curveSymbolsFromWidgets(
  widgets: PortalWidgetInstance[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of widgets) {
    let spec: CurveSpec | null = null;
    if (isIndexWidgetType(w.type) || isSparkWidgetType(w.type)) {
      spec = getCurveSpecByType(w.type);
    }
    // 未来：自定义曲线面板可在 widget.config.klineSymbol 声明
    const custom =
      typeof w.config?.klineSymbol === 'string'
        ? String(w.config.klineSymbol).trim()
        : '';
    const sym = (spec?.klineSymbol || custom || '').trim();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export function isCurveWidgetType(type: string): boolean {
  return isIndexWidgetType(type) || isSparkWidgetType(type);
}

/** 打开 K 线工具时用的符号 */
export function klineSymbolForWidgetType(type: string): string | null {
  if (isSparkWidgetType(type)) return getSparkPanel(type).klineSymbol;
  const spec = getCurveSpecByType(type);
  return spec?.klineSymbol || null;
}
