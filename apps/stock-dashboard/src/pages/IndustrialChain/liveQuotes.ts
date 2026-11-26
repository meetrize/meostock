/**
 * P4：用真实行情刷新背离雷达的价格/估值分位代理
 */

import type { FullQuote } from 'stock-sdk';
import { getQuotesByCodesPreferCache } from '@/services/quoteCache';
import { toWatchlistCode } from './portfolioExposure';
import type { EntityMarketMetrics, IndustrialChainGraph } from './types';
import { C01_MARKET_METRICS } from './seed/c01MarketMetrics';

export type LiveQuoteRow = {
  entityId: string;
  code: string;
  name: string;
  changePercent: number | null;
  pe: number | null;
  price: number | null;
};

function rankPercentile(values: number[], value: number): number {
  if (!values.length) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  let below = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
  }
  return Math.round((below / sorted.length) * 100);
}

/** 收集图谱实体可请求的行情代码 */
export function collectQuoteCodes(graph: IndustrialChainGraph): {
  entityId: string;
  code: string;
  name: string;
}[] {
  const rows: { entityId: string; code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const ent of graph.entities) {
    for (const sym of ent.symbols) {
      const code = toWatchlistCode(sym);
      if (!code || seen.has(ent.id)) continue;
      // 台股等 toWatchlistCode 可能 null；美/港/A 可进
      seen.add(ent.id);
      rows.push({ entityId: ent.id, code, name: ent.name });
      break;
    }
  }
  return rows;
}

export async function fetchLiveQuoteRows(
  graph: IndustrialChainGraph
): Promise<LiveQuoteRow[]> {
  const map = collectQuoteCodes(graph);
  if (!map.length) return [];
  const quotes = await getQuotesByCodesPreferCache(
    map.map((m) => m.code),
    { source: 'auto' }
  );
  const byCode = new Map<string, FullQuote>();
  for (const q of quotes) {
    byCode.set(q.code.toLowerCase(), q);
  }

  return map.map((m) => {
    const q =
      byCode.get(m.code.toLowerCase()) ||
      [...byCode.values()].find((x) => x.code.toLowerCase().endsWith(m.code.replace(/^(sh|sz|bj|us|hk)/i, '').toLowerCase()));
    return {
      entityId: m.entityId,
      code: m.code,
      name: m.name,
      changePercent:
        q && Number.isFinite(q.changePercent) ? Number(q.changePercent) : null,
      pe: q && q.pe != null && Number.isFinite(Number(q.pe)) ? Number(q.pe) : null,
      price: q && Number.isFinite(q.price) ? Number(q.price) : null,
    };
  });
}

/**
 * 用 cohort 内涨跌幅/PE 相对分位覆盖种子 metrics；无行情则保留种子
 */
export function mergeLiveMetrics(
  live: LiveQuoteRow[],
  seed: EntityMarketMetrics[] = C01_MARKET_METRICS
): EntityMarketMetrics[] {
  const seedMap = new Map(seed.map((s) => [s.entityId, s]));
  const chg = live
    .map((r) => r.changePercent)
    .filter((v): v is number => v != null);
  const pes = live
    .map((r) => r.pe)
    .filter((v): v is number => v != null && v > 0);

  const today = new Date().toISOString().slice(0, 10);
  const out: EntityMarketMetrics[] = [];

  const entityIds = new Set([
    ...seed.map((s) => s.entityId),
    ...live.map((r) => r.entityId),
  ]);

  for (const entityId of entityIds) {
    const base = seedMap.get(entityId);
    const row = live.find((r) => r.entityId === entityId);
    if (!row && !base) continue;

    let pricePercentile = base?.pricePercentile ?? 50;
    let valuationPercentile = base?.valuationPercentile ?? 50;

    if (row?.changePercent != null && chg.length >= 3) {
      pricePercentile = rankPercentile(chg, row.changePercent);
    } else if (row?.changePercent != null) {
      // 样本不足：用涨跌幅粗映射
      const clamped = Math.max(-8, Math.min(8, row.changePercent));
      pricePercentile = Math.round(((clamped + 8) / 16) * 100);
    }

    if (row?.pe != null && row.pe > 0 && pes.length >= 3) {
      valuationPercentile = rankPercentile(pes, row.pe);
    }

    const crowding =
      pricePercentile >= 80 && valuationPercentile >= 75
        ? 'high'
        : pricePercentile <= 35
          ? 'low'
          : 'mid';

    out.push({
      entityId,
      pricePercentile,
      valuationPercentile,
      crowding,
      asOf: row ? today : base?.asOf ?? today,
    });
  }

  return out;
}

export function liveQuoteByEntity(
  live: LiveQuoteRow[]
): Map<string, LiveQuoteRow> {
  return new Map(live.map((r) => [r.entityId, r]));
}
