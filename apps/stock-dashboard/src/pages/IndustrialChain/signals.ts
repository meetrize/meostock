/**
 * P1 信号卡生成：基于图谱 + 指标的可审计规则（示意数据亦可复核）
 */

import { C01_INDICATORS } from './seed/c01Indicators';
import type {
  ChainSignalCard,
  IndustrialChainGraph,
  LeadingIndicator,
  SignalActionLevel,
} from './types';

const LEVEL_LABEL: Record<SignalActionLevel, string> = {
  intel: '情报',
  watch: '观察',
  position: '布局',
  action: '行动',
};

export function signalTypeLabel(type: ChainSignalCard['type']): string {
  const map: Record<ChainSignalCard['type'], string> = {
    cycle_turn: '景气拐点',
    margin_shift: '利润迁移',
    event_cascade: '事件传导',
    choke_alert: '卡脖子',
    expected_gap: '预期差',
    relative_divergence: '相对强弱',
    regime_downgrade: 'Regime 降级',
  };
  return map[type];
}

export function signalLevelLabel(level: SignalActionLevel): string {
  return LEVEL_LABEL[level];
}

function membersOnSegment(graph: IndustrialChainGraph, segmentId: string, tiers?: string[]) {
  return graph.memberships
    .filter((m) => {
      if (m.segmentId !== segmentId) return false;
      if (m.status !== 'active' && m.status !== 'concept') return false;
      if (tiers && !tiers.includes(m.tier)) return false;
      // 概念关联不得进入行动/布局文案主力
      if (m.tier === 'concept') return false;
      return true;
    })
    .map((m) => {
      const ent = graph.entities.find((e) => e.id === m.entityId);
      return {
        membership: m,
        entity: ent,
        label: ent ? `${ent.name}(${ent.symbols[0] ?? ''})` : m.entityId,
      };
    })
    .filter((x) => x.entity);
}

function pickNames(rows: { label: string }[], n = 3): string {
  if (!rows.length) return '（暂无合格挂载）';
  return rows
    .slice(0, n)
    .map((r) => r.label)
    .join('、');
}

/** 通用：高卡脖子 + 领先指标分位偏高 */
function chokeCards(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[],
  now: string
): ChainSignalCard[] {
  const cards: ChainSignalCard[] = [];
  for (const seg of graph.segments) {
    if (seg.chokeRisk !== 'high') continue;
    const inds = indicators.filter(
      (i) => i.segmentId === seg.id && i.layer === 'leading' && (i.percentile ?? 0) >= 70
    );
    if (!inds.length) continue;
    const ind = inds[0];
    const cores = membersOnSegment(graph, seg.id, ['core', 'elastic']);
    cards.push({
      id: `sig-choke-${seg.id}`,
      chainId: graph.id,
      type: 'choke_alert',
      level: 'watch',
      urgency: 'U1',
      trigger: `${seg.name} 标记高卡脖子，且「${ind.name}」分位 ${ind.percentile}（${ind.direction}）`,
      path: `${seg.name} 供给约束 → 下游成本与交期（边时滞见图谱）`,
      names: `受益关注：${pickNames(cores)}`,
      segmentIds: [seg.id],
      entityIds: cores.map((c) => c.entity!.id),
      confidenceNote: `规则：chokeRisk=high 且 leading 分位≥70；样本为种子指标，非实盘回测`,
      action: `加入观察池：盯 ${seg.name} 核心/弹性标的；概念关联勿升级`,
      createdAt: now,
    });
  }
  return cards;
}

