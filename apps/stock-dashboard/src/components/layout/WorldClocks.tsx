/**
 * 顶栏世界时钟：主要金融市场当地时间 + 常规交易时段
 * 宽屏直接展示卡片；窄屏收成图标，点击弹出菜单
 */

import { useEffect, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import {
  formatSessionsLabel,
  snapshotMarketClocks,
  type MarketClockSnapshot,
} from '@/utils/marketSessions';
import styles from './WorldClocks.module.css';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function buildTitle(item: MarketClockSnapshot): string {
  const status = item.open ? '交易中' : '休市';
  const countdown = item.open
    ? ''
    : `\n距开市 ${pad2(item.openIn.hours)}:${pad2(item.openIn.minutes)}`;
  return `${item.market.fullName}（${item.market.timeZone}）\n当地 周${item.weekdayLabel} ${item.dateLabel} ${item.timeLabel} · ${status}${countdown}\n常规时段 ${formatSessionsLabel(item.market)}（不含节假日）`;
}

function ClockCard({ item }: { item: MarketClockSnapshot }) {
  return (
    <div
      className={`${styles.item} ${item.open ? styles.open : styles.closed}`}
      title={buildTitle(item)}
    >
      {!item.open && (
        <span
          className={styles.countdown}
          aria-label={`距开市 ${item.openIn.hours}小时${item.openIn.minutes}分`}
        >
          <span className={styles.countdownBox}>{pad2(item.openIn.hours)}</span>
          <span className={styles.countdownBox}>{pad2(item.openIn.minutes)}</span>
        </span>
      )}
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.name}>{item.market.shortName}</span>
          <span className={styles.hours}>{item.market.hoursLabel}</span>
        </div>
        <div className={styles.bottom}>
          <span className={styles.time}>{item.timeLabel}</span>
          <span className={styles.date}>{item.dateLabel}</span>
          <span className={styles.weekday}>{item.weekdayLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function WorldClocks() {
  const [items, setItems] = useState<MarketClockSnapshot[]>(() => snapshotMarketClocks());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anyOpen = items.some((item) => item.open);

  useEffect(() => {
    const tick = () => setItems(snapshotMarketClocks());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

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

  return (
    <div
      className={styles.root}
      ref={rootRef}
      role="group"
      aria-label="全球主要交易所时钟"
    >
      <div className={styles.inline}>
        {items.map((item) => (
          <ClockCard key={item.market.id} item={item} />
        ))}
      </div>

      <button
        type="button"
        className={`${styles.compactTrigger} ${anyOpen ? styles.compactOpen : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="全球市场时间"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Globe2 size={18} />
        {anyOpen && <span className={styles.compactDot} aria-hidden />}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="全球主要交易所时钟">
          <div className={styles.panelTitle}>全球市场时间</div>
          <div className={styles.panelList}>
            {items.map((item) => (
              <ClockCard key={item.market.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
