/**
 * 选股宝同系列池：嵌入本地 /limit-up|/limit-down|… 表格页
 */

import { useLocation } from 'react-router-dom';
import styles from './XgbPool.module.css';

const POOLS: Record<
  string,
  { title: string; pageUrl: string; blurb: string }
> = {
  '/limit-up': {
    title: '当前涨停',
    pageUrl: '/limit-up',
    blurb: '选股宝 limit_up · 按概念分组',
  },
  '/limit-down': {
    title: '当前跌停',
    pageUrl: '/limit-down',
    blurb: '选股宝 limit_down · 按概念分组',
  },
  '/yesterday-limit-up': {
    title: '昨日涨停',
    pageUrl: '/yesterday-limit-up',
    blurb: '选股宝 yesterday_limit_up · 按概念分组',
  },
};

export function XgbPool() {
  const { pathname } = useLocation();
  const meta = POOLS[pathname] || POOLS['/limit-up'];

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.title}>{meta.title}</h2>
          <p className={styles.sub}>
            {meta.blurb} · {meta.pageUrl}
          </p>
        </div>
        <div className={styles.links}>
          <a className={styles.link} href={meta.pageUrl} target="_blank" rel="noopener noreferrer">
            新窗口打开
          </a>
          <a className={styles.link} href="/fupan" target="_blank" rel="noopener noreferrer">
            复盘 Demo
          </a>
        </div>
      </div>
      <iframe className={styles.frame} title={meta.title} src={meta.pageUrl} />
    </div>
  );
}
