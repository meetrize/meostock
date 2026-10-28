/**
 * 顶栏数据同步指示：单图标 + 展开分轨矩阵
 */

import { useEffect, useRef, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/contexts/useSyncStatus';
import { LANE_META, LANE_ORDER, type SourceLane } from '@/services/sourceLanes';
import styles from './SyncIndicator.module.css';

export function SyncIndicator() {
  const { tracks, anyActive, requestSyncLane } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const activeTrack = tracks.find((t) => t.active);
  const badge =
    anyActive && activeTrack
      ? `${activeTrack.percent}%`
      : anyActive
        ? '…'
        : null;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${anyActive ? styles.active : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="数据同步（按来源分轨）"
        aria-expanded={open}
      >
        {anyActive ? (
          <RefreshCw size={16} className={styles.spin} />
        ) : (
          <Database size={16} />
        )}
        {badge && <span className={styles.badge}>{badge}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="数据同步">
          <div className={styles.panelTitle}>数据来源同步</div>
          <ul className={styles.list}>
            {LANE_ORDER.map((lane) => {
              const t = tracks.find((x) => x.lane === lane)!;
              const meta = LANE_META[lane as SourceLane];
              return (
                <li key={lane} className={styles.row}>
                  <span
                    className={styles.dot}
                    style={{ background: meta.colorVar }}
                    title={meta.title}
                  />
                  <div className={styles.meta}>
                    <div className={styles.rowTop}>
                      <span className={styles.laneLabel}>{meta.title}</span>
                      <span className={styles.pct}>
                        {t.active ? `${t.percent}%` : '空闲'}
                      </span>
                    </div>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          width: `${t.active ? t.percent : 0}%`,
                          background: meta.colorVar,
                        }}
                      />
                    </div>
                    <div className={styles.msg}>
                      {t.active
                        ? t.marketLabel || t.message || '同步中…'
                        : t.message || '点击右侧同步本轨'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.syncBtn}
                    disabled={t.active}
                    onClick={() => void requestSyncLane(lane)}
                  >
                    同步
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.hint}>同步在后台进行，不打断当前页面</p>
        </div>
      )}
    </div>
  );
}
