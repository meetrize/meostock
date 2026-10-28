/**
 * 默认看盘布局 v7：A 股指数 + 全球/期货独立面板 + 涨跌停名单
 */

import { MAIN_INDEX_PANELS } from './indexCatalog';
import {
  DEFAULT_FUTURES_SPARK_TYPES,
  DEFAULT_GLOBAL_SPARK_TYPES,
} from './sparkCatalog';
import { applyCatalogConstraints } from './widgetCatalog';
import type {
  IndexDisplayMode,
  PortalLayoutItem,
  PortalPreset,
  PortalWidgetInstance,
  PortalWidgetType,
} from './types';

function item(
  id: string,
  type: PortalWidgetType,
  x: number,
  y: number,
  w: number,
  h: number
): { layout: PortalLayoutItem; widget: PortalWidgetInstance } {
  return {
    layout: applyCatalogConstraints(type, { i: id, x, y, w, h }),
    widget: { id, type },
  };
}

/** 默认看盘 */
export function createDefaultWatchPreset(): PortalPreset {
  const indexParts = MAIN_INDEX_PANELS.map((p, i) =>
    item(`index-${p.code}`, p.type, i * 2, 0, 2, 2)
  );

  // 全球指数：两行 6+4（w=2）
  const globalParts = DEFAULT_GLOBAL_SPARK_TYPES.map((t, i) => {
    const row = Math.floor(i / 6);
    const col = i % 6;
    return item(`spark-${t}`, t, col * 2, 4 + row * 2, 2, 2);
  });

  // 期货：接在全球下方
  const futStartY = 4 + Math.ceil(DEFAULT_GLOBAL_SPARK_TYPES.length / 6) * 2;
  const futParts = DEFAULT_FUTURES_SPARK_TYPES.map((t, i) => {
    const row = Math.floor(i / 6);
    const col = i % 6;
    return item(`spark-${t}`, t, col * 2, futStartY + row * 2, 2, 2);
  });

  const afterFutY =
    futStartY + Math.ceil(DEFAULT_FUTURES_SPARK_TYPES.length / 6) * 2;

  const parts = [
    ...indexParts,
    item('stat-breadth', 'stat.breadth', 0, 2, 2, 2),
    item('stat-limit', 'stat.limit', 2, 2, 2, 2),
    item('stat-amount', 'stat.amount', 4, 2, 2, 2),
    item('stat-northbound', 'stat.northbound', 6, 2, 2, 2),
    item('stat-mainForce', 'stat.mainForce', 8, 2, 2, 2),
    item('stat-strongestBoard', 'stat.strongestBoard', 10, 2, 2, 2),
    ...globalParts,
    ...futParts,
    item('watchlist', 'watchlist', 0, afterFutY, 6, 10),
    item('hotBoards', 'hotBoards', 6, afterFutY, 6, 10),
    item('topic-limit', 'topic.limitList', 0, afterFutY + 10, 6, 10),
    item('marketRanking', 'marketRanking', 6, afterFutY + 10, 6, 12),
    item('boardFundFlow', 'boardFundFlow', 0, afterFutY + 22, 6, 12),
    item('fundFlowRank', 'fundFlowRank', 6, afterFutY + 22, 6, 10),
  ];

  return {
    id: 'default-watch',
    name: '默认看盘',
    layout: parts.map((p) => p.layout),
    widgets: parts.map((p) => p.widget),
  };
}

export function createDefaultPersistedState(indexDisplayMode: IndexDisplayMode = 'price') {
  const preset = createDefaultWatchPreset();
  return {
    version: 1 as const,
    density: 'tight' as const,
    indexDisplayMode,
    activePresetId: preset.id,
    presets: [preset],
  };
}
