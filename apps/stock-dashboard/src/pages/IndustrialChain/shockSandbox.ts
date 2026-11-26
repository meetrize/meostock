/**
 * P2 传导沙盘：冲击沿边扩散 → L1/L2/L3 + 事件 checklist
 */

import type {
  CascadeHit,
  EventChecklistItem,
  IndustrialChainGraph,
  ShockScenario,
} from './types';

export const SHOCK_PRESETS: Omit<ShockScenario, 'intensity'>[] = [
  {
    id: 'shock-euv',
    kind: 'export_control',
    label: '光刻/出口管制收紧',
    description: '先进制程设备交期拉长或禁运加码',
    epicenterSegmentId: 'c01-litho',
    polarity: 'supply_tight',
  },
  {
    id: 'shock-capex',
    kind: 'capex_cut',
    label: '晶圆厂削减资本开支',
    description: '代工/IDM 下调年度 capex',
    epicenterSegmentId: 'c01-foundry',
    polarity: 'demand_down',
  },
  {
    id: 'shock-ai',
    kind: 'ai_demand_surge',
    label: 'AI 算力需求上修',
    description: '服务器/加速器订单超预期',
    epicenterSegmentId: 'c01-app',
    polarity: 'demand_up',
  },
  {
    id: 'shock-memory',
    kind: 'memory_crash',
    label: '存储现货急跌',
    description: 'DRAM/NAND 现货连跌、库存堆积',
    epicenterSegmentId: 'c01-memory',
    polarity: 'demand_down',
  },
];

function beneficiariesForSegment(graph: IndustrialChainGraph, segmentId: string) {
  return graph.memberships
    .filter(
      (m) =>
        m.segmentId === segmentId &&
        m.status === 'active' &&
        m.tier !== 'concept'
    )
    .map((m) => {
      const ent = graph.entities.find((e) => e.id === m.entityId);
      if (!ent) return null;
      return {
        name: ent.name,
        symbol: ent.symbols[0] ?? '',
        tier: m.tier,
      };
    })
    .filter(Boolean) as CascadeHit['beneficiaries'];
}

/**
 * 沿出边/入边做有限层 BFS：强度 × 边权重 × 弹性中点，衰减按层
 */
export function runCascade(
  graph: IndustrialChainGraph,
  shock: ShockScenario
): CascadeHit[] {
  const intensity = Math.max(0, Math.min(1, shock.intensity));
  if (intensity <= 0) return [];

  const segName = (id: string) =>
    graph.segments.find((s) => s.id === id)?.name ?? id;

  type NodeHit = {
    segmentId: string;
    layer: 1 | 2 | 3;
    score: number;
    lagWeeks: number;
    pathNote: string;
  };

  const best = new Map<string, NodeHit>();
  const queue: NodeHit[] = [
    {
      segmentId: shock.epicenterSegmentId,
      layer: 1,
      score: intensity,
      lagWeeks: 0,
      pathNote: `冲击落点：${segName(shock.epicenterSegmentId)}（${shock.polarity}）`,
    },
  ];

  while (queue.length) {
    const cur = queue.shift()!;
    const prev = best.get(cur.segmentId);
    if (prev && prev.score >= cur.score) continue;
    best.set(cur.segmentId, cur);
    if (cur.layer >= 3) continue;

    const outgoing = graph.edges.filter((e) => e.from === cur.segmentId);
    const incoming = graph.edges.filter((e) => e.to === cur.segmentId);

    // 供给紧张：更强调沿出边打下游；需求上修：沿入边回传上游亦可
    const edges =
      shock.polarity === 'supply_tight'
        ? outgoing
        : shock.polarity === 'demand_up'
          ? [...incoming, ...outgoing]
          : [...outgoing, ...incoming];

    for (const edge of edges) {
      const nextId = edge.from === cur.segmentId ? edge.to : edge.from;
      if (nextId === cur.segmentId) continue;
      const midElast =
        (edge.params.elasticity[0] + edge.params.elasticity[1]) / 2;
      const decay = cur.layer === 1 ? 0.85 : 0.55;
      const score =
        cur.score * edge.params.weight * midElast * decay * intensity;
      if (score < 0.08) continue;
      const layer = (cur.layer + 1) as 2 | 3;
      queue.push({
        segmentId: nextId,
        layer,
        score,
        lagWeeks: cur.lagWeeks + edge.params.lagWeeks,
        pathNote: `${segName(cur.segmentId)} → ${segName(nextId)}（w=${edge.params.weight}, lag=${edge.params.lagWeeks}w）`,
      });
    }
  }

  const hits: CascadeHit[] = [...best.values()]
    .map((h) => ({
      layer: (`L${h.layer}` as CascadeHit['layer']),
      segmentId: h.segmentId,
      segmentName: segName(h.segmentId),
      score: Math.round(h.score * 100) / 100,
      lagWeeks: h.lagWeeks,
      pathNote: h.pathNote,
      beneficiaries: beneficiariesForSegment(graph, h.segmentId).slice(0, 4),
    }))
    .sort((a, b) => {
      const layerRank = { L1: 0, L2: 1, L3: 2 };
      if (layerRank[a.layer] !== layerRank[b.layer]) {
        return layerRank[a.layer] - layerRank[b.layer];
      }
      return b.score - a.score;
    });

  return hits;
}

export function buildEventChecklist(
  graph: IndustrialChainGraph,
  shock: ShockScenario,
  hits: CascadeHit[]
): EventChecklistItem[] {
  const items: EventChecklistItem[] = [];
  const epicenter = graph.segments.find((s) => s.id === shock.epicenterSegmentId);

  items.push({
    id: `chk-w1-${shock.id}`,
    horizon: 'W1',
    segmentId: shock.epicenterSegmentId,
    text: `${epicenter?.name ?? '落点'}：公告/交期/现货是否确认「${shock.label}」`,
    verifiable: true,
  });

  const l2 = hits.filter((h) => h.layer === 'L2').slice(0, 2);
  for (const h of l2) {
    items.push({
      id: `chk-m1-${h.segmentId}`,
      horizon: 'M1',
      segmentId: h.segmentId,
      text: `${h.segmentName}：约 ${h.lagWeeks} 周窗口内看价差/稼动/订单是否同向（score=${h.score}）`,
      verifiable: true,
    });
  }

  const l3 = hits.filter((h) => h.layer === 'L3').slice(0, 2);
  for (const h of l3) {
    items.push({
      id: `chk-q1-${h.segmentId}`,
      horizon: 'Q1',
      segmentId: h.segmentId,
      text: `${h.segmentName}：季度验证利润迁移或国产替代证据是否兑现`,
      verifiable: true,
    });
  }

  if (items.length === 1) {
    items.push({
      id: `chk-m1-fallback`,
      horizon: 'M1',
      segmentId: shock.epicenterSegmentId,
      text: '提高冲击强度或检查边权重，以便生成下游验证项',
      verifiable: false,
    });
  }

  return items;
}
