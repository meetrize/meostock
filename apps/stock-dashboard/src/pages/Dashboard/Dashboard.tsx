/**
 * 总览页面 — Portal 可编辑布局
 */

import { useState, useEffect } from 'react';
import { Loading } from '@/components/common';
import { DashboardDataContext } from './portal/dashboardDataContext';
import { PortalMarketsContext } from './portal/portalMarketsContext';
import { PortalCanvas } from './portal/PortalCanvas';
import { PortalToolbar } from './portal/PortalToolbar';
import { usePortalLayout } from './portal/usePortalLayout';
import {
  useIsPortalMobile,
  usePortalDashboardBundle,
} from './portal/usePortalDashboardBundle';
import styles from './Dashboard.module.css';

export function Dashboard() {
  const mobile = useIsPortalMobile();
  const [editing, setEditing] = useState(false);

  const {
    layout,
    widgets,
    onLayoutChange,
    removeWidget,
    updateWidget,
    addWidget,
    resetToDefault,
  } = usePortalLayout();

  const { initialLoading, boardLoading, dataValue, portalMarkets, refreshAll } =
    usePortalDashboardBundle(widgets);

  useEffect(() => {
    if (mobile && editing) setEditing(false);
  }, [mobile, editing]);

  if (initialLoading && boardLoading) {
    return <Loading fullScreen text="加载中..." />;
  }

  return (
    <DashboardDataContext.Provider value={dataValue}>
      <PortalMarketsContext.Provider value={portalMarkets}>
        <div className={styles.dashboard}>
          <PortalToolbar
            editing={editing}
            mobile={mobile}
            onToggleEdit={() => setEditing((v) => !v)}
            onAddWidget={addWidget}
            onReset={resetToDefault}
            onRefresh={refreshAll}
          />
          <PortalCanvas
            editing={editing && !mobile}
            mobile={mobile}
            layout={layout}
            widgets={widgets}
            onLayoutChange={onLayoutChange}
            onRemoveWidget={removeWidget}
            onUpdateWidget={updateWidget}
          />
        </div>
      </PortalMarketsContext.Provider>
    </DashboardDataContext.Provider>
  );
}
