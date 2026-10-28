import { useCallback, useEffect, useRef } from 'react';
import GridLayout, {
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { WIDGET_CATALOG } from './widgetCatalog';
import { WidgetChrome } from './WidgetChrome';
import { renderWidget } from './widgets';
import { getIndexCodeByType, isIndexWidgetType } from './indexCatalog';
import {
  PORTAL_COLS,
  PORTAL_GUTTER,
  PORTAL_ROW_HEIGHT,
  type PortalLayoutItem,
  type PortalWidgetInstance,
} from './types';
import styles from './PortalCanvas.module.css';

function isCompactWidgetType(type: string): boolean {
  return (
    isIndexWidgetType(type) ||
    type.startsWith('stat.') ||
    type.startsWith('strip.')
  );
}

function openIndexKline(code: string) {
  const symbol = encodeURIComponent(code);
  window.open(`/?symbol=${symbol}&period=1d`, '_blank', 'noopener,noreferrer');
}

interface PortalCanvasProps {
  editing: boolean;
  mobile: boolean;
  layout: PortalLayoutItem[];
  widgets: PortalWidgetInstance[];
  onLayoutChange: (layout: Layout) => void;
  onRemoveWidget: (id: string) => void;
}

type ResizeAxis = 'e' | 's' | 'se';

interface ResizeSession {
  i: string;
  axis: ResizeAxis;
  snapshot: Layout;
}

function detectResizeAxis(target: EventTarget | null): ResizeAxis | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  if (el.closest('.react-resizable-handle-se')) return 'se';
  if (el.closest('.react-resizable-handle-e')) return 'e';
  if (el.closest('.react-resizable-handle-s')) return 's';
  return null;
}

/**
 * 把正在拖/缩放的面板几何，完整对齐到占位色块。
 * 只改「当前活动」那一个节点；松手后交给 React/RGL 重绘，禁止 removeProperty 清全局面板。
 */
function snapActiveItemToPlaceholder(root: HTMLElement | null) {
  if (!root) return;
  const item = root.querySelector(
    '.react-grid-item.resizing, .react-grid-item.react-draggable-dragging'
  ) as HTMLElement | null;
  const ph = root.querySelector('.react-grid-placeholder') as HTMLElement | null;
  if (!item || !ph) return;

  const w = ph.offsetWidth;
  const h = ph.offsetHeight;
  if (w < 8 || h < 8) return;
  // 占位异常超高时不同步，避免把脏高度写到可视面板
  if (h > Math.max(window.innerHeight * 1.5, 1200)) return;

  item.style.width = `${w}px`;
  item.style.height = `${h}px`;

  // 位置：优先拷贝 transform（RGL 默认策略），否则 top/left
  const tf = ph.style.transform;
  if (tf && tf !== 'none') {
    item.style.transform = tf;
    if (ph.style.top) item.style.top = ph.style.top;
    if (ph.style.left) item.style.left = ph.style.left;
  } else {
    if (ph.style.top) item.style.top = ph.style.top;
    if (ph.style.left) item.style.left = ph.style.left;
  }
}

/**
 * 落盘时用快照修正：右缘只改 w；下缘只改 h；其它面板恢复快照，防止 compact 被带偏。
 */
function applyResizeSnapshot(next: Layout, session: ResizeSession | null): Layout {
  if (!session) return next;
  const snapById = new Map(session.snapshot.map((item) => [item.i, item]));
  const nextById = new Map(next.map((item) => [item.i, item]));

  const restored = session.snapshot.map((snap) => {
    const cur = nextById.get(snap.i);
    if (!cur) return { ...snap };
    if (snap.i !== session.i) return { ...snap };

    if (session.axis === 'e') {
      return { ...snap, w: cur.w, x: cur.x };
    }
    if (session.axis === 's') {
      return { ...snap, h: cur.h, y: cur.y };
    }
    return { ...snap, w: cur.w, h: cur.h, x: cur.x, y: cur.y };
  });

  for (const item of next) {
    if (!snapById.has(item.i)) restored.push(item);
  }
  return restored;
}

