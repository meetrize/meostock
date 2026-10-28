/**
 * 设置页：四轨来源矩阵 + Tushare 定时 / 清空
 */

import { useCallback, useEffect, useState } from 'react';
import { useSyncStatus } from '@/contexts';
import { LANE_META, LANE_ORDER, type SourceLane } from '@/services/sourceLanes';
import {
  clearTushareCache,
  fetchTushareSchedule,
  setTushareSchedule,
} from '@/services/tushare';
import { useToast } from '@/components/common';
import styles from './SourceLaneMatrix.module.css';

export function SourceLaneMatrix() {
  const toast = useToast();
  const { tracks, requestSyncLane } = useSyncStatus();
  const [tsEnabled, setTsEnabled] = useState(true);
  const [tsLastRun, setTsLastRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshSchedule = useCallback(async () => {
    try {
      const s = await fetchTushareSchedule();
      if (s.ok) {
        setTsEnabled(Boolean(s.enabled));
        setTsLastRun(s.last_run ? String(s.last_run) : null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshSchedule();
  }, [refreshSchedule]);

  const onToggleSchedule = async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await setTushareSchedule(enabled);
      if (!r.ok) throw new Error(r.error || '更新失败');
      setTsEnabled(Boolean(r.enabled ?? enabled));
      toast.success(enabled ? '已开启 Tushare 定时（需服务常开）' : '已关闭 Tushare 定时');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onClearTs = async () => {
    setBusy(true);
    try {
      const r = await clearTushareCache();
      if (!r.ok) throw new Error(r.error || '清空失败');
      toast.success('已清空 Tushare 专题缓存');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        按数据来源分轨同步；进度在顶栏查看，不打断当前页面。服务常开时 Tushare 工作日 15:30 / 16:00 自动补跑。
      </p>
      <div className={styles.grid}>
        {LANE_ORDER.map((lane) => {
          const meta = LANE_META[lane as SourceLane];
          const track = tracks.find((t) => t.lane === lane);
          const active = Boolean(track?.active);
          return (
            <div key={lane} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.dot} style={{ background: meta.colorVar }} />
                <strong>{meta.title}</strong>
                <span className={styles.pct}>{active ? `${track?.percent ?? 0}%` : '空闲'}</span>
              </div>
              <p className={styles.cardDesc}>
                {active
                  ? track?.marketLabel || track?.message || '同步中…'
                  : lane === 'tushare'
                    ? '涨跌停 / 板块 / ETF / 可转债 / 资金流等'
                    : meta.title}
              </p>
              <button
                type="button"
                className={styles.syncBtn}
                disabled={active}
                onClick={() => void requestSyncLane(lane).catch((e) => toast.error(String(e)))}
              >
                同步本轨
              </button>
              {lane === 'tushare' && (
                <div className={styles.tsExtras}>
                  <label className={styles.switchRow}>
                    <input
                      type="checkbox"
                      checked={tsEnabled}
                      disabled={busy}
                      onChange={(e) => void onToggleSchedule(e.target.checked)}
                    />
                    <span>定时同步（15:30+16:00）</span>
                  </label>
                  {tsLastRun && (
                    <div className={styles.lastRun}>上次：{tsLastRun}</div>
                  )}
                  <button
                    type="button"
                    className={styles.clearBtn}
                    disabled={busy}
                    onClick={() => void onClearTs()}
                  >
                    清空专题缓存
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
