/**
 * 按当前布局批量拉取 portal 面积图日 K（读盘优先 + defer_live）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSettings } from '@/contexts';
import type { QuoteSource } from '@/types';
import { curveSymbolsFromWidgets } from './curveCatalog';
import type { PortalCurveBar, PortalCurvesValue } from './portalCurvesContext';
import type { PortalWidgetInstance } from './types';

const SOFT_REFRESH_MS = 45_000;

function mapBars(
  raw: Array<{ timestamp?: number; close?: number; date?: string; volume?: number }>
): PortalCurveBar[] {
  const out: PortalCurveBar[] = [];
  for (const b of raw || []) {
    const close = Number(b.close);
    if (!Number.isFinite(close)) continue;
    const ts = Number(b.timestamp);
    const date =
      (typeof b.date === 'string' && b.date.slice(0, 10)) ||
      (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '');
    if (!date) continue;
    const vol = Number(b.volume);
    out.push({
      date,
      close,
      volume: Number.isFinite(vol) && vol > 0 ? vol : null,
    });
  }
  return out;
}

export function usePortalCurvesData(
  widgets: PortalWidgetInstance[]
): PortalCurvesValue {
  const { settings } = useAppSettings();
  const quoteSource: QuoteSource =
    settings.quoteSource === 'local' || settings.quoteSource === 'network'
      ? settings.quoteSource
      : 'auto';

  const symbols = useMemo(() => curveSymbolsFromWidgets(widgets), [widgets]);
  const symbolsKey = symbols.join(',');

  const [bySymbol, setBySymbol] = useState<Record<string, PortalCurveBar[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const softTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBatch = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!symbols.length) {
        setBySymbol({});
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!opts?.soft) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const body = {
          symbols,
          period: '1d',
          max_bars: 60,
          defer_live: quoteSource !== 'local',
          cache_only: quoteSource === 'local',
          slim: true,
        };
        const res = await fetch('/api/cache/kline/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `batch ${res.status}`);
        }
        const series = (data.series || {}) as Record<
          string,
          { ok?: boolean; bars?: Array<Record<string, unknown>> }
        >;
        const next: Record<string, PortalCurveBar[]> = {};
        for (const sym of symbols) {
          const row = series[sym];
          if (row?.ok && Array.isArray(row.bars)) {
            next[sym] = mapBars(
              row.bars as Array<{
                timestamp?: number;
                close?: number;
                date?: string;
                volume?: number;
              }>
            );
          } else {
            next[sym] = [];
          }
        }
        setBySymbol(next);
        const bg = Boolean(data.refreshing) && quoteSource !== 'local';
        setRefreshing(bg);

        // 后台补当日后软刷一次
        if (bg) {
          if (softTimer.current) clearTimeout(softTimer.current);
          softTimer.current = setTimeout(() => {
            void fetchBatch({ soft: true });
          }, SOFT_REFRESH_MS);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRefreshing(false);
      } finally {
        setLoading(false);
      }
    },
    [quoteSource, symbols]
  );

  useEffect(() => {
    void fetchBatch();
    return () => {
      if (softTimer.current) clearTimeout(softTimer.current);
    };
  }, [fetchBatch, symbolsKey]);

  return {
    bySymbol,
    loading,
    refreshing,
    error,
    reload: () => fetchBatch(),
  };
}
