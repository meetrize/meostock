/**
 * 总览页面 — Portal 可编辑布局
 */

import { useState, useEffect, useCallback } from 'react';
import { Loading } from '@/components/common';
import { DashboardDataContext } from './portal/dashboardDataContext';
import { PortalCurvesContext } from './portal/portalCurvesContext';
import { PortalMarketsContext } from './portal/portalMarketsContext';
import { PortalCanvas } from './portal/PortalCanvas';
import { PortalToolbar } from './portal/PortalToolbar';
import { usePortalLayout } from './portal/usePortalLayout';
import {
  useIsPortalMobile,
  usePortalDashboardBundle,
} from './portal/usePortalDashboardBundle';
import { usePortalCurvesData } from './portal/usePortalCurvesData';
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
  const portalCurves = usePortalCurvesData(widgets);
  const reloadCurves = portalCurves.reload;

  const onRefresh = useCallback(async () => {
    await Promise.all([refreshAll(), reloadCurves()]);
  }, [refreshAll, reloadCurves]);

  useEffect(() => {
    if (mobile && editing) setEditing(false);
  }, [mobile, editing]);

  if (initialLoading && boardLoading) {
    return <Loading fullScreen text="加载中..." />;
  }

  return (
    <DashboardDataContext.Provider value={dataValue}>
      <PortalMarketsContext.Provider value={portalMarkets}>
        <PortalCurvesContext.Provider value={portalCurves}>
          <div className={styles.dashboard}>
            <PortalToolbar
              editing={editing}
              mobile={mobile}
              onToggleEdit={() => setEditing((v) => !v)}
              onAddWidget={addWidget}
              onReset={resetToDefault}
              onRefresh={onRefresh}
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
        </PortalCurvesContext.Provider>
      </PortalMarketsContext.Provider>
    </DashboardDataContext.Provider>
  );
}