function c01SpecificCards(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[],
  now: string
): ChainSignalCard[] {
  const cards: ChainSignalCard[] = [];
  const osatUtil = indicators.find((i) => i.id === 'ind-cowos');
  const memSpot = indicators.find((i) => i.id === 'ind-memory-spot');
  if (osatUtil && (osatUtil.percentile ?? 0) >= 75 && memSpot && memSpot.direction === 'up') {
    const osat = membersOnSegment(graph, 'c01-osat', ['core', 'elastic']);
    const mem = membersOnSegment(graph, 'c01-memory', ['core']);
    cards.push({
      id: 'sig-cycle-osat-mem',
      chainId: graph.id,
      type: 'cycle_turn',
      level: 'watch',
      urgency: 'U1',
      trigger: `先进封装利用率分位 ${osatUtil.percentile} 且存储现货动量向上`,
      path: `存储/AI 需求 → 先进封装瓶颈 → 封测利润修复（同步验证稼动）`,
      names: `封装：${pickNames(osat)}；存储：${pickNames(mem)}`,
      segmentIds: ['c01-osat', 'c01-memory'],
      entityIds: [...osat, ...mem].map((c) => c.entity!.id),
      confidenceNote: '领先同向规则；待接入真实价量后回填胜率档案',
      action: '观察：封装弹性 + 存储核心；等待同步指标确认后再考虑布局',
      createdAt: now,
    });
  }

  const litho = graph.segments.find((s) => s.id === 'c01-litho');
  if (litho) {
    const lithoMembers = membersOnSegment(graph, 'c01-litho', ['core']);
    const foundry = membersOnSegment(graph, 'c01-foundry', ['core', 'elastic']);
    cards.push({
      id: 'sig-event-litho',
      chainId: graph.id,
      type: 'event_cascade',
      level: 'intel',
      urgency: 'U2',
      trigger: '出口管制/交期类事件模板：光刻设备供给受限（示意规则常驻）',
      path: 'L1 光刻设备 → L2 先进制程代工 → L3 国产替代设备/材料（需证据升级）',
      names: `L1：${pickNames(lithoMembers)}；L2：${pickNames(foundry)}`,
      segmentIds: ['c01-litho', 'c01-foundry', 'c01-front-eq'],
      entityIds: [...lithoMembers, ...foundry].map((c) => c.entity!.id),
      confidenceNote: '事件模板卡：有真实公告/管制文本时应替换 trigger 并升 U0/U1',
      action: '情报：打开光刻→制造边，核对受益分层；无披露勿把国产替代抬到行动级',
      createdAt: now,
    });
  }

  if (osatUtil && (osatUtil.percentile ?? 0) >= 80) {
    const osat = membersOnSegment(graph, 'c01-osat', ['core', 'elastic']);
    cards.push({
      id: 'sig-gap-osat',
      chainId: graph.id,
      type: 'expected_gap',
      level: 'intel',
      urgency: 'U2',
      trigger: `封装景气分位 ${osatUtil.percentile}（现实偏紧）`,
      path: '现实领先价格？需对照股价/估值分位（P2 背离雷达接入前仅情报）',
      names: pickNames(osat),
      segmentIds: ['c01-osat'],
      entityIds: osat.map((c) => c.entity!.id),
      confidenceNote: '缺估值分位数据 → 禁止自动升到布局/行动',
      action: '情报：记录封装瓶颈；补齐估值/拥挤字段后再评估是否布局',
      createdAt: now,
    });
  }
  return cards;
}

