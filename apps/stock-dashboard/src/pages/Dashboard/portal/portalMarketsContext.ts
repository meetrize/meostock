/**
 * 多来源 Portal 行情 Context
 */

import { createContext, useContext } from 'react';
import type { FullQuote } from 'stock-sdk';

export type PortalTopicRows = {
  items: Array<Record<string, unknown>>;
  tradeDate: string | null;
  syncing: boolean;
  stale: boolean;
  syncedAt: number | null;
  source: string | null;
  error?: string;
  columns?: Array<{ key: string; label: string; align?: string }>;
};

export type PortalMarketsValue = {
  /** market_id → 全表/过滤后的 quote（供独立 spark 面板） */
  sparkQuotes: Record<string, FullQuote[]>;
  stripQuotes: Record<string, FullQuote[]>;
  topics: Record<string, PortalTopicRows>;
  ranks: Record<string, FullQuote[]>;
  loading: boolean;
  refreshPortalMarkets: (opts?: { force?: boolean }) => Promise<void>;
};

export const PortalMarketsContext = createContext<PortalMarketsValue | null>(null);

export function usePortalMarkets(): PortalMarketsValue {
  const ctx = useContext(PortalMarketsContext);
  if (!ctx) {
    throw new Error('usePortalMarkets must be used within PortalMarketsContext');
  }
  return ctx;
}
