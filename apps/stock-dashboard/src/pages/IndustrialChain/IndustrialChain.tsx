/**
 * 产业链 Situation Room（P0–P2：图谱/信号/候选/沙盘/背离/跨市场）
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Download,
  Eye,
  FileWarning,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { useToast } from '@/components/common';
import {
  selectAllCodes,
  watchlistActions,
  watchlistStore,
} from '@/services/watchlistStore';
import { fetchSemiImpactItems, impactToProposals } from './announceCandidates';
import {
  acceptMembershipProposal,
  ingestProposals,
  listProposals,
  rejectProposal,
  resetProposals,
} from './candidatesStore';
import { CHAIN_CATALOG, depthLabel } from './catalog';
import { CommandPalette } from './CommandPalette';
import { buildCommandItems } from './commands';
import { buildDivergencePoints } from './divergence';
import {
  fetchLiveQuoteRows,
  liveQuoteByEntity,
  mergeLiveMetrics,
  type LiveQuoteRow,
} from './liveQuotes';
import { EntityRelationView } from './EntityRelationView';
import {
  CenterViewSwitch,
  CrossMarketTable,
  DivergenceRadar,
  ExposurePanel,
  RestructurePanel,
  SandboxPanel,
} from './P2Views';
import { buildPortfolioExposure, toWatchlistCode } from './portfolioExposure';
import { C01_INDICATORS } from './seed/c01Indicators';
import { C01_MARKET_METRICS } from './seed/c01MarketMetrics';
import { C01_RESTRUCTURE } from './seed/c01Restructure';
import { C05_INDICATORS } from './seed/c05Indicators';
import {
  buildSignalCards,
  getIndicatorsForSegment,
  signalLevelLabel,
  signalTypeLabel,
} from './signals';
import {
  buildEventChecklist,
  runCascade,
  SHOCK_PRESETS,
} from './shockSandbox';
import {
  discardDraft,
  exportChainJson,
  getDraftChain,
  getEditableChain,
  getPublishedChain,
  importChainJson,
  isEditableChain,
  publishDraft,
  resetToSeed,
  saveDraft,
} from './store';
import type {
  BeneficiaryTier,
  ChainCenterView,
  ChainMembership,
  ChainRightTab,
  ChainSignalCard,
  ChainWorkspaceMode,
  ChangeProposal,
  CommandAction,
  EdgeParams,
  EntityMarketMetrics,
  EntityRelation,
  EntityRelationType,
  EvidenceGrade,
  IndustrialChainGraph,
  LeadingIndicator,
  MembershipStatus,
  PeerComparability,
  ShockScenario,
  SignalActionLevel,
  SignalUrgency,
} from './types';
import styles from './IndustrialChain.module.css';

function indicatorsForChain(chainId: string): LeadingIndicator[] {
  if (chainId === 'C05') return C05_INDICATORS;
  return C01_INDICATORS;
}

function seedMetricsForChain(chainId: string): EntityMarketMetrics[] {
  if (chainId === 'C01') return C01_MARKET_METRICS;
  return [];
}

const PEER_LABEL: Record<PeerComparability, string> = {
  focal: '锚点',
  high: '高可比',
  mid: '中可比',
  low: '低可比',
  upstream: '上游',
  downstream: '下游',
};

const NODE_W = 132;
const NODE_H = 56;
const COL_GAP = 56;
const ROW_GAP = 28;
const PAD_X = 32;
const PAD_Y = 28;

const TIER_LABEL: Record<BeneficiaryTier, string> = {
  core: '核心',
  elastic: '弹性',
  indirect: '间接',
  concept: '概念',
};

const STATUS_LABEL: Record<MembershipStatus, string> = {
  candidate: '候选',
  concept: '概念',
  active: '活跃',
  watch_only: '仅观察',
  deprecated: '停用',
};

const LAYER_LABEL = {
  leading: '领先',
  coincident: '同步',
  lagging: '滞后',
} as const;

function tierClass(tier: BeneficiaryTier) {
  if (tier === 'core') return styles.tierCore;
  if (tier === 'elastic') return styles.tierElastic;
  if (tier === 'indirect') return styles.tierIndirect;
  return styles.tierConcept;
}

function urgencyClass(u: SignalUrgency) {
  if (u === 'U0') return styles.u0;
  if (u === 'U1') return styles.u1;
  return styles.u2;
}

function levelClass(level: SignalActionLevel) {
  if (level === 'intel') return styles.levelIntel;
  if (level === 'watch') return styles.levelWatch;
  if (level === 'position') return styles.levelPosition;
  return styles.levelAction;
}

function layoutPositions(graph: IndustrialChainGraph) {
  const map = new Map<string, { x: number; y: number }>();
  for (const seg of graph.segments) {
    map.set(seg.id, {
      x: PAD_X + seg.column * (NODE_W + COL_GAP),
      y: PAD_Y + seg.row * (NODE_H + ROW_GAP),
    });
  }
  const maxCol = Math.max(0, ...graph.segments.map((s) => s.column));
  const maxRow = Math.max(0, ...graph.segments.map((s) => s.row));
  return {
    map,
    width: PAD_X * 2 + (maxCol + 1) * NODE_W + maxCol * COL_GAP,
    height: PAD_Y * 2 + (maxRow + 1) * NODE_H + maxRow * ROW_GAP,
  };
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function IndustrialChain() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [chainId, setChainId] = useState('C01');
  const [mode, setMode] = useState<ChainWorkspaceMode>('situation');
  const [centerView, setCenterView] = useState<ChainCenterView>('graph');
  const [rightTab, setRightTab] = useState<ChainRightTab>('signals');
  const [selectedSegId, setSelectedSegId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(() => !!getDraftChain('C01'));
  const [graph, setGraph] = useState<IndustrialChainGraph | null>(() =>
    getPublishedChain('C01')
  );
  const [proposals, setProposals] = useState<ChangeProposal[]>(() =>
    listProposals('C01', true)
  );
  const [shock, setShock] = useState<ShockScenario>(() => ({
    ...SHOCK_PRESETS[0],
    intensity: 0.7,
  }));
  const [checklistDone, setChecklistDone] = useState<Record<string, boolean>>({});
  const [cmdOpen, setCmdOpen] = useState(false);
  const [liveRows, setLiveRows] = useState<LiveQuoteRow[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<EntityMarketMetrics[] | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [announceLoading, setAnnounceLoading] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<EntityRelationType | 'all'>('all');
  const [relationQuery, setRelationQuery] = useState('');
  const [egoMode, setEgoMode] = useState(true);

  const watchSnapshot = useSyncExternalStore(
    watchlistStore.subscribe,
    watchlistStore.getSnapshot,
    watchlistStore.getSnapshot
  );
  const watchCodes = useMemo(() => selectAllCodes(watchSnapshot), [watchSnapshot]);

  const catalogItem = CHAIN_CATALOG.find((c) => c.id === chainId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 可编辑链自动尝试拉一次行情（失败静默，可手动刷新）
  useEffect(() => {
    if (!isEditableChain(chainId) || !graph) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchLiveQuoteRows(graph);
        if (cancelled) return;
        setLiveRows(rows);
        setLiveMetrics(mergeLiveMetrics(rows, seedMetricsForChain(chainId)));
      } catch {
        /* 静默：缓存/网络不可用时仍可用种子 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, graph?.id, graph?.release.version]);

  const reloadProposals = useCallback((id: string = chainId) => {
    setProposals(listProposals(id, true));
  }, [chainId]);

  const reloadView = useCallback(
    (id: string, preferDraft: boolean) => {
      if (!isEditableChain(id)) {
        setGraph(null);
        setSelectedSegId(null);
        setHasDraft(false);
        setLiveRows([]);
        setLiveMetrics(null);
        setProposals([]);
        return;
      }
      const next = preferDraft ? getEditableChain(id) : getPublishedChain(id);
      setGraph(next);
      setHasDraft(!!getDraftChain(id));
      setSelectedSegId((prev) => {
        if (prev && next?.segments.some((s) => s.id === prev)) return prev;
        if (next?.focalEntityId) {
          const m = next.memberships.find((x) => x.entityId === next.focalEntityId);
          if (m) return m.segmentId;
        }
        return next?.segments[0]?.id ?? null;
      });
      setLiveRows([]);
      setLiveMetrics(null);
      reloadProposals(id);
    },
    [reloadProposals]
  );

  const enterEditor = () => {
    if (!isEditableChain(chainId)) return;
    const editable = getEditableChain(chainId);
    if (!editable) return;
    if (!getDraftChain(chainId)) saveDraft(editable);
    setMode('editor');
    setRightTab('detail');
    reloadView(chainId, true);
    toast.info('已进入编辑：改动先写入草稿，发布后才生效');
  };

  const exitEditor = () => {
    setMode('situation');
    reloadView(chainId, false);
  };

  const mutateDraft = (updater: (g: IndustrialChainGraph) => IndustrialChainGraph) => {
    if (!graph || !isEditableChain(graph.id) || mode !== 'editor') return;
    const next = updater(structuredClone(graph));
    saveDraft(next);
    setGraph(next);
    setHasDraft(true);
  };

  const handlePublish = () => {
    if (!graph || !isEditableChain(graph.id)) return;
    const published = publishDraft(graph);
    setGraph(published);
    setHasDraft(false);
    setMode('situation');
    toast.success(`已发布 v${published.release.version}`);
  };

  const handleDiscard = () => {
    if (!isEditableChain(chainId)) return;
    discardDraft(chainId);
    setHasDraft(false);
    setMode('situation');
    reloadView(chainId, false);
    toast.info('已丢弃草稿');
  };

  const handleResetSeed = () => {
    if (!isEditableChain(chainId)) return;
    if (!window.confirm(`重置 ${chainId} 为种子数据？将清除该链本地发布版与草稿。`)) return;
    resetToSeed(chainId);
    if (chainId === 'C01') resetProposals();
    setHasDraft(false);
    setMode('situation');
    setRightTab('signals');
    reloadView(chainId, false);
    toast.success(`已重置为 ${chainId} 种子`);
  };

  const handleExport = () => {
    if (!graph) return;
    const blob = new Blob([exportChainJson(graph)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graph.id}-v${graph.release.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const imported = importChainJson(text);
      if (!isEditableChain(imported.id)) {
        toast.error('仅支持导入已开放主链（C01 / C05）');
        return;
      }
      saveDraft(imported);
      setChainId(imported.id);
      setMode('editor');
      setRightTab('detail');
      reloadView(imported.id, true);
      toast.success('已导入为草稿，确认后请发布');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败');
    }
  };

  const chainIndicators = useMemo(
    () => indicatorsForChain(graph?.id ?? chainId),
    [graph?.id, chainId]
  );

  const selectedSeg = graph?.segments.find((s) => s.id === selectedSegId) ?? null;

  const relatedEdges = useMemo(() => {
    if (!graph || !selectedSeg) return [];
    return graph.edges.filter(
      (e) => e.from === selectedSeg.id || e.to === selectedSeg.id
    );
  }, [graph, selectedSeg]);

  const members = useMemo(() => {
    if (!graph || !selectedSeg) return [];
    return graph.memberships
      .filter((m) => m.segmentId === selectedSeg.id && m.status !== 'deprecated')
      .map((m) => ({
        membership: m,
        entity: graph.entities.find((e) => e.id === m.entityId),
      }))
      .filter((x) => x.entity);
  }, [graph, selectedSeg]);

  const layout = useMemo(() => (graph ? layoutPositions(graph) : null), [graph]);

  const activeEdgeIds = useMemo(() => {
    if (!selectedSeg || !graph) return new Set<string>();
    return new Set(
      graph.edges
        .filter((e) => e.from === selectedSeg.id || e.to === selectedSeg.id)
        .map((e) => e.id)
    );
  }, [graph, selectedSeg]);

  const signalCards = useMemo(
    () => (graph ? buildSignalCards(graph, chainIndicators) : []),
    [graph, chainIndicators]
  );

  const segmentIndicators = useMemo(
    () =>
      selectedSeg
        ? getIndicatorsForSegment(selectedSeg.id, chainIndicators)
        : chainIndicators,
    [selectedSeg, chainIndicators]
  );

  const cascadeHits = useMemo(
    () => (graph ? runCascade(graph, shock) : []),
    [graph, shock]
  );

  const eventChecklist = useMemo(
    () => (graph ? buildEventChecklist(graph, shock, cascadeHits) : []),
    [graph, shock, cascadeHits]
  );

  const divergencePoints = useMemo(
    () =>
      graph
        ? buildDivergencePoints(
            graph,
            chainIndicators,
            liveMetrics ?? seedMetricsForChain(graph.id),
            { liveLabel: !!liveMetrics }
          )
        : [],
    [graph, liveMetrics, chainIndicators]
  );

  const quoteMap = useMemo(() => liveQuoteByEntity(liveRows), [liveRows]);

  const refreshQuotes = useCallback(async () => {
    if (!graph || !isEditableChain(graph.id)) return;
    setQuotesLoading(true);
    try {
      const rows = await fetchLiveQuoteRows(graph);
      setLiveRows(rows);
      setLiveMetrics(mergeLiveMetrics(rows, seedMetricsForChain(graph.id)));
      const hit = rows.filter((r) => r.changePercent != null).length;
      toast.success(`行情已刷新：${hit}/${rows.length} 只有涨跌数据`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '行情刷新失败');
    } finally {
      setQuotesLoading(false);
    }
  }, [graph, toast]);

  const pullAnnounceCandidates = useCallback(async () => {
    if (!graph || graph.id !== 'C01') return;
    setAnnounceLoading(true);
    try {
      const items = await fetchSemiImpactItems(50);
      const props = impactToProposals(items, graph);
      const added = ingestProposals(props);
      reloadProposals();
      setRightTab('candidates');
      toast.success(
        items.length
          ? `公告候选：命中 ${items.length} 条，新增待审 ${added} 条`
          : '未命中半导体相关公告异动（可能尚未跑评估任务）'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取公告失败');
    } finally {
      setAnnounceLoading(false);
    }
  }, [graph, toast, reloadProposals]);

  const exposure = useMemo(
    () =>
      graph
        ? buildPortfolioExposure(graph, watchCodes)
        : { rows: [], matched: 0, unmatched: [], hiddenConcentration: [] },
    [graph, watchCodes]
  );

  const commandItems = useMemo(() => buildCommandItems(graph), [graph]);

  const addSymbolToWatch = useCallback(
    (symbol: string, name?: string) => {
      const code = toWatchlistCode(symbol);
      if (!code) {
        toast.info(`${name ?? symbol} 暂无法写入自选（台股等需后续扩展）`);
        return;
      }
      watchlistActions.add(code);
      toast.success(`已将 ${name ?? code} 加入自选（${code}）`);
    },
    [toast]
  );

  const runCommand = (action: CommandAction) => {
    if (action.type === 'view') {
      setCenterView(action.view);
      if (action.view === 'relations' && graph?.focalEntityId) {
        setSelectedEntityId(graph.focalEntityId);
        setEgoMode(true);
      }
      return;
    }
    if (action.type === 'tab') {
      setRightTab(action.tab);
      return;
    }
    if (action.type === 'edit') {
      enterEditor();
      return;
    }
    if (action.type === 'segment') {
      setSelectedSegId(action.segmentId);
      setCenterView('graph');
      setRightTab('detail');
      return;
    }
    if (action.type === 'entity') {
      setSelectedSegId(action.segmentId);
      setSelectedEntityId(action.entityId);
      setCenterView('relations');
      setRightTab('detail');
      setEgoMode(true);
    }
  };

  const openEntityRelations = (entityId: string, segmentId?: string) => {
    if (segmentId) setSelectedSegId(segmentId);
    setSelectedEntityId(entityId);
    setCenterView('relations');
    setEgoMode(true);
    setRightTab('detail');
  };

  const addEntityRelation = (rel: Omit<EntityRelation, 'id'> & { id?: string }) => {
    mutateDraft((g) => {
      if (!g.relations) g.relations = [];
      g.relations.push({
        ...rel,
        id: rel.id ?? newId('rel'),
      });
      return g;
    });
    toast.success('关系已写入草稿');
  };

  const removeEntityRelation = (id: string) => {
    mutateDraft((g) => {
      g.relations = (g.relations ?? []).filter((r) => r.id !== id);
      return g;
    });
    toast.info('已从草稿删除关系');
  };

  const addMembership = (form: {
    name: string;
    symbol: string;
    tier: BeneficiaryTier;
    status: MembershipStatus;
    evidenceGrade: EvidenceGrade;
    note: string;
  }) => {
    if (!selectedSeg || !graph) return;
    const name = form.name.trim();
    const symbol = form.symbol.trim();
    if (!name || !symbol) {
      toast.error('请填写公司名与代码');
      return;
    }
    mutateDraft((g) => {
      const entityId = newId('ent');
      g.entities.push({
        id: entityId,
        name,
        symbols: [symbol],
        market: 'CN',
      });
      const membership: ChainMembership = {
        id: newId('m'),
        entityId,
        segmentId: selectedSeg.id,
        tier: form.tier,
        status: form.status,
        evidenceGrade: form.evidenceGrade,
        revenueSharePct: null,
        note: form.note.trim() || undefined,
      };
      g.memberships.push(membership);
      return g;
    });
    toast.success('已挂载到草稿');
  };

  const updateMembership = (
    membershipId: string,
    patch: Partial<Pick<ChainMembership, 'tier' | 'status' | 'evidenceGrade' | 'note'>>
  ) => {
    mutateDraft((g) => {
      const m = g.memberships.find((x) => x.id === membershipId);
      if (m) Object.assign(m, patch);
      return g;
    });
  };

  const updateEdgeParams = (edgeId: string, patch: Partial<EdgeParams>) => {
    mutateDraft((g) => {
      const edge = g.edges.find((e) => e.id === edgeId);
      if (!edge) return g;
      edge.params = { ...edge.params, ...patch };
      return g;
    });
  };

  const handleAcceptProposal = (id: string) => {
    if (chainId !== 'C01') return;
    if (!getDraftChain('C01')) {
      const base = getPublishedChain('C01');
      if (base) saveDraft(base);
    }
    const next = acceptMembershipProposal(id);
    if (!next) {
      toast.error('采纳失败');
      return;
    }
    setMode('editor');
    setRightTab('detail');
    setGraph(next);
    setHasDraft(true);
    reloadProposals('C01');
    if (next.memberships.at(-1)?.segmentId) {
      setSelectedSegId(next.memberships.at(-1)!.segmentId);
    }
    toast.success('已写入草稿，请核对分层后发布');
  };

  const handleRejectProposal = (id: string) => {
    rejectProposal(id);
    reloadProposals();
    toast.info('已驳回候选');
  };

  const chainEditable = isEditableChain(chainId);
  const focalEntity = graph?.focalEntityId
    ? graph.entities.find((e) => e.id === graph.focalEntityId)
    : null;

  const focusSignal = (card: ChainSignalCard) => {
    if (card.segmentIds[0]) {
      setSelectedSegId(card.segmentIds[0]);
      setRightTab('detail');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <h1>产业链情报台</h1>
          <p className={styles.tagline}>
            {catalogItem
              ? `${catalogItem.name} · ${catalogItem.blurb}`
              : '精编主链 · 骨架稳、成员活'}
            {graph ? ` · 发布 v${graph.release.version}` : ''}
            {signalCards.length ? ` · ${signalCards.length} 条信号` : ''}
            {proposals.length ? ` · ${proposals.length} 条待审` : ''}
          </p>
        </div>
        <div className={styles.topActions}>
          {hasDraft && (
            <span className={`${styles.badge} ${styles.badgeDraft}`}>有草稿</span>
          )}
          <button type="button" className={styles.btn} onClick={() => setCmdOpen(true)}>
            <Search size={14} /> ⌘K
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void refreshQuotes()}
            disabled={!chainEditable || quotesLoading}
          >
            <RefreshCw size={14} /> {quotesLoading ? '行情…' : liveMetrics ? '刷新行情' : '拉行情'}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void pullAnnounceCandidates()}
            disabled={chainId !== 'C01' || announceLoading}
            title={chainId !== 'C01' ? '公告候选暂仅 C01 半导体关键词' : undefined}
          >
            <FileWarning size={14} /> {announceLoading ? '公告…' : '拉公告候选'}
          </button>
          {mode === 'situation' ? (
            <button
              type="button"
              className={styles.btn}
              onClick={enterEditor}
              disabled={!chainEditable}
            >
              <Pencil size={14} /> 编辑链
            </button>
          ) : (
            <button type="button" className={styles.btn} onClick={exitEditor}>
              <Eye size={14} /> 返回态势
            </button>
          )}
          {mode === 'editor' && (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handlePublish}
              >
                <Send size={14} /> 发布草稿
              </button>
              <button
                type="button"
                className={styles.btn}
                onClick={handleDiscard}
                disabled={!hasDraft}
              >
                <Trash2 size={14} /> 丢弃草稿
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.btn}
            onClick={handleExport}
            disabled={!graph}
          >
            <Download size={14} /> 导出 JSON
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => fileRef.current?.click()}
            disabled={!chainEditable}
          >
            <Upload size={14} /> 导入
          </button>
          <input
            ref={fileRef}
            className={styles.hiddenFile}
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={handleResetSeed}
            disabled={!chainEditable}
          >
            <RotateCcw size={14} /> 重置种子
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.left}>
          <div className={styles.panelTitle}>主链目录</div>
          <ul className={styles.catalogList}>
            {CHAIN_CATALOG.map((item) => {
              const disabled = !!item.building;
              const active = item.id === chainId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`${styles.catalogItem} ${active ? styles.catalogItemActive : ''}`}
                    disabled={disabled}
                    onClick={() => {
                      setChainId(item.id);
                      setMode('situation');
                      setRightTab('signals');
                      setSelectedEntityId(null);
                      setRelationQuery('');
                      setRelationFilter('all');
                      setEgoMode(true);
                      setCenterView('graph');
                      reloadView(item.id, false);
                    }}
                  >
                    <div className={styles.catalogName}>
                      <span>
                        {item.id} {item.name}
                      </span>
                      <span className={styles.badge}>{depthLabel(item.depth)}</span>
                    </div>
                    <p className={styles.catalogBlurb}>{item.blurb}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className={styles.center}>
          {graph ? (
            <>
              <CenterViewSwitch value={centerView} onChange={setCenterView} />
              {centerView === 'graph' && layout && (
                <>
                  <div className={styles.canvasWrap}>
                    <svg
                      className={styles.canvasSvg}
                      viewBox={`0 0 ${layout.width} ${layout.height}`}
                      role="img"
                      aria-label={`${graph.name}产业链图谱`}
                    >
                      {graph.edges.map((edge) => {
                        const from = layout.map.get(edge.from);
                        const to = layout.map.get(edge.to);
                        if (!from || !to) return null;
                        const active = activeEdgeIds.has(edge.id);
                        const inCascade = cascadeHits.some(
                          (h) => h.segmentId === edge.from || h.segmentId === edge.to
                        );
                        return (
                          <path
                            key={edge.id}
                            d={edgePath(from, to)}
                            className={`${styles.edgePath} ${active || inCascade ? styles.edgeActive : ''}`}
                          />
                        );
                      })}
                      {graph.segments.map((seg) => {
                        const pos = layout.map.get(seg.id);
                        if (!pos) return null;
                        const selected = seg.id === selectedSegId;
                        const choke = seg.chokeRisk === 'high';
                        const hasFocal = graph.memberships.some(
                          (m) =>
                            m.segmentId === seg.id &&
                            m.entityId === graph.focalEntityId
                        );
                        const activeCount = graph.memberships.filter(
                          (m) => m.segmentId === seg.id && m.status === 'active'
                        ).length;
                        const metaParts = [
                          hasFocal ? '锚点' : choke ? '卡脖子' : null,
                          seg.grossMarginHint && seg.grossMarginHint !== '—'
                            ? seg.grossMarginHint
                            : null,
                          `${activeCount} 家`,
                        ].filter(Boolean) as string[];
                        const metaLine = metaParts.join(' · ');
                        const tipLines = [
                          seg.name,
                          seg.grossMarginHint && seg.grossMarginHint !== '—'
                            ? `毛利带：${seg.grossMarginHint}`
                            : null,
                          hasFocal ? '含锚点公司' : null,
                          choke ? '高卡脖子' : null,
                          `活跃挂载 ${activeCount} 家`,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return (
                          <g
                            key={seg.id}
                            className={`${styles.segNode} ${selected ? styles.segSelected : ''} ${choke ? styles.segChoke : ''}`}
                            transform={`translate(${pos.x}, ${pos.y})`}
                            onClick={() => {
                              setSelectedSegId(seg.id);
                              setRightTab('detail');
                            }}
                          >
                            <title>{tipLines}</title>
                            <rect
                              className={styles.segRect}
                              width={NODE_W}
                              height={NODE_H}
                              rx={8}
                            />
                            <foreignObject
                              x={8}
                              y={6}
                              width={NODE_W - 16}
                              height={NODE_H - 12}
                              style={{ pointerEvents: 'none', overflow: 'hidden' }}
                            >
                              <div className={styles.segLabelBox}>
                                <div className={styles.segTitleHtml}>{seg.name}</div>
                                <div className={styles.segMetaHtml}>{metaLine}</div>
                              </div>
                            </foreignObject>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div className={styles.legend}>
                    <span className={styles.legendItem}>
                      <span className={styles.dot} /> 高卡脖子
                    </span>
                    <span>P3：重构 / 暴露 / ⌘K · 指标与估值为种子</span>
                  </div>
                </>
              )}
              {centerView === 'relations' && (
                <EntityRelationView
                  graph={graph}
                  selectedEntityId={selectedEntityId}
                  onSelectEntity={(id) => {
                    setSelectedEntityId(id);
                    if (id) {
                      const m = graph.memberships.find(
                        (x) => x.entityId === id && x.status !== 'deprecated'
                      );
                      if (m) setSelectedSegId(m.segmentId);
                      setRightTab('detail');
                    }
                  }}
                  quotePct={
                    new Map(
                      [...quoteMap.entries()].map(([k, v]) => [k, v.changePercent])
                    )
                  }
                  onWatch={addSymbolToWatch}
                  egoMode={egoMode && !!graph.focalEntityId}
                  onEgoModeChange={setEgoMode}
                  relationFilter={relationFilter}
                  onRelationFilterChange={setRelationFilter}
                  query={relationQuery}
                  onQueryChange={setRelationQuery}
                  editable={mode === 'editor'}
                  onAddRelation={addEntityRelation}
                  onRemoveRelation={removeEntityRelation}
                />
              )}
              {centerView === 'sandbox' && (
                <SandboxPanel
                  graph={graph}
                  shock={shock}
                  onShockChange={(next) => {
                    setShock(next);
                    setChecklistDone({});
                  }}
                  hits={cascadeHits}
                  checklist={eventChecklist}
                  checklistDone={checklistDone}
                  onToggleCheck={(id) =>
                    setChecklistDone((prev) => ({ ...prev, [id]: !prev[id] }))
                  }
                  onFocusSegment={(id) => {
                    setSelectedSegId(id);
                    setCenterView('graph');
                    setRightTab('detail');
                  }}
                />
              )}
              {centerView === 'radar' && (
                <DivergenceRadar
                  points={divergencePoints}
                  onFocus={(segId) => {
                    setSelectedSegId(segId);
                    setCenterView('graph');
                    setRightTab('detail');
                  }}
                  onWatch={(symbol, name) => addSymbolToWatch(symbol, name)}
                />
              )}
              {centerView === 'markets' && (
                <CrossMarketTable
                  graph={graph}
                  onFocusSegment={(id) => {
                    setSelectedSegId(id);
                    setCenterView('graph');
                    setRightTab('detail');
                  }}
                />
              )}
              {centerView === 'restructure' && (
                <RestructurePanel
                  moves={graph.id === 'C01' ? C01_RESTRUCTURE : []}
                  graph={graph}
                  onFocusSegment={(id) => {
                    setSelectedSegId(id);
                    setCenterView('graph');
                    setRightTab('detail');
                  }}
                />
              )}
              {centerView === 'exposure' && (
                <ExposurePanel
                  rows={exposure.rows}
                  matched={exposure.matched}
                  unmatched={exposure.unmatched}
                  hiddenConcentration={exposure.hiddenConcentration}
                  watchCount={watchCodes.length}
                  onFocusSegment={(id) => {
                    setSelectedSegId(id);
                    setCenterView('graph');
                    setRightTab('detail');
                  }}
                />
              )}
            </>
          ) : (
            <div className={styles.detailEmpty}>该主链建设中，当前已开放 C01 / C05。</div>
          )}
        </section>

        <aside className={styles.right}>
          <div className={styles.rightTabs}>
            {(
              [
                ['signals', '信号'],
                ['detail', '深潜'],
                ['indicators', '景气'],
                ['candidates', `候选${proposals.length ? `(${proposals.length})` : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.tabBtn} ${rightTab === id ? styles.tabActive : ''}`}
                onClick={() => setRightTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {rightTab === 'signals' && (
            <div className={styles.detail}>
              {!graph ? (
                <div className={styles.detailEmpty}>无图谱</div>
              ) : signalCards.length === 0 ? (
                <div className={styles.detailEmpty}>暂无信号</div>
              ) : (
                signalCards.map((card) => (
                  <article key={card.id} className={styles.signalCard}>
                    <div className={styles.signalMeta}>
                      <span className={`${styles.badge} ${urgencyClass(card.urgency)}`}>
                        {card.urgency}
                      </span>
                      <span className={`${styles.badge} ${levelClass(card.level)}`}>
                        {signalLevelLabel(card.level)}
                      </span>
                      <span className={styles.badge}>{signalTypeLabel(card.type)}</span>
                    </div>
                    <p className={styles.signalBody}>
                      <strong>触发</strong> {card.trigger}
                    </p>
                    <p className={styles.signalBody}>
                      <strong>路径</strong> {card.path}
                    </p>
                    <p className={styles.signalBody}>
                      <strong>标的</strong> {card.names}
                    </p>
                    <p className={styles.signalBody}>
                      <strong>置信</strong> {card.confidenceNote}
                    </p>
                    <p className={styles.signalAction}>
                      <strong>动作</strong> {card.action}
                    </p>
                    {card.entityIds.some((eid) => quoteMap.get(eid)?.changePercent != null) && (
                      <p className={styles.signalBody}>
                        <strong>行情</strong>{' '}
                        {card.entityIds
                          .map((eid) => {
                            const ent = graph.entities.find((e) => e.id === eid);
                            const q = quoteMap.get(eid);
                            if (!ent || q?.changePercent == null) return null;
                            const sign = q.changePercent > 0 ? '+' : '';
                            return `${ent.name} ${sign}${q.changePercent.toFixed(2)}%`;
                          })
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <div className={styles.candidateActions}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => focusSignal(card)}
                      >
                        定位环节
                      </button>
                      {card.entityIds.slice(0, 2).map((eid) => {
                        const ent = graph.entities.find((e) => e.id === eid);
                        if (!ent?.symbols[0]) return null;
                        return (
                          <button
                            key={eid}
                            type="button"
                            className={styles.btn}
                            onClick={() =>
                              addSymbolToWatch(ent.symbols[0], ent.name)
                            }
                          >
                            自选 {ent.name}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))
              )}
            </div>
          )}

          {rightTab === 'indicators' && (
            <div className={styles.detail}>
              <p className={styles.detailP}>
                {selectedSeg
                  ? `${selectedSeg.name} 相关指标`
                  : '全链先行/同步/滞后指标（种子分位，非实盘）'}
              </p>
              {selectedSeg && (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setSelectedSegId(null)}
                >
                  查看全链指标
                </button>
              )}
              <IndicatorList
                items={selectedSeg ? segmentIndicators : chainIndicators}
                graph={graph}
                onFocusSeg={(id) => {
                  setSelectedSegId(id);
                  setRightTab('detail');
                }}
              />
            </div>
          )}

          {rightTab === 'candidates' && (
            <div className={styles.detail}>
              <p className={styles.detailP}>
                外源只进候选箱；采纳后写入草稿，概念关联默认不可行动级。
              </p>
              {proposals.length === 0 ? (
                <div className={styles.detailEmpty}>暂无待审候选</div>
              ) : (
                proposals.map((p) => (
                  <article key={p.id} className={styles.candidateCard}>
                    <div className={styles.memberTop}>
                      <span className={styles.memberName}>
                        {p.suggestedName ?? p.summary.slice(0, 16)}
                      </span>
                      <span className={`${styles.tier} ${tierClass(p.suggestedTier ?? 'concept')}`}>
                        {TIER_LABEL[p.suggestedTier ?? 'concept']}
                      </span>
                    </div>
                    <p className={styles.detailP}>{p.summary}</p>
                    <p className={styles.memberSymbols}>
                      {p.source}
                      {p.suggestedSymbol ? ` · ${p.suggestedSymbol}` : ''}
                      {p.suggestedSegmentId
                        ? ` · → ${graph?.segments.find((s) => s.id === p.suggestedSegmentId)?.name ?? p.suggestedSegmentId}`
                        : ''}
                    </p>
                    {p.evidence && <p className={styles.detailP}>{p.evidence}</p>}
                    <div className={styles.candidateActions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => handleAcceptProposal(p.id)}
                      >
                        采纳到草稿
                      </button>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => handleRejectProposal(p.id)}
                      >
                        驳回
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}

          {rightTab === 'detail' && (
            <div className={styles.detail}>
              {!selectedSeg || !graph ? (
                <div className={styles.detailEmpty}>选择一个环节</div>
              ) : (
                <>
                  {(focalEntity || graph.valueLaw || graph.chainRisks?.length) && (
                    <div className={styles.reportBlock}>
                      {focalEntity && (
                        <p className={styles.detailP}>
                          <strong>锚点</strong> {focalEntity.name}
                          {focalEntity.symbols[0] ? ` · ${focalEntity.symbols[0]}` : ''}
                          {graph.reportSource ? (
                            <span className={styles.reportSource}>
                              {' '}
                              · {graph.reportSource}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {graph.valueLaw && (
                        <p className={styles.detailP}>
                          <strong>价值规律</strong> {graph.valueLaw}
                        </p>
                      )}
                      {!!graph.chainRisks?.length && (
                        <ul className={styles.riskList}>
                          {graph.chainRisks.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <h2 className={styles.detailH}>{selectedSeg.name}</h2>
                  {selectedSeg.nameEn && (
                    <p className={styles.detailP}>{selectedSeg.nameEn}</p>
                  )}
                  <p className={styles.detailP}>{selectedSeg.summary}</p>
                  {selectedSeg.valueRole && (
                    <p className={styles.detailP}>
                      <strong>价值角色</strong> {selectedSeg.valueRole}
                    </p>
                  )}
                  <dl className={styles.kv}>
                    <dt>卡脖子</dt>
                    <dd>{selectedSeg.chokeRisk ?? '—'}</dd>
                    <dt>毛利带</dt>
                    <dd>{selectedSeg.grossMarginHint ?? '—'}</dd>
                    <dt>地区</dt>
                    <dd>{selectedSeg.regions?.join(' / ') || '—'}</dd>
                    {selectedSeg.keyDrivers?.length ? (
                      <>
                        <dt>景气驱动</dt>
                        <dd>{selectedSeg.keyDrivers.join(' · ')}</dd>
                      </>
                    ) : null}
                  </dl>

                  <div
                    className={styles.panelTitle}
                    style={{ padding: '8px 0', border: 'none' }}
                  >
                    相邻边（四参数）
                  </div>
                  <ul className={styles.edgeList}>
                    {relatedEdges.map((e) => {
                      const otherId = e.from === selectedSeg.id ? e.to : e.from;
                      const other = graph.segments.find((s) => s.id === otherId);
                      const dir = e.from === selectedSeg.id ? '→' : '←';
                      return (
                        <li key={e.id}>
                          {dir} {other?.name ?? otherId}
                          <br />
                          w={e.params.weight} · ε=[{e.params.elasticity.join(', ')}] ·
                          lag={e.params.lagWeeks}w · conf={e.params.confidence}
                          {mode === 'editor' && (
                            <EdgeEditor
                              params={e.params}
                              onChange={(patch) => updateEdgeParams(e.id, patch)}
                            />
                          )}
                        </li>
                      );
                    })}
                    {relatedEdges.length === 0 && <li>无直接边</li>}
                  </ul>

                  <div
                    className={styles.panelTitle}
                    style={{ padding: '8px 0', border: 'none' }}
                  >
                    挂载公司
                  </div>
                  <ul className={styles.memberList}>
                    {members.map(({ membership, entity }) => (
                      <li key={membership.id} className={styles.memberCard}>
                        <div className={styles.memberTop}>
                          <span className={styles.memberName}>{entity!.name}</span>
                          <span
                            className={`${styles.tier} ${tierClass(membership.tier)}`}
                          >
                            {TIER_LABEL[membership.tier]}
                          </span>
                          {membership.peerTag && (
                            <span
                              className={`${styles.peerTag} ${
                                membership.peerTag === 'focal' ? styles.peerFocal : ''
                              }`}
                            >
                              {PEER_LABEL[membership.peerTag]}
                            </span>
                          )}
                        </div>
                        <div className={styles.memberSymbols}>
                          {entity!.symbols.join(' · ')} ·{' '}
                          {STATUS_LABEL[membership.status]} · {membership.evidenceGrade}
                          {membership.revenueSharePct != null
                            ? ` · 占比约 ${membership.revenueSharePct}%`
                            : ''}
                          {quoteMap.get(membership.entityId)?.changePercent != null
                            ? ` · 今 ${
                                (quoteMap.get(membership.entityId)!.changePercent! > 0
                                  ? '+'
                                  : '') +
                                quoteMap
                                  .get(membership.entityId)!
                                  .changePercent!.toFixed(2)
                              }%`
                            : ''}
                        </div>
                        {(membership.roleNote || entity!.revenueMix) && (
                          <p className={styles.detailP} style={{ marginTop: 4 }}>
                            {membership.roleNote || entity!.revenueMix}
                          </p>
                        )}
                        {membership.note && (
                          <p className={styles.detailP} style={{ marginTop: 4 }}>
                            {membership.note}
                          </p>
                        )}
                        <div className={styles.candidateActions}>
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() =>
                              openEntityRelations(entity!.id, selectedSeg.id)
                            }
                          >
                            在关系网查看
                          </button>
                          {entity!.symbols[0] && (
                            <button
                              type="button"
                              className={styles.btn}
                              onClick={() =>
                                addSymbolToWatch(entity!.symbols[0], entity!.name)
                              }
                            >
                              自选
                            </button>
                          )}
                        </div>
                        {mode === 'editor' && (
                          <div
                            className={styles.editorBox}
                            style={{ borderTop: 'none', paddingTop: 6 }}
                          >
                            <label>
                              受益层
                              <select
                                value={membership.tier}
                                onChange={(ev) =>
                                  updateMembership(membership.id, {
                                    tier: ev.target.value as BeneficiaryTier,
                                  })
                                }
                              >
                                {(Object.keys(TIER_LABEL) as BeneficiaryTier[]).map(
                                  (k) => (
                                    <option key={k} value={k}>
                                      {TIER_LABEL[k]}
                                    </option>
                                  )
                                )}
                              </select>
                            </label>
                            <label>
                              状态
                              <select
                                value={membership.status}
                                onChange={(ev) =>
                                  updateMembership(membership.id, {
                                    status: ev.target.value as MembershipStatus,
                                  })
                                }
                              >
                                {(
                                  Object.keys(STATUS_LABEL) as MembershipStatus[]
                                ).map((k) => (
                                  <option key={k} value={k}>
                                    {STATUS_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        )}
                      </li>
                    ))}
                    {members.length === 0 && (
                      <li className={styles.detailP}>暂无挂载</li>
                    )}
                  </ul>

                  {mode === 'editor' && <MembershipForm onAdd={addMembership} />}
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      <CommandPalette
        open={cmdOpen}
        items={commandItems}
        onClose={() => setCmdOpen(false)}
        onRun={runCommand}
      />
    </div>
  );
}

function IndicatorList({
  items,
  graph,
  onFocusSeg,
}: {
  items: LeadingIndicator[];
  graph: IndustrialChainGraph | null;
  onFocusSeg: (segmentId: string) => void;
}) {
  if (!items.length) {
    return <div className={styles.detailEmpty}>该环节暂无指标卡</div>;
  }
  return (
    <div className={styles.memberList}>
      {items.map((ind) => {
        const segName =
          graph?.segments.find((s) => s.id === ind.segmentId)?.name ?? ind.segmentId;
        const dirClass =
          ind.direction === 'up'
            ? styles.dirUp
            : ind.direction === 'down'
              ? styles.dirDown
              : undefined;
        return (
          <button
            key={ind.id}
            type="button"
            className={styles.indRow}
            onClick={() => onFocusSeg(ind.segmentId)}
          >
            <span className={styles.indName}>{ind.name}</span>
            <span className={dirClass}>
              {LAYER_LABEL[ind.layer]}
              {ind.percentile != null ? ` · P${ind.percentile}` : ''}
            </span>
            {ind.percentile != null && (
              <span className={styles.pctBar} aria-hidden>
                <span
                  className={styles.pctFill}
                  style={{ width: `${Math.min(100, Math.max(0, ind.percentile))}%` }}
                />
              </span>
            )}
            <span className={styles.indMeta}>
              {segName} · {ind.asOf}
              {ind.note ? ` · ${ind.note}` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EdgeEditor({
  params,
  onChange,
}: {
  params: EdgeParams;
  onChange: (patch: Partial<EdgeParams>) => void;
}) {
  return (
    <div className={styles.editorBox} style={{ marginTop: 6 }}>
      <label>
        权重 0–1
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={params.weight}
          onChange={(e) => onChange({ weight: Number(e.target.value) })}
        />
      </label>
      <label>
        弹性下限
        <input
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={params.elasticity[0]}
          onChange={(e) =>
            onChange({
              elasticity: [Number(e.target.value), params.elasticity[1]],
            })
          }
        />
      </label>
      <label>
        弹性上限
        <input
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={params.elasticity[1]}
          onChange={(e) =>
            onChange({
              elasticity: [params.elasticity[0], Number(e.target.value)],
            })
          }
        />
      </label>
      <label>
        时滞（周）
        <input
          type="number"
          min={0}
          step={1}
          value={params.lagWeeks}
          onChange={(e) => onChange({ lagWeeks: Number(e.target.value) })}
        />
      </label>
      <label>
        置信度 0–1
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={params.confidence}
          onChange={(e) => onChange({ confidence: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

function MembershipForm({
  onAdd,
}: {
  onAdd: (form: {
    name: string;
    symbol: string;
    tier: BeneficiaryTier;
    status: MembershipStatus;
    evidenceGrade: EvidenceGrade;
    note: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tier, setTier] = useState<BeneficiaryTier>('concept');
  const [status, setStatus] = useState<MembershipStatus>('candidate');
  const [evidenceGrade, setEvidenceGrade] = useState<EvidenceGrade>('unverified');
  const [note, setNote] = useState('');

  return (
    <div className={styles.editorBox}>
      <div className={styles.panelTitle} style={{ padding: '4px 0', border: 'none' }}>
        挂载新公司（进草稿）
      </div>
      <label>
        公司名
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：拓荆科技" />
      </label>
      <label>
        代码
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="例：688072.SH"
        />
      </label>
      <label>
        受益层
        <select value={tier} onChange={(e) => setTier(e.target.value as BeneficiaryTier)}>
          {(Object.keys(TIER_LABEL) as BeneficiaryTier[]).map((k) => (
            <option key={k} value={k}>
              {TIER_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        状态
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MembershipStatus)}
        >
          {(Object.keys(STATUS_LABEL) as MembershipStatus[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        证据等级
        <select
          value={evidenceGrade}
          onChange={(e) => setEvidenceGrade(e.target.value as EvidenceGrade)}
        >
          <option value="disclosed">已披露</option>
          <option value="analyst">机构判断</option>
          <option value="unverified">待验证</option>
        </select>
      </label>
      <label>
        备注
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="证据或主业说明"
        />
      </label>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={() => {
          onAdd({ name, symbol, tier, status, evidenceGrade, note });
          setName('');
          setSymbol('');
          setNote('');
          setTier('concept');
          setStatus('candidate');
          setEvidenceGrade('unverified');
        }}
      >
        加入草稿
      </button>
    </div>
  );
}
