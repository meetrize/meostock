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

/** 从指标+图谱生成当日信号流（确定性，便于演示与单测） */
export function buildSignalCards(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[] = C01_INDICATORS
): ChainSignalCard[] {
  if (graph.id !== 'C01') return [];
  const cards: ChainSignalCard[] = [];
  const now = new Date().toISOString();

  // 1) 高卡脖子 + 领先指标分位偏高 → 卡脖子警报
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
      path: `${seg.name} 供给约束 → 下游制造/设计成本与交期（边时滞见图谱）`,
      names: `受益关注：${pickNames(cores)}`,
      segmentIds: [seg.id],
      entityIds: cores.map((c) => c.entity!.id),
      confidenceNote: `规则：chokeRisk=high 且 leading 分位≥70；样本为种子指标，非实盘回测`,
      action: `加入观察池：盯 ${seg.name} 核心/弹性标的；概念关联勿升级`,
      createdAt: now,
    });
  }

  // 2) 先进封装高稼动 + 设计/存储活跃 → 景气拐点观察
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

  // 3) 光刻卡脖子 → 事件传导示意（L1）
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

  // 4) 简单「现实 vs 拥挤」占位：封装高分位但仅作观察（预期差字段预留）
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

  // 过滤：必须有动作句
  return cards.filter((c) => c.action.trim().length > 0);
}

export function getIndicatorsForSegment(
  segmentId: string,
  indicators: LeadingIndicator[] = C01_INDICATORS
): LeadingIndicator[] {
  return indicators.filter((i) => i.segmentId === segmentId);
}
