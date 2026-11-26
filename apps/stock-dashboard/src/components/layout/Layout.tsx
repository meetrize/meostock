/**
 * 应用主布局
 */

import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '@/components/common';
import { noteLocalWrite } from '@/services/prefSync';
import styles from './Layout.module.css';

const SIDEBAR_STORAGE_KEY = 'app.sidebarCollapsed';
const MOBILE_MQ = '(max-width: 768px)';

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
    const v = collapsed ? '1' : '0';
    localStorage.setItem(SIDEBAR_STORAGE_KEY, v);
    noteLocalWrite(SIDEBAR_STORAGE_KEY, v);
  } catch {
    // localStorage 不可用
  }
}

function useIsMobileLayout() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return mobile;
}

/** 总览页：内容区贴边更紧（固定 10px） */
function isDashboardPath(pathname: string): boolean {
  return pathname === '/' || pathname === '';
}

export function Layout() {
  const location = useLocation();
  const isMobile = useIsMobileLayout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const tightContent = isDashboardPath(location.pathname);

  const sidebarHidden = isMobile ? !mobileNavOpen : sidebarCollapsed;

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileNavOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  }, [isMobile]);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  // 窄屏切路由后收起抽屉，避免挡内容
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  // 回到宽屏时关掉临时抽屉状态
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  // 页面级「沉浸全屏」可临时收起/恢复系统侧栏（默认不写 localStorage）
  useEffect(() => {
    const onChrome = (event: Event) => {
      if (isMobile) return;
      const detail = (event as CustomEvent<{ collapsed?: boolean; persist?: boolean }>).detail;
      if (typeof detail?.collapsed !== 'boolean') return;
      setSidebarCollapsed(detail.collapsed);
      if (detail.persist) persistSidebarCollapsed(detail.collapsed);
    };
    window.addEventListener('meostock:app-sidebar', onChrome);
    return () => window.removeEventListener('meostock:app-sidebar', onChrome);
  }, [isMobile]);

  return (
    <div
      className={`${styles.layout}${sidebarHidden ? ` ${styles.sidebarCollapsed}` : ''}${
        isMobile && mobileNavOpen ? ` ${styles.mobileNavOpen}` : ''
      }`}
      data-sidebar-collapsed={sidebarHidden ? '1' : '0'}
    >
      {isMobile && mobileNavOpen && (
        <button
          type="button"
          className={styles.sidebarBackdrop}
          aria-label="关闭导航菜单"
          onClick={closeMobileNav}
        />
      )}
      <Sidebar collapsed={sidebarHidden} onNavigate={closeMobileNav} />
      <Header
        sidebarCollapsed={sidebarHidden}
        onToggleSidebar={toggleSidebar}
      />
      <main className={styles.main}>
        <div
          className={`${styles.content}${tightContent ? ` ${styles.contentTight}` : ''}`}
        >
          {/* key 按路径复位：某页渲染崩溃后导航到其他页可自动恢复 */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
