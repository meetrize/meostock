import { useEffect, useRef, useState } from 'react';
import {
  Check,
  LayoutGrid,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
} from 'lucide-react';
import { useToast } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { syncQuoteSourceToServer } from '@/services/quoteCache';
import type { QuoteSource } from '@/types';
import {
  CUSTOM_STOCK_WIDGET_TYPE,
  type CustomStockConfig,
} from './customStock';
import { catalogGroups, laneMetaOf } from './widgetCatalog';
import type { PortalWidgetType } from './types';
import { StockPickerModal } from './widgets/StockPickerModal';
import styles from './PortalToolbar.module.css';

const REFRESH_OPTIONS_MS = [
  { value: 1000, label: '1 秒' },
  { value: 2000, label: '2 秒' },
  { value: 5000, label: '5 秒' },
  { value: 10000, label: '10 秒' },
  { value: 15000, label: '15 秒' },
  { value: 30000, label: '30 秒' },
] as const;

interface PortalToolbarProps {
  editing: boolean;
  mobile: boolean;
  onToggleEdit: () => void;
  onAddWidget: (
    type: PortalWidgetType,
    opts?: { title?: string; config?: Record<string, unknown> }
  ) => string;
  onReset: () => void;
  onRefresh: () => Promise<void>;
}

function isRealtimeSource(source: QuoteSource | undefined): boolean {
  return source === 'network';
}

