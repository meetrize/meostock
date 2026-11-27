/**
 * 企业关系网：跨环节的供货 / 投资 / 技术 / 产能（对照 cyl，证据分层 + 锚点 ego）
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronDown, ChevronUp, LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';
import { openKlineTool } from '@/utils/multipanel';
import {
  formatAmount,
  formatMarketCap,
  formatPercent,
  formatPrice,
  formatRatio,
  formatTurnover,
  getChangeColorClass,
} from '@/utils/format';
import { RELATION_META, RELATION_TYPES } from './relationMeta';
import { NodeSparkline } from './NodeSparkline';
import type { LiveQuoteRow } from './liveQuotes';
import type {
  EntityRelation,
  EntityRelationType,
  EvidenceGrade,
  IndustrialChainGraph,
} from './types';
import styles from './IndustrialChain.module.css';

type QuoteMoveFilter = 'all' | 'limitUp' | 'up5' | 'down';

type Rect = { x: number; y: number; w: number; h: number };
type ViewTransform = { scale: number; x: number; y: number };

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;
const DETAIL_HEIGHT_KEY = 'industrial-chain.relDetailHeight';
const DETAIL_MIN = 96;
const DETAIL_MAX = 420;
const DETAIL_DEFAULT = 180;

function clampScale(n: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
}

function clampDetailHeight(n: number) {
  return Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, n));
}

function readDetailHeight(): number {
  try {
    const raw = localStorage.getItem(DETAIL_HEIGHT_KEY);
    if (!raw) return DETAIL_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampDetailHeight(n) : DETAIL_DEFAULT;
  } catch {
    return DETAIL_DEFAULT;
  }
}

const LAYER_ACCENTS = ['#a78bfa', '#38bdf8', '#34d399', '#f5b75c', '#f97316', '#e879f9', '#94a3b8'];

type IoRole = 'input' | 'output' | 'both';

function primaryMembership(
  graph: IndustrialChainGraph,
  entityId: string
): { segmentId: string; secondary: number; ioRole?: IoRole } | null {
  const rows = graph.memberships.filter(
    (m) => m.entityId === entityId && m.status !== 'deprecated'
  );
  if (!rows.length) return null;
  const ranked = [...rows].sort((a, b) => {
    const score = (m: (typeof rows)[0]) => {
      if (m.peerTag === 'focal') return 100;
      if (m.tier === 'core') return 80;
      if (m.tier === 'elastic') return 60;
      if (m.status === 'active') return 40;
      return 10;
    };
    return score(b) - score(a);
  });
  return {
    segmentId: ranked[0].segmentId,
    secondary: ranked.length - 1,
    ioRole: ranked[0].ioRole,
  };
}

function buildPath(a: Rect, b: Rect) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dy) > 48) {
    const down = dy > 0;
    const p1 = { x: ac.x, y: down ? a.y + a.h : a.y };
    const p2 = { x: bc.x, y: down ? b.y : b.y + b.h };
    const bend = Math.max(36, Math.abs(p2.y - p1.y) * 0.42);
    return {
      d: `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + (down ? bend : -bend)}, ${p2.x} ${p2.y - (down ? bend : -bend)}, ${p2.x} ${p2.y}`,
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    };
  }
  const right = dx > 0;
  const p1 = { x: right ? a.x + a.w : a.x, y: ac.y };
  const p2 = { x: right ? b.x : b.x + b.w, y: bc.y };
  const bend = Math.max(32, Math.abs(p2.x - p1.x) * 0.4);
  return {
    d: `M ${p1.x} ${p1.y} C ${p1.x + (right ? bend : -bend)} ${p1.y}, ${p2.x - (right ? bend : -bend)} ${p2.y}, ${p2.x} ${p2.y}`,
    mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
  };
}

function gradeLabel(g: EvidenceGrade) {
  if (g === 'disclosed') return '披露';
  if (g === 'analyst') return '研报';
  return '未核';
}

function displaySymbol(raw: string | undefined): string {
  if (!raw) return '—';
  if (/^\d{6}\.(SH|SZ|BJ)$/i.test(raw)) return raw.toUpperCase();
  const pref = raw.match(/^(sh|sz|bj)(\d{6})$/i);
  if (pref) return `${pref[2]}.${pref[1].toUpperCase()}`;
  return raw;
}

function passQuoteFilter(q: LiveQuoteRow | undefined, filter: QuoteMoveFilter): boolean {
  if (filter === 'all') return true;
  if (!q || q.changePercent == null) return false;
  if (filter === 'limitUp') return q.limitUp;
  if (filter === 'up5') return q.changePercent >= 5;
  return q.changePercent < 0;
}

function compactMcap(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '流通—';
  if (v >= 10000) return `流通${(v / 10000).toFixed(1)}万亿`;
  if (v >= 100) return `流通${v.toFixed(0)}亿`;
  return `流通${v.toFixed(1)}亿`;
}

function compactPe(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'PE—';
  if (v < 0) return 'PE亏';
  return `PE ${v >= 100 ? v.toFixed(0) : v.toFixed(1)}`;
}

export function EntityRelationView({
  graph,
  selectedEntityId,
  onSelectEntity,
  quotes,
  quotePct,
  onWatch,
  egoMode,
  onEgoModeChange,
  relationFilter,
  onRelationFilterChange,
  query,
  onQueryChange,
  editable,
  onAddRelation,
  onRemoveRelation,
}: {
  graph: IndustrialChainGraph;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  /** 完整行情（优先） */
  quotes?: Map<string, LiveQuoteRow>;
  /** @deprecated 兼容旧调用，仅涨跌幅 */
  quotePct?: Map<string, number | null | undefined>;
  onWatch?: (symbol: string, name: string) => void;
  egoMode: boolean;
  onEgoModeChange: (v: boolean) => void;
  relationFilter: EntityRelationType | 'all';
  onRelationFilterChange: (v: EntityRelationType | 'all') => void;
  query: string;
  onQueryChange: (v: string) => void;
  editable?: boolean;
  onAddRelation?: (rel: Omit<EntityRelation, 'id'> & { id?: string }) => void;
  onRemoveRelation?: (id: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tipTimerRef = useRef<number | null>(null);
  const [positions, setPositions] = useState<Record<string, Rect>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tipId, setTipId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const [detailHeight, setDetailHeight] = useState(readDetailHeight);
  const [ioFilter, setIoFilter] = useState<IoRole | 'all'>('all');
  const [quoteFilter, setQuoteFilter] = useState<QuoteMoveFilter>('all');
  const viewRef = useRef(view);

  useEffect(() => {
    return () => {
      if (tipTimerRef.current) window.clearTimeout(tipTimerRef.current);
    };
  }, []);
  const spaceDownRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const resizeRef = useRef<{
    pointerId: number;
    startY: number;
    originH: number;
  } | null>(null);
  const detailHeightRef = useRef(detailHeight);
  detailHeightRef.current = detailHeight;
  viewRef.current = view;

  // 新选中节点时自动展开详情，避免收起后找不到
  useEffect(() => {
    if (selectedEntityId) setDetailOpen(true);
  }, [selectedEntityId]);

  const relations = graph.relations ?? [];

  const placement = useMemo(() => {
    const map = new Map<
      string,
      { segmentId: string; secondary: number; ioRole?: IoRole }
    >();
    for (const ent of graph.entities) {
      const p = primaryMembership(graph, ent.id);
      if (p) map.set(ent.id, p);
    }
    return map;
  }, [graph]);

  const hasIoRoles = useMemo(
    () => graph.memberships.some((m) => !!m.ioRole),
    [graph.memberships]
  );

  const egoIds = useMemo(() => {
    const focal = graph.focalEntityId;
    if (!egoMode || !focal) return null;
    const set = new Set<string>([focal]);
    for (const r of relations) {
      if (r.fromEntityId === focal || r.toEntityId === focal) {
        set.add(r.fromEntityId);
        set.add(r.toEntityId);
      }
    }
    return set;
  }, [egoMode, graph.focalEntityId, relations]);

  const matchedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      graph.entities
        .filter((e) =>
          [e.name, ...(e.symbols ?? []), e.revenueMix ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
        .map((e) => e.id)
    );
  }, [graph.entities, query]);

  const getQuote = useCallback(
    (entityId: string): LiveQuoteRow | undefined => {
      const full = quotes?.get(entityId);
      if (full) return full;
      const pct = quotePct?.get(entityId);
      if (pct == null) return undefined;
      return {
        entityId,
        code: '',
        name: '',
        changePercent: pct ?? null,
        pe: null,
        price: null,
        circulatingMarketCap: null,
        turnoverRate: null,
        amount: null,
        limitUp: false,
      };
    },
    [quotes, quotePct]
  );

  const chainChgRank = useMemo(() => {
    const vals = graph.entities
      .map((e) => getQuote(e.id)?.changePercent)
      .filter((v): v is number => v != null);
    return vals;
  }, [graph.entities, getQuote]);

  const visibleEntityIds = useMemo(() => {
    const ids = new Set<string>();
    const passIo = (id: string) => {
      if (ioFilter === 'all') return true;
      const role = placement.get(id)?.ioRole;
      if (!role) return false;
      if (ioFilter === 'both') return role === 'both';
      return role === ioFilter || role === 'both';
    };
    const passMove = (id: string) => passQuoteFilter(getQuote(id), quoteFilter);
    for (const ent of graph.entities) {
      if (!placement.has(ent.id)) continue;
      if (egoIds && !egoIds.has(ent.id)) continue;
      if (!passIo(ent.id)) continue;
      if (!passMove(ent.id)) continue;
      ids.add(ent.id);
    }
    // 保证关系两端都在（若未 ego 过滤掉）
    for (const r of relations) {
      if (relationFilter !== 'all' && r.type !== relationFilter) continue;
      if (egoIds && !egoIds.has(r.fromEntityId) && !egoIds.has(r.toEntityId)) continue;
      if (egoIds) {
        if (egoIds.has(r.fromEntityId) && passIo(r.fromEntityId) && passMove(r.fromEntityId)) {
          ids.add(r.fromEntityId);
        }
        if (egoIds.has(r.toEntityId) && passIo(r.toEntityId) && passMove(r.toEntityId)) {
          ids.add(r.toEntityId);
        }
      }
    }
    return ids;
  }, [graph.entities, placement, egoIds, relations, relationFilter, ioFilter, quoteFilter, getQuote]);

  const layers = useMemo(() => {
    return graph.segments
      .slice()
      .sort((a, b) => a.column - b.column || a.row - b.row)
      .map((seg, i) => ({
        seg,
        accent: LAYER_ACCENTS[i % LAYER_ACCENTS.length],
        nodes: graph.entities.filter(
          (e) => visibleEntityIds.has(e.id) && placement.get(e.id)?.segmentId === seg.id
        ),
      }))
      .filter((L) => L.nodes.length > 0);
  }, [graph, visibleEntityIds, placement]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // getBoundingClientRect 含 CSS transform；连线画在 .relWorld 内，必须换算回未缩放局部坐标，
    // 否则缩放后再点选/重测会把 scale 乘第二次，导致连线错位。
    const scale = viewRef.current.scale || 1;
    const base = stage.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const id of Object.keys(nodeRefs.current)) {
      const el = nodeRefs.current[id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      next[id] = {
        x: (rect.left - base.left) / scale,
        y: (rect.top - base.top) / scale,
        w: rect.width / scale,
        h: rect.height / scale,
      };
    }
    setPositions(next);
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, layers, selectedEntityId, egoMode, relationFilter, ioFilter, quoteFilter, query]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stage);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, [graph.id, egoMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        spaceDownRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setView((v) => ({ ...v, scale: clampScale(nextScale) }));
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { scale, x, y } = viewRef.current;
    const s = clampScale(nextScale);
    const wx = (mx - x) / scale;
    const wy = (my - y) / scale;
    setView({ scale: s, x: mx - wx * s, y: my - wy * s });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));
        return;
      }
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, viewRef.current.scale * factor);
    },
    [zoomAt]
  );

  const resetView = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { scale } = viewRef.current;
      const next = e.ctrlKey
        ? scale * Math.exp(-e.deltaY * 0.01)
        : scale * (e.deltaY > 0 ? 0.9 : 1.1);
      zoomAt(e.clientX, e.clientY, next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const beginPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.relZoomBar}`)) return;
    const onCard = !!target.closest('button');
    const middle = e.button === 1;
    const space = spaceDownRef.current;
    if (onCard && !middle && !space) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
    };
    setPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onViewportPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy > 9) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    setView({
      scale: viewRef.current.scale,
      x: drag.originX + dx,
      y: drag.originY + dy,
    });
  }, []);

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const drawn = useMemo(() => {
    return relations.flatMap((relation) => {
      if (relationFilter !== 'all' && relation.type !== relationFilter) return [];
      if (egoIds && !egoIds.has(relation.fromEntityId) && !egoIds.has(relation.toEntityId)) {
        return [];
      }
      const from = positions[relation.fromEntityId];
      const to = positions[relation.toEntityId];
      if (!from || !to) return [];
      const geometry = buildPath(from, to);
      const active =
        !!selectedEntityId &&
        (relation.fromEntityId === selectedEntityId ||
          relation.toEntityId === selectedEntityId);
      const preview =
        !selectedEntityId &&
        !!hoveredId &&
        (relation.fromEntityId === hoveredId || relation.toEntityId === hoveredId);
      const searchMuted =
        !!matchedIds &&
        !matchedIds.has(relation.fromEntityId) &&
        !matchedIds.has(relation.toEntityId);
      const muted = (!!selectedEntityId && !active) || searchMuted;
      return [{ relation, ...geometry, active, preview, muted }];
    });
  }, [relations, positions, selectedEntityId, hoveredId, relationFilter, matchedIds, egoIds]);

  const selectedRels = useMemo(
    () =>
      relations.filter(
        (r) =>
          r.fromEntityId === selectedEntityId || r.toEntityId === selectedEntityId
      ),
    [relations, selectedEntityId]
  );

  const selectedEnt = selectedEntityId
    ? graph.entities.find((e) => e.id === selectedEntityId)
    : null;

  const selectedMembershipNote = useMemo(() => {
    if (!selectedEntityId) return null;
    const rows = graph.memberships.filter(
      (m) => m.entityId === selectedEntityId && m.status !== 'deprecated' && m.note
    );
    if (!rows.length) return null;
    return [...rows].sort((a, b) => (b.note?.length ?? 0) - (a.note?.length ?? 0))[0]
      .note!;
  }, [graph.memberships, selectedEntityId]);

  return (
    <div className={styles.relPanel}>
      <div className={styles.relToolbar}>
        <input
          className={styles.relSearch}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索公司 / 代码 / 标签"
          aria-label="搜索企业"
        />
        <div className={styles.relFilters}>
          <button
            type="button"
            className={`${styles.relChip} ${relationFilter === 'all' ? styles.relChipOn : ''}`}
            onClick={() => onRelationFilterChange('all')}
          >
            全部关系
          </button>
          {RELATION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.relChip} ${relationFilter === t ? styles.relChipOn : ''}`}
              style={{ ['--rel-color' as string]: RELATION_META[t].color }}
              onClick={() =>
                onRelationFilterChange(relationFilter === t ? 'all' : t)
              }
            >
              <span className={styles.relDot} />
              {RELATION_META[t].label}
            </button>
          ))}
        </div>
        {hasIoRoles && (
          <div className={styles.relFilters}>
            {(
              [
                ['all', '全部I/O'],
                ['input', '输入'],
                ['output', '输出'],
                ['both', '双向'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.relChip} ${ioFilter === id ? styles.relChipOn : ''}`}
                style={{
                  ['--rel-color' as string]:
                    id === 'input'
                      ? '#3b82f6'
                      : id === 'output'
                        ? '#10b981'
                        : id === 'both'
                          ? '#d97706'
                          : '#94a3b8',
                }}
                onClick={() => setIoFilter(id)}
              >
                <span className={styles.relDot} />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.relFilters} role="group" aria-label="行情筛选">
          {(
            [
              ['all', '全部行情'],
              ['limitUp', '涨停'],
              ['up5', '涨幅≥5%'],
              ['down', '下跌'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.relChip} ${quoteFilter === id ? styles.relChipOn : ''}`}
              style={{
                ['--rel-color' as string]:
                  id === 'limitUp'
                    ? '#ca8a04'
                    : id === 'up5'
                      ? '#ef4444'
                      : id === 'down'
                        ? '#22c55e'
                        : '#94a3b8',
              }}
              onClick={() => setQuoteFilter(id)}
            >
              <span className={styles.relDot} />
              {label}
            </button>
          ))}
        </div>
        {graph.focalEntityId && (
          <button
            type="button"
            className={`${styles.btn} ${egoMode ? styles.btnPrimary : ''}`}
            onClick={() => onEgoModeChange(!egoMode)}
          >
            {egoMode ? '锚点邻居' : '全链关系'}
          </button>
        )}
        {editable && (
          <button type="button" className={styles.btn} onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? '收起添加' : '添加关系'}
          </button>
        )}
      </div>
      {addOpen && editable && onAddRelation && (
        <RelationAddForm
          graph={graph}
          defaultFrom={selectedEntityId}
          onSubmit={(rel) => {
            onAddRelation(rel);
            setAddOpen(false);
          }}
        />
      )}

      <div
        className={`${styles.relCanvas} ${panning ? styles.relCanvasPanning : ''}`}
        ref={viewportRef}
        onClick={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if ((e.target as HTMLElement).closest('button')) return;
          onSelectEntity(null);
        }}
        onPointerDown={beginPan}
        onPointerMove={onViewportPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div className={styles.relZoomBar} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.panelIconBtn}
            title="放大"
            aria-label="放大"
            onClick={() => zoomBy(1.15)}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className={styles.relZoomReadout}
            title="点击复位视图"
            onClick={resetView}
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            className={styles.panelIconBtn}
            title="缩小"
            aria-label="缩小"
            onClick={() => zoomBy(1 / 1.15)}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className={styles.panelIconBtn}
            title="复位视图"
            aria-label="复位视图"
            onClick={resetView}
          >
            <LocateFixed size={14} />
          </button>
        </div>
        <div
          className={styles.relWorld}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <div className={styles.relStage} ref={stageRef}>
            <svg className={styles.relSvg} aria-hidden>
              <defs>
                {RELATION_TYPES.map((t) => (
                  <marker
                    key={t}
                    id={`rel-arrow-${t}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.2 L 9 5 L 0 8.8 Z" fill={RELATION_META[t].color} />
                  </marker>
                ))}
              </defs>
              {drawn.map(({ relation, d, mid, active, preview, muted }) => {
                const meta = RELATION_META[relation.type];
                const weak = relation.evidenceGrade === 'unverified';
                const hot = active || preview;
                const flow = !muted;
                // 未选中：悬停显示短标签；选中：连线中显示完整关系说明
                const showShort = preview && !selectedEntityId;
                const showFull = active && !!selectedEntityId;
                const fullText = (relation.note || relation.label).trim();
                const labelW = Math.min(280, Math.max(140, Math.ceil(fullText.length * 5.2)));
                const labelH = Math.min(96, Math.max(36, Math.ceil(fullText.length / 22) * 14 + 10));
                return (
                  <g
                    key={relation.id}
                    className={[
                      styles.relEdge,
                      hot ? styles.relEdgeHot : '',
                      muted ? styles.relEdgeMuted : '',
                      weak ? styles.relEdgeWeak : '',
                      flow ? styles.relEdgeFlowing : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <path
                      className={styles.relEdgeBase}
                      d={d}
                      stroke={meta.color}
                      fill="none"
                      markerEnd={`url(#rel-arrow-${relation.type})`}
                    />
                    {flow && (
                      <path
                        className={`${styles.relEdgeFlow} ${hot ? styles.relEdgeFlowHot : ''}`}
                        d={d}
                        stroke={meta.color}
                        fill="none"
                      />
                    )}
                    {hot && (
                      <circle
                        className={styles.relEdgeParticle}
                        r="3.2"
                        fill={meta.color}
                      >
                        <animateMotion
                          key={`${relation.id}-${selectedEntityId ?? 'x'}-${hoveredId ?? 'h'}`}
                          dur="2.4s"
                          repeatCount="indefinite"
                          path={d}
                        />
                      </circle>
                    )}
                    {showShort && (
                      <text
                        x={mid.x}
                        y={mid.y - 6}
                        textAnchor="middle"
                        className={styles.relEdgeLabel}
                        fill={meta.color}
                      >
                        {relation.label}
                      </text>
                    )}
                    {showFull && (
                      <foreignObject
                        x={mid.x - labelW / 2}
                        y={mid.y - labelH / 2}
                        width={labelW}
                        height={labelH}
                        className={styles.relEdgeNoteFo}
                      >
                        <div
                          className={styles.relEdgeNote}
                          style={{ borderColor: meta.color }}
                          title={fullText}
                        >
                          <span
                            className={styles.relEdgeNoteLabel}
                            style={{ color: meta.color }}
                          >
                            {relation.label}
                          </span>
                          {relation.note && relation.note !== relation.label ? (
                            <span className={styles.relEdgeNoteBody}>{relation.note}</span>
                          ) : null}
                        </div>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
            </svg>

            <div className={styles.relLayers}>
            {layers.map((layer, li) => (
              <div className={styles.relLayerRow} key={layer.seg.id}>
                <div
                  className={styles.relRail}
                  style={{ ['--layer-accent' as string]: layer.accent } as CSSProperties}
                >
                  <span className={styles.relRailIdx}>
                    {String(li + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.relRailName}>{layer.seg.name}</span>
                  <span className={styles.relRailHint}>
                    {layer.seg.grossMarginHint && layer.seg.grossMarginHint !== '—'
                      ? layer.seg.grossMarginHint
                      : layer.seg.summary ?? ''}
                  </span>
                </div>
                <div className={styles.relTrack}>
                  {layer.nodes.map((node) => {
                    const selected = selectedEntityId === node.id;
                    const related =
                      !!selectedEntityId &&
                      node.id !== selectedEntityId &&
                      drawn.some(
                        (x) =>
                          x.active &&
                          (x.relation.fromEntityId === node.id ||
                            x.relation.toEntityId === node.id)
                      );
                    const searchMuted = !!matchedIds && !matchedIds.has(node.id);
                    const focusMuted =
                      !!selectedEntityId && node.id !== selectedEntityId && !related;
                    const q = getQuote(node.id);
                    const pct = q?.changePercent ?? null;
                    const ioRole = placement.get(node.id)?.ioRole;
                    const isFocal = node.id === graph.focalEntityId;
                    const limitUp = !!q?.limitUp;
                    const strongUp = !limitUp && pct != null && pct >= 5;
                    const toneClass =
                      limitUp
                        ? styles.relCardLimitUp
                        : pct != null && pct > 0
                          ? styles.relCardUp
                          : pct != null && pct < 0
                            ? styles.relCardDown
                            : styles.relCardFlat;
                    const ioClass =
                      ioRole === 'input'
                        ? styles.relIoIn
                        : ioRole === 'output'
                          ? styles.relIoOut
                          : ioRole === 'both'
                            ? styles.relIoBoth
                            : '';
                    const sym = displaySymbol(node.symbols[0]);
                    const sparkSym = q?.code || node.symbols[0] || '';
                    const showTip = tipId === node.id && !!q;
                    let chgRankLabel = '';
                    if (q?.changePercent != null && chainChgRank.length >= 3) {
                      const below = chainChgRank.filter((v) => v < q.changePercent!).length;
                      const pctl = Math.round((below / chainChgRank.length) * 100);
                      chgRankLabel = `链内涨幅分位 ${pctl}%`;
                    }
                    return (
                      <button
                        key={node.id}
                        type="button"
                        ref={(el) => {
                          nodeRefs.current[node.id] = el;
                        }}
                        className={[
                          styles.relCard,
                          styles.relCardTrader,
                          toneClass,
                          selected ? styles.relCardSelected : '',
                          related ? styles.relCardRelated : '',
                          searchMuted || focusMuted ? styles.relCardDim : '',
                          isFocal ? styles.relCardFocal : '',
                          limitUp && !selected ? styles.relCardPulse : '',
                          ioClass,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ ['--node-accent' as string]: layer.accent } as CSSProperties}
                        title="单击选中 · 双击打开日K"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEntity(selected ? null : node.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const code = sparkSym || node.symbols[0];
                          if (code) openKlineTool(code, '1d');
                        }}
                        onMouseEnter={() => {
                          setHoveredId(node.id);
                          if (tipTimerRef.current) window.clearTimeout(tipTimerRef.current);
                          tipTimerRef.current = window.setTimeout(() => {
                            setTipId(node.id);
                          }, 240);
                        }}
                        onMouseLeave={() => {
                          setHoveredId(null);
                          if (tipTimerRef.current) {
                            window.clearTimeout(tipTimerRef.current);
                            tipTimerRef.current = null;
                          }
                          setTipId((cur) => (cur === node.id ? null : cur));
                        }}
                      >
                        <span className={styles.relCardTop}>
                          <span className={styles.relCardStatus}>
                            {limitUp ? (
                              <span className={styles.relLimitBadge}>涨停</span>
                            ) : strongUp ? (
                              <span className={styles.relStrongBadge}>强势</span>
                            ) : null}
                            {isFocal ? (
                              <span className={styles.relAnchorDot} title="锚点">
                                锚
                              </span>
                            ) : null}
                            <span className={styles.relCardCode}>{sym}</span>
                          </span>
                          <span className={`${styles.relCardPct} ${getChangeColorClass(pct)}`}>
                            {pct != null ? formatPercent(pct) : '—'}
                          </span>
                        </span>
                        <span className={styles.relCardMain}>
                          <span className={styles.relCardText}>
                            <span className={styles.relCardNameRow}>
                              <span className={styles.relCardName}>{node.name}</span>
                              <span className={`${styles.relCardPrice} ${getChangeColorClass(pct)}`}>
                                {q?.price != null ? formatPrice(q.price) : '—'}
                              </span>
                            </span>
                          </span>
                        </span>
                        {sparkSym ? (
                          <NodeSparkline
                            symbol={sparkSym}
                            tone={pct}
                            className={styles.relCardSpark}
                          />
                        ) : (
                          <span className={styles.relCardSpark} />
                        )}
                        <span className={styles.relCardFoot}>
                          <span className={styles.relCardMetrics}>
                            {compactMcap(q?.circulatingMarketCap)}
                            <span className={styles.relCardSep}>·</span>
                            {compactPe(q?.pe)}
                          </span>
                          <span className={styles.relCardIo}>
                            {ioRole === 'input' && (
                              <span className={`${styles.ioBadge} ${styles.ioBadgeIn}`}>入</span>
                            )}
                            {ioRole === 'output' && (
                              <span className={`${styles.ioBadge} ${styles.ioBadgeOut}`}>出</span>
                            )}
                            {ioRole === 'both' && (
                              <span className={`${styles.ioBadge} ${styles.ioBadgeBoth}`}>双</span>
                            )}
                          </span>
                        </span>
                        {showTip && (
                          <span className={styles.relCardTip} role="tooltip">
                            <span>换手 {formatTurnover(q?.turnoverRate)}</span>
                            <span>额 {formatAmount(q?.amount)}</span>
                            {q?.pe != null && <span>PE {formatRatio(q.pe)}</span>}
                            {q?.circulatingMarketCap != null && (
                              <span>流通 {formatMarketCap(q.circulatingMarketCap)}</span>
                            )}
                            {chgRankLabel ? <span>{chgRankLabel}</span> : null}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {layers.length === 0 && (
              <div className={styles.detailEmpty}>
                当前筛选下无企业节点（可切换行情筛选、关闭「锚点邻居」或清空搜索）
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {selectedEnt && (
        <div className={styles.relDetailDock}>
          <div
            className={styles.relResizeHandle}
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖动调整详情面板高度"
            title="拖动调整高度"
            onPointerDown={(e) => {
              if (!detailOpen) {
                setDetailOpen(true);
                return;
              }
              e.preventDefault();
              resizeRef.current = {
                pointerId: e.pointerId,
                startY: e.clientY,
                originH: detailHeight,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const drag = resizeRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              // 手柄在面板上方：向上拖增大高度
              const next = clampDetailHeight(drag.originH - (e.clientY - drag.startY));
              detailHeightRef.current = next;
              setDetailHeight(next);
            }}
            onPointerUp={(e) => {
              const drag = resizeRef.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              resizeRef.current = null;
              try {
                localStorage.setItem(
                  DETAIL_HEIGHT_KEY,
                  String(detailHeightRef.current)
                );
              } catch {
                /* ignore */
              }
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }}
          />
          <div className={styles.relDetailHeader}>
            <div className={styles.relDetailTitle}>
              <span className={styles.memberName}>{selectedEnt.name}</span>
              <span className={styles.badge}>{selectedEnt.symbols.join(' · ')}</span>
              <span className={styles.badge}>
                {selectedRels.length} 条关系
              </span>
            </div>
            <div className={styles.relDetailHeaderActions}>
              {onWatch && selectedEnt.symbols[0] && detailOpen && (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => onWatch(selectedEnt.symbols[0], selectedEnt.name)}
                >
                  加入自选
                </button>
              )}
              <button
                type="button"
                className={styles.panelIconBtn}
                title={detailOpen ? '收起详情' : '展开详情'}
                aria-label={detailOpen ? '收起详情' : '展开详情'}
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen((v) => !v)}
              >
                {detailOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>
          {detailOpen && (
            <div
              className={styles.relSideStrip}
              style={{ height: detailHeight }}
            >
              {selectedEnt.revenueMix && (
                <p className={styles.detailP}>
                  <strong>产品/服务</strong> {selectedEnt.revenueMix}
                </p>
              )}
              {selectedMembershipNote && (
                <p className={styles.detailP}>
                  <strong>关系说明</strong> {selectedMembershipNote}
                </p>
              )}
              <ul className={styles.relSideList}>
                {selectedRels.length === 0 && (
                  <li className={styles.detailP}>暂无出入关系</li>
                )}
                {selectedRels.map((r) => {
                  const otherId =
                    r.fromEntityId === selectedEnt.id ? r.toEntityId : r.fromEntityId;
                  const other = graph.entities.find((e) => e.id === otherId);
                  const dir = r.fromEntityId === selectedEnt.id ? '→' : '←';
                  const meta = RELATION_META[r.type];
                  return (
                    <li key={r.id} className={styles.relSideItem}>
                      <button
                        type="button"
                        className={styles.relSideJump}
                        onClick={() => onSelectEntity(otherId)}
                      >
                        <span style={{ color: meta.color }}>
                          {meta.label} {dir}
                        </span>{' '}
                        {other?.name ?? otherId}
                        <span className={styles.badge}>{gradeLabel(r.evidenceGrade)}</span>
                        <span className={styles.badge}>{r.label}</span>
                      </button>
                      {r.note && (
                        <p className={styles.relSideNote}>
                          <strong>关系</strong> {r.note}
                        </p>
                      )}
                      {editable && onRemoveRelation && (
                        <button
                          type="button"
                          className={styles.btn}
                          onClick={() => onRemoveRelation(r.id)}
                        >
                          删除关系
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RelationAddForm({
  graph,
  defaultFrom,
  onSubmit,
}: {
  graph: IndustrialChainGraph;
  defaultFrom: string | null;
  onSubmit: (rel: Omit<EntityRelation, 'id'> & { id?: string }) => void;
}) {
  const [fromEntityId, setFrom] = useState(defaultFrom ?? graph.entities[0]?.id ?? '');
  const [toEntityId, setTo] = useState(
    graph.entities.find((e) => e.id !== (defaultFrom ?? graph.entities[0]?.id))?.id ?? ''
  );
  const [type, setType] = useState<EntityRelationType>('supply');
  const [label, setLabel] = useState('');
  const [evidenceGrade, setGrade] = useState<EvidenceGrade>('analyst');
  const [note, setNote] = useState('');

  return (
    <div className={styles.relAddForm}>
      <label>
        从
        <select value={fromEntityId} onChange={(e) => setFrom(e.target.value)}>
          {graph.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        到
        <select value={toEntityId} onChange={(e) => setTo(e.target.value)}>
          {graph.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        类型
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EntityRelationType)}
        >
          {RELATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {RELATION_META[t].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        标签
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：服务器供货" />
      </label>
      <label>
        证据
        <select
          value={evidenceGrade}
          onChange={(e) => setGrade(e.target.value as EvidenceGrade)}
        >
          <option value="disclosed">披露</option>
          <option value="analyst">研报</option>
          <option value="unverified">未核</option>
        </select>
      </label>
      <label>
        关系说明
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="完整关系/供货说明（选中后连线与详情显示）"
        />
      </label>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={() => {
          if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) return;
          if (!label.trim()) return;
          onSubmit({
            fromEntityId,
            toEntityId,
            type,
            label: label.trim(),
            evidenceGrade,
            note: note.trim() || undefined,
            confidence: evidenceGrade === 'disclosed' ? 0.85 : evidenceGrade === 'analyst' ? 0.6 : 0.35,
            asOf: new Date().toISOString().slice(0, 7),
          });
        }}
      >
        写入草稿
      </button>
    </div>
  );
}
