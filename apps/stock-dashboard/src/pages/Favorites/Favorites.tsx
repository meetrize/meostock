/**
 * 网址收藏夹：Launchpad 风格图标网格，拖拽排序
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Loader2, Pencil, Plus, X } from 'lucide-react';
import { useToast } from '@/components/common';
import { FavoriteFormModal } from './FavoriteFormModal';
import {
  DEFAULT_COLUMNS,
  FAVORITES_COLUMNS_KEY,
  MAX_COLUMNS,
  MIN_COLUMNS,
  type FavoriteItem,
} from './types';
import styles from './Favorites.module.css';

function loadColumns(): number {
  try {
    const raw = localStorage.getItem(FAVORITES_COLUMNS_KEY);
    const n = raw ? Number(raw) : DEFAULT_COLUMNS;
    if (Number.isFinite(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) return Math.round(n);
  } catch {
    /* ignore */
  }
  return DEFAULT_COLUMNS;
}

function displayName(item: FavoriteItem): string {
  if (item.title?.trim()) return item.title.trim();
  try {
    return new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    return item.url;
  }
}

export function Favorites() {
  const toast = useToast();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState(loadColumns);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editing, setEditing] = useState<FavoriteItem | null>(null);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<FavoriteItem[] | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '加载失败');
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const displayItems = dragPreview ?? items;

  const columnOptions = useMemo(
    () => Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, i) => MIN_COLUMNS + i),
    []
  );

  const onColumnsChange = (value: number) => {
    setColumns(value);
    try {
      localStorage.setItem(FAVORITES_COLUMNS_KEY, String(value));
      void import('@/services/prefSync')
        .then((m) => m.noteLocalWrite(FAVORITES_COLUMNS_KEY, String(value)))
        .catch(() => undefined);
    } catch {
      /* ignore */
    }
  };

  const openAdd = () => {
    setModalMode('add');
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (item: FavoriteItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalMode('edit');
    setEditing(item);
    setModalOpen(true);
  };

  const removeItem = async (item: FavoriteItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`删除收藏「${displayName(item)}」？`)) return;
    try {
      const res = await fetch(`/api/favorites/${item.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '删除失败');
      }
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(id);
    setDragPreview(items);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    setDragPreview((prev) => {
      const list = [...(prev ?? items)];
      const from = list.findIndex((x) => x.id === draggedId);
      const to = list.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return list;
    });
  };

  const persistOrder = async (ordered: FavoriteItem[]) => {
    const ids = ordered.map((x) => x.id);
    setItems(ordered);
    try {
      const res = await fetch('/api/favorites/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '排序保存失败');
      }
      if (Array.isArray(data.items)) setItems(data.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '排序保存失败');
      void reload();
    }
  };

  const handleDrop = () => {
    if (draggedId && dragPreview) {
      void persistOrder(dragPreview);
    }
    setDraggedId(null);
    setDragPreview(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragPreview(null);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>收藏夹</h1>
          <p className={styles.subtitle}>点击打开 · 拖动排序 · 悬停可编辑或删除</p>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.columnsControl}>
            列数
            <select
              value={columns}
              onChange={(e) => onColumnsChange(Number(e.target.value))}
              aria-label="卡片列数"
            >
              {columnOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.addBtn} onClick={openAdd}>
            <Plus size={16} aria-hidden />
            添加
          </button>
        </div>
      </header>

      <div className={styles.panel}>
        {loading ? (
          <div className={styles.empty}>
            <Loader2 size={22} className={styles.spin} />
            加载中…
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <p className={styles.error}>{error}</p>
            <button type="button" className={styles.addBtn} onClick={() => void reload()}>
              重试
            </button>
          </div>
        ) : displayItems.length === 0 ? (
          <div className={styles.empty}>
            <Bookmark size={28} aria-hidden />
            <p className={styles.emptyHint}>还没有收藏，点击右上角「添加」开始</p>
            <button type="button" className={styles.addBtn} onClick={openAdd}>
              <Plus size={16} aria-hidden />
              添加网址
            </button>
          </div>
        ) : (
          <div
            className={styles.grid}
            style={{ ['--fav-cols' as string]: String(columns) }}
          >
            {displayItems.map((item) => {
              const dragging = draggedId === item.id;
              const note = item.note?.trim();
              return (
                <div
                  key={item.id}
                  role="link"
                  tabIndex={0}
                  className={`${styles.tile} ${dragging ? styles.tileDragging : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onClick={() => openUrl(item.url)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openUrl(item.url);
                    }
                  }}
                  title={item.url}
                >
                  <span className={styles.iconWrap}>
                    <button
                      type="button"
                      className={`${styles.badge} ${styles.badgeEdit}`}
                      title="编辑"
                      aria-label={`编辑 ${displayName(item)}`}
                      onClick={(e) => openEdit(item, e)}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.badge} ${styles.badgeDelete}`}
                      title="删除"
                      aria-label={`删除 ${displayName(item)}`}
                      onClick={(e) => void removeItem(item, e)}
                    >
                      <X size={12} />
                    </button>
                    <span className={styles.iconClip}>
                      {item.favicon_url ? (
                        <img
                          src={item.favicon_url}
                          alt=""
                          className={styles.icon}
                          draggable={false}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Bookmark size={28} className={styles.iconFallback} aria-hidden />
                      )}
                    </span>
                  </span>
                  <span className={styles.label}>
                    <span className={styles.name}>{displayName(item)}</span>
                    {note ? <span className={styles.note}>{note}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FavoriteFormModal
        open={modalOpen}
        mode={modalMode}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void reload()}
      />
    </div>
  );
}
