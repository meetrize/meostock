/**
 * Portal 布局持久化与增删
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import { createDefaultPersistedState, createDefaultWatchPreset } from './defaultLayouts';
import { applyCatalogConstraints, WIDGET_CATALOG } from './widgetCatalog';
import {
  PORTAL_STORAGE_KEY,
  type PortalLayoutItem,
  type PortalPersistedState,
  type PortalWidgetInstance,
  type PortalWidgetType,
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

function parseState(raw: string | null): PortalPersistedState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PortalPersistedState;
    if (data?.version !== 1 || !Array.isArray(data.presets) || data.presets.length === 0) {
      return null;
    }
    const presets = data.presets
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
        if (layout.length === 0 || widgets.length === 0) return null;
        return { id: p.id, name: p.name || '未命名', layout, widgets };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (presets.length === 0) return null;

    const activePresetId =
      presets.find((p) => p.id === data.activePresetId)?.id ?? presets[0].id;

    return {
      version: 1,
      density: data.density === 'comfortable' ? 'comfortable' : 'tight',
      activePresetId,
      presets,
    };
  } catch {
    return null;
  }
}

function loadState(): PortalPersistedState {
  try {
    const parsed = parseState(localStorage.getItem(PORTAL_STORAGE_KEY));
    if (parsed) return parsed;
  } catch {
    // ignore
  }
  return createDefaultPersistedState();
}

function saveState(state: PortalPersistedState) {
  try {
    localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

function nextId(type: PortalWidgetType): string {
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

export function usePortalLayout() {
  const [state, setState] = useState<PortalPersistedState>(() => loadState());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePreset = useMemo(() => {
    return (
      state.presets.find((p) => p.id === state.activePresetId) ??
      state.presets[0] ??
      createDefaultWatchPreset()
    );
  }, [state]);

  const persist = useCallback((next: PortalPersistedState) => {
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveState(next), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const updateActivePreset = useCallback(
    (
      updater: (preset: {
        layout: PortalLayoutItem[];
        widgets: PortalWidgetInstance[];
      }) => { layout: PortalLayoutItem[]; widgets: PortalWidgetInstance[] }
    ) => {
      const current =
        state.presets.find((p) => p.id === state.activePresetId) ?? state.presets[0];
      if (!current) return;
      const updated = updater({ layout: current.layout, widgets: current.widgets });
      persist({
        ...state,
        presets: state.presets.map((p) =>
          p.id === current.id
            ? { ...p, layout: updated.layout, widgets: updated.widgets }
            : p
        ),
      });
    },
    [persist, state]
  );

  const onLayoutChange = useCallback(
    (nextLayout: Layout) => {
      updateActivePreset(({ layout, widgets }) => {
        const byId = new Map(layout.map((item) => [item.i, item]));
        const merged = nextLayout.map((item) => {
          const prev = byId.get(item.i);
          const widget = widgets.find((w) => w.id === item.i);
          const base: PortalLayoutItem = {
            ...(prev ?? {}),
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: Math.max(1, item.h),
            static: item.static ?? prev?.static,
          };
          const constrained = widget
            ? applyCatalogConstraints(widget.type, base)
            : base;
          if (constrained.maxH != null && constrained.h > constrained.maxH) {
            constrained.h = constrained.maxH;
          }
          if (constrained.maxW != null && constrained.w > constrained.maxW) {
            constrained.w = constrained.maxW;
          }
          return constrained;
        });
        return { layout: merged, widgets };
      });
    },
    [updateActivePreset]
  );

  const removeWidget = useCallback(
    (id: string) => {
      updateActivePreset(({ layout, widgets }) => ({
        layout: layout.filter((item) => item.i !== id),
        widgets: widgets.filter((w) => w.id !== id),
      }));
    },
    [updateActivePreset]
  );

  const addWidget = useCallback(
    (type: PortalWidgetType) => {
      const catalog = WIDGET_CATALOG[type];
      const id = nextId(type);
      const { w, h } = catalog.defaultLayout;
      updateActivePreset(({ layout, widgets }) => {
        const { x, y } = findDropPosition(layout, w, h);
        const layoutItem = applyCatalogConstraints(type, {
          i: id,
          x,
          y,
          w,
          h,
        });
        return {
          layout: [...layout, layoutItem],
          widgets: [...widgets, { id, type }],
        };
      });
      return id;
    },
    [updateActivePreset]
  );

  const resetToDefault = useCallback(() => {
    const fresh = createDefaultPersistedState();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setState(fresh);
    saveState(fresh);
  }, []);

  const layoutById = useMemo(() => {
    const map = new Map<string, PortalLayoutItem>();
    for (const item of activePreset.layout) map.set(item.i, item);
    return map;
  }, [activePreset.layout]);

  return {
    density: state.density,
    layout: activePreset.layout,
    widgets: activePreset.widgets,
    layoutById,
    onLayoutChange,
    removeWidget,
    addWidget,
    resetToDefault,
  };
}
