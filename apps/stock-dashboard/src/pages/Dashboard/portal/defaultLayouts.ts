/**
 * 默认看盘布局 v6：A 股核心 + 全球指数条带 + 涨跌停名单 + 期货条带
 */

import { MAIN_INDEX_PANELS } from './indexCatalog';
import { applyCatalogConstraints } from './widgetCatalog';
import type { PortalLayoutItem, PortalPreset, PortalWidgetInstance, PortalWidgetType } from './types';

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

  const parts = [
    ...indexParts,
    item('stat-breadth', 'stat.breadth', 0, 2, 2, 2),
    item('stat-limit', 'stat.limit', 2, 2, 2, 2),
    item('stat-amount', 'stat.amount', 4, 2, 2, 2),
    item('stat-northbound', 'stat.northbound', 6, 2, 2, 2),
    item('stat-mainForce', 'stat.mainForce', 8, 2, 2, 2),
    item('stat-strongestBoard', 'stat.strongestBoard', 10, 2, 2, 2),
    // KPI 正下方：全球主要指数
    item('strip-global', 'strip.globalIndices', 0, 4, 12, 3),
    item('watchlist', 'watchlist', 0, 7, 6, 10),
    item('hotBoards', 'hotBoards', 6, 7, 6, 10),
    // 新行：涨跌停名单 | 期货条带
    item('topic-limit', 'topic.limitList', 0, 17, 6, 10),
    item('strip-futures', 'strip.futures', 6, 17, 6, 3),
    item('marketRanking', 'marketRanking', 0, 27, 6, 12),
    item('boardFundFlow', 'boardFundFlow', 6, 27, 6, 12),
    item('fundFlowRank', 'fundFlowRank', 0, 39, 6, 10),
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
