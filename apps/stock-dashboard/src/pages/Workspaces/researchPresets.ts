/**
 * 研判工作台三套 Workspace 预设（长线 / 波段 / 短线）
 */

import { applyCatalogConstraints } from '@/pages/Dashboard/portal/widgetCatalog';
import type {
  PortalLayoutItem,
  PortalWidgetInstance,
  PortalWidgetType,
} from '@/pages/Dashboard/portal/types';
import type { Workspace } from './types';

function cell(
  id: string,
  type: PortalWidgetType,
  x: number,
  y: number,
  w: number,
  h: number,
  extra?: Partial<PortalWidgetInstance>
): { layout: PortalLayoutItem; widget: PortalWidgetInstance } {
  return {
    layout: applyCatalogConstraints(type, { i: id, x, y, w, h }),
    widget: { id, type, ...extra },
  };
}

function fromParts(
  id: string,
  name: string,
  parts: Array<{ layout: PortalLayoutItem; widget: PortalWidgetInstance }>
): Workspace {
  return {
    id,
    name,
    layout: parts.map((p) => p.layout),
    widgets: parts.map((p) => p.widget),
  };
}

/** 长线桌：Regime + 估值相关扫描入口位 + 财务质量占位用雷达 + 组合风控 */
export function createLongTermDeskPreset(): Workspace {
  const parts = [
    cell('r-regime', 'research.regime', 0, 0, 3, 3),
    cell('r-thermo', 'research.marketThermometer', 3, 0, 5, 8),
    cell('r-themes', 'research.themeLeaders', 8, 0, 4, 8),
    cell('r-radar', 'research.radarWatchlist', 0, 3, 3, 8),
    cell('r-risk', 'research.portfolioRisk', 0, 11, 6, 8),
    cell('macro', 'macro.rates', 6, 11, 6, 5),
    cell('cal', 'calendar.events', 6, 16, 6, 10),
  ];
  return fromParts(
    `ws-research-long-${Date.now().toString(36)}`,
    '研判·长线桌',
    parts
  );
}

/** 波段桌：大盘温度 + 板块轮动 + 趋势扫描入口 + K 线多窗用网页位可选 */
export function createSwingDeskPreset(): Workspace {
  const parts = [
    cell('r-thermo', 'research.marketThermometer', 0, 0, 6, 8),
    cell('r-themes', 'research.themeLeaders', 6, 0, 6, 8),
    cell('hot', 'hotBoards', 0, 8, 6, 10),
    cell('flow', 'boardFundFlow', 6, 8, 6, 10),
    cell('r-risk', 'research.portfolioRisk', 0, 18, 6, 8),
    cell('rank', 'marketRanking', 6, 18, 6, 10),
  ];
  return fromParts(
    `ws-research-swing-${Date.now().toString(36)}`,
    '研判·波段桌',
    parts
  );
}

/** 短线桌：情绪温度 + 复盘 iframe + 题材 + 事件 */
export function createShortDeskPreset(): Workspace {
  const parts = [
    cell('r-thermo', 'research.marketThermometer', 0, 0, 4, 8),
    cell('limit', 'topic.limitList', 4, 0, 4, 10),
    cell('r-themes', 'research.themeLeaders', 8, 0, 4, 10),
    cell(
      'fupan',
      'embed.iframe',
      0,
      10,
      8,
      14,
      {
        title: '涨停复盘',
        config: { url: '/dashboard/fupan' },
      }
    ),
    cell('cal', 'calendar.events', 8, 10, 4, 12),
    cell('r-risk', 'research.portfolioRisk', 0, 24, 6, 8),
  ];
  return fromParts(
    `ws-research-short-${Date.now().toString(36)}`,
    '研判·短线桌',
    parts
  );
}

export type ResearchDeskKind = 'long' | 'swing' | 'short';

export const RESEARCH_DESK_OPTIONS: Array<{
  kind: ResearchDeskKind;
  label: string;
  desc: string;
}> = [
  { kind: 'long', label: '长线桌', desc: 'Regime · 温度 · 雷达 · 风控 · 宏观日历' },
  { kind: 'swing', label: '波段桌', desc: '温度 · 板块轮动 · 榜单 · 风控' },
  { kind: 'short', label: '短线桌', desc: '情绪温度 · 涨停 · 复盘嵌入 · 事件' },
];

export function createResearchDesk(kind: ResearchDeskKind): Workspace {
  switch (kind) {
    case 'long':
      return createLongTermDeskPreset();
    case 'swing':
      return createSwingDeskPreset();
    case 'short':
      return createShortDeskPreset();
  }
}
