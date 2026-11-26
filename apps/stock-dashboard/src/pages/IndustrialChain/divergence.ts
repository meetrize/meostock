/**
 * P2 预期差 / 背离雷达
 * 横轴：环节景气（指标分位相对 50）
 * 纵轴：价格表现（价格分位相对 50）
 * 左下角 value_gap = 景气改善但价格未动 → 黄金坑候选
 */

import { C01_INDICATORS } from './seed/c01Indicators';
import { C01_MARKET_METRICS } from './seed/c01MarketMetrics';
import type {
  DivergencePoint,
  EntityMarketMetrics,
  IndustrialChainGraph,
  LeadingIndicator,
} from './types';

function segmentBoom(segmentId: string, indicators: LeadingIndicator[]): number {
  const rows = indicators.filter((i) => i.segmentId === segmentId && i.percentile != null);
  if (!rows.length) return 0;
  const avg =
    rows.reduce((s, r) => s + (r.percentile as number), 0) / rows.length;
  return Math.round(avg - 50);
}

export function buildDivergencePoints(
  graph: IndustrialChainGraph,
  indicators: LeadingIndicator[] = C01_INDICATORS,
  metrics: EntityMarketMetrics[] = C01_MARKET_METRICS,
  options?: { liveLabel?: boolean }
): DivergencePoint[] {
  const metricMap = new Map(metrics.map((m) => [m.entityId, m]));
  const points: DivergencePoint[] = [];

  for (const m of graph.memberships) {
    if (m.status !== 'active' || m.tier === 'concept') continue;
    const ent = graph.entities.find((e) => e.id === m.entityId);
    const met = metricMap.get(m.entityId);
    if (!ent || !met) continue;
    const seg = graph.segments.find((s) => s.id === m.segmentId);
    if (!seg) continue;

    const cycleDelta = segmentBoom(m.segmentId, indicators);
    const priceDelta = Math.round(met.pricePercentile - 50);

    let quadrant: DivergencePoint['quadrant'];
    if (cycleDelta >= 10 && priceDelta <= 0) quadrant = 'value_gap';
    else if (cycleDelta >= 10 && priceDelta > 10) quadrant = 'confirmed';
    else if (cycleDelta < 0 && priceDelta > 10) quadrant = 'overheated';
    else if (cycleDelta < 0 && priceDelta <= 0) quadrant = 'value_trap';
    else quadrant = cycleDelta >= 5 ? 'value_gap' : 'confirmed';

    // 微调：估值很高且景气改善 → 仍可能 overheated
    if (cycleDelta >= 10 && met.valuationPercentile >= 85 && priceDelta > 5) {
      quadrant = 'overheated';
    }

    const liveTag = options?.liveLabel ? '·行情' : '·种子';
    const note =
      quadrant === 'value_gap'
        ? `现实偏紧/景气改善，价格未充分反应（${liveTag}）`
        : quadrant === 'overheated'
          ? `价格/估值领先现实，谨防透支（${liveTag}）`
          : quadrant === 'value_trap'
            ? `景气与价格双弱（${liveTag}）`
            : `景气与价格同向确认（${liveTag}）`;

    points.push({
      entityId: ent.id,
      name: ent.name,
      symbol: ent.symbols[0] ?? '',
      segmentId: seg.id,
      segmentName: seg.name,
      tier: m.tier,
      cycleDelta,
      priceDelta,
      valuationPercentile: met.valuationPercentile,
      crowding: met.crowding,
      quadrant,
      note,
    });
  }

  return points.sort((a, b) => {
    const rank = { value_gap: 0, confirmed: 1, overheated: 2, value_trap: 3 };
    if (rank[a.quadrant] !== rank[b.quadrant]) {
      return rank[a.quadrant] - rank[b.quadrant];
    }
    return b.cycleDelta - a.cycleDelta;
  });
}

export function quadrantLabel(q: DivergencePoint['quadrant']): string {
  switch (q) {
    case 'value_gap':
      return '黄金坑（现实>价格）';
    case 'confirmed':
      return '同向确认';
    case 'overheated':
      return '过热（价格>现实）';
    case 'value_trap':
      return '双弱';
  }
}
