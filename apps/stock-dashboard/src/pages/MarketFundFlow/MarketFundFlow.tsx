/**
 * 大盘主力净流入 × 上证成交量曲线页
 */

import { useEffect, useMemo, useState } from 'react';
import { LazyEChart } from '@/components/charts/LazyEChart';
import { getChartColors } from '@/components/charts/chartTheme';
import { Card, Loading, Empty } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { useTheme } from '@/hooks';
import { getMarketFundFlow } from '@/services/sdk';
import { formatPercent, formatYuanAmount, getChangeColorClass } from '@/utils/format';
import styles from './MarketFundFlow.module.css';

type FlowRow = Awaited<ReturnType<typeof getMarketFundFlow>>[number];
type IndexVolBar = { date: string; volume: number };

function tsToShanghaiYmd(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

async function fetchIndexVolumeBars(symbol = 'sh000001'): Promise<IndexVolBar[]> {
  const qs = new URLSearchParams({
    symbol,
    period: '1d',
    local_first: '1',
  });
  const res = await fetch(`/api/cache/kline?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || !Array.isArray(data.bars)) {
    throw new Error(data?.error || `kline ${res.status}`);
  }
  return (data.bars as Array<{ timestamp?: number; date?: string; volume?: number }>)
    .map((b) => {
      const vol = Number(b.volume);
      if (!Number.isFinite(vol) || vol <= 0) return null;
      const ts = Number(b.timestamp);
      const date =
        (b.date && String(b.date).slice(0, 10)) ||
        (Number.isFinite(ts) ? tsToShanghaiYmd(ts) : '');
      if (!date) return null;
      return { date, volume: vol };
    })
    .filter((x): x is IndexVolBar => Boolean(x))
    .slice(-120);
}

function formatVolumeCompact(volume: number): string {
  const yi = volume / 1e8;
  if (yi >= 100) return `${yi.toFixed(0)}亿`;
  if (yi >= 1) return `${yi.toFixed(1)}亿`;
  const wan = volume / 1e4;
  if (wan >= 1) return `${wan.toFixed(0)}万`;
  return volume.toFixed(0);
}

export function MarketFundFlow() {
  const { theme } = useTheme();
  const { settings } = useAppSettings();
  const chartColors = useMemo(
    () => getChartColors(theme, settings.colorMode),
    [theme, settings.colorMode]
  );

  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [volBars, setVolBars] = useState<IndexVolBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getMarketFundFlow(), fetchIndexVolumeBars()])
      .then(([flowRows, vols]) => {
        if (cancelled) return;
        setFlow(Array.isArray(flowRows) ? flowRows : []);
        setVolBars(vols);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = flow.at(-1) ?? null;
  const latestVol = volBars.at(-1)?.volume;

  const chartOption = useMemo(() => {
    const colors = chartColors;
    const rows = flow.slice(-90);
    const dates = rows.map((r) => String(r.date || '').slice(0, 10));
    const volByDate = new Map(volBars.map((b) => [b.date, b.volume]));
    const volSeries = dates.map((d) => {
      const v = volByDate.get(d);
      return v == null ? null : v / 1e8;
    });

    return {
      color: [colors.accent, colors.rise],
      grid: { left: 56, right: 56, top: 40, bottom: 32 },
      legend: {
        top: 6,
        textStyle: { color: colors.textTertiary, fontSize: 12 },
        data: ['主力净流入', '上证成交量'],
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: colors.bgElevated,
        borderColor: colors.borderPrimary,
        textStyle: { color: colors.textPrimary, fontSize: 12 },
        valueFormatter: (value: number | null) =>
          value == null || !Number.isFinite(value) ? '--' : value.toFixed(2),
      },
      xAxis: {
        type: 'category',
        data: dates.map((d) => d.slice(5)),
        axisLabel: { color: colors.textTertiary, fontSize: 11 },
        axisLine: { lineStyle: { color: colors.borderSecondary } },
      },
      yAxis: [
        {
          type: 'value',
          name: '亿',
          nameTextStyle: { color: colors.textTertiary, fontSize: 11 },
          axisLabel: {
            color: colors.textTertiary,
            fontSize: 11,
            formatter: (v: number) => `${v.toFixed(0)}`,
          },
          splitLine: { lineStyle: { color: colors.borderSecondary, type: 'dashed' } },
        },
        {
          type: 'value',
          name: '亿手',
          nameTextStyle: { color: colors.textTertiary, fontSize: 11 },
          axisLabel: {
            color: colors.textTertiary,
            fontSize: 11,
            formatter: (v: number) => `${v.toFixed(1)}`,
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '主力净流入',
          type: 'bar',
          data: rows.map((r) =>
            r.mainNetInflow == null ? null : Number(r.mainNetInflow) / 1e8
          ),
          barMaxWidth: 12,
          itemStyle: {
            color: (params: { value: number | null }) =>
              Number(params.value) >= 0 ? colors.rise : colors.fall,
          },
        },
        {
          name: '上证成交量',
          type: 'line',
          yAxisIndex: 1,
          data: volSeries,
          symbol: 'none',
          lineStyle: { width: 1.8, color: colors.accent },
          areaStyle: { color: 'rgba(96, 165, 250, 0.12)' },
        },
      ],
    };
  }, [chartColors, flow, volBars]);

  if (loading) {
    return <Loading fullScreen text="加载大盘主力曲线..." />;
  }

  if (error && flow.length === 0) {
    return (
      <div className={styles.page}>
        <Empty title="加载失败" description={error} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>大盘主力 · 成交量</h1>
          <p className={styles.sub}>
            主力净流入（亿）与上证成交量
            {latest?.date ? ` · ${latest.date}` : ''}
            {latestVol != null ? ` · 近值 ${formatVolumeCompact(latestVol)}` : ''}
          </p>
        </div>
        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>主力净流入</span>
            <span className={`${styles.summaryValue} ${getChangeColorClass(latest?.mainNetInflow)}`}>
              {formatYuanAmount(latest?.mainNetInflow)}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>净占比</span>
            <span
              className={`${styles.summaryValue} ${getChangeColorClass(latest?.mainNetInflowPercent)}`}
            >
              {formatPercent(latest?.mainNetInflowPercent)}
            </span>
          </div>
        </div>
      </div>

      <Card className={styles.chartCard}>
        {flow.length === 0 ? (
          <Empty title="暂无主力资金历史" description="请稍后重试或检查网络" />
        ) : (
          <div className={styles.chartWrap}>
            <LazyEChart option={chartOption} style={{ height: '100%', width: '100%' }} notMerge />
          </div>
        )}
      </Card>
    </div>
  );
}
