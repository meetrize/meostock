import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { useToast } from '@/components/common';
import { useAppSettings } from '@/contexts';
import { syncQuoteSourceToServer } from '@/services/quoteCache';
import type { QuoteSource } from '@/types';
import { WIDGET_CATALOG_LIST } from './widgetCatalog';
import type { PortalWidgetType } from './types';
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
  onAddWidget: (type: PortalWidgetType) => void;
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
        setMenuOpen(false);
        setRefreshOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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
  }, [menuOpen]);

  const setQuoteSource = async (source: QuoteSource) => {
    updateSettings({ quoteSource: source });
    try {
      await syncQuoteSourceToServer(source);
      toast.success(source === 'network' ? '已切换实时数据' : '已切换缓存数据');
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
      setMenuOpen(false);
      setRefreshOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className={styles.fabRoot} ref={rootRef}>
        {menuOpen && (
          <div className={styles.menu} role="menu" aria-label="总览设置">
            {!mobile && (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  onToggleEdit();
                  setMenuOpen(false);
                  setRefreshOpen(false);
                }}
              >
                <span>{editing ? '完成编辑' : '编辑布局'}</span>
                {editing && <span className={styles.menuHint}>编辑中</span>}
              </button>
            )}

            {mobile && (
              <div className={styles.menuNote}>手机端仅浏览；请在桌面编辑布局</div>
            )}

            {editing && !mobile && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
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
                  className={styles.menuItem}
                  onClick={() => {
                    if (window.confirm('确定恢复默认看盘布局？当前布局将被覆盖。')) {
                      onReset();
                      setMenuOpen(false);
                    }
                  }}
                >
                  重置默认
                </button>
                <div className={styles.menuDivider} />
              </>
            )}

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
                  if (realtime) void setQuoteSource('local');
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
          aria-label="总览设置"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((v) => !v);
            setRefreshOpen(false);
          }}
        >
          <Settings size={20} strokeWidth={2} />
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
              {WIDGET_CATALOG_LIST.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  className={styles.catalogCard}
                  onClick={() => {
                    onAddWidget(entry.type);
                    setAddOpen(false);
                  }}
                >
                  <span className={styles.catalogName}>{entry.name}</span>
                  <span className={styles.catalogDesc}>{entry.description}</span>
                  <span className={styles.catalogMeta}>
                    默认 {entry.defaultLayout.w}×{entry.defaultLayout.h}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
