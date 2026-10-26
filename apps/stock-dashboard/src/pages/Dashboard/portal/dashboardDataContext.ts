/**
 * 总览数据 Context：数据上提，Widget 只消费
 */

import { createContext, useContext } from 'react';
import type { ConceptBoard, FullQuote, IndustryBoard } from 'stock-sdk';
import type {
  getFundFlowRank,
  getMarketFundFlow,
  getNorthboundFlowSummary,
  getSectorFundFlowRank,
} from '@/services/sdk';

export interface MarketSummary {
  riseCount: number;
  fallCount: number;
  flatCount: number;
  limitUpCount: number;
  limitDownCount: number;
  totalAmount: number;
}

type MarketFundFlowRows = Awaited<ReturnType<typeof getMarketFundFlow>>;
type NorthboundSummaryRows = Awaited<ReturnType<typeof getNorthboundFlowSummary>>;
type SectorFundFlowRows = Awaited<ReturnType<typeof getSectorFundFlowRank>>;
type FundFlowRankRows = Awaited<ReturnType<typeof getFundFlowRank>>;

export type DashboardBoard = IndustryBoard | ConceptBoard;

export interface DashboardDataValue {
  indices: FullQuote[];
  indexCodes: string[];
  watchlistCodes: string[];
  watchlistQuotes: FullQuote[];
  marketSummary: MarketSummary;
  northboundSnapshot: NorthboundSummaryRows[number] | null;
  latestMarketFundFlow: MarketFundFlowRows[number] | null;
  strongestBoard: DashboardBoard | undefined;
  boardTab: 'industry' | 'concept';
  setBoardTab: (tab: 'industry' | 'concept') => void;
  currentBoards: DashboardBoard[];
  currentFundFlowBoards: SectorFundFlowRows;
  rankingTab: string;
  setRankingTab: (tab: string) => void;
  rankingItems: FullQuote[];
  rankingIndustries: Record<string, string>;
  fundFlowRanks: FundFlowRankRows;
  onStockClick: (code: string) => void;
  onBoardClick: (code: string, type: 'industry' | 'concept') => void;
  onManageWatchlist: () => void;
}

export const DashboardDataContext = createContext<DashboardDataValue | null>(null);

export function useDashboardData(): DashboardDataValue {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData must be used within DashboardDataContext');
  }
  return ctx;
}
