/**
 * 独立报价面板：标题行报价（portal 注入）+ 正文常驻面积曲线
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FullQuote } from 'stock-sdk';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { useAppSettings } from '@/contexts';
import {
  formatAmount,
  formatPercent,
  formatPrice,
  formatVolume,
  getChangeColorClass,
  normalizeStockCode,
} from '@/utils/format';
import type { QuoteSource } from '@/types';
import { useWidgetHeaderSlot } from '../widgetHeaderSlotContext';
import styles from '../widgetContent.module.css';

export interface SparkQuoteProps {
  code: string;
  klineSymbol: string;
  quote: FullQuote | undefined;
  /** 无成交额时隐藏；默认尝试显示 */
  showAmount?: boolean;
}

interface SparkBar {
  date: string;
  close: number;
  volume: number | null;
}

const KLINE_CACHE_TTL_MS = 60_000;
const klineCache = new Map<string, { at: number; bars: SparkBar[] }>();
const klineInflight = new Map<string, Promise<SparkBar[]>>();

function sameCode(a: string, b: string): boolean {
  const na = normalizeStockCode(a) || a;
  const nb = normalizeStockCode(b) || b;
  if (na.toLowerCase() === nb.toLowerCase()) return true;
  const strip = (s: string) => s.replace(/^(yf:|fut:)/i, '');
  return strip(na).toUpperCase() === strip(nb).toUpperCase();
}

function openDailyKline(symbol: string) {
  const s = encodeURIComponent(symbol);
  window.open(`/?symbol=${s}&period=1d`, '_blank', 'noopener,noreferrer');
}

