/**
 * 形态回测：全市场本地日 K 滚动匹配量价齐升事件
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, LayoutGrid, Play, Square, RotateCcw } from 'lucide-react';
import { Button, Empty, useToast } from '@/components/common';
import { openKlineTool, openMultipanelEntries } from '@/utils/multipanel';
import styles from './PatternBacktest.module.css';

type VprCheckKey =
  | 'require_price_rise'
  | 'require_vol_lift'
  | 'require_sync'
  | 'require_near_high'
  | 'require_ma20_up'
  | 'cap_price_rise'
  | 'up_day_vol_share'
  | 'max_day_vol'
  | 'require_break_hold'
  | 'tag_ma5_pullback'
  | 'exclude_st';

type VprCheckState = Record<VprCheckKey, boolean>;

const VPR_CHECK_ITEMS: {
  key: VprCheckKey;
  group: 'core' | 'enhance' | 'filter';
  label: string;
  hint?: string;
}[] = [
  { key: 'require_price_rise', group: 'core', label: '窗口收盘涨幅达标（≥8%）' },
  { key: 'require_vol_lift', group: 'core', label: '后半段均量抬升（≥1.5×前半段）' },
  { key: 'require_sync', group: 'core', label: '上涨日多数放量（同步率≥55%）' },
  { key: 'require_near_high', group: 'core', label: '收盘贴近窗口高点（≤5%）' },
  { key: 'require_ma20_up', group: 'enhance', label: '收盘站上 MA20 且均线上行' },
  { key: 'cap_price_rise', group: 'enhance', label: '窗口涨幅未过热（≤25%）' },
  { key: 'up_day_vol_share', group: 'enhance', label: '上涨日量能占比≥55%' },
  { key: 'max_day_vol', group: 'enhance', label: '无极端单日堆量（峰值≤6×均量）' },
  {
    key: 'require_break_hold',
    group: 'enhance',
    label: '突破近 20 日前高并站稳',
  },
  {
    key: 'tag_ma5_pullback',
    group: 'enhance',
    label: '标记更优买点：缩量贴近 MA5',
    hint: '仅标签，不否决',
  },
  { key: 'exclude_st', group: 'filter', label: '排除 ST' },
];

const DEFAULT_VPR_CHECKS: VprCheckState = {
  require_price_rise: true,
  require_vol_lift: true,
  require_sync: true,
  require_near_high: true,
  require_ma20_up: true,
  cap_price_rise: true,
  up_day_vol_share: true,
  max_day_vol: true,
  require_break_hold: true,
  tag_ma5_pullback: true,
  exclude_st: true,
};

function buildVprRuleOverrides(checks: VprCheckState): Record<string, Record<string, unknown>> {
  const anyEnhance =
    checks.require_ma20_up ||
    checks.cap_price_rise ||
    checks.up_day_vol_share ||
    checks.max_day_vol ||
    checks.require_break_hold ||
    checks.tag_ma5_pullback;
  return {
    'volume.price_sync_rise': {
      require_price_rise: checks.require_price_rise,
      require_vol_lift: checks.require_vol_lift,
      require_sync: checks.require_sync,
      require_near_high: checks.require_near_high,
      enhancements: anyEnhance,
      require_ma20_up: checks.require_ma20_up,
      max_price_rise_pct: checks.cap_price_rise ? 25.0 : null,
      min_up_day_vol_share: checks.up_day_vol_share ? 0.55 : null,
      max_day_vol_multiple: checks.max_day_vol ? 6.0 : null,
      require_break_hold: checks.require_break_hold,
      break_lookback: 20,
      tag_ma5_pullback: checks.tag_ma5_pullback,
    },
    'quote.exclude_st': { enabled: checks.exclude_st },
  };
}

type PatternHit = {
  symbol: string;
  name: string;
  window_start?: string;
  signal_date: string;
  signal_end?: string;
  run_days?: number;
  close?: number;
  fwd_5?: number | null;
  fwd_10?: number | null;
  fwd_20?: number | null;
  why_hit?: string[];
  factors?: Record<string, unknown>;
};

type ProgressState = {
  active?: boolean;
  run_id?: string | null;
  total?: number;
  done?: number;
  hit_count?: number;
  skipped_no_kline?: number;
  skipped_short?: number;
  error_count?: number;
  current?: string | null;
  message?: string;
  finished_at?: string | null;
  cancel_requested?: boolean;
};

const SORT_OPTIONS = [
  { value: 'signal_date_desc', label: '信号日 ↓' },
  { value: 'signal_date_asc', label: '信号日 ↑' },
  { value: 'fwd_5_desc', label: '5日收益 ↓' },
  { value: 'fwd_10_desc', label: '10日收益 ↓' },
  { value: 'fwd_20_desc', label: '20日收益 ↓' },
  { value: 'symbol_asc', label: '代码 ↑' },
] as const;

function rowKey(hit: PatternHit, idx: number): string {
  return `${hit.symbol}|${hit.signal_date}|${hit.signal_end || ''}|${idx}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function pctClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return styles.num;
  const n = Number(v);
  if (n > 0) return `${styles.num} ${styles.pos}`;
  if (n < 0) return `${styles.num} ${styles.neg}`;
  return styles.num;
}

export function PatternBacktest() {
  const toast = useToast();
  const [checks, setChecks] = useState<VprCheckState>({ ...DEFAULT_VPR_CHECKS });
  const [progress, setProgress] = useState<ProgressState>({});
  const [results, setResults] = useState<PatternHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [disclaimer, setDisclaimer] = useState('');
  const [sort, setSort] = useState<string>('signal_date_desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingResults, setLoadingResults] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch('/api/research/pattern-events/progress', { cache: 'no-store' });
      const data = await res.json();
      if (data?.ok && data.progress) {
        setProgress(data.progress as ProgressState);
        return data.progress as ProgressState;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const fetchResults = useCallback(
    async (sortKey = sort) => {
      setLoadingResults(true);
      try {
        const qs = new URLSearchParams({
          offset: '0',
          limit: '500',
          sort: sortKey,
        });
        const res = await fetch(`/api/research/pattern-events/results?${qs}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (data?.ok) {
          setResults(Array.isArray(data.results) ? data.results : []);
          setTotalHits(Number(data.total_hits) || 0);
          if (typeof data.disclaimer === 'string') setDisclaimer(data.disclaimer);
        }
      } catch (e) {
        toast.error(`拉取结果失败: ${e instanceof Error ? e.message : e}`);
      } finally {
        setLoadingResults(false);
      }
    },
    [sort, toast]
  );

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      const p = await fetchProgress();
      if (!p) return;
      if (!p.active) {
        stopPoll();
        await fetchResults();
      }
    }, 1200);
  }, [fetchProgress, fetchResults, stopPoll]);

  useEffect(() => {
    void (async () => {
      const p = await fetchProgress();
      await fetchResults();
      if (p?.active) startPoll();
    })();
    return () => stopPoll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchResults(sort);
  }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = useCallback(async () => {
    try {
      const overrides = buildVprRuleOverrides(checks);
      const res = await fetch('/api/research/pattern-events/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id: 'volume_price_rise',
          rule_param_overrides: overrides,
          exclude_st: checks.exclude_st,
          dedupe: 'run',
        }),
      });
      const data = await res.json();
      if (!data?.ok) {
        toast.error(data?.error || '启动扫描失败');
        if (data?.progress) setProgress(data.progress);
        return;
      }
      setResults([]);
      setSelected(new Set());
      setTotalHits(0);
      if (data.progress) setProgress(data.progress);
      toast.success('已开始全市场形态扫描');
      startPoll();
    } catch (e) {
      toast.error(`启动失败: ${e instanceof Error ? e.message : e}`);
    }
  }, [checks, startPoll, toast]);

  const handleCancel = useCallback(async () => {
    try {
      await fetch('/api/research/pattern-events/cancel', { method: 'POST' });
      toast.info('已请求取消');
      await fetchProgress();
    } catch (e) {
      toast.error(`取消失败: ${e instanceof Error ? e.message : e}`);
    }
  }, [fetchProgress, toast]);

  const toggleCheck = useCallback((key: VprCheckKey) => {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const openHit = useCallback((hit: PatternHit, idx: number) => {
    const list = results.map((r) => r.symbol);
    const dates = results.map((r) => r.signal_date);
    openKlineTool(hit.symbol, '1d', {
      symbols: list.length >= 2 ? list : undefined,
      dates: list.length >= 2 ? dates : undefined,
      index: idx,
      date: hit.signal_date,
      bias: 'left',
    });
  }, [results]);

  const selectedHits = useMemo(() => {
    return results.filter((hit, idx) => selected.has(rowKey(hit, idx)));
  }, [results, selected]);

  const openSelectedMultipanel = useCallback(() => {
    const entries = selectedHits.map((h) => ({
      symbol: h.symbol,
      date: h.signal_date,
    }));
    if (!entries.length) {
      toast.info('请先勾选结果行');
      return;
    }
    openMultipanelEntries(entries, { period: '1d', bias: 'left' });
  }, [selectedHits, toast]);

  const toggleRow = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const keys = results.map((h, i) => rowKey(h, i));
      const allOn = keys.length > 0 && keys.every((k) => prev.has(k));
      if (allOn) return new Set();
      return new Set(keys);
    });
  }, [results]);

  const pct =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100))
      : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <History size={22} />
          形态回测
        </h1>
        <p className={styles.subtitle}>
          全市场本地日 K 滚动匹配「量价齐升」命中段；点开日 K 时信号日偏左锚定，便于观察右侧后续走势。仅扫描已入库 K
          线，缺数据标的会被跳过。
        </p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.side}>
          <div className={styles.sideTitle}>量价齐升规则</div>
          <div className={styles.vprCheckList}>
            {(['core', 'enhance', 'filter'] as const).map((group) => {
              const items = VPR_CHECK_ITEMS.filter((i) => i.group === group);
              const title =
                group === 'core' ? '核心' : group === 'enhance' ? '增强' : '过滤';
              return (
                <div key={group} className={styles.vprCheckGroup}>
                  <div className={styles.vprCheckGroupTitle}>{title}</div>
                  {items.map((item) => (
                    <label
                      key={item.key}
                      className={`${styles.vprCheckItem} ${
                        checks[item.key] ? styles.vprChecked : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checks[item.key]}
                        onChange={() => toggleCheck(item.key)}
                      />
                      <span>{item.label}</span>
                      {item.hint ? (
                        <span className={styles.vprCheckHint}>{item.hint}</span>
                      ) : null}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="sm"
              disabled={!!progress.active}
              onClick={() => void handleStart()}
            >
              <Play size={14} />
              开始扫描
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!progress.active}
              onClick={() => void handleCancel()}
            >
              <Square size={14} />
              取消
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChecks({ ...DEFAULT_VPR_CHECKS })}
            >
              <RotateCcw size={14} />
              重置勾选
            </Button>
          </div>
        </aside>

        <section className={styles.main}>
          <div className={styles.progressBox}>
            <div>{progress.message || (progress.active ? '扫描中…' : '就绪')}</div>
            {(progress.active || (progress.total || 0) > 0) && (
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${pct}%` }} />
              </div>
            )}
            <div className={styles.meta}>
              {progress.active
                ? `进度 ${progress.done || 0}/${progress.total || 0}（${pct}%）· 命中段 ${
                    progress.hit_count || 0
                  } · 缺K ${progress.skipped_no_kline || 0}`
                : totalHits
                  ? `共 ${totalHits} 段命中${loadingResults ? ' · 刷新中…' : ''}`
                  : '尚无结果'}
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <select
                className={styles.select}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={toggleAllVisible}>
                {results.length && results.every((h, i) => selected.has(rowKey(h, i)))
                  ? '取消全选'
                  : '全选本页'}
              </Button>
            </div>
            <div className={styles.toolbarRight}>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedHits.length}
                onClick={openSelectedMultipanel}
              >
                <LayoutGrid size={14} />
                多面板打开选中（{selectedHits.length}）
              </Button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            {results.length === 0 ? (
              <div className={styles.empty}>
                <Empty
                  description={
                    progress.active
                      ? '扫描进行中，完成后自动刷新…'
                      : '点击「开始扫描」在全市场本地日 K 上找量价齐升命中段'
                  }
                />
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkCell} />
                    <th>标的</th>
                    <th>信号日</th>
                    <th>持续</th>
                    <th>窗口起</th>
                    <th>收盘</th>
                    <th>5日</th>
                    <th>10日</th>
                    <th>20日</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((hit, idx) => {
                    const key = rowKey(hit, idx);
                    const on = selected.has(key);
                    return (
                      <tr
                        key={key}
                        className={on ? styles.selected : undefined}
                        onClick={() => openHit(hit, idx)}
                      >
                        <td
                          className={styles.checkCell}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(key);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleRow(key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>
                          <div className={styles.nameCell}>
                            <strong>{hit.name || hit.symbol}</strong>
                            <span>{hit.symbol}</span>
                          </div>
                        </td>
                        <td className={styles.num}>{hit.signal_date}</td>
                        <td className={styles.num}>
                          {hit.run_days != null ? `${hit.run_days}日` : '—'}
                        </td>
                        <td className={styles.num}>{hit.window_start || '—'}</td>
                        <td className={styles.num}>
                          {hit.close != null ? Number(hit.close).toFixed(2) : '—'}
                        </td>
                        <td className={pctClass(hit.fwd_5)}>{fmtPct(hit.fwd_5)}</td>
                        <td className={pctClass(hit.fwd_10)}>{fmtPct(hit.fwd_10)}</td>
                        <td className={pctClass(hit.fwd_20)}>{fmtPct(hit.fwd_20)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {disclaimer ? <p className={styles.disclaimer}>{disclaimer}</p> : null}
        </section>
      </div>
    </div>
  );
}
