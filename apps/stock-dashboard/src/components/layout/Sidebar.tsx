/**
 * 侧边栏导航组件
 */

import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  Clock,
  CalendarDays,
  Bookmark,
  PanelsTopLeft,
  ChevronDown,
  Plus,
  Wrench,
  Bot,
  Microscope,
  History,
} from 'lucide-react';
import { Logo } from '@/components/common';
import {
  createWorkspaceStandalone,
  peekLastOpenedId,
  peekWorkspaces,
  subscribeWorkspaces,
} from '@/pages/Workspaces';
import type { Workspace } from '@/pages/Workspaces/types';
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
  { path: '/research', label: '研判', icon: <Microscope size={18} /> },
  { path: '/quotes', label: '行情', icon: <CandlestickChart size={18} /> },
  { path: '/limit-up', label: '涨停池', icon: <Flame size={18} /> },
  { path: '/zt-history', label: '涨跌停历史', icon: <Flame size={18} /> },
  { path: '/fupan', label: '复盘', icon: <Flame size={18} /> },
  { path: '/zt', label: '涨停异动', icon: <Flame size={18} /> },
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
  { path: '/calendar', label: '财经日历', icon: <CalendarDays size={18} /> },
  { path: '/favorites', label: '收藏夹', icon: <Bookmark size={18} /> },
  { path: '/scanner', label: '扫描', icon: <TrendingUp size={18} /> },
  { path: '/eod-picker', label: '策略选股', icon: <TrendingUp size={18} /> },
  { path: '/pattern-backtest', label: '形态回测', icon: <History size={18} /> },
  { path: '/scheduler', label: '定时任务', icon: <Clock size={18} /> },
  { path: '/agent', label: 'AI Agent', icon: <Bot size={18} /> },
];

const bottomItems: NavItem[] = [
  { path: '/settings', label: '设置', icon: <Settings size={18} /> },
];

interface SidebarProps {
  collapsed?: boolean;
  /** 窄屏抽屉内点击导航后回调（用于关闭抽屉） */
  onNavigate?: () => void;
}

export function Sidebar({ collapsed = false, onNavigate }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => peekWorkspaces());
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(() => peekLastOpenedId());
  const onWorkspaceRoute =
    location.pathname === '/workspaces' ||
    location.pathname.startsWith('/workspaces/');
  const [wsOpen, setWsOpen] = useState(onWorkspaceRoute);

  useEffect(() => {
    return subscribeWorkspaces(() => {
      setWorkspaces(peekWorkspaces());
      setLastOpenedId(peekLastOpenedId());
    });
  }, []);

  useEffect(() => {
    if (onWorkspaceRoute) setWsOpen(true);
  }, [onWorkspaceRoute]);

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
          onClick={() => onNavigate?.()}
        >
          <span className={styles.icon}>{item.icon}</span>
          <span className={styles.label}>{item.label}</span>
          <ExternalLink size={12} className={styles.externalIcon} aria-hidden />
        </a>
      );
    }

    const poolPaths = ['/limit-up', '/limit-down', '/yesterday-limit-up'];
    const isActive =
      item.path === '/'
        ? location.pathname === '/'
        : item.path === '/limit-up'
          ? poolPaths.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'))
          : item.path === '/zt-history'
            ? location.pathname === '/zt-history' || location.pathname.startsWith('/zt-history/')
            : location.pathname.startsWith(item.path);

    return (
      <NavLink
        key={item.path}
        to={item.path}
        className={`${styles.navItem} ${isActive ? styles.active : ''}`}
        onClick={() => onNavigate?.()}
      >
        {isActive && <span className={styles.activeIndicator} />}
        <span className={styles.icon}>{item.icon}</span>
        <span className={styles.label}>{item.label}</span>
      </NavLink>
    );
  };

  const openDefaultWorkspace = () => {
    const id = lastOpenedId ?? workspaces[0]?.id;
    if (id) navigate(`/workspaces/${id}`);
    else navigate('/workspaces');
    onNavigate?.();
  };

  return (
    <aside
      className={`${styles.sidebar}${collapsed ? ` ${styles.collapsed}` : ''}`}
      data-app-chrome="sidebar"
      aria-hidden={collapsed}
    >
      <div className={styles.logo}>
        <Logo size={36} />
        <span className={styles.logoText}>Meo投研</span>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          {navItems.map(renderNavItem)}

          <div className={styles.wsSection}>
            <button
              type="button"
              className={`${styles.navItem} ${styles.wsToggle} ${
                onWorkspaceRoute ? styles.active : ''
              }`}
              aria-expanded={wsOpen}
              onClick={() => {
                if (collapsed) {
                  openDefaultWorkspace();
                  return;
                }
                setWsOpen((v) => !v);
              }}
              onDoubleClick={openDefaultWorkspace}
              title="自定义版面"
            >
              {onWorkspaceRoute && <span className={styles.activeIndicator} />}
              <span className={styles.icon}>
                <PanelsTopLeft size={18} />
              </span>
              <span className={styles.label}>自定义版面</span>
              <ChevronDown
                size={14}
                className={`${styles.chevron} ${wsOpen ? styles.chevronOpen : ''}`}
                aria-hidden
              />
            </button>

            {wsOpen && !collapsed && (
              <div className={styles.wsList} role="group" aria-label="版面列表">
                {workspaces.map((ws) => {
                  const active = location.pathname === `/workspaces/${ws.id}`;
                  return (
                    <NavLink
                      key={ws.id}
                      to={`/workspaces/${ws.id}`}
                      className={`${styles.wsItem} ${active ? styles.wsItemActive : ''}`}
                      title={ws.name}
                      onClick={() => onNavigate?.()}
                    >
                      <span className={styles.wsItemLabel}>{ws.name}</span>
                    </NavLink>
                  );
                })}
                <button
                  type="button"
                  className={styles.wsAction}
                  onClick={() => {
                    const ws = createWorkspaceStandalone();
                    navigate(`/workspaces/${ws.id}`);
                    onNavigate?.();
                  }}
                >
                  <Plus size={13} aria-hidden />
                  新建版面
                </button>
                <button
                  type="button"
                  className={styles.wsAction}
                  onClick={() => {
                    navigate('/workspaces');
                    onNavigate?.();
                  }}
                >
                  <Wrench size={13} aria-hidden />
                  管理版面
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.navGroup}>
          {bottomItems.map(renderNavItem)}
        </div>
      </nav>
    </aside>
  );
}