export function PortalCanvas({
  editing,
  mobile,
  layout,
  widgets,
  onLayoutChange,
  onRemoveWidget,
}: PortalCanvasProps) {
  const { width, containerRef, mounted } = useContainerWidth({
    measureBeforeMount: true,
  });
  const sessionRef = useRef<ResizeSession | null>(null);
  const axisHintRef = useRef<ResizeAxis | null>(null);
  const pendingClearRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const layoutMap = new Map(layout.map((item) => [item.i, item]));

  const stopSnapLoop = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startSnapLoop = useCallback(() => {
    activeRef.current = true;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      if (!activeRef.current) return;
      snapActiveItemToPlaceholder(containerRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [containerRef]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !editing) return;
    const onDown = (e: MouseEvent) => {
      axisHintRef.current = detectResizeAxis(e.target);
    };
    root.addEventListener('mousedown', onDown, true);
    return () => root.removeEventListener('mousedown', onDown, true);
  }, [editing, containerRef, mounted, width]);

  useEffect(
    () => () => {
      stopSnapLoop();
      if (pendingClearRef.current != null) {
        cancelAnimationFrame(pendingClearRef.current);
      }
    },
    [stopSnapLoop]
  );

  const commitLayout = useCallback(
    (next: Layout) => {
      onLayoutChange(applyResizeSnapshot(next, sessionRef.current));
    },
    [onLayoutChange]
  );

  const handleResizeStart = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null) => {
      if (!oldItem) return;
      if (pendingClearRef.current != null) {
        cancelAnimationFrame(pendingClearRef.current);
        pendingClearRef.current = null;
      }
      sessionRef.current = {
        i: oldItem.i,
        axis: axisHintRef.current ?? 'se',
        snapshot: layout.map((item) => ({ ...item })),
      };
      startSnapLoop();
    },
    [layout, startSnapLoop]
  );

  const handleResize = useCallback(() => {
    // 立即对齐一帧，不等 rAF
    snapActiveItemToPlaceholder(containerRef.current);
  }, [containerRef]);

  const handleResizeStop = useCallback(
    (nextLayout: Layout) => {
      stopSnapLoop();
      // 不 removeProperty：下一帧 React 会用最终 layout 重写 style
      commitLayout(nextLayout);
      pendingClearRef.current = requestAnimationFrame(() => {
        pendingClearRef.current = requestAnimationFrame(() => {
          sessionRef.current = null;
          axisHintRef.current = null;
          pendingClearRef.current = null;
        });
      });
    },
    [commitLayout, stopSnapLoop]
  );

  const handleDragStart = useCallback(() => {
    startSnapLoop();
  }, [startSnapLoop]);

  const handleDrag = useCallback(() => {
    snapActiveItemToPlaceholder(containerRef.current);
  }, [containerRef]);

  const handleDragStop = useCallback(() => {
    stopSnapLoop();
  }, [stopSnapLoop]);

  if (mobile) {
    return (
      <div className={styles.mobileStack}>
        {widgets.map((widget) => {
          const item = layoutMap.get(widget.id);
          const w = item?.w ?? 6;
          const h = item?.h ?? 8;
          const title =
            widget.title ?? WIDGET_CATALOG[widget.type]?.name ?? widget.type;
          return (
            <div key={widget.id} className={styles.mobileItem}>
              <WidgetChrome
                title={title}
                editing={false}
                compact={isCompactWidgetType(widget.type)}
                onRemove={() => onRemoveWidget(widget.id)}
                onTitleClick={
                  isIndexWidgetType(widget.type)
                    ? () => {
                        if (isIndexWidgetType(widget.type)) {
                          openIndexKline(getIndexCodeByType(widget.type));
                        }
                      }
                    : undefined
                }
                titleHint={
                  isIndexWidgetType(widget.type) ? '打开日线 K 线' : undefined
                }
              >
                {renderWidget(widget.type, w, h)}
              </WidgetChrome>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${styles.canvasWrap} ${editing ? styles.canvasEditing : ''}`}
    >
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: PORTAL_COLS,
            rowHeight: PORTAL_ROW_HEIGHT,
            margin: [PORTAL_GUTTER, PORTAL_GUTTER],
            containerPadding: [0, 0],
            maxRows: 120,
          }}
          dragConfig={{
            enabled: editing,
            handle: '.widget-drag-handle',
            cancel: 'button, a, input, textarea, select',
          }}
          resizeConfig={{
            enabled: editing,
            handles: ['e', 's', 'se'],
          }}
          compactor={verticalCompactor}
          onLayoutChange={commitLayout}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeStop={handleResizeStop}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragStop={handleDragStop}
        >
          {widgets.map((widget) => {
            const item = layoutMap.get(widget.id);
            if (!item) return null;
            const title =
              widget.title ?? WIDGET_CATALOG[widget.type]?.name ?? widget.type;
            return (
              <div key={widget.id} className={styles.gridItem}>
                <WidgetChrome
                  title={title}
                  editing={editing}
                  compact={isCompactWidgetType(widget.type)}
                  onRemove={() => onRemoveWidget(widget.id)}
                  onTitleClick={
                    isIndexWidgetType(widget.type)
                      ? () => {
                          if (isIndexWidgetType(widget.type)) {
                            openIndexKline(getIndexCodeByType(widget.type));
                          }
                        }
                      : undefined
                  }
                  titleHint={
                    isIndexWidgetType(widget.type) ? '打开日线 K 线' : undefined
                  }
                >
                  {renderWidget(widget.type, item.w, item.h)}
                </WidgetChrome>
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
