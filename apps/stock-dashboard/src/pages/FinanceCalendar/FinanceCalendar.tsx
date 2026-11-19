/**
 * 财经日历独立页（侧栏入口）
 */

import { Link } from 'react-router-dom';
import { CalendarEventsWidget } from '@/pages/Dashboard/portal/widgets/CalendarEventsWidget';
import styles from './FinanceCalendar.module.css';

export function FinanceCalendar() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>财经日历</h1>
          <p className={styles.subtitle}>
            东财财经会议 / 经济数据 / 其他事件。可同步日历，并用 AI 对未评级事件打 1–5 星重要性。
          </p>
        </div>
        <Link to="/scheduler" className={styles.link}>
          定时任务
        </Link>
      </header>
      <div className={styles.panel}>
        <CalendarEventsWidget />
      </div>
    </div>
  );
}
