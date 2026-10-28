/**
 * 按当前布局订阅多来源行情；同步完成后 softReload
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FullQuote } from 'stock-sdk';
import { useAppSettings, useSyncStatus } from '@/contexts';
import { usePolling } from '@/hooks';
import {
  fetchMarketSnapshot,
  fetchTopicMarket,
  pickCuratedQuotes,
} from '@/services/portalMarkets';
import {
  CRYPTO_CURATED,
  FUTURES_CURATED,
  FX_CURATED,
  GLOBAL_INDEX_CURATED,
  METALS_CURATED,
  RATES_CURATED,
  type CuratedQuote,
} from './curatedSymbols';
import type { PortalMarketsValue, PortalTopicRows } from './portalMarketsContext';
import { getSparkPanel, isSparkWidgetType } from './sparkCatalog';
import type { PortalWidgetInstance, PortalWidgetType } from './types';

const STRIP_CURATED: Partial<Record<PortalWidgetType, CuratedQuote[]>> = {
  'strip.globalIndices': GLOBAL_INDEX_CURATED,
  'strip.futures': FUTURES_CURATED,
  'strip.metals': METALS_CURATED,
  'strip.fx': FX_CURATED,
  'strip.crypto': CRYPTO_CURATED,
  'strip.rates': RATES_CURATED,
};

const TOPIC_MARKET: Partial<Record<PortalWidgetType, string>> = {
  'topic.limitList': 'ts:limit',
  'topic.topList': 'ts:top_list',
  'stat.margin': 'ts:margin',
};

const RANK_MARKET: Partial<Record<PortalWidgetType, string>> = {
  'rank.hk': 'hk',
};

function emptyTopic(): PortalTopicRows {
  return {
    items: [],
    tradeDate: null,
    syncing: false,
    stale: false,
    syncedAt: null,
    source: null,
  };
}

function rowsToQuotes(items: Array<Record<string, unknown>>): FullQuote[] {
  return items.map(
    (it) =>
      ({
        code: String(it.code || ''),
        name: String(it.name || it.code || ''),
        price: Number(it.price ?? it.close ?? 0) || 0,
        change: Number(it.change ?? 0) || 0,
        changePercent: Number(it.changePercent ?? it.pctChg ?? 0) || 0,
        volume: Number(it.volume ?? 0) || 0,
        amount: Number(it.amount ?? 0) || 0,
      }) as FullQuote
  );
}

export function usePortalMarketsData(
  widgets: PortalWidgetInstance[]
): PortalMarketsValue {
  const { softVersion, completedLanes } = useSyncStatus();
  const { getRefreshInterval } = useAppSettings();
  const types = useMemo(() => new Set(widgets.map((w) => w.type)), [widgets]);

  const [sparkQuotes, setSparkQuotes] = useState<Record<string, FullQuote[]>>({});
  const [stripQuotes, setStripQuotes] = useState<Record<string, FullQuote[]>>({});
  const [topics, setTopics] = useState<Record<string, PortalTopicRows>>({});
  const [ranks, setRanks] = useState<Record<string, FullQuote[]>>({});
  const [loading, setLoading] = useState(true);

  const refreshPortalMarkets = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = Boolean(opts?.force);
      const snapMarkets = new Set<string>();
      const topicIds = new Set<string>();
      const curatedByStrip: Array<{ type: PortalWidgetType; curated: CuratedQuote[] }> =
        [];

      for (const t of types) {
        if (isSparkWidgetType(t)) {
          snapMarkets.add(getSparkPanel(t).market);
        }
        const curated = STRIP_CURATED[t];
        if (curated) {
          curatedByStrip.push({ type: t, curated });
          curated.forEach((c) => snapMarkets.add(c.market));
        }
        const topicId = TOPIC_MARKET[t];
        if (topicId) topicIds.add(topicId);
        const rankM = RANK_MARKET[t];
        if (rankM) snapMarkets.add(rankM);
        if (t === 'rank.cb') topicIds.add('ts:cb');
      }

      if (!snapMarkets.size && !topicIds.size) {
        setLoading(false);
        return;
      }

      const snapResults = await Promise.all(
        [...snapMarkets].map((m) => fetchMarketSnapshot(m, { force }))
      );
      const byMarket: Record<string, FullQuote[]> = {};
      for (const r of snapResults) byMarket[r.market] = r.items;
      setSparkQuotes(byMarket);

      const nextStrips: Record<string, FullQuote[]> = {};
      for (const { type, curated } of curatedByStrip) {
        nextStrips[type] = pickCuratedQuotes(byMarket, curated);
      }
      setStripQuotes(nextStrips);

      const nextRanks: Record<string, FullQuote[]> = {};
      for (const t of types) {
        const m = RANK_MARKET[t];
        if (!m) continue;
        const items = [...(byMarket[m] || [])].sort(
          (a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)
        );
        nextRanks[t] = items.slice(0, 30);
      }

      const nextTopics: Record<string, PortalTopicRows> = {};
      await Promise.all(
        [...topicIds].map(async (id) => {
          const data = await fetchTopicMarket(id);
          const rows: PortalTopicRows = {
            items: data.items || [],
            tradeDate: data.trade_date ? String(data.trade_date) : null,
            syncing: Boolean(data.syncing),
            stale: Boolean(data.stale),
            syncedAt: typeof data.synced_at === 'number' ? data.synced_at : null,
            source: data.source ? String(data.source) : null,
            error: data.ok ? undefined : data.error,
            columns: data.columns,
          };
          for (const [type, mid] of Object.entries(TOPIC_MARKET)) {
            if (mid === id) nextTopics[type] = rows;
          }
          if (id === 'ts:cb' && types.has('rank.cb')) {
            const quotes = rowsToQuotes(data.items || []);
            quotes.sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
            nextRanks['rank.cb'] = quotes.slice(0, 30);
          }
        })
      );

      for (const t of types) {
        if (TOPIC_MARKET[t] && !nextTopics[t]) nextTopics[t] = emptyTopic();
      }

      setTopics((prev) => ({ ...prev, ...nextTopics }));
      setRanks((prev) => ({ ...prev, ...nextRanks }));
      setLoading(false);
    },
    [types]
  );

  useEffect(() => {
    void refreshPortalMarkets();
  }, [refreshPortalMarkets]);

  useEffect(() => {
    if (!softVersion || !completedLanes.length) return;
    const need =
      completedLanes.includes('yfinance') ||
      completedLanes.includes('lazy-catalog') ||
      completedLanes.includes('em-sina') ||
      completedLanes.includes('tushare');
    if (need) void refreshPortalMarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softVersion]);

  const interval = getRefreshInterval('list');
  usePolling(() => refreshPortalMarkets(), {
    interval: Math.max(interval * 2, 30000),
    enabled: types.size > 0 && !loading,
    immediate: false,
  });

  return {
    sparkQuotes,
    stripQuotes,
    topics,
    ranks,
    loading,
    refreshPortalMarkets,
  };
}
