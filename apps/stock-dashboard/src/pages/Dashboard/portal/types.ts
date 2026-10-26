/**
 * 总览 Portal 布局类型
 */

import type { LayoutItem } from 'react-grid-layout';
import type { IndexWidgetType } from './indexCatalog';

export type PortalWidgetType =
  | IndexWidgetType
  | 'stat.breadth'
  | 'stat.limit'
  | 'stat.amount'
  | 'stat.northbound'
  | 'stat.mainForce'
  | 'stat.strongestBoard'
  | 'watchlist'
  | 'marketRanking'
  | 'fundFlowRank'
  | 'hotBoards'
  | 'boardFundFlow';

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
  activePresetId: string;
  presets: PortalPreset[];
}

/** v5：第二排 KPI 与指数同高（h=2） */
export const PORTAL_STORAGE_KEY = 'stock-dashboard:overview-portal:v5';

export const PORTAL_COLS = 12;
export const PORTAL_ROW_HEIGHT = 36;
export const PORTAL_GUTTER = 8;
export const PORTAL_MOBILE_BREAKPOINT = 768;
