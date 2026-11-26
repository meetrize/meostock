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
} from 'react';
import { RELATION_META, RELATION_TYPES } from './relationMeta';
import type {
  EntityRelation,
  EntityRelationType,
  EvidenceGrade,
  IndustrialChainGraph,
} from './types';
import styles from './IndustrialChain.module.css';

type Rect = { x: number; y: number; w: number; h: number };

const LAYER_ACCENTS = ['#a78bfa', '#38bdf8', '#34d399', '#f5b75c', '#f97316', '#e879f9', '#94a3b8'];

function primaryMembership(
  graph: IndustrialChainGraph,
  entityId: string
): { segmentId: string; secondary: number } | null {
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
  return { segmentId: ranked[0].segmentId, secondary: ranked.length - 1 };
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

export function EntityRelationView({
  graph,
  selectedEntityId,
  onSelectEntity,
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [positions, setPositions] = useState<Record<string, Rect>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const relations = graph.relations ?? [];

  const placement = useMemo(() => {
    const map = new Map<string, { segmentId: string; secondary: number }>();
    for (const ent of graph.entities) {
      const p = primaryMembership(graph, ent.id);
      if (p) map.set(ent.id, p);
    }
    return map;
  }, [graph]);

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

  const visibleEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ent of graph.entities) {
      if (!placement.has(ent.id)) continue;
      if (egoIds && !egoIds.has(ent.id)) continue;
      ids.add(ent.id);
    }
    // 保证关系两端都在（若未 ego 过滤掉）
    for (const r of relations) {
      if (relationFilter !== 'all' && r.type !== relationFilter) continue;
      if (egoIds && !egoIds.has(r.fromEntityId) && !egoIds.has(r.toEntityId)) continue;
      if (egoIds) {
        if (egoIds.has(r.fromEntityId)) ids.add(r.fromEntityId);
        if (egoIds.has(r.toEntityId)) ids.add(r.toEntityId);
      }
    }
    return ids;
  }, [graph.entities, placement, egoIds, relations, relationFilter]);

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
    const base = stage.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const id of Object.keys(nodeRefs.current)) {
      const el = nodeRefs.current[id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      next[id] = {
        x: rect.left - base.left,
        y: rect.top - base.top,
        w: rect.width,
        h: rect.height,
      };
    }
    setPositions(next);
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, layers, selectedEntityId, egoMode, relationFilter, query]);

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
    const el = nodeRefs.current[selectedEntityId ?? ''];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedEntityId]);

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
      <p className={styles.relHint}>
        点击卡片聚焦，悬停预览连接 · invest/tech 不进冲击沙盘 · 未核关系灰显
        {egoMode && graph.focalEntityId
          ? ' · 当前为锚点一阶邻居（可切全链）'
          : ''}
      </p>

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
        className={styles.relCanvas}
        ref={scrollRef}
        onClick={() => onSelectEntity(null)}
      >
        <div className={styles.relStage} ref={stageRef}>
          <svg className={styles.relSvg} aria-hidden>
            {drawn.map(({ relation, d, mid, active, preview, muted }) => {
              const meta = RELATION_META[relation.type];
              const weak = relation.evidenceGrade === 'unverified';
              return (
                <g
                  key={relation.id}
                  className={`${styles.relEdge} ${active || preview ? styles.relEdgeHot : ''} ${muted ? styles.relEdgeMuted : ''} ${weak ? styles.relEdgeWeak : ''}`}
                >
                  <path d={d} stroke={meta.color} fill="none" />
                  {(active || preview) && (
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
                  {layer.nodes.map((node, ni) => {
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
                    const pct = quotePct?.get(node.id);
                    const secondary = placement.get(node.id)?.secondary ?? 0;
                    const isFocal = node.id === graph.focalEntityId;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        ref={(el) => {
                          nodeRefs.current[node.id] = el;
                        }}
                        className={[
                          styles.relCard,
                          selected ? styles.relCardSelected : '',
                          related ? styles.relCardRelated : '',
                          searchMuted || focusMuted ? styles.relCardDim : '',
                          isFocal ? styles.relCardFocal : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ ['--node-accent' as string]: layer.accent } as CSSProperties}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEntity(selected ? null : node.id);
                        }}
                        onMouseEnter={() => setHoveredId(node.id)}
                        onMouseLeave={() => setHoveredId(null)}
                      >
                        <span className={styles.relCardTop}>
                          <span>
                            {String(li + 1).padStart(2, '0')}-
                            {String(ni + 1).padStart(2, '0')}
                          </span>
                          <span>
                            {node.symbols[0] ?? '—'}
                            {secondary > 0 ? ` · +${secondary}挂` : ''}
                          </span>
                        </span>
                        <span className={styles.relCardMain}>
                          <span className={styles.relCardGlyph}>
                            {(node.name.slice(0, 1) || '?').toUpperCase()}
                          </span>
                          <span className={styles.relCardText}>
                            <span className={styles.relCardName}>
                              {node.name}
                              {isFocal ? ' · 锚点' : ''}
                            </span>
                            <span className={styles.relCardSub}>
                              {node.revenueMix?.slice(0, 28) ?? layer.seg.name}
                              {node.revenueMix && node.revenueMix.length > 28 ? '…' : ''}
                            </span>
                          </span>
                        </span>
                        <span className={styles.relCardFoot}>
                          <span>
                            {pct != null
                              ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
                              : '行情—'}
                          </span>
                          <span>↗</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {layers.length === 0 && (
              <div className={styles.detailEmpty}>
                当前筛选下无企业节点（可关闭「锚点邻居」或清空搜索）
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedEnt && (
        <div className={styles.relSideStrip}>
          <div className={styles.memberTop}>
            <span className={styles.memberName}>{selectedEnt.name}</span>
            <span className={styles.badge}>{selectedEnt.symbols.join(' · ')}</span>
          </div>
          {selectedEnt.revenueMix && (
            <p className={styles.detailP}>{selectedEnt.revenueMix}</p>
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
                  </button>
                  <div className={styles.memberSymbols}>
                    {r.label}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
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
          {onWatch && selectedEnt.symbols[0] && (
            <button
              type="button"
              className={styles.btn}
              onClick={() => onWatch(selectedEnt.symbols[0], selectedEnt.name)}
            >
              加入自选
            </button>
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
        备注
        <input value={note} onChange={(e) => setNote(e.target.value)} />
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
