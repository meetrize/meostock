/**
 * 面板 Catalog：默认尺寸与约束
 *
 * maxW 一律 12：允许拖满整行；min 只保证勉强可读。
 */

import { MAIN_INDEX_PANELS } from './indexCatalog';
import type { PortalLayoutItem, PortalWidgetType } from './types';

export interface WidgetCatalogEntry {
  type: PortalWidgetType;
  name: string;
  description: string;
  defaultLayout: Pick<PortalLayoutItem, 'w' | 'h' | 'minW' | 'minH' | 'maxW' | 'maxH'>;
  allowMultiple?: boolean;
}

/** 全宽上限；高度也放宽，避免「拖不动」 */
const FULL_W = 12;
const TALL_H = 60;

const INDEX_LAYOUT = {
  w: 2,
  h: 2, // 标题 + 两行数据即可，避免留白
  minW: 2,
  minH: 2,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const KPI_LAYOUT = {
  w: 2,
  h: 2, // 与指数同高：标题 + 两行数据
  minW: 2,
  minH: 2,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const LIST_LAYOUT = {
  w: 6,
  h: 10,
  minW: 2,
  minH: 4,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const indexEntries = Object.fromEntries(
  MAIN_INDEX_PANELS.map((p) => [
    p.type,
    {
      type: p.type,
      name: p.name,
      description: `指数 ${p.code}`,
      defaultLayout: { ...INDEX_LAYOUT },
    } satisfies WidgetCatalogEntry,
  ])
) as Record<(typeof MAIN_INDEX_PANELS)[number]['type'], WidgetCatalogEntry>;

export const WIDGET_CATALOG: Record<PortalWidgetType, WidgetCatalogEntry> = {
  ...indexEntries,
  'stat.breadth': {
    type: 'stat.breadth',
    name: '市场涨跌',
    description: '上涨 / 下跌家数',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.limit': {
    type: 'stat.limit',
    name: '涨跌停',
    description: '涨停 / 跌停家数',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.amount': {
    type: 'stat.amount',
    name: '全市场成交额',
    description: 'A 股成交额快照',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.northbound': {
    type: 'stat.northbound',
    name: '北向资金',
    description: '北向净流入摘要',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.mainForce': {
    type: 'stat.mainForce',
    name: '大盘主力',
    description: '主力净流入',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.strongestBoard': {
    type: 'stat.strongestBoard',
    name: '最强板块',
    description: '当日最强行业/概念',
    defaultLayout: { ...KPI_LAYOUT },
  },
  watchlist: {
    type: 'watchlist',
    name: '自选股',
    description: '自选快照列表',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
  },
  marketRanking: {
    type: 'marketRanking',
    name: '市场榜单',
    description: '涨幅/跌幅/成交额/换手',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
  fundFlowRank: {
    type: 'fundFlowRank',
    name: '主力净流入榜',
    description: '个股主力净流入排名',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
  },
  hotBoards: {
    type: 'hotBoards',
    name: '热点板块',
    description: '行业/概念强度榜',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
  boardFundFlow: {
    type: 'boardFundFlow',
    name: '板块资金流',
    description: '板块主力资金排名',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
};

export const WIDGET_CATALOG_LIST = Object.values(WIDGET_CATALOG);

export function applyCatalogConstraints(
  type: PortalWidgetType,
  item: PortalLayoutItem
): PortalLayoutItem {
  const { defaultLayout } = WIDGET_CATALOG[type];
  return {
    ...item,
    minW: defaultLayout.minW,
    minH: defaultLayout.minH,
    maxW: defaultLayout.maxW,
    maxH: defaultLayout.maxH,
  };
}

/** 估算列表可见行数（扣掉标题与内边距） */
export function estimateVisibleRows(h: number, rowPx = 36, gutter = 8): number {
  const panelPx = h * rowPx + Math.max(0, h - 1) * gutter;
  const contentPx = panelPx - 44;
  return Math.max(3, Math.floor(contentPx / 36));
}
