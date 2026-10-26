/**
 * 侧边栏导航组件
 */

import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Grid3X3,
  BarChart3,
  Layers,
  Star,
  Settings,
  TrendingUp,
  CandlestickChart,
  Flame,
  Cloud,
  ExternalLink,
} from 'lucide-react';
import { Logo } from '@/components/common';
import styles from './Sidebar.module.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  /** 外链：新标签打开（如 /dapan/ 大盘云图） */
  external?: boolean;
}

const navItems: NavItem[] = [
  { path: '/', label: '总览', icon: <LayoutDashboard size={18} /> },
  { path: '/quotes', label: '行情', icon: <CandlestickChart size={18} /> },
  { path: '/fupan', label: '涨停复盘', icon: <Flame size={18} /> },
  { path: '/heatmap', label: '热力图', icon: <Grid3X3 size={18} /> },
  {
    path: '/dapan/',
    label: '大盘云图',
    icon: <Cloud size={18} />,
    external: true,
  },
  { path: '/rankings', label: '榜单', icon: <BarChart3 size={18} /> },
  { path: '/boards', label: '板块', icon: <Layers size={18} /> },
  { path: '/watchlist', label: '自选', icon: <Star size={18} /> },
  { path: '/scanner', label: '扫描', icon: <TrendingUp size={18} /> },
  { path: '/eod-picker', label: '尾盘选股', icon: <TrendingUp size={18} /> },
];

const bottomItems: NavItem[] = [
  { path: '/settings', label: '设置', icon: <Settings size={18} /> },
];

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation();

  const renderNavItem = (item: NavItem) => {
    if (item.external) {
      return (
        <a
          key={item.path}
          href={item.path}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.navItem}
          title={`${item.label}（新窗口）`}
        >
          <span className={styles.icon}>{item.icon}</span>
          <span className={styles.label}>{item.label}</span>
          <ExternalLink size={12} className={styles.externalIcon} aria-hidden />
        </a>
      );
    }

    const isActive =
      item.path === '/'
        ? location.pathname === '/'
        : location.pathname.startsWith(item.path);

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
      >
        {isActive && <span className={styles.activeIndicator} />}
        <span className={styles.icon}>{item.icon}</span>
        <span className={styles.label}>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <aside
      className={`${styles.sidebar}${collapsed ? ` ${styles.collapsed}` : ''}`}
      aria-hidden={collapsed}
    >
      <div className={styles.logo}>
        <Logo size={36} />
        <span className={styles.logoText}>A股看板</span>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          {navItems.map(renderNavItem)}
        </div>

        <div className={styles.navGroup}>
          {bottomItems.map(renderNavItem)}
        </div>
      </nav>
    </aside>
  );
}
