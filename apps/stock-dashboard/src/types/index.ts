/**
 * 应用级类型定义
 */

/** 自选分组 */
export interface WatchlistGroup {
  id: string;
  name: string;
  codes: string[];
  createdAt: number;
  updatedAt: number;
}

/** 告警规则类型 */
export type AlertType =
  | 'price_gte'
  | 'price_lte'
  | 'change_percent_gte'
  | 'change_percent_lte'
  | 'amount_gte'
  | 'near_limit_up'
  | 'near_limit_down';

/** 告警规则 */
export interface AlertRule {
  id: string;
  code: string;
  name: string;
  type: AlertType;
  value: number;
  cooldownSec: number;
  enabled: boolean;
  lastTriggeredAt: number;
  createdAt: number;
}

/** 热力图配置 */
export interface HeatmapConfig {
  dimension: 'industry' | 'concept' | 'stock' | 'watchlist';
  colorField: 'changePercent' | 'change' | 'volumeRatio' | 'turnoverRate';
  sizeField: 'totalMarketCap' | 'amount' | 'volume';
  topK: number;
}

/** 指标配置 */
export interface IndicatorConfig {
  ma: number[];
  macd: { short: number; long: number; signal: number };
  boll: { period: number; stdDev: number };
  kdj: { period: number; kPeriod: number; dPeriod: number };
  rsi: number[];
  dmi: { period: number; adxPeriod: number };
  sar: { afStart: number; afIncrement: number; afMax: number };
  kc: { emaPeriod: number; atrPeriod: number; multiplier: number };
}

/** 表格列配置 */
export interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  width?: number;
}

/** 行情本地缓存模式：极速只读盘 / 均衡先缓存后刷 / 实时偏打网 */
export type QuoteCacheMode = 'speed' | 'balanced' | 'realtime';

/** 行情源：自动优先缓存 / 仅本地 / 仅联网(sdk) */
export type QuoteSource = 'auto' | 'local' | 'network';

/** 应用设置 */
export interface AppSettings {
  refreshInterval: {
    list: number;
    detail: number;
    heatmap: number;
  };
  /** 行情页本地缓存策略（同步到服务端 /api/cache/mode） */
  cacheMode: QuoteCacheMode;
  /** 自选/热力/总览等取数源（同步到 /api/cache/source） */
  quoteSource: QuoteSource;
  colorMode: 'red-rise' | 'green-rise';
  heatmapConfig: HeatmapConfig;
  indicatorConfig: IndicatorConfig;
}

/** 搜索历史项 */
export interface SearchHistoryItem {
  code: string;
  name: string;
  market: string;
  type: string;
  timestamp: number;
}

/** 刷新状态 */
export type RefreshStatus = 'idle' | 'loading' | 'success' | 'error';

/** 市场状态 */
export type MarketStatus = 'pre' | 'trading' | 'break' | 'closed';

/** K线周期 */
export type KlinePeriod = 'daily' | 'weekly' | 'monthly';

/** 分钟周期 */
export type MinutePeriod = '1' | '5' | '15' | '30' | '60';

/** 复权类型 */
export type AdjustType = '' | 'qfq' | 'hfq';

/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/** 排序配置 */
export interface SortConfig {
  field: string;
  direction: SortDirection;
}
