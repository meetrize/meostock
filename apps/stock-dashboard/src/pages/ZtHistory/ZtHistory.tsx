/**
 * 涨跌停历史：选日期 + 涨停/跌停，iframe 回放当日快照
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { XgbPoolTabs } from '@/components/XgbPoolTabs';
import styles from './ZtHistory.module.css';

type PoolKey = 'limit_up' | 'limit_down';

interface DateRow {
  trade_date: string;
  pool: string;
  stock_count?: number;
  theme_count?: number;
  captured_at?: number;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function ymdToInput(ymd: string) {
  if (ymd.length !== 8) return '';
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function ymdParts(ymd: string): { y: number; m: number; d: number } | null {
  if (ymd.length !== 8) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function toYmd(y: number, m: number, d: number) {
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function buildMonthCells(year: number, month: number) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startPad = first.getDay();
  const cells: Array<{ ymd: string; day: number; inMonth: boolean } | null> = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ ymd: toYmd(year, month, d), day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function HistoryDateCalendar({
  value,
  available,
  onChange,
  disabled,
}: {
  value: string;
  available: Set<string>;
  onChange: (ymd: string) => void;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = ymdParts(value);
  const [viewY, setViewY] = useState(selected?.y ?? new Date().getFullYear());
  const [viewM, setViewM] = useState(selected?.m ?? new Date().getMonth() + 1);

  useEffect(() => {
    if (!open) return;
    const parts = ymdParts(value);
    if (parts) {
      setViewY(parts.y);
      setViewM(parts.m);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCells(viewY, viewM), [viewY, viewM]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewY, viewM - 1 + delta, 1);
    setViewY(d.getFullYear());
    setViewM(d.getMonth() + 1);
  };

  return (
    <div className={styles.calWrap} ref={rootRef}>
      <button
        type="button"
        className={styles.calTrigger}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {ymdToInput(value) || '选择交易日'}
      </button>
      {open ? (
        <div className={styles.calPanel} role="dialog" aria-label="选择交易日">
          <div className={styles.calHead}>
            <button type="button" className={styles.calNav} onClick={() => shiftMonth(-1)} aria-label="上一月">
              <ChevronLeft size={16} />
            </button>
            <span className={styles.calTitle}>
              {viewY}年{viewM}月
            </span>
            <button type="button" className={styles.calNav} onClick={() => shiftMonth(1)} aria-label="下一月">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className={styles.calWeek}>
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className={styles.calGrid}>
            {cells.map((cell, i) => {
              if (!cell) return <span key={`e-${i}`} className={styles.calEmpty} />;
              const hasHistory = available.has(cell.ymd);
              const isSelected = cell.ymd === value;
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  className={[
                    styles.calDay,
                    hasHistory ? styles.calDayAvail : styles.calDayDisabled,
                    isSelected ? styles.calDaySelected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!hasHistory}
                  title={hasHistory ? cell.ymd : '无历史快照'}
                  onClick={() => {
                    if (!hasHistory) return;
                    onChange(cell.ymd);
                    setOpen(false);
                  }}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          {available.size === 0 ? <div className={styles.calHint}>暂无已落库交易日</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ZtHistory() {
  const [pool, setPool] = useState<PoolKey>('limit_up');
  const [dates, setDates] = useState<DateRow[]>([]);
  const [date, setDate] = useState('');
  const [loadingDates, setLoadingDates] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [msg, setMsg] = useState('');

  const availableSet = useMemo(() => new Set(dates.map((d) => d.trade_date)), [dates]);

  const loadDates = useCallback(async (p: PoolKey) => {
    setLoadingDates(true);
    setMsg('');
    try {
      const res = await fetch(`/api/zt/history/dates?pool=${encodeURIComponent(p)}&limit=180`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '加载日期失败');
      const rows = (data.dates || []) as DateRow[];
      setDates(rows);
      setDate((prev) => {
        if (prev && rows.some((r) => r.trade_date === prev)) return prev;
        return rows[0]?.trade_date || todayYmd();
      });
    } catch (e) {
      setDates([]);
      setMsg(e instanceof Error ? e.message : String(e));
      setDate((prev) => prev || todayYmd());
    } finally {
      setLoadingDates(false);
    }
  }, []);

  useEffect(() => {
    void loadDates(pool);
  }, [pool, loadDates]);

  const frameSrc = useMemo(() => {
    if (!date || date.length !== 8) return '';
    const path = pool === 'limit_down' ? '/limit-down' : '/limit-up';
    return `${path}?embed=1&date=${encodeURIComponent(date)}`;
  }, [date, pool]);

  const onCapture = async () => {
    setCapturing(true);
    setMsg('');
    try {
      const q = new URLSearchParams({
        force: '1',
        pool,
      });
      if (date) q.set('date', date);
      const res = await fetch(`/api/zt/history/capture?${q.toString()}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok && !data.skipped) throw new Error(data.error || '落库失败');
      setMsg(
        data.skipped
          ? `已跳过：${data.reason || '非交易日'}`
          : `已落库 ${data.trade_date || date} · ${pool === 'limit_down' ? '跌停' : '涨停'} ${data.stock_count ?? data.pools?.[pool]?.stock_count ?? ''} 只`
      );
      await loadDates(pool);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className={styles.page}>
      <XgbPoolTabs />
      <div className={styles.toolbar}>
        <div className={styles.poolTabs}>
          <button
            type="button"
            className={pool === 'limit_up' ? styles.poolActive : styles.poolBtn}
            onClick={() => setPool('limit_up')}
          >
            涨停历史
          </button>
          <button
            type="button"
            className={pool === 'limit_down' ? styles.poolActive : styles.poolBtn}
            onClick={() => setPool('limit_down')}
          >
            跌停历史
          </button>
        </div>
        <label className={styles.dateLabel}>
          交易日
          <HistoryDateCalendar
            value={date}
            available={availableSet}
            disabled={loadingDates}
            onChange={setDate}
          />
        </label>
        <select
          className={styles.dateSelect}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={loadingDates || dates.length === 0}
          title="已落库日期"
        >
          {dates.length === 0 ? (
            <option value={date || ''}>暂无快照</option>
          ) : (
            dates.map((d) => (
              <option key={d.trade_date} value={d.trade_date}>
                {d.trade_date}（{d.stock_count ?? 0} 只）
              </option>
            ))
          )}
        </select>
        <button type="button" className={styles.captureBtn} disabled={capturing} onClick={() => void onCapture()}>
          {capturing ? '落库中…' : '抓取并落库'}
        </button>
        <NavLink className={styles.liveLink} to={pool === 'limit_down' ? '/limit-down' : '/limit-up'}>
          回实时池
        </NavLink>
        {msg ? <span className={styles.msg}>{msg}</span> : null}
      </div>
      {frameSrc ? (
        <iframe className={styles.frame} title="涨跌停历史" src={frameSrc} />
      ) : (
        <div className={styles.empty}>请选择交易日</div>
      )}
    </div>
  );
}
