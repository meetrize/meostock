/**
 * 应用主布局
 */

import { useCallback, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '@/components/common';
import styles from './Layout.module.css';

const SIDEBAR_STORAGE_KEY = 'app.sidebarCollapsed';

function getStoredSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // localStorage 不可用
  }
}

export function Layout() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div
      className={`${styles.layout}${sidebarCollapsed ? ` ${styles.sidebarCollapsed}` : ''}`}
    >
      <Sidebar collapsed={sidebarCollapsed} />
      <Header
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <main className={styles.main}>
        <div className={styles.content}>
          {/* key 按路径复位：某页渲染崩溃后导航到其他页可自动恢复 */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
        <footer className={styles.footer}>
          <span>数据来源：</span>
          <a
            href="https://stock-sdk.linkdiary.cn/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Stock SDK
          </a>
          <span className={styles.divider}>|</span>
          <span>仅供学习参考，不构成投资建议</span>
        </footer>
      </main>
    </div>
  );
}