async function fetchDailyBars(
  symbol: string,
  source: QuoteSource
): Promise<SparkBar[]> {
  const key = `${symbol}|${source}`;
  const hit = klineCache.get(key);
  if (hit && Date.now() - hit.at < KLINE_CACHE_TTL_MS) return hit.bars;

  const existing = klineInflight.get(key);
  if (existing) return existing;

  const qs = new URLSearchParams({
    symbol,
    period: '1d',
  });
  if (source === 'local') qs.set('cache_only', '1');
  else if (source === 'network') qs.set('force', '1');
  else qs.set('local_first', '1');

  const promise = (async () => {
    const res = await fetch(`/api/cache/kline?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !Array.isArray(data.bars)) {
      throw new Error(data?.error || `kline ${res.status}`);
    }
    const bars = (
      data.bars as Array<{
        timestamp?: number;
        close?: number;
        date?: string;
        volume?: number;
      }>
    )
      .map((b) => {
        const close = Number(b.close);
        if (!Number.isFinite(close)) return null;
        const ts = Number(b.timestamp);
        const date =
          b.date ||
          (Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '');
        const vol = Number(b.volume);
        return {
          date,
          close,
          volume: Number.isFinite(vol) && vol > 0 ? vol : null,
        };
      })
      .filter((x): x is SparkBar => Boolean(x));
    const sliced = bars.slice(-60);
    klineCache.set(key, { at: Date.now(), bars: sliced });
    return sliced;
  })().finally(() => {
    klineInflight.delete(key);
  });

  klineInflight.set(key, promise);
  return promise;
}

function changeText(change: number | null | undefined): string {
  if (change == null || !Number.isFinite(Number(change))) return '--';
  const n = Number(change);
  return n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
}

/** 标题行成交额：去「亿/万」后缀、少小数，省宽度；完整带单位放 title */
function formatAmountCompact(value: number): { text: string; full: string } {
  const full = formatAmount(value);
  if (value >= 10000) {
    const yi = value / 10000;
    return {
      text: yi >= 100 ? yi.toFixed(0) : yi.toFixed(1),
      full,
    };
  }
  if (value >= 1) {
    return {
      text: value >= 100 ? value.toFixed(0) : value.toFixed(1),
      full,
    };
  }
  return { text: (value * 10000).toFixed(0), full };
}

function HeaderQuote({
  quote,
  showAmount,
}: {
  quote: FullQuote | undefined;
  showAmount: boolean;
}) {
  if (!quote) {
    return <div className={styles.headerQuote}>--</div>;
  }
  const hasAmount =
    showAmount &&
    quote.amount != null &&
    Number.isFinite(Number(quote.amount)) &&
    Number(quote.amount) > 0;
  const amount = hasAmount
    ? formatAmountCompact(Number(quote.amount))
    : null;

  return (
    <div
      className={styles.headerQuote}
      title={[
        formatPrice(quote.price),
        formatPercent(quote.changePercent),
        changeText(quote.change),
        amount?.full,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <span
        className={`${styles.headerQuotePrice} ${getChangeColorClass(quote.changePercent)}`}
      >
        {formatPrice(quote.price)}
      </span>
      <span
        className={`${styles.headerQuotePct} ${getChangeColorClass(quote.changePercent)}`}
      >
        {formatPercent(quote.changePercent)}
      </span>
      <span
        className={`${styles.headerQuoteChg} ${getChangeColorClass(quote.change)}`}
      >
        {changeText(quote.change)}
      </span>
      {amount && (
        <span className={styles.headerQuoteAmount} title={`成交额 ${amount.full}`}>
          {amount.text}
        </span>
      )}
    </div>
  );
}

export function SparkQuoteWidget({
  code,
  klineSymbol,
  quote,
  showAmount = true,
}: SparkQuoteProps) {
  const { settings } = useAppSettings();
  const headerSlot = useWidgetHeaderSlot();
  const quoteSource: QuoteSource =
    settings.quoteSource === 'local' || settings.quoteSource === 'network'
      ? settings.quoteSource
      : 'auto';

  const [bars, setBars] = useState<SparkBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(true);

  const symbol = klineSymbol || code;

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    fetchDailyBars(symbol, quoteSource)
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
  }, [symbol, quoteSource]);

  const todayChg = quote?.changePercent;
  const todayUp =
    todayChg != null && Number.isFinite(todayChg) ? todayChg > 0 : false;
  const todayDown =
    todayChg != null && Number.isFinite(todayChg) ? todayChg < 0 : false;
  const lineColor = todayDown ? '#22c55e' : todayUp ? '#ef4444' : '#94a3b8';
  const areaTop = todayDown
    ? 'rgba(34, 197, 94, 0.28)'
    : todayUp
      ? 'rgba(239, 68, 68, 0.28)'
      : 'rgba(148, 163, 184, 0.22)';
  const areaBottom = todayDown
    ? 'rgba(34, 197, 94, 0)'
    : todayUp
      ? 'rgba(239, 68, 68, 0)'
      : 'rgba(148, 163, 184, 0)';

  const prevClose = useMemo(() => {
    const fromQuote = Number(quote?.prevClose);
    if (Number.isFinite(fromQuote) && fromQuote > 0) return fromQuote;
    if (bars && bars.length >= 2) return bars[bars.length - 2].close;
    return null;
  }, [bars, quote?.prevClose]);

  const ret60 = useMemo(() => {
    if (!bars || bars.length < 2) return null;
    const first = bars[0].close;
    const last = bars[bars.length - 1].close;
    if (!first) return null;
    return ((last - first) / first) * 100;
  }, [bars]);

  const hasVolume = useMemo(
    () => Boolean(bars?.some((b) => b.volume != null && b.volume > 0)),
    [bars]
  );

  const chartOption = useMemo(() => {
    if (!bars?.length) return null;
    const closes = bars.map((b) => b.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const pad = (max - min) * 0.08 || max * 0.002 || 1;
    const hiIdx = closes.indexOf(max);
    const loIdx = closes.indexOf(min);
    const lastIdx = closes.length - 1;
    const volumes = bars.map((b) => b.volume ?? 0);
    const volMax = Math.max(...volumes, 1);

    const markLine =
      prevClose != null
        ? {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed' as const,
              width: 1,
              color: 'rgba(148, 163, 184, 0.55)',
            },
            label: { show: false },
            data: [{ yAxis: prevClose }],
          }
        : undefined;

    const markPoint = {
      symbol: 'circle',
      symbolSize: 5,
      label: { show: false },
      data: [
        {
          coord: [hiIdx, max],
          itemStyle: { color: '#ef4444' },
          symbolSize: 4,
        },
        {
          coord: [loIdx, min],
          itemStyle: { color: '#22c55e' },
          symbolSize: 4,
        },
        {
          coord: [lastIdx, closes[lastIdx]],
          itemStyle: { color: lineColor },
          symbolSize: 6,
        },
      ],
    };

    const priceGrid = hasVolume
      ? { left: 0, right: 0, top: 2, bottom: '24%' }
      : { left: 0, right: 0, top: 2, bottom: 2 };

    const option: Record<string, unknown> = {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: hasVolume
        ? [priceGrid, { left: 0, right: 0, top: '78%', bottom: 0 }]
        : [priceGrid],
      xAxis: hasVolume
        ? [
            {
              type: 'category',
              data: bars.map((b) => b.date),
              show: false,
              gridIndex: 0,
              boundaryGap: false,
            },
            {
              type: 'category',
              data: bars.map((b) => b.date),
              show: false,
              gridIndex: 1,
              boundaryGap: false,
            },
          ]
        : [
            {
              type: 'category',
              data: bars.map((b) => b.date),
              show: false,
              boundaryGap: false,
            },
          ],
      yAxis: hasVolume
        ? [
            {
              type: 'value',
              min: min - pad,
              max: max + pad,
              show: false,
              scale: true,
              gridIndex: 0,
            },
            {
              type: 'value',
              show: false,
              max: volMax * 1.1,
              gridIndex: 1,
            },
          ]
        : [
            {
              type: 'value',
              min: min - pad,
              max: max + pad,
              show: false,
              scale: true,
            },
          ],
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: (params: Array<{ axisValue?: string; data?: number; seriesName?: string }>) => {
          const priceP = params?.find((p) => p.seriesName === 'close') ?? params?.[0];
          if (!priceP) return '';
          const v =
            typeof priceP.data === 'number' ? priceP.data.toFixed(2) : '--';
          const lines = [`${priceP.axisValue || ''}`, `收盘 ${v}`];
          if (prevClose != null && typeof priceP.data === 'number') {
            const vsPrev = ((priceP.data - prevClose) / prevClose) * 100;
            lines.push(`较基准 ${vsPrev >= 0 ? '+' : ''}${vsPrev.toFixed(2)}%`);
          }
          if (typeof priceP.data === 'number' && min > 0) {
            const vsLow = ((priceP.data - min) / min) * 100;
            lines.push(`距窗口低 ${vsLow >= 0 ? '+' : ''}${vsLow.toFixed(2)}%`);
          }
          const volP = params?.find((p) => p.seriesName === 'volume');
          if (volP && typeof volP.data === 'number' && volP.data > 0) {
            lines.push(`量 ${formatVolume(volP.data)}`);
          }
          return lines.join('<br/>');
        },
      },
      series: [
        {
          name: 'close',
          type: 'line',
          data: closes,
          symbol: 'none',
          xAxisIndex: 0,
          yAxisIndex: 0,
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
          markLine,
          markPoint,
        },
      ],
    };

    if (hasVolume) {
      (option.series as unknown[]).push({
        name: 'volume',
        type: 'bar',
        data: volumes,
        xAxisIndex: 1,
        yAxisIndex: 1,
        barWidth: '60%',
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const i = params.dataIndex;
            if (i === 0) return 'rgba(148, 163, 184, 0.35)';
            return closes[i] >= closes[i - 1]
              ? 'rgba(239, 68, 68, 0.35)'
              : 'rgba(34, 197, 94, 0.35)';
          },
        },
      });
    }

    return option;
  }, [areaBottom, areaTop, bars, hasVolume, lineColor, prevClose]);

  const headerNode = <HeaderQuote quote={quote} showAmount={showAmount} />;

  return (
    <>
      {headerSlot ? createPortal(headerNode, headerSlot) : null}
      <div
        className={styles.indexPanelChart}
        onClick={() => openDailyKline(symbol)}
        role="button"
        tabIndex={0}
        title="打开日线 K 线"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDailyKline(symbol);
          }
        }}
      >
        {ret60 != null && Number.isFinite(ret60) && (
          <div
            className={`${styles.retBadge} ${getChangeColorClass(ret60)}`}
            title="近 60 个交易日收益"
          >
            60D {formatPercent(ret60)}
          </div>
        )}
        {chartLoading && (
          <div className={styles.indexPanelChartHint}>加载中…</div>
        )}
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
    </>
  );
}

export { sameCode };
