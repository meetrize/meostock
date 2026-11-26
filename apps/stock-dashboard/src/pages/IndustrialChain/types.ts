/**
 * 产业链情报台 — 本体类型（对齐 docs/global-industrial-chain.md）
 */

export type ChainDepth =
  | 'placeholder'
  | 'graph'
  | 'observe'
  | 'simulate'
  | 'price';

export type BeneficiaryTier = 'core' | 'elastic' | 'indirect' | 'concept';

export type MembershipStatus =
  | 'candidate'
  | 'concept'
  | 'active'
  | 'watch_only'
  | 'deprecated';

export type EvidenceGrade = 'disclosed' | 'analyst' | 'unverified';

export type SegmentStage =
  | 'resource'
  | 'process'
  | 'component'
  | 'assembly'
  | 'channel';

/** 边四参数 */
export interface EdgeParams {
  /** 依赖权重 0–1 */
  weight: number;
  /** 价格传导弹性区间 */
  elasticity: [number, number];
  /** 时滞（周） */
  lagWeeks: number;
  /** 关系置信度 0–1 */
  confidence: number;
  evidence?: string;
}

export interface ChainSegment {
  id: string;
  name: string;
  nameEn?: string;
  stage: SegmentStage;
  /** 画布列 0=最上游 */
  column: number;
  /** 同列内行序 */
  row: number;
  summary?: string;
  chokeRisk?: 'high' | 'medium' | 'low';
  regions?: string[];
}

export interface ChainEdge {
  id: string;
  from: string;
  to: string;
  params: EdgeParams;
}

export interface ChainEntity {
  id: string;
  name: string;
  /** 多市场代码，如 2330.TW / ASML / 688981.SH */
  symbols: string[];
  market?: string;
  country?: string;
}

export interface ChainMembership {
  id: string;
  entityId: string;
  segmentId: string;
  tier: BeneficiaryTier;
  status: MembershipStatus;
  evidenceGrade: EvidenceGrade;
  /** 相关业务占比 0–100，未知为 null */
  revenueSharePct: number | null;
  note?: string;
}

export interface ChainReleaseMeta {
  version: number;
  publishedAt: string;
  publishedBy: string;
  note?: string;
}

export interface IndustrialChainGraph {
  id: string;
  name: string;
  tagline: string;
  depth: ChainDepth;
  segments: ChainSegment[];
  edges: ChainEdge[];
  entities: ChainEntity[];
  memberships: ChainMembership[];
  release: ChainReleaseMeta;
}

export interface ChainCatalogItem {
  id: string;
  name: string;
  depth: ChainDepth;
  /** 建设中占位 */
  building?: boolean;
  blurb: string;
}

export type ChainWorkspaceMode = 'situation' | 'editor';

/** 右侧面板 Tab */
export type ChainRightTab =
  | 'detail'
  | 'signals'
  | 'candidates'
  | 'indicators'
  | 'checklist';

/** 中央主视图 */
export type ChainCenterView =
  | 'graph'
  | 'sandbox'
  | 'radar'
  | 'markets'
  | 'restructure'
  | 'exposure';

/** 供应链重构叙事节点 */
export interface RestructureMove {
  id: string;
  title: string;
  theme: 'nearshore' | 'friendshore' | 'china_plus_one' | 'onshore';
  fromRegion: string;
  toRegion: string;
  segmentIds: string[];
  status: 'ongoing' | 'early' | 'mature';
  summary: string;
  evidence?: string;
  asOf: string;
}

export interface PortfolioExposureRow {
  segmentId: string;
  segmentName: string;
  codes: string[];
  names: string[];
  count: number;
  chokeRisk?: 'high' | 'medium' | 'low';
}

export type CommandAction =
  | { type: 'view'; view: ChainCenterView }
  | { type: 'segment'; segmentId: string }
  | { type: 'tab'; tab: ChainRightTab }
  | { type: 'entity'; entityId: string; segmentId: string }
  | { type: 'edit' };

