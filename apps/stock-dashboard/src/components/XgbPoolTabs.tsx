/**
 * 涨停相关页顶部标签：当前涨停 / 当前跌停 / 昨天涨停 / 复盘
 */

import { NavLink } from 'react-router-dom';
import styles from './XgbPoolTabs.module.css';

const TABS = [
  { to: '/limit-up', label: '当前涨停' },
  { to: '/limit-down', label: '当前跌停' },
  { to: '/yesterday-limit-up', label: '昨天涨停' },
  { to: '/zt-history', label: '涨跌停历史' },
  { to: '/fupan', label: '复盘' },
] as const;

export function XgbPoolTabs() {
  return (
    <div className={styles.tabs}>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `${styles.tab}${isActive ? ` ${styles.tabActive}` : ''}`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
