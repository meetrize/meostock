/**
 * 默认看盘布局 v8：指数/spark 默认 h=3（标题报价 + 面积图）
 */

import { MAIN_INDEX_PANELS } from './indexCatalog';
import {
  DEFAULT_FUTURES_SPARK_TYPES,
  DEFAULT_GLOBAL_SPARK_TYPES,
} from './sparkCatalog';
import { applyCatalogConstraints } from './widgetCatalog';
import type {
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
  const indexH = 3;
  const indexParts = MAIN_INDEX_PANELS.map((p, i) =>
    item(`index-${p.code}`, p.type, i * 2, 0, 2, indexH)
  );

  const statsY = indexH;
  // 全球指数：两行，每格 h=3
  const sparkH = 3;
  const globalParts = DEFAULT_GLOBAL_SPARK_TYPES.map((t, i) => {
    const row = Math.floor(i / 6);
    const col = i % 6;
    return item(`spark-${t}`, t, col * 2, statsY + 2 + row * sparkH, 2, sparkH);
  });

  const futStartY =
    statsY + 2 + Math.ceil(DEFAULT_GLOBAL_SPARK_TYPES.length / 6) * sparkH;
  const futParts = DEFAULT_FUTURES_SPARK_TYPES.map((t, i) => {
    const row = Math.floor(i / 6);
    const col = i % 6;
    return item(`spark-${t}`, t, col * 2, futStartY + row * sparkH, 2, sparkH);
  });

  const afterFutY =
    futStartY + Math.ceil(DEFAULT_FUTURES_SPARK_TYPES.length / 6) * sparkH;

  const parts = [
    ...indexParts,
    item('stat-breadth', 'stat.breadth', 0, statsY, 2, 2),
    item('stat-limit', 'stat.limit', 2, statsY, 2, 2),
    item('stat-amount', 'stat.amount', 4, statsY, 2, 2),
    item('stat-northbound', 'stat.northbound', 6, statsY, 2, 2),
    item('stat-mainForce', 'stat.mainForce', 8, statsY, 2, 2),
    item('stat-strongestBoard', 'stat.strongestBoard', 10, statsY, 2, 2),
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

export function createDefaultPersistedState() {
  const preset = createDefaultWatchPreset();
  return {
    version: 1 as const,
    density: 'tight' as const,
    activePresetId: preset.id,
    presets: [preset],
  };
}
