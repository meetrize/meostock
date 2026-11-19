/**
 * 全屏自定义版面（无顶栏 / 无侧栏）
 */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loading } from '@/components/common';
import { DashboardDataContext } from '@/pages/Dashboard/portal/dashboardDataContext';
import { PortalMarketsContext } from '@/pages/Dashboard/portal/portalMarketsContext';
import { PortalCanvas } from '@/pages/Dashboard/portal/PortalCanvas';
import {
  useIsPortalMobile,
  usePortalDashboardBundle,
} from '@/pages/Dashboard/portal/usePortalDashboardBundle';
import dashboardStyles from '@/pages/Dashboard/Dashboard.module.css';
import { WorkspaceChrome } from './WorkspaceChrome';
import { useWorkspaces } from './useWorkspaces';
import styles from './WorkspaceView.module.css';

export function WorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mobile = useIsPortalMobile();
  const [editing, setEditing] = useState(false);

  const {
    workspaces,
    activeWorkspace,
    layout,
    widgets,
    onLayoutChange,
    removeWidget,
    updateWidget,
    addWidget,
    clearLayout,
    setLastOpened,
  } = useWorkspaces(id);

  const { initialLoading, boardLoading, dataValue, portalMarkets, refreshAll } =
    usePortalDashboardBundle(widgets);

  // 只在路由 id 变化时记录「最近打开」，避免每次 layout/widgets 变更触发写回竞态
  useEffect(() => {
    if (id) setLastOpened(id);
  }, [id, setLastOpened]);

  useEffect(() => {
    if (mobile && editing) setEditing(false);
  }, [mobile, editing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'e' || e.key === 'E') {
        if (!mobile) setEditing((v) => !v);
      }
      if (e.key === 'Escape' && editing) {
        setEditing(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, mobile]);

  if (!id) {
    return <Navigate to="/workspaces" replace />;
  }

  if (!activeWorkspace) {
    return <Navigate to="/workspaces" replace />;
  }

  if (initialLoading && boardLoading) {
    return <Loading fullScreen text="加载版面..." />;
  }

  return (
    <DashboardDataContext.Provider value={dataValue}>
      <PortalMarketsContext.Provider value={portalMarkets}>
        <div className={styles.root}>
          <WorkspaceChrome
            editing={editing}
            mobile={mobile}
            workspaceName={activeWorkspace.name}
            workspaces={workspaces}
            activeId={activeWorkspace.id}
            onToggleEdit={() => setEditing((v) => !v)}
            onAddWidget={(type) => {
              addWidget(type);
            }}
            onClearLayout={clearLayout}
            onRefresh={refreshAll}
            onSwitchWorkspace={(nextId) => {
              navigate(`/workspaces/${nextId}`);
            }}
          />
          <div className={`${dashboardStyles.dashboard} ${styles.canvas}`}>
            {widgets.length === 0 && !editing ? (
              <div className={styles.empty}>
                <p>当前版面为空</p>
                <p className={styles.emptyHint}>
                  点击右下角设置 →「编辑布局」→「添加面板」开始拼版
                </p>
                {!mobile && (
                  <button
                    type="button"
                    className={styles.emptyBtn}
                    onClick={() => setEditing(true)}
                  >
                    开始编辑
                  </button>
                )}
              </div>
            ) : (
              <PortalCanvas
                editing={editing && !mobile}
                mobile={mobile}
                layout={layout}
                widgets={widgets}
                onLayoutChange={onLayoutChange}
                onRemoveWidget={removeWidget}
                onUpdateWidget={updateWidget}
              />
            )}
          </div>
        </div>
      </PortalMarketsContext.Provider>
    </DashboardDataContext.Provider>
  );
}