export interface CommandItem {
  id: string;
  title: string;
  hint?: string;
  keywords: string[];
  action: CommandAction;
}

export type ShockKind =
  | 'export_control'
  | 'capex_cut'
  | 'ai_demand_surge'
  | 'memory_crash'
  | 'custom';

export interface ShockScenario {
  id: string;
  kind: ShockKind;
  label: string;
  description: string;
  /** 冲击落点环节 */
  epicenterSegmentId: string;
  /** 冲击强度 0–1（滑块） */
  intensity: number;
  /** 方向：供给收缩为正紧张；需求为拉动 */
  polarity: 'supply_tight' | 'demand_up' | 'demand_down';
}

export type CascadeLayer = 'L1' | 'L2' | 'L3';

export interface CascadeHit {
  layer: CascadeLayer;
  segmentId: string;
  segmentName: string;
  score: number;
  lagWeeks: number;
  pathNote: string;
  beneficiaries: { name: string; symbol: string; tier: BeneficiaryTier }[];
}

export interface EventChecklistItem {
  id: string;
  horizon: 'W1' | 'M1' | 'Q1';
  segmentId: string;
  text: string;
  verifiable: boolean;
  done?: boolean;
}

/** 标的定价占位（真源接入前用种子） */
export interface EntityMarketMetrics {
  entityId: string;
  pricePercentile: number;
  valuationPercentile: number;
  crowding?: 'low' | 'mid' | 'high';
  asOf: string;
}

/** 背离雷达点（P2：估值分位可先种子） */
export interface DivergencePoint {
  entityId: string;
  name: string;
  symbol: string;
  segmentId: string;
  segmentName: string;
  tier: BeneficiaryTier;
  /** 横轴：景气变化示意 -50..+50 */
  cycleDelta: number;
  /** 纵轴：价格/估值变化示意 -50..+50 */
  priceDelta: number;
  valuationPercentile: number | null;
  crowding?: 'low' | 'mid' | 'high';
  quadrant: 'value_gap' | 'confirmed' | 'overheated' | 'value_trap';
  note: string;
}

export type IndicatorLayer = 'leading' | 'coincident' | 'lagging';

export type IndicatorDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface LeadingIndicator {
  id: string;
  segmentId: string;
  name: string;
  layer: IndicatorLayer;
  /** 相对历史/季节性分位 0–100，未知 null */
  percentile: number | null;
  direction: IndicatorDirection;
  asOf: string;
  note?: string;
  source?: string;
}

export type SignalType =
  | 'cycle_turn'
  | 'margin_shift'
  | 'event_cascade'
  | 'choke_alert'
  | 'expected_gap'
  | 'relative_divergence'
  | 'regime_downgrade';

export type SignalActionLevel = 'intel' | 'watch' | 'position' | 'action';

export type SignalUrgency = 'U0' | 'U1' | 'U2';

/** 五段式信号卡 */
export interface ChainSignalCard {
  id: string;
  chainId: string;
  type: SignalType;
  level: SignalActionLevel;
  urgency: SignalUrgency;
  /** 【触发】 */
  trigger: string;
  /** 【路径】 */
  path: string;
  /** 【标的】文案 */
  names: string;
  segmentIds: string[];
  entityIds: string[];
  /** 【置信】 */
  confidenceNote: string;
  /** 【动作】——无动作不许展示为可推送卡 */
  action: string;
  createdAt: string;
  muted?: boolean;
}

export type ChangeProposalKind = 'add_membership' | 'suggest_segment' | 'update_edge';

export interface ChangeProposal {
  id: string;
  chainId: string;
  kind: ChangeProposalKind;
  source: string;
  createdAt: string;
  summary: string;
  evidence?: string;
  /** add_membership */
  suggestedName?: string;
  suggestedSymbol?: string;
  suggestedSegmentId?: string;
  suggestedTier?: BeneficiaryTier;
  suggestedStatus?: MembershipStatus;
  suggestedEvidenceGrade?: EvidenceGrade;
  status: 'open' | 'accepted' | 'rejected';
}
