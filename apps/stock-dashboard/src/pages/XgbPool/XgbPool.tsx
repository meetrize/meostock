/**
 * 选股宝池看板：顶部标签 + embed 表格页
 */

import { useLocation } from 'react-router-dom';
import { XgbPoolTabs } from '@/components/XgbPoolTabs';
import styles from './XgbPool.module.css';

const POOL_BY_PATH: Record<string, { title: string; pageUrl: string }> = {
  '/limit-up': { title: '当前涨停', pageUrl: '/limit-up?embed=1' },
  '/limit-down': { title: '当前跌停', pageUrl: '/limit-down?embed=1' },
  '/yesterday-limit-up': { title: '昨天涨停', pageUrl: '/yesterday-limit-up?embed=1' },
};

export function XgbPool() {
  const { pathname } = useLocation();
  const meta = POOL_BY_PATH[pathname] || POOL_BY_PATH['/limit-up'];

  return (
    <div className={styles.page}>
      <XgbPoolTabs />
      <iframe className={styles.frame} title={meta.title} src={meta.pageUrl} />
    </div>
  );
}
