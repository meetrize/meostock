/**
 * 面板 Catalog：默认尺寸、分组与约束
 */

import { LANE_META, type SourceLane } from '@/services/sourceLanes';
import { MAIN_INDEX_PANELS } from './indexCatalog';
import { SPARK_PANELS, type SparkWidgetType } from './sparkCatalog';
import type {
  PortalCatalogGroupId,
  PortalLayoutItem,
  PortalWidgetType,
} from './types';

export interface WidgetCatalogEntry {
  type: PortalWidgetType;
  name: string;
  description: string;
  group: PortalCatalogGroupId;
  lane: SourceLane;
  defaultLayout: Pick<PortalLayoutItem, 'w' | 'h' | 'minW' | 'minH' | 'maxW' | 'maxH'>;
  allowMultiple?: boolean;
  starred?: boolean;
}

export const CATALOG_GROUP_LABELS: Record<PortalCatalogGroupId, string> = {
  ashare: 'A 股核心',
  global: '全球指数',
  futuresSpark: '国内期货',
  metals: '贵金属/能源',
  fx: '外汇',
  crypto: '加密货币',
  rates: '美债利率',
  sentiment: '情绪与异动',
  capital: '资金',
  cross: '跨境市场',
  assets: '紧凑条带（可选）',
  derivatives: '衍生品与场内',
};

const FULL_W = 12;
const TALL_H = 60;

