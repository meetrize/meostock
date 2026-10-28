/**
 * 总览 Portal 布局类型
 */

import type { LayoutItem } from 'react-grid-layout';
import type { IndexWidgetType } from './indexCatalog';
import type { SparkWidgetType } from './sparkCatalog';

export type IndexDisplayMode = 'price' | 'chart';

export type PortalWidgetType =
  | IndexWidgetType
  | SparkWidgetType
  | 'stat.breadth'
  | 'stat.limit'
  | 'stat.amount'
  | 'stat.northbound'
  | 'stat.mainForce'
  | 'stat.strongestBoard'
  | 'stat.margin'
  | 'watchlist'
  | 'marketRanking'
  | 'fundFlowRank'
  | 'hotBoards'
  | 'boardFundFlow'
  | 'strip.globalIndices'
  | 'strip.futures'
  | 'strip.metals'
  | 'strip.fx'
  | 'strip.crypto'
  | 'strip.rates'
  | 'topic.limitList'
  | 'topic.topList'
  | 'rank.hk'
  | 'rank.cb';

export type PortalCatalogGroupId =
  | 'ashare'
  | 'sentiment'
  | 'capital'
  | 'cross'
  | 'assets'
  | 'derivatives'
  | 'global'
  | 'futuresSpark'
  | 'metals'
  | 'fx'
  | 'crypto'
  | 'rates';

export interface PortalWidgetInstance {
  id: string;
  type: PortalWidgetType;
  title?: string;
  config?: Record<string, unknown>;
}

export interface PortalLayoutItem extends LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

export interface PortalPreset {
  id: string;
  name: string;
  layout: PortalLayoutItem[];
  widgets: PortalWidgetInstance[];
}

export interface PortalPersistedState {
  version: 1;
  density: 'tight' | 'comfortable';
  /** 指数类面板默认展示：价格 or 面积曲线 */
  indexDisplayMode: IndexDisplayMode;
  activePresetId: string;
  presets: PortalPreset[];
}

/** v7：独立全球/期货面板 + 全局价格/曲线 */
export const PORTAL_STORAGE_KEY = 'stock-dashboard:overview-portal:v7';

export const PORTAL_COLS = 12;
export const PORTAL_ROW_HEIGHT = 36;
export const PORTAL_GUTTER = 8;
export const PORTAL_MOBILE_BREAKPOINT = 768;
