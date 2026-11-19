/**
 * 全屏工作区悬浮工具条：版面切换 / 编辑 / 添加 / 返回
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutTemplate, RefreshCw, Settings } from 'lucide-react';
import { useToast } from '@/components/common';
import { catalogGroups, laneMetaOf } from '@/pages/Dashboard/portal/widgetCatalog';
import type { PortalWidgetType } from '@/pages/Dashboard/portal/types';
import type { Workspace } from './types';
import toolbarStyles from '@/pages/Dashboard/portal/PortalToolbar.module.css';
import styles from './WorkspaceChrome.module.css';

interface WorkspaceChromeProps {
  editing: boolean;
  mobile: boolean;
  workspaceName: string;
  workspaces: Workspace[];
  activeId: string;
  onToggleEdit: () => void;
  onAddWidget: (type: PortalWidgetType) => void;
  onClearLayout: () => void;
  onRefresh: () => Promise<void>;
  onSwitchWorkspace: (id: string) => void;
}

export function WorkspaceChrome({
  editing,
  mobile,
  workspaceName,
  workspaces,
  activeId,
  onToggleEdit,
  onAddWidget,
  onClearLayout,
  onRefresh,
  onSwitchWorkspace,
}: WorkspaceChromeProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setSwitchOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setSwitchOpen(false);
        setAddOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success('已刷新版面数据');
      setMenuOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className={styles.namePill} title={workspaceName}>
        <LayoutTemplate size={14} aria-hidden />
        <span>{workspaceName}</span>
        {editing && <span className={styles.editingBadge}>编辑中</span>}
      </div>

      <div className={toolbarStyles.fabRoot} ref={rootRef}>
        {menuOpen && (
          <div className={toolbarStyles.menu} role="menu" aria-label="版面设置">
            <button
              type="button"
              role="menuitem"
              className={toolbarStyles.menuItem}
              onClick={() => {
                navigate('/');
              }}
            >
              <span className={toolbarStyles.menuItemWithIcon}>
                <ArrowLeft size={14} aria-hidden />
                返回看板
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              className={toolbarStyles.menuItem}
              onClick={() => {
                navigate('/workspaces');
              }}
            >
              管理版面…
            </button>

            <div className={toolbarStyles.menuDivider} />

            <button
              type="button"
              role="menuitem"
              className={toolbarStyles.menuItem}
              aria-expanded={switchOpen}
              onClick={() => setSwitchOpen((v) => !v)}
            >
              <span>切换版面</span>
              <span className={toolbarStyles.menuHint}>{workspaceName}</span>
            </button>
            {switchOpen && (
              <div className={toolbarStyles.subMenu} role="group" aria-label="版面列表">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    className={`${toolbarStyles.subMenuItem} ${
                      ws.id === activeId ? toolbarStyles.subMenuActive : ''
                    }`}
                    onClick={() => {
                      onSwitchWorkspace(ws.id);
                      setSwitchOpen(false);
                      setMenuOpen(false);
                    }}
                  >
                    {ws.name}
                  </button>
                ))}
              </div>
            )}

            <div className={toolbarStyles.menuDivider} />

            {!mobile && (
              <button
                type="button"
                role="menuitem"
                className={toolbarStyles.menuItem}
                onClick={() => {
                  onToggleEdit();
                  setMenuOpen(false);
                }}
              >
                <span>{editing ? '完成编辑' : '编辑布局'}</span>
                {editing && <span className={toolbarStyles.menuHint}>编辑中</span>}
              </button>
            )}

            {mobile && (
              <div className={toolbarStyles.menuNote}>手机端仅浏览；请在桌面编辑布局</div>
            )}

            {editing && !mobile && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={toolbarStyles.menuItem}
                  onClick={() => {
                    setAddOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  添加面板
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={toolbarStyles.menuItem}
                  onClick={() => {
                    if (window.confirm('清空当前版面所有面板？')) {
                      onClearLayout();
                      setMenuOpen(false);
                    }
                  }}
                >
                  清空面板
                </button>
                <div className={toolbarStyles.menuDivider} />
              </>
            )}

            <button
              type="button"
              role="menuitem"
              className={toolbarStyles.menuItem}
              disabled={refreshing}
              onClick={() => void handleManualRefresh()}
            >
              <span className={toolbarStyles.menuItemWithIcon}>
                <RefreshCw
                  size={14}
                  className={refreshing ? toolbarStyles.spin : undefined}
                  aria-hidden
                />
                {refreshing ? '刷新中…' : '立即刷新'}
              </span>
            </button>
          </div>
        )}

        <button
          type="button"
          className={`${toolbarStyles.fab} ${menuOpen ? toolbarStyles.fabOpen : ''} ${
            editing ? toolbarStyles.fabEditing : ''
          }`}
          aria-label="版面设置"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((v) => !v);
            setSwitchOpen(false);
          }}
        >
          <Settings size={20} strokeWidth={2} />
        </button>
      </div>

      {addOpen && (
        <div
          className={toolbarStyles.modalBackdrop}
          onClick={() => setAddOpen(false)}
          role="presentation"
        >
          <div
            className={toolbarStyles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="添加面板"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={toolbarStyles.modalHeader}>
              <div className={toolbarStyles.modalTitle}>添加面板</div>
              <button
                type="button"
                className={toolbarStyles.modalClose}
                aria-label="关闭"
                onClick={() => setAddOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={toolbarStyles.modalBody}>
              {catalogGroups().map((group) => (
                <div key={group.id} className={toolbarStyles.catalogGroup}>
                  <div className={toolbarStyles.catalogGroupTitle}>{group.label}</div>
                  <div className={toolbarStyles.catalogGroupGrid}>
                    {group.entries.map((entry) => {
                      const lane = laneMetaOf(entry.type);
                      return (
                        <button
                          key={entry.type}
                          type="button"
                          className={toolbarStyles.catalogCard}
                          onClick={() => {
                            onAddWidget(entry.type);
                            setAddOpen(false);
                          }}
                        >
                          <span className={toolbarStyles.catalogNameRow}>
                            <span
                              className={toolbarStyles.laneDot}
                              style={{ background: lane.colorVar }}
                              title={lane.title}
                            />
                            <span className={toolbarStyles.catalogName}>{entry.name}</span>
                            {entry.starred ? (
                              <span className={toolbarStyles.starTag}>荐</span>
                            ) : null}
                          </span>
                          <span className={toolbarStyles.catalogDesc}>{entry.description}</span>
                          <span className={toolbarStyles.catalogMeta}>
                            {lane.label} · 默认 {entry.defaultLayout.w}×
                            {entry.defaultLayout.h}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
