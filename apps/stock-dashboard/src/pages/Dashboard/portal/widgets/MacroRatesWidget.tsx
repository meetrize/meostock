/**
 * 宏观利率 KPI：联储目标 / EFFR / 美债曲线 / 实际利率 / FedWatch 入口
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchMacroRates,
  type MacroRateSeries,
  type MacroRatesPayload,
} from '@/services/macroRates';
import { getChangeColorClass } from '@/utils/format';
import styles from '../widgetContent.module.css';

const PRIMARY_IDS = [
  'fed_target',
  'effr',
  'ust_2y',
  'ust_10y',
  'ust_30y',
  'spread_10y2y',
  'real_10y',
] as const;

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '--';
  return `${v.toFixed(digits)}%`;
}

function fmtBp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '--';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)} bp`;
}

function pickSeries(
  series: MacroRateSeries[] | undefined,
  id: string
): MacroRateSeries | undefined {
  return (series || []).find((s) => s.id === id);
}

export function MacroRatesWidget() {
  const [data, setData] = useState<MacroRatesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    const payload = await fetchMacroRates({ force });
    setData(payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(false);
    const t = window.setInterval(() => void load(false), 5 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [load]);

  const series = data?.series || [];
  const policy = data?.policy_expectation;
  const proxyBp = policy?.proxy_short_vs_target_upper_bp;

  if (loading && !data) {
    return <div className={styles.macroEmpty}>加载宏观利率…</div>;
  }

  if (!data?.ok && series.length === 0) {
    return (
      <div className={styles.macroEmpty}>
        宏观利率暂不可用{data?.error ? `：${data.error}` : ''}
        <button type="button" className={styles.macroLinkBtn} onClick={() => void load(true)}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className={styles.macroRoot}>
      <div className={styles.macroGrid}>
        {PRIMARY_IDS.map((id) => {
          const s = pickSeries(series, id);
          const value =
            id === 'fed_target' && s?.note
              ? s.note
              : id === 'spread_10y2y'
                ? s?.value != null
                  ? `${s.value >= 0 ? '+' : ''}${s.value.toFixed(2)}%`
                  : '--'
                : fmtPct(s?.value ?? null);
          const tone =
            id === 'spread_10y2y' || id === 'real_10y'
              ? getChangeColorClass(s?.value ?? 0)
              : '';
          return (
            <div key={id} className={styles.macroCard} title={s?.note || s?.source || ''}>
              <div className={styles.macroLabel}>{s?.name || id}</div>
              <div className={`${styles.macroValue} ${tone}`}>{value}</div>
              <div className={styles.macroAsOf}>{s?.as_of || data?.as_of || ''}</div>
            </div>
          );
        })}
      </div>

      <div className={styles.macroPolicy}>
        <div className={styles.macroPolicyMain}>
          <span className={styles.macroLabel}>政策利率预期</span>
          <span className={styles.macroPolicyName}>{policy?.provider || 'CME FedWatch'}</span>
          {proxyBp != null && (
            <span
              className={`${styles.macroProxy} ${getChangeColorClass(proxyBp)}`}
              title={policy?.proxy_note || ''}
            >
              短端相对目标 {fmtBp(proxyBp)}
            </span>
          )}
        </div>
        <div className={styles.macroPolicyActions}>
          {policy?.url && (
            <a
              className={styles.macroLinkBtn}
              href={policy.url}
              target="_blank"
              rel="noreferrer"
            >
              打开 FedWatch
            </a>
          )}
          <button type="button" className={styles.macroLinkBtn} onClick={() => void load(true)}>
            刷新
          </button>
        </div>
      </div>
      {policy?.note && <div className={styles.macroHint}>{policy.note}</div>}
    </div>
  );
}