const INDEX_LAYOUT = {
  w: 2,
  h: 3,
  minW: 2,
  minH: 2,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const KPI_LAYOUT = {
  w: 2,
  h: 2,
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

const STRIP_LAYOUT = {
  w: 12,
  h: 3,
  minW: 4,
  minH: 3,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const HALF_STRIP_LAYOUT = {
  w: 6,
  h: 3,
  minW: 4,
  minH: 3,
  maxW: FULL_W,
  maxH: TALL_H,
} as const;

const SPARK_GROUP_TO_CATALOG: Record<
  (typeof SPARK_PANELS)[number]['group'],
  PortalCatalogGroupId
> = {
  global: 'global',
  futures: 'futuresSpark',
  metals: 'metals',
  fx: 'fx',
  crypto: 'crypto',
  rates: 'rates',
};

const SPARK_GROUP_LANE: Record<(typeof SPARK_PANELS)[number]['group'], SourceLane> = {
  global: 'yfinance',
  futures: 'lazy-catalog',
  metals: 'yfinance',
  fx: 'yfinance',
  crypto: 'yfinance',
  rates: 'yfinance',
};

const indexEntries = Object.fromEntries(
  MAIN_INDEX_PANELS.map((p) => [
    p.type,
    {
      type: p.type,
      name: p.name,
      description: `指数 ${p.code} · 标题报价 + 面积走势`,
      group: 'ashare' as const,
      lane: 'lazy-catalog' as const,
      defaultLayout: { ...INDEX_LAYOUT },
    } satisfies WidgetCatalogEntry,
  ])
) as Record<(typeof MAIN_INDEX_PANELS)[number]['type'], WidgetCatalogEntry>;

const sparkEntries = Object.fromEntries(
  SPARK_PANELS.map((p) => [
    p.type,
    {
      type: p.type as SparkWidgetType,
      name: p.name,
      description: `${p.code} · 标题报价 + 面积走势`,
      group: SPARK_GROUP_TO_CATALOG[p.group],
      lane: SPARK_GROUP_LANE[p.group],
      defaultLayout: { ...INDEX_LAYOUT },
    } satisfies WidgetCatalogEntry,
  ])
) as Record<SparkWidgetType, WidgetCatalogEntry>;

export const WIDGET_CATALOG: Record<PortalWidgetType, WidgetCatalogEntry> = {
  ...indexEntries,
  ...sparkEntries,
  'stat.breadth': {
    type: 'stat.breadth',
    name: '市场涨跌',
    description: '上涨 / 下跌家数',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.limit': {
    type: 'stat.limit',
    name: '涨跌停',
    description: '涨停 / 跌停家数',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.amount': {
    type: 'stat.amount',
    name: '全市场成交额',
    description: 'A 股成交额快照',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.northbound': {
    type: 'stat.northbound',
    name: '北向资金',
    description: '北向净流入摘要',
    group: 'capital',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.mainForce': {
    type: 'stat.mainForce',
    name: '大盘主力',
    description: '主力净流入',
    group: 'capital',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.strongestBoard': {
    type: 'stat.strongestBoard',
    name: '最强板块',
    description: '当日最强行业/概念',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...KPI_LAYOUT },
  },
  'stat.margin': {
    type: 'stat.margin',
    name: '两融余额',
    description: '融资融券汇总（Tushare）',
    group: 'capital',
    lane: 'tushare',
    defaultLayout: { ...KPI_LAYOUT },
    starred: true,
  },
  watchlist: {
    type: 'watchlist',
    name: '自选股',
    description: '自选快照列表',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
  },
  marketRanking: {
    type: 'marketRanking',
    name: '市场榜单',
    description: '涨幅/跌幅/成交额/换手',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
  fundFlowRank: {
    type: 'fundFlowRank',
    name: '主力净流入榜',
    description: '个股主力净流入排名',
    group: 'capital',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
  },
  hotBoards: {
    type: 'hotBoards',
    name: '热点板块',
    description: '行业/概念强度榜',
    group: 'ashare',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
  boardFundFlow: {
    type: 'boardFundFlow',
    name: '板块资金流',
    description: '板块主力资金排名',
    group: 'capital',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 12, minH: 6 },
  },
  'strip.globalIndices': {
    type: 'strip.globalIndices',
    name: '全球指数条带',
    description: '紧凑横滑（推荐改用独立面板）',
    group: 'assets',
    lane: 'yfinance',
    defaultLayout: { ...STRIP_LAYOUT },
  },
  'strip.futures': {
    type: 'strip.futures',
    name: '期货条带',
    description: '紧凑横滑（推荐改用独立面板）',
    group: 'assets',
    lane: 'lazy-catalog',
    defaultLayout: { ...HALF_STRIP_LAYOUT },
  },
  'strip.metals': {
    type: 'strip.metals',
    name: '贵金属条带',
    description: '紧凑横滑',
    group: 'assets',
    lane: 'yfinance',
    defaultLayout: { ...STRIP_LAYOUT },
  },
  'strip.fx': {
    type: 'strip.fx',
    name: '外汇条带',
    description: '紧凑横滑',
    group: 'assets',
    lane: 'yfinance',
    defaultLayout: { ...STRIP_LAYOUT },
  },
  'strip.crypto': {
    type: 'strip.crypto',
    name: '加密条带',
    description: '紧凑横滑',
    group: 'assets',
    lane: 'yfinance',
    defaultLayout: { ...STRIP_LAYOUT },
  },
  'strip.rates': {
    type: 'strip.rates',
    name: '利率条带',
    description: '紧凑横滑',
    group: 'assets',
    lane: 'yfinance',
    defaultLayout: { ...HALF_STRIP_LAYOUT },
  },
  'topic.limitList': {
    type: 'topic.limitList',
    name: '涨跌停名单',
    description: 'Tushare 涨停/跌停明细',
    group: 'sentiment',
    lane: 'tushare',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
  },
  'topic.topList': {
    type: 'topic.topList',
    name: '龙虎榜',
    description: '当日龙虎榜明细',
    group: 'sentiment',
    lane: 'tushare',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
    starred: true,
  },
  'rank.hk': {
    type: 'rank.hk',
    name: '港股涨幅榜',
    description: '港股涨跌幅前列',
    group: 'cross',
    lane: 'em-sina',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
    starred: true,
  },
  'rank.cb': {
    type: 'rank.cb',
    name: '可转债涨幅',
    description: '可转债日线涨幅榜',
    group: 'derivatives',
    lane: 'tushare',
    defaultLayout: { ...LIST_LAYOUT, h: 10 },
    starred: true,
  },
};

export const WIDGET_CATALOG_LIST = Object.values(WIDGET_CATALOG);

export function catalogGroups(): Array<{
  id: PortalCatalogGroupId;
  label: string;
  entries: WidgetCatalogEntry[];
}> {
  const order: PortalCatalogGroupId[] = [
    'ashare',
    'global',
    'futuresSpark',
    'metals',
    'fx',
    'rates',
    'crypto',
    'sentiment',
    'capital',
    'cross',
    'derivatives',
    'assets',
  ];
  return order.map((id) => ({
    id,
    label: CATALOG_GROUP_LABELS[id],
    entries: WIDGET_CATALOG_LIST.filter((e) => e.group === id),
  }));
}

export function laneMetaOf(type: PortalWidgetType) {
  return LANE_META[WIDGET_CATALOG[type].lane];
}

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

export function estimateVisibleRows(h: number, rowPx = 36, gutter = 8): number {
  const panelPx = h * rowPx + Math.max(0, h - 1) * gutter;
  const contentPx = panelPx - 44;
  return Math.max(3, Math.floor(contentPx / 36));
}
