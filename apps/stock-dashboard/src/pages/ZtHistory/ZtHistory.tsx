/**
 * 涨跌停历史：选日期 + 涨停/跌停，iframe 回放当日快照
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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

function inputToYmd(v: string) {
  return v.replace(/\D/g, '').slice(0, 8);
}

export function ZtHistory() {
  const [pool, setPool] = useState<PoolKey>('limit_up');
  const [dates, setDates] = useState<DateRow[]>([]);
  const [date, setDate] = useState('');
  const [loadingDates, setLoadingDates] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [msg, setMsg] = useState('');

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
          <input
            type="date"
            value={ymdToInput(date)}
            onChange={(e) => setDate(inputToYmd(e.target.value))}
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
