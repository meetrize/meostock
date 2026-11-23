/**
 * 当前涨停池：嵌入本地 /limit-up（选股宝 limit_up，按概念分组）
 */

import styles from './LimitUpPool.module.css';

const PAGE_URL = '/limit-up';

export function LimitUpPool() {
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.title}>当前涨停</h2>
          <p className={styles.sub}>
            选股宝涨停池 · 按关联概念分组 · 组内按首封时间排序 · {PAGE_URL}
          </p>
        </div>
        <div className={styles.links}>
          <a className={styles.link} href={PAGE_URL} target="_blank" rel="noopener noreferrer">
            新窗口打开
          </a>
          <a className={styles.link} href="/fupan" target="_blank" rel="noopener noreferrer">
            复盘 Demo
          </a>
        </div>
      </div>
      <iframe className={styles.frame} title="当前涨停" src={PAGE_URL} />
    </div>
  );
}
