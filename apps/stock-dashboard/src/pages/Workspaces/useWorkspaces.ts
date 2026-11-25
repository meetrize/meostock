/**
 * 自定义版面 CRUD + 布局持久化
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import { applyCatalogConstraints, WIDGET_CATALOG } from '@/pages/Dashboard/portal/widgetCatalog';
import type {
  PortalLayoutItem,
  PortalWidgetInstance,
  PortalWidgetType,
} from '@/pages/Dashboard/portal/types';
import { createDefaultWorkspaceState, createEmptyWorkspace } from './defaultWorkspace';
import {
  WORKSPACE_STORAGE_KEY,
  type Workspace,
  type WorkspacePersistedState,
} from './types';

function isLayoutItem(value: unknown): value is PortalLayoutItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.i === 'string' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number'
  );
}

function isWidget(value: unknown): value is PortalWidgetInstance {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.type === 'string' && v.type in WIDGET_CATALOG;
}

function parseState(raw: string | null): WorkspacePersistedState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as WorkspacePersistedState;
    if (data?.version !== 1 || !Array.isArray(data.workspaces) || data.workspaces.length === 0) {
      return null;
    }
    const workspaces = data.workspaces
      .map((p) => {
        if (!p || typeof p.id !== 'string' || !Array.isArray(p.layout) || !Array.isArray(p.widgets)) {
          return null;
        }
        const widgets = p.widgets.filter(isWidget);
        const widgetIds = new Set(widgets.map((w) => w.id));
        const layout = p.layout
          .filter(isLayoutItem)
          .filter((item) => widgetIds.has(item.i))
          .map((item) => {
            const widget = widgets.find((w) => w.id === item.i)!;
            return applyCatalogConstraints(widget.type, item);
          });
        return {
          id: p.id,
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '未命名',
          layout,
          widgets,
        };
      })
      .filter((p): p is Workspace => p !== null);

    if (workspaces.length === 0) return null;

    const lastOpenedId =
      workspaces.find((w) => w.id === data.lastOpenedId)?.id ?? workspaces[0].id;

    return {
      version: 1,
      density: data.density === 'comfortable' ? 'comfortable' : 'tight',
      lastOpenedId,
      workspaces,
    };
  } catch {
    return null;
  }
}

function loadState(): WorkspacePersistedState {
  try {
    const parsed = parseState(localStorage.getItem(WORKSPACE_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    // ignore
  }
  return createDefaultWorkspaceState();
}

function saveState(state: WorkspacePersistedState) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
    // 动态 import 避免循环依赖；失败不影响本机写入
    void import('@/services/prefSync')
      .then((m) => m.noteLocalWrite(WORKSPACE_STORAGE_KEY, state))
      .catch(() => undefined);
  } catch {
    // ignore quota / private mode
  }
}

function nextWidgetId(type: PortalWidgetType): string {
  return `${type.replace(/\./g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function findDropPosition(
  layout: PortalLayoutItem[],
  w: number,
  h: number,
  cols = 12
): { x: number; y: number } {
  const maxY = layout.reduce((m, item) => Math.max(m, item.y + item.h), 0);
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= cols - w; x += 1) {
      const collides = layout.some(
        (item) =>
          x < item.x + item.w &&
          x + w > item.x &&
          y < item.y + item.h &&
          y + h > item.y
      );
      if (!collides) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

function nextWorkspaceName(existing: Workspace[]): string {
  let n = existing.length + 1;
  const names = new Set(existing.map((w) => w.name));
  while (names.has(`版面 ${n}`)) n += 1;
  return `版面 ${n}`;
}

/** 订阅列表用：跨组件刷新侧栏 */
type Listener = () => void;
const listeners = new Set<Listener>();

function emitWorkspacesChanged() {
  listeners.forEach((l) => l());
}

export function subscribeWorkspaces(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function peekWorkspaces(): Workspace[] {
  return loadState().workspaces;
}

export function peekLastOpenedId(): string | null {
  return loadState().lastOpenedId;
}

/** 侧栏等非 hook 场景：立即新建并持久化 */
export function createWorkspaceStandalone(name?: string): Workspace {
  const state = loadState();
  const ws = createEmptyWorkspace(name ?? nextWorkspaceName(state.workspaces));
  const next: WorkspacePersistedState = {
    ...state,
    lastOpenedId: ws.id,
    workspaces: [...state.workspaces, ws],
  };
  saveState(next);
  emitWorkspacesChanged();
  return ws;
}

/**
 * RGL 在空→首块 / 测宽时可能先抛空 layout；绝不能据此清空。
 * 若 next 缺了仍有 widget 的项，予以保留（避免与 addWidget 竞态丢格）。
 */
function mergeLayoutFromRgl(ws: Workspace, nextLayout: Layout): PortalLayoutItem[] {
  if (nextLayout.length === 0) {
    return ws.layout;
  }

  const byId = new Map(ws.layout.map((item) => [item.i, item]));
  const merged = nextLayout.map((item) => {
    const prev = byId.get(item.i);
    const widget = ws.widgets.find((w) => w.id === item.i);
    const base: PortalLayoutItem = {
      ...(prev ?? {}),
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: Math.max(1, item.h),
      static: item.static ?? prev?.static,
    };
    const constrained = widget ? applyCatalogConstraints(widget.type, base) : base;
    if (constrained.maxH != null && constrained.h > constrained.maxH) {
      constrained.h = constrained.maxH;
    }
    if (constrained.maxW != null && constrained.w > constrained.maxW) {
      constrained.w = constrained.maxW;
    }
    return constrained;
  });

  const mergedIds = new Set(merged.map((item) => item.i));
  const retained = ws.layout.filter(
    (item) => !mergedIds.has(item.i) && ws.widgets.some((w) => w.id === item.i)
  );
  return [...merged, ...retained];
}

function layoutsEqual(a: PortalLayoutItem[], b: PortalLayoutItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => {
    const prev = b[i];
    return (
      prev &&
      prev.i === item.i &&
      prev.x === item.x &&
      prev.y === item.y &&
      prev.w === item.w &&
      prev.h === item.h
    );
  });
}

