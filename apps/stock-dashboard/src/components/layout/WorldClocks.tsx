/**
 * 顶栏世界时钟：主要金融市场当地时间 + 常规交易时段
 */

import { useEffect, useState } from 'react';
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

export function WorldClocks() {
  const [items, setItems] = useState<MarketClockSnapshot[]>(() => snapshotMarketClocks());

  useEffect(() => {
    const tick = () => setItems(snapshotMarketClocks());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={styles.root} role="group" aria-label="全球主要交易所时钟">
      {items.map((item) => (
        <div
          key={item.market.id}
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
      ))}
    </div>
  );
}