/** C05：I1–I9→枢纽→O1–O6 报告型传导信号 */
function c05SpecificCards(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[],
  now: string
): ChainSignalCard[] {
  const cards: ChainSignalCard[] = [];

  const capex = indicators.find((i) => i.id === 'ind-c05-ai-capex');
  if (capex && (capex.percentile ?? 0) >= 65 && capex.direction === 'up') {
    const servers = membersOnSegment(graph, 'c05-server', ['core', 'elastic']);
    const optical = membersOnSegment(graph, 'c05-optical', ['core', 'elastic']);
    const facility = membersOnSegment(graph, 'c05-facility', ['elastic']);
    cards.push({
      id: 'sig-c05-capex-cascade',
      chainId: graph.id,
      type: 'event_cascade',
      level: 'intel',
      urgency: 'U1',
      trigger: `云厂商/AI 资本开支分位 ${capex.percentile}（${capex.direction}）`,
      path: '资本开支 → 服务器/超节点 → 光模块与液冷机电 → IDC/智算上架',
      names: `整机：${pickNames(servers)}；光通信：${pickNames(optical)}；机电：${pickNames(facility)}`,
      segmentIds: ['c05-server', 'c05-optical', 'c05-facility', 'c05-idc'],
      entityIds: [...servers, ...optical, ...facility].map((c) => c.entity!.id),
      confidenceNote: '全景报告传导模板；种子分位非实盘',
      action: '情报：核对服务器招标与光模块/液冷订单；区分实质供货与题材扩散',
      createdAt: now,
    });
  }

  const chip = indicators.find((i) => i.id === 'ind-c05-chip');
  if (chip && (chip.percentile ?? 0) >= 50) {
    const chips = membersOnSegment(graph, 'c05-chip', ['core', 'elastic']);
    const servers = membersOnSegment(graph, 'c05-server', ['core', 'elastic']);
    cards.push({
      id: 'sig-c05-chip-cascade',
      chainId: graph.id,
      type: 'event_cascade',
      level: 'intel',
      urgency: 'U1',
      trigger: `国产算力芯片供给分位 ${chip.percentile}`,
      path: 'I2 芯片 → I6 服务器整机 → 枢纽 → O2/O4 智算与算力租赁',
      names: `芯片：${pickNames(chips)}；整机：${pickNames(servers)}`,
      segmentIds: ['c05-chip', 'c05-server', 'c05-hub', 'c05-gpuas'],
      entityIds: [...chips, ...servers].map((c) => c.entity!.id),
      confidenceNote: '链条风险「算力供给」模板；有真实缺货/管制文本时升 U0',
      action: '情报：沿芯片→整机→智算边核对交期；勿把芯片弹性直接套到行业云毛利',
      createdAt: now,
    });
  }

  const gpuas = indicators.find((i) => i.id === 'ind-c05-gpuas');
  if (gpuas && (gpuas.direction === 'flat' || gpuas.direction === 'down')) {
    const lease = membersOnSegment(graph, 'c05-gpuas', ['core', 'elastic']);
    const idc = membersOnSegment(graph, 'c05-idc', ['core', 'elastic']);
    cards.push({
      id: 'sig-c05-lease-price',
      chainId: graph.id,
      type: 'margin_shift',
      level: 'watch',
      urgency: 'U2',
      trigger: `算力租赁/Token 价格分位 ${gpuas.percentile}（${gpuas.direction}）`,
      path: '输出侧价格战 → GPUaaS/Token 毛利承压 → 反噬 IDC 上架溢价',
      names: `租赁：${pickNames(lease)}；IDC：${pickNames(idc)}`,
      segmentIds: ['c05-gpuas', 'c05-idc', 'c05-hub'],
      entityIds: [...lease, ...idc].map((c) => c.entity!.id),
      confidenceNote: '报告风险「价格战」映射；需跟踪真实 Token/机时单价',
      action: '观察：核对算力租赁利用率与单价；输入侧景气≠输出侧利润',
      createdAt: now,
    });
  }

  return cards;
}

/** 从指标+图谱生成当日信号流（确定性，便于演示与单测） */
export function buildSignalCards(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[] = C01_INDICATORS
): ChainSignalCard[] {
  const now = new Date().toISOString();
  const cards: ChainSignalCard[] = [...chokeCards(graph, indicators, now)];

  if (graph.id === 'C01') {
    cards.push(...c01SpecificCards(graph, indicators, now));
  } else if (graph.id === 'C05') {
    cards.push(...c05SpecificCards(graph, indicators, now));
  }

  return cards.filter((c) => c.action.trim().length > 0);
}

export function getIndicatorsForSegment(
  segmentId: string,
  indicators: LeadingIndicator[] = C01_INDICATORS
): LeadingIndicator[] {
  return indicators.filter((i) => i.segmentId === segmentId);
}