/** 修复「有 widget 无 layout」脏数据（旧竞态遗留） */
function ensureLayoutForWidgets(ws: Workspace): Workspace {
  const layoutIds = new Set(ws.layout.map((item) => item.i));
  const missing = ws.widgets.filter((w) => !layoutIds.has(w.id));
  if (missing.length === 0) return ws;

  let layout = [...ws.layout];
  for (const widget of missing) {
    const catalog = WIDGET_CATALOG[widget.type];
    if (!catalog) continue;
    const { w, h } = catalog.defaultLayout;
    const { x, y } = findDropPosition(layout, w, h);
    layout = [
      ...layout,
      applyCatalogConstraints(widget.type, { i: widget.id, x, y, w, h }),
    ];
  }
  return { ...ws, layout };
}

export function useWorkspaces(activeId?: string) {
  const [state, setState] = useState<WorkspacePersistedState>(() => loadState());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    const onPrefs = () => setState(loadState());
    window.addEventListener('meo:prefs-applied', onPrefs);
    return () => window.removeEventListener('meo:prefs-applied', onPrefs);
  }, []);

  const scheduleSave = useCallback((next: WorkspacePersistedState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState(next);
      emitWorkspacesChanged();
    }, 300);
  }, []);

  /** 函数式更新，避免 addWidget 与 RGL onLayoutChange 竞态互相覆盖 */
  const patchState = useCallback(
    (recipe: (prev: WorkspacePersistedState) => WorkspacePersistedState) => {
      setState((prev) => {
        const next = recipe(prev);
        if (next === prev) return prev;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const commitStateNow = useCallback((next: WorkspacePersistedState) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setState(next);
    saveState(next);
    emitWorkspacesChanged();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    return subscribeWorkspaces(() => {
      setState(loadState());
    });
  }, []);

  const activeWorkspace = useMemo(() => {
    const raw = activeId
      ? state.workspaces.find((w) => w.id === activeId) ?? null
      : state.workspaces.find((w) => w.id === state.lastOpenedId) ??
        state.workspaces[0] ??
        null;
    return raw ? ensureLayoutForWidgets(raw) : null;
  }, [activeId, state.lastOpenedId, state.workspaces]);

  const updateWorkspace = useCallback(
    (id: string, updater: (ws: Workspace) => Workspace) => {
      patchState((prev) => {
        const current = prev.workspaces.find((w) => w.id === id);
        if (!current) return prev;
        const updated = updater(current);
        if (updated === current) return prev;
        return {
          ...prev,
          workspaces: prev.workspaces.map((w) => (w.id === id ? updated : w)),
        };
      });
    },
    [patchState]
  );

  // 脏数据自愈写回（有 widget 无 layout）
  useEffect(() => {
    if (!activeId) return;
    const raw = state.workspaces.find((w) => w.id === activeId);
    if (!raw) return;
    const fixed = ensureLayoutForWidgets(raw);
    if (fixed === raw) return;
    updateWorkspace(activeId, () => fixed);
  }, [activeId, state.workspaces, updateWorkspace]);

  const onLayoutChange = useCallback(
    (nextLayout: Layout) => {
      const id = activeIdRef.current;
      if (!id) return;
      updateWorkspace(id, (ws) => {
        const layout = mergeLayoutFromRgl(ws, nextLayout);
        if (layoutsEqual(layout, ws.layout)) return ws;
        return { ...ws, layout };
      });
    },
    [updateWorkspace]
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      const id = activeIdRef.current;
      if (!id) return;
      updateWorkspace(id, (ws) => ({
        ...ws,
        layout: ws.layout.filter((item) => item.i !== widgetId),
        widgets: ws.widgets.filter((w) => w.id !== widgetId),
      }));
    },
    [updateWorkspace]
  );

  const updateWidget = useCallback(
    (widgetId: string, patch: Partial<PortalWidgetInstance>) => {
      const id = activeIdRef.current;
      if (!id) return;
      updateWorkspace(id, (ws) => ({
        ...ws,
        widgets: ws.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...patch, id: w.id, type: w.type } : w
        ),
      }));
    },
    [updateWorkspace]
  );

  const addWidget = useCallback(
    (type: PortalWidgetType) => {
      const workspaceId = activeIdRef.current;
      if (!workspaceId) return null;
      const catalog = WIDGET_CATALOG[type];
      const id = nextWidgetId(type);
      const { w, h } = catalog.defaultLayout;
      updateWorkspace(workspaceId, (ws) => {
        const { x, y } = findDropPosition(ws.layout, w, h);
        const layoutItem = applyCatalogConstraints(type, {
          i: id,
          x,
          y,
          w,
          h,
        });
        const widget: PortalWidgetInstance = {
          id,
          type,
          ...(type === 'embed.iframe'
            ? { title: '网页', config: { url: '' } }
            : {}),
        };
        return {
          ...ws,
          layout: [...ws.layout, layoutItem],
          widgets: [...ws.widgets, widget],
        };
      });
      return id;
    },
    [updateWorkspace]
  );

  const createWorkspace = useCallback((name?: string): Workspace => {
    const prev = loadState();
    // 优先用内存态，避免侧栏刚改过而 storage 尚未 debounce 完成
    const base = state;
    const source = base.workspaces.length >= prev.workspaces.length ? base : prev;
    const ws = createEmptyWorkspace(name ?? nextWorkspaceName(source.workspaces));
    const next: WorkspacePersistedState = {
      ...source,
      lastOpenedId: ws.id,
      workspaces: [...source.workspaces, ws],
    };
    commitStateNow(next);
    return ws;
  }, [commitStateNow, state]);

  /** 从研判桌预设新建（长线/波段/短线） */
  const createWorkspaceFromPreset = useCallback(
    (preset: Workspace): Workspace => {
      const prev = loadState();
      const base = state;
      const source = base.workspaces.length >= prev.workspaces.length ? base : prev;
      const ws: Workspace = {
        ...preset,
        id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const next: WorkspacePersistedState = {
        ...source,
        lastOpenedId: ws.id,
        workspaces: [...source.workspaces, ws],
      };
      commitStateNow(next);
      return ws;
    },
    [commitStateNow, state]
  );

  const renameWorkspace = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateWorkspace(id, (ws) => ({ ...ws, name: trimmed }));
    },
    [updateWorkspace]
  );

  const duplicateWorkspace = useCallback(
    (id: string): Workspace | null => {
      const source = state.workspaces.find((w) => w.id === id);
      if (!source) return null;
      const copy: Workspace = {
        id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${source.name} 副本`,
        layout: source.layout.map((item) => ({ ...item })),
        widgets: source.widgets.map((w) => ({
          ...w,
          config: w.config ? { ...w.config } : undefined,
        })),
      };
      commitStateNow({
        ...state,
        lastOpenedId: copy.id,
        workspaces: [...state.workspaces, copy],
      });
      return copy;
    },
    [commitStateNow, state]
  );

  const deleteWorkspace = useCallback(
    (id: string): boolean => {
      if (state.workspaces.length <= 1) return false;
      const remaining = state.workspaces.filter((w) => w.id !== id);
      commitStateNow({
        ...state,
        lastOpenedId:
          state.lastOpenedId === id ? remaining[0]?.id ?? null : state.lastOpenedId,
        workspaces: remaining,
      });
      return true;
    },
    [commitStateNow, state]
  );

  const setLastOpened = useCallback(
    (id: string) => {
      patchState((prev) => {
        if (!prev.workspaces.some((w) => w.id === id)) return prev;
        if (prev.lastOpenedId === id) return prev;
        return { ...prev, lastOpenedId: id };
      });
    },
    [patchState]
  );

  const clearLayout = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    updateWorkspace(id, (ws) => ({
      ...ws,
      layout: [],
      widgets: [],
    }));
  }, [updateWorkspace]);

  const exportJson = useCallback(() => {
    return JSON.stringify(state, null, 2);
  }, [state]);

  const importJson = useCallback(
    (raw: string): boolean => {
      const parsed = parseState(raw);
      if (!parsed) return false;
      commitStateNow(parsed);
      return true;
    },
    [commitStateNow]
  );

  return {
    density: state.density,
    workspaces: state.workspaces,
    lastOpenedId: state.lastOpenedId,
    activeWorkspace,
    layout: activeWorkspace?.layout ?? [],
    widgets: activeWorkspace?.widgets ?? [],
    onLayoutChange,
    removeWidget,
    updateWidget,
    addWidget,
    createWorkspace,
    createWorkspaceFromPreset,
    renameWorkspace,
    duplicateWorkspace,
    deleteWorkspace,
    setLastOpened,
    clearLayout,
    exportJson,
    importJson,
  };
}