export function PortalToolbar({
  editing,
  mobile,
  onToggleEdit,
  onAddWidget,
  onReset,
  onRefresh,
}: PortalToolbarProps) {
  const toast = useToast();
  const { settings, updateSettings, getRefreshInterval } = useAppSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const realtime = isRealtimeSource(settings.quoteSource);
  const listRefreshMs = getRefreshInterval('list');
  const refreshLabel =
    REFRESH_OPTIONS_MS.find((opt) => opt.value === listRefreshMs)?.label ??
    `${Math.round(listRefreshMs / 1000)} 秒`;

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        // 点外部只收菜单，不退出编辑态（FAB 仍提示「编辑中」）
        setMenuOpen(false);
        setRefreshOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (addOpen) {
          setAddOpen(false);
          return;
        }
        setMenuOpen(false);
        setRefreshOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, addOpen]);

  const setQuoteSource = async (source: QuoteSource) => {
    updateSettings({ quoteSource: source });
    try {
      await syncQuoteSourceToServer(source);
      toast.success(source === 'network' ? '已切换实时数据' : '已切换优先缓存');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const setListRefresh = (ms: number) => {
    updateSettings({
      refreshInterval: {
        ...settings.refreshInterval,
        list: ms,
      },
    });
    toast.success(`刷新频率已设为 ${Math.round(ms / 1000)} 秒`);
    setRefreshOpen(false);
  };

  const handleManualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success('已刷新总览数据');
      setRefreshOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const enterEdit = () => {
    if (!editing) onToggleEdit();
    setMenuOpen(true);
    setRefreshOpen(false);
  };

  const finishEdit = () => {
    if (editing) onToggleEdit();
    setMenuOpen(true);
    setRefreshOpen(false);
  };

  const handleCatalogPick = (type: PortalWidgetType) => {
    if (type === CUSTOM_STOCK_WIDGET_TYPE) {
      setAddOpen(false);
      setStockPickerOpen(true);
      return;
    }
    onAddWidget(type);
    setAddOpen(false);
  };

  const handleStockPicked = (config: CustomStockConfig) => {
    onAddWidget(CUSTOM_STOCK_WIDGET_TYPE, {
      title: config.name,
      config: { ...config },
    });
    setStockPickerOpen(false);
    if (!editing) onToggleEdit();
    toast.success(`已添加 ${config.name}`);
  };

  return (
    <>
      <div className={styles.fabRoot} ref={rootRef}>
        {menuOpen && (
          <div className={styles.menu} role="menu" aria-label="总览设置">
            <div className={styles.menuSectionLabel}>布局</div>

            {mobile ? (
              <div className={styles.menuNote}>手机端仅浏览；请在桌面编辑布局</div>
            ) : editing ? (
              <div className={styles.layoutActions} role="group" aria-label="布局编辑">
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.actionItem} ${styles.actionDone}`}
                  onClick={finishEdit}
                >
                  <span className={`${styles.actionIcon} ${styles.iconDone}`} aria-hidden>
                    <Check size={15} strokeWidth={2.5} />
                  </span>
                  <span className={styles.actionText}>
                    <span className={styles.actionTitle}>完成编辑</span>
                    <span className={styles.actionDesc}>退出拖拽与删改</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.actionItem} ${styles.actionAdd}`}
                  onClick={() => setAddOpen(true)}
                >
                  <span className={`${styles.actionIcon} ${styles.iconAdd}`} aria-hidden>
                    <Plus size={15} strokeWidth={2.5} />
                  </span>
                  <span className={styles.actionText}>
                    <span className={styles.actionTitle}>添加面板</span>
                    <span className={styles.actionDesc}>从目录选一块</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.actionItem} ${styles.actionReset}`}
                  onClick={() => {
                    if (window.confirm('确定恢复默认看盘布局？当前布局将被覆盖。')) {
                      onReset();
                    }
                  }}
                >
                  <span className={`${styles.actionIcon} ${styles.iconReset}`} aria-hidden>
                    <RotateCcw size={14} strokeWidth={2.25} />
                  </span>
                  <span className={styles.actionText}>
                    <span className={styles.actionTitle}>重置默认</span>
                    <span className={styles.actionDesc}>覆盖当前布局</span>
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={`${styles.actionItem} ${styles.actionEdit}`}
                onClick={enterEdit}
              >
                <span className={`${styles.actionIcon} ${styles.iconEdit}`} aria-hidden>
                  <LayoutGrid size={15} strokeWidth={2.25} />
                </span>
                <span className={styles.actionText}>
                  <span className={styles.actionTitle}>编辑布局</span>
                  <span className={styles.actionDesc}>拖拽、添加或删除面板</span>
                </span>
              </button>
            )}

            <div className={styles.menuDivider} />

            <div className={styles.menuSectionLabel}>数据源</div>
            <div className={styles.toggleRow} role="group" aria-label="实时或缓存">
              <button
                type="button"
                className={`${styles.toggleBtn} ${realtime ? styles.toggleActive : ''}`}
                aria-pressed={realtime}
                onClick={() => {
                  if (!realtime) void setQuoteSource('network');
                }}
              >
                实时
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${!realtime ? styles.toggleActive : ''}`}
                aria-pressed={!realtime}
                onClick={() => {
                  if (realtime) void setQuoteSource('auto');
                }}
              >
                缓存
              </button>
            </div>

            <div className={styles.menuDivider} />

            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              aria-expanded={refreshOpen}
              onClick={() => setRefreshOpen((v) => !v)}
            >
              <span>刷新频率</span>
              <span className={styles.menuHint}>{refreshLabel}</span>
            </button>

            {refreshOpen && (
              <div className={styles.subMenu} role="group" aria-label="刷新频率选项">
                {REFRESH_OPTIONS_MS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.subMenuItem} ${
                      listRefreshMs === opt.value ? styles.subMenuActive : ''
                    }`}
                    onClick={() => setListRefresh(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.menuDivider} />

            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              disabled={refreshing}
              onClick={() => void handleManualRefresh()}
            >
              <span className={styles.menuItemWithIcon}>
                <RefreshCw
                  size={14}
                  className={refreshing ? styles.spin : undefined}
                  aria-hidden
                />
                {refreshing ? '刷新中…' : '立即刷新'}
              </span>
            </button>
          </div>
        )}

        <button
          type="button"
          className={`${styles.fab} ${menuOpen ? styles.fabOpen : ''} ${
            editing ? styles.fabEditing : ''
          }`}
          aria-label={editing ? '总览设置（编辑中）' : '总览设置'}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={editing ? '布局编辑中' : '总览设置'}
          onClick={() => {
            setMenuOpen((v) => !v);
            setRefreshOpen(false);
          }}
        >
          {editing ? <LayoutGrid size={20} strokeWidth={2} /> : <Settings size={20} strokeWidth={2} />}
          {editing && !menuOpen ? <span className={styles.fabDot} aria-hidden /> : null}
        </button>
      </div>

      {addOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setAddOpen(false)}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="添加面板"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>添加面板</div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="关闭"
                onClick={() => setAddOpen(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              {catalogGroups().map((group) => (
                <div key={group.id} className={styles.catalogGroup}>
                  <div className={styles.catalogGroupTitle}>{group.label}</div>
                  <div className={styles.catalogGroupGrid}>
                    {group.entries.map((entry) => {
                      const lane = laneMetaOf(entry.type);
                      return (
                        <button
                          key={entry.type}
                          type="button"
                          className={styles.catalogCard}
                          onClick={() => handleCatalogPick(entry.type)}
                        >
                          <span className={styles.catalogNameRow}>
                            <span
                              className={styles.laneDot}
                              style={{ background: lane.colorVar }}
                              title={lane.title}
                            />
                            <span className={styles.catalogName}>{entry.name}</span>
                            {entry.starred ? (
                              <span className={styles.starTag}>荐</span>
                            ) : null}
                          </span>
                          <span className={styles.catalogDesc}>{entry.description}</span>
                          <span className={styles.catalogMeta}>
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

      <StockPickerModal
        open={stockPickerOpen}
        title="添加自选个股"
        confirmLabel="添加到总览"
        onClose={() => setStockPickerOpen(false)}
        onConfirm={handleStockPicked}
      />
    </>
  );
}
