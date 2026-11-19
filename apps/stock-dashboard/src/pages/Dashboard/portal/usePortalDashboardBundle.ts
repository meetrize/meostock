/**
 * 总览 / 自定义版面共用的行情与市场数据拉取
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllWatchlistCodes, usePolling } from '@/hooks';
import { useBoardData, useAppSettings } from '@/contexts';
import {
  getFundFlowRank,
  getMarketFundFlow,
  getNorthboundFlowSummary,
  getSectorFundFlowRank,
  getStockIndustries,
} from '@/services/sdk';
import {
  getAllASharePreferCache,
  getFullQuotesPreferCache,
} from '@/services/quoteCache';
import { selectAllCodes, watchlistStore } from '@/services/watchlistStore';
import { isLimitDown, isLimitUp } from '@/services/analysis';
import { normalizeStockCode } from '@/utils/format';
import { openKlineTool } from '@/utils/multipanel';
import type { FullQuote } from 'stock-sdk';
import {
  type DashboardDataValue,
  type MarketSummary,
} from './dashboardDataContext';
import { usePortalMarketsData } from './usePortalMarketsData';
import { MAIN_INDEX_CODES } from './indexCatalog';
import { PORTAL_MOBILE_BREAKPOINT, type PortalWidgetInstance } from './types';

type MarketFundFlowRows = Awaited<ReturnType<typeof getMarketFundFlow>>;
type NorthboundSummaryRows = Awaited<ReturnType<typeof getNorthboundFlowSummary>>;
type SectorFundFlowRows = Awaited<ReturnType<typeof getSectorFundFlowRank>>;
type FundFlowRankRows = Awaited<ReturnType<typeof getFundFlowRank>>;

export function useIsPortalMobile(breakpoint = PORTAL_MOBILE_BREAKPOINT) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return mobile;
}

export function usePortalDashboardBundle(widgets: PortalWidgetInstance[]) {
  const navigate = useNavigate();
  const { getRefreshInterval } = useAppSettings();
  const { industryList, conceptList, loading: boardLoading } = useBoardData();
  const portalMarkets = usePortalMarketsData(widgets);
  const { refreshPortalMarkets } = portalMarkets;

  const [indices, setIndices] = useState<FullQuote[]>([]);
  const [watchlistQuotes, setWatchlistQuotes] = useState<FullQuote[]>([]);
  const [marketQuotes, setMarketQuotes] = useState<FullQuote[]>([]);
  const [marketFundFlowHistory, setMarketFundFlowHistory] =
    useState<MarketFundFlowRows>([]);
  const [northboundSummary, setNorthboundSummary] =
    useState<NorthboundSummaryRows>([]);
  const [industryFundFlowRanks, setIndustryFundFlowRanks] =
    useState<SectorFundFlowRows>([]);
  const [conceptFundFlowRanks, setConceptFundFlowRanks] =
    useState<SectorFundFlowRows>([]);
  const [fundFlowRanks, setFundFlowRanks] = useState<FundFlowRankRows>([]);
  const [rankingTab, setRankingTab] = useState('rise');
  const [boardTab, setBoardTab] = useState<'industry' | 'concept'>('industry');
  const [initialLoading, setInitialLoading] = useState(true);
  const [rankingIndustries, setRankingIndustries] = useState<Record<string, string>>(
    {}
  );

  const watchlistCodes = useAllWatchlistCodes();
  const listRefreshInterval = getRefreshInterval('list');
  const breadthRefreshInterval = Math.max(listRefreshInterval * 4, 60000);

  const fetchQuoteData = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const codes = selectAllCodes(watchlistStore.getSnapshot());
      const useSdkCache = !opts?.force;
      const [indicesData, watchlistData] = await Promise.all([
        getFullQuotesPreferCache([...MAIN_INDEX_CODES], {
          market: 'index',
          useSdkCache,
        }),
        codes.length > 0
          ? getFullQuotesPreferCache(codes.slice(0, 50), { useSdkCache })
          : Promise.resolve<FullQuote[]>([]),
      ]);
      setIndices(indicesData);
      setWatchlistQuotes(watchlistData);
    } catch (error) {
      console.error('Portal fetch error:', error);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  const fetchMarketOverview = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const quotes = await getAllASharePreferCache({
        batchSize: 500,
        concurrency: 4,
        force: opts?.force,
      });
      setMarketQuotes(quotes);
    } catch (error) {
      console.error('Portal market overview error:', error);
    }
  }, []);

  const fetchMarketInsights = useCallback(async () => {
    const tasks = [
      getMarketFundFlow()
        .then((value) => setMarketFundFlowHistory(value))
        .catch((reason) => console.error('Portal marketFundFlow error:', reason)),
      getNorthboundFlowSummary()
        .then((value) => setNorthboundSummary(value))
        .catch((reason) => console.error('Portal northboundSummary error:', reason)),
      getSectorFundFlowRank({ indicator: 'today', sectorType: 'industry' })
        .then((value) => setIndustryFundFlowRanks(value))
        .catch((reason) => console.error('Portal industryFundFlow error:', reason)),
      getSectorFundFlowRank({ indicator: 'today', sectorType: 'concept' })
        .then((value) => setConceptFundFlowRanks(value))
        .catch((reason) => console.error('Portal conceptFundFlow error:', reason)),
      getFundFlowRank({ indicator: 'today' })
        .then((value) => setFundFlowRanks(value))
        .catch((reason) => console.error('Portal fundFlowRank error:', reason)),
    ];
    await Promise.allSettled(tasks);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchQuoteData({ force: true }),
      fetchMarketOverview({ force: true }),
      fetchMarketInsights(),
      refreshPortalMarkets({ force: true }),
    ]);
  }, [
    fetchMarketInsights,
    fetchMarketOverview,
    fetchQuoteData,
    refreshPortalMarkets,
  ]);

  useEffect(() => {
    fetchQuoteData();
    fetchMarketOverview();
    fetchMarketInsights();
  }, [fetchMarketInsights, fetchMarketOverview, fetchQuoteData]);

  usePolling(fetchQuoteData, {
    interval: listRefreshInterval,
    enabled: !initialLoading,
    immediate: false,
  });

  usePolling(fetchMarketOverview, {
    interval: breadthRefreshInterval,
    enabled: !initialLoading,
    immediate: false,
  });

  usePolling(fetchMarketInsights, {
    interval: breadthRefreshInterval,
    enabled: !initialLoading,
    immediate: false,
  });

  const handleStockClick = useCallback((code: string) => {
    const symbol = normalizeStockCode(code) || code;
    openKlineTool(symbol);
  }, []);

  const handleBoardClick = useCallback(
    (code: string, type: 'industry' | 'concept') => {
      navigate(`/boards/${type}/${code}`);
    },
    [navigate]
  );

  const handleManageWatchlist = useCallback(() => {
    navigate('/watchlist');
  }, [navigate]);

  const currentBoards = boardTab === 'industry' ? industryList : conceptList;
  const currentFundFlowBoards =
    boardTab === 'industry' ? industryFundFlowRanks : conceptFundFlowRanks;
  const strongestBoard = currentBoards[0];
  const latestMarketFundFlow = marketFundFlowHistory.at(-1) ?? null;

  const northboundSnapshot = useMemo(() => {
    const northItems = northboundSummary.filter(
      (item) =>
        item.direction.includes('北向') || item.boardName.includes('北向')
    );
    if (northItems.length === 0) {
      return (
        northboundSummary.find((item) => item.direction.includes('沪深港通')) ??
        northboundSummary[0] ??
        null
      );
    }
    if (northItems.length === 1) return northItems[0];
    const sum = (pick: (row: (typeof northItems)[number]) => number | null | undefined) =>
      northItems.reduce((acc, row) => acc + (Number(pick(row)) || 0), 0);
    const base = northItems[0];
    return {
      ...base,
      boardName: '北向',
      netInflow: sum((r) => r.netInflow),
      netBuyAmount: sum((r) => r.netBuyAmount),
      remainAmount: sum((r) => r.remainAmount),
      upCount: sum((r) => r.upCount),
      downCount: sum((r) => r.downCount),
      flatCount: sum((r) => r.flatCount),
    };
  }, [northboundSummary]);

  const marketSummary = useMemo<MarketSummary>(() => {
    return marketQuotes.reduce(
      (summary, quote) => {
        if (quote.changePercent > 0) summary.riseCount += 1;
        else if (quote.changePercent < 0) summary.fallCount += 1;
        else summary.flatCount += 1;

        if (isLimitUp(quote)) summary.limitUpCount += 1;
        if (isLimitDown(quote)) summary.limitDownCount += 1;
        summary.totalAmount += quote.amount ?? 0;
        return summary;
      },
      {
        riseCount: 0,
        fallCount: 0,
        flatCount: 0,
        limitUpCount: 0,
        limitDownCount: 0,
        totalAmount: 0,
      }
    );
  }, [marketQuotes]);

  const rankingItems = useMemo(() => {
    const sorted = [...marketQuotes];
    switch (rankingTab) {
      case 'fall':
        sorted.sort((a, b) => a.changePercent - b.changePercent);
        break;
      case 'amount':
        sorted.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
        break;
      case 'turnover':
        sorted.sort((a, b) => (b.turnoverRate ?? 0) - (a.turnoverRate ?? 0));
        break;
      case 'rise':
      default:
        sorted.sort((a, b) => b.changePercent - a.changePercent);
        break;
    }
    return sorted.slice(0, 10);
  }, [marketQuotes, rankingTab]);

  useEffect(() => {
    if (!rankingItems.length) {
      setRankingIndustries({});
      return;
    }
    let cancelled = false;
    getStockIndustries(rankingItems.map((item) => item.code))
      .then((map) => {
        if (!cancelled) setRankingIndustries(map);
      })
      .catch(() => {
        if (!cancelled) setRankingIndustries({});
      });
    return () => {
      cancelled = true;
    };
  }, [rankingItems]);

  const dataValue = useMemo<DashboardDataValue>(
    () => ({
      indices,
      indexCodes: [...MAIN_INDEX_CODES],
      watchlistCodes,
      watchlistQuotes,
      marketSummary,
      northboundSnapshot,
      latestMarketFundFlow,
      marketFundFlowHistory,
      strongestBoard,
      boardTab,
      setBoardTab,
      currentBoards,
      currentFundFlowBoards,
      rankingTab,
      setRankingTab,
      rankingItems,
      rankingIndustries,
      fundFlowRanks,
      onStockClick: handleStockClick,
      onBoardClick: handleBoardClick,
      onManageWatchlist: handleManageWatchlist,
    }),
    [
      indices,
      watchlistCodes,
      watchlistQuotes,
      marketSummary,
      northboundSnapshot,
      latestMarketFundFlow,
      marketFundFlowHistory,
      strongestBoard,
      boardTab,
      currentBoards,
      currentFundFlowBoards,
      rankingTab,
      rankingItems,
      rankingIndustries,
      fundFlowRanks,
      handleStockClick,
      handleBoardClick,
      handleManageWatchlist,
    ]
  );

  return {
    initialLoading,
    boardLoading,
    dataValue,
    portalMarkets,
    refreshAll,
  };
}
