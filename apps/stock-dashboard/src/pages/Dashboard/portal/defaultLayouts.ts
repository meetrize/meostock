/**
 * 默认看盘布局
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

/** 默认看盘：6 独立指数 + 6 KPI（同高）+ 自选/板块 + 榜单/资金流 */
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
    item('watchlist', 'watchlist', 0, 4, 6, 10),
    item('hotBoards', 'hotBoards', 6, 4, 6, 10),
    item('marketRanking', 'marketRanking', 0, 14, 6, 12),
    item('boardFundFlow', 'boardFundFlow', 6, 14, 6, 12),
    item('fundFlowRank', 'fundFlowRank', 0, 26, 6, 10),
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
