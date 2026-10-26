import { useEffect, useMemo, useState } from 'react';
import { LazyEChart } from '@/components/charts/LazyEChart';
import {
  formatAmount,
  formatPercent,
  formatPrice,
  getChangeColorClass,
  normalizeStockCode,
} from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import type { IndexWidgetType } from '../indexCatalog';
import { getIndexCodeByType } from '../indexCatalog';
import styles from '../widgetContent.module.css';

interface Props {
  type: IndexWidgetType;
}

interface SparkBar {
  date: string;
  close: number;
}

function sameIndexCode(a: string, b: string): boolean {
  const na = normalizeStockCode(a) || a;
  const nb = normalizeStockCode(b) || b;
  if (na.toLowerCase() === nb.toLowerCase()) return true;
  const da = na.replace(/^(sh|sz|bj)/i, '');
  const db = nb.replace(/^(sh|sz|bj)/i, '');
  return Boolean(da) && da === db;
}

async function fetchDailyCloses(code: string): Promise<SparkBar[]> {
  const qs = new URLSearchParams({
    symbol: code,
    period: '1d',
  });
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
        (Number.isFinite(ts)
          ? new Date(ts).toISOString().slice(0, 10)
          : '');
      return { date, close };
    })
    .filter((x): x is SparkBar => Boolean(x));
  return bars.slice(-60);
}

/** 单个指数面板 — 紧凑两行；价格可切日线面积图 */
export function IndexWidget({ type }: Props) {
  const { indices } = useDashboardData();
  const code = getIndexCodeByType(type);
  const quote = indices.find((q) => sameIndexCode(q.code, code));
  const [showChart, setShowChart] = useState(false);
  const [bars, setBars] = useState<SparkBar[] | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    if (!showChart) return;
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    fetchDailyCloses(code)
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
  }, [showChart, code]);

  // 红涨绿跌（与看板默认配色一致）；canvas 不能吃 CSS 变量
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
      ? `+${quote.change.toFixed(2)}`
      : (quote.change?.toFixed(2) ?? '--');

  if (showChart) {
    return (
      <div
        className={styles.indexPanelChart}
        onClick={() => setShowChart(false)}
        role="button"
        tabIndex={0}
        title="点击回到报价"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowChart(false);
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
        onClick={() => setShowChart(true)}
      >
        {formatPrice(quote.price)}
      </button>
      <div className={styles.indexPanelMeta}>
        <span className={getChangeColorClass(quote.changePercent)}>
          {formatPercent(quote.changePercent)}
        </span>
        <span className={getChangeColorClass(quote.change)}>{changeText}</span>
        <span className={styles.indexPanelAmount}>
          {formatAmount(quote.amount)}
        </span>
      </div>
    </div>
  );
}
