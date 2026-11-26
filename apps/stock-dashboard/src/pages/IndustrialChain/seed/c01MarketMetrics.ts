import type { EntityMarketMetrics } from '../types';

/** P2 背离雷达用：价格/估值分位种子（非实盘） */
export const C01_MARKET_METRICS: EntityMarketMetrics[] = [
  { entityId: 'ent-asml', pricePercentile: 72, valuationPercentile: 78, crowding: 'high', asOf: '2026-11-21' },
  { entityId: 'ent-amath', pricePercentile: 65, valuationPercentile: 60, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-lrcx', pricePercentile: 68, valuationPercentile: 62, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-klac', pricePercentile: 70, valuationPercentile: 66, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-tel', pricePercentile: 58, valuationPercentile: 55, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-tsmc', pricePercentile: 80, valuationPercentile: 75, crowding: 'high', asOf: '2026-11-21' },
  { entityId: 'ent-smic', pricePercentile: 45, valuationPercentile: 40, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-nvda', pricePercentile: 88, valuationPercentile: 92, crowding: 'high', asOf: '2026-11-21' },
  { entityId: 'ent-skhynix', pricePercentile: 74, valuationPercentile: 58, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-samsung', pricePercentile: 55, valuationPercentile: 48, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-ase', pricePercentile: 42, valuationPercentile: 35, crowding: 'low', asOf: '2026-11-21' },
  { entityId: 'ent-jcet', pricePercentile: 38, valuationPercentile: 32, crowding: 'low', asOf: '2026-11-21' },
  { entityId: 'ent-tfme', pricePercentile: 36, valuationPercentile: 30, crowding: 'low', asOf: '2026-11-21' },
  { entityId: 'ent-naura', pricePercentile: 60, valuationPercentile: 70, crowding: 'high', asOf: '2026-11-21' },
  { entityId: 'ent-acm', pricePercentile: 52, valuationPercentile: 55, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-hysc', pricePercentile: 40, valuationPercentile: 45, crowding: 'low', asOf: '2026-11-21' },
  { entityId: 'ent-will', pricePercentile: 48, valuationPercentile: 42, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-synopsys', pricePercentile: 62, valuationPercentile: 80, crowding: 'mid', asOf: '2026-11-21' },
  { entityId: 'ent-cadence', pricePercentile: 60, valuationPercentile: 78, crowding: 'mid', asOf: '2026-11-21' },
];
