/**
 * 独立报价面板：价格 ↔ 日线面积图（服从全局模式 + 单卡点击）
 */

import { useEffect, useMemo, useState } from 'react';
import type { FullQuote } from 'stock-sdk';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { useAppSettings } from '@/contexts';
import {
  formatAmount,
  formatPercent,
  formatPrice,
  getChangeColorClass,
  normalizeStockCode,
} from '@/utils/format';
import type { QuoteSource } from '@/types';
import { usePortalDisplay } from '../portalDisplayContext';
import styles from '../widgetContent.module.css';

export interface SparkQuoteProps {
  code: string;
  klineSymbol: string;
  quote: FullQuote | undefined;
  /** 无成交额时隐藏 */
  showAmount?: boolean;
}

interface SparkBar {
  date: string;
  close: number;
}

function sameCode(a: string, b: string): boolean {
  const na = normalizeStockCode(a) || a;
  const nb = normalizeStockCode(b) || b;
  if (na.toLowerCase() === nb.toLowerCase()) return true;
  const strip = (s: string) => s.replace(/^(yf:|fut:)/i, '');
  return strip(na).toUpperCase() === strip(nb).toUpperCase();
}

async function fetchDailyCloses(
  symbol: string,
  source: QuoteSource
): Promise<SparkBar[]> {
  const qs = new URLSearchParams({
    symbol,
    period: '1d',
  });
  if (source === 'local') qs.set('cache_only', '1');
  else if (source === 'network') qs.set('force', '1');
  else qs.set('local_first', '1');

  const res = await fetch(`/api/cache/kline?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.bars)) {
    throw new Error(data?.error || `kline ${res.status}`);
  }
  const bars = (data.bars as Array<{ timestamp?: number; close?: number; date?: string }>)
    .map((b) => {
      const close = Number(b.close);
      if (!Number.isFinite(close)) return null;
      const ts = Number(b.timestamp);
      const date =
        b.date ||
        (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '');
      return { date, close };
    })
    .filter((x): x is SparkBar => Boolean(x));
  return bars.slice(-60);
}

export function SparkQuoteWidget({
  code,
  klineSymbol,
  quote,
  showAmount = true,
}: SparkQuoteProps) {
  const { settings } = useAppSettings();
  const { indexDisplayMode } = usePortalDisplay();
  const quoteSource: QuoteSource =
    settings.quoteSource === 'local' || settings.quoteSource === 'network'
      ? settings.quoteSource
      : 'auto';

  const [localMode, setLocalMode] = useState<'price' | 'chart' | null>(null);
  const showChart = (localMode ?? indexDisplayMode) === 'chart';

  // 全局模式变化时清除单卡覆盖
  useEffect(() => {
    setLocalMode(null);
  }, [indexDisplayMode]);

  const [bars, setBars] = useState<SparkBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (!showChart) return;
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    fetchDailyCloses(klineSymbol || code, quoteSource)
      .then((rows) => {
        if (!cancelled) {
          setBars(rows);
          if (!rows.length) setChartError('暂无日线');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setBars(null);
          setChartError(e instanceof Error ? e.message : '加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showChart, klineSymbol, code, quoteSource]);

  const up =
    bars && bars.length >= 2 ? bars[bars.length - 1].close >= bars[0].close : true;
  const lineColor = up ? '#ef4444' : '#22c55e';
  const areaTop = up ? 'rgba(239, 68, 68, 0.28)' : 'rgba(34, 197, 94, 0.28)';
  const areaBottom = up ? 'rgba(239, 68, 68, 0)' : 'rgba(34, 197, 94, 0)';

  const chartOption = useMemo(() => {
    if (!bars?.length) return null;
    const closes = bars.map((b) => b.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const pad = (max - min) * 0.08 || max * 0.002 || 1;
    return {
      animation: false,
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: {
        type: 'category',
        data: bars.map((b) => b.date),
        show: false,
      },
      yAxis: {
        type: 'value',
        min: min - pad,
        max: max + pad,
        show: false,
        scale: true,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (params: Array<{ axisValue?: string; data?: number }>) => {
          const p = params?.[0];
          if (!p) return '';
          const v = typeof p.data === 'number' ? p.data.toFixed(2) : '--';
          return `${p.axisValue || ''}<br/>${v}`;
        },
      },
      series: [
        {
          type: 'line',
          data: closes,
          symbol: 'none',
          lineStyle: { width: 1.5, color: lineColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: areaTop },
                { offset: 1, color: areaBottom },
              ],
            },
          },
        },
      ],
    };
  }, [areaBottom, areaTop, bars, lineColor]);

  const toggle = () => setLocalMode(showChart ? 'price' : 'chart');

  if (!quote) {
    return (
      <div className={styles.indexPanel}>
        <div className={styles.indexPanelPrice}>--</div>
        <div className={styles.indexPanelMeta}>
          <span>{code}</span>
        </div>
      </div>
    );
  }

  const changeText =
    quote.change !== null && quote.change > 0
      ? `+${Number(quote.change).toFixed(2)}`
      : quote.change != null
        ? Number(quote.change).toFixed(2)
        : '--';

  if (showChart) {
    return (
      <div
        className={styles.indexPanelChart}
        onClick={toggle}
        role="button"
        tabIndex={0}
        title="点击回到报价"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {chartLoading && <div className={styles.indexPanelChartHint}>加载中…</div>}
        {!chartLoading && chartError && (
          <div className={styles.indexPanelChartHint}>{chartError}</div>
        )}
        {!chartLoading && !chartError && chartOption && (
          <LazyEChart
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
            opts={{ renderer: 'canvas' }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.indexPanel}>
      <button
        type="button"
        className={`${styles.indexPanelPrice} ${styles.indexPanelPriceBtn} ${getChangeColorClass(quote.changePercent)}`}
        title="点击查看日线走势"
        onClick={toggle}
      >
        {formatPrice(quote.price)}
      </button>
      <div className={styles.indexPanelMeta}>
        <span className={getChangeColorClass(quote.changePercent)}>
          {formatPercent(quote.changePercent)}
        </span>
        <span className={getChangeColorClass(quote.change)}>{changeText}</span>
        {showAmount && (
          <span className={styles.indexPanelAmount}>{formatAmount(quote.amount)}</span>
        )}
      </div>
    </div>
  );
}

export { sameCode };
