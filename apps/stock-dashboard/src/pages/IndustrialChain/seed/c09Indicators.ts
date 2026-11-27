import type { LeadingIndicator } from '../types';

/** C09 关键变量：PCB 产业链景气指标（2026-11-27） */
export const C09_INDICATORS: LeadingIndicator[] = [
  { id: 'ind-c09-ai-pcb', segmentId: 'c09-pcb', name: 'AI 服务器/交换板订单', layer: 'leading', percentile: 72, direction: 'up', asOf: '2026-11-27', note: '高多层/HDI 订单能见度与认证进度', source: 'seed/pcb-chain-report' },
  { id: 'ind-c09-ccl', segmentId: 'c09-ccl', name: '高频高速 CCL 稼动/毛利', layer: 'coincident', percentile: 70, direction: 'up', asOf: '2026-11-27', note: 'M6–M9 等级 CCL 价格与稼动；材料侧利润中枢', source: 'seed/pcb-chain-report' },
  { id: 'ind-c09-foil', segmentId: 'c09-foil', name: 'HVLP 铜箔供给', layer: 'leading', percentile: 48, direction: 'up', asOf: '2026-11-27', note: 'HVLP4 国产良率与交期；卡脖子输入', source: 'seed/pcb-chain-report' },
  { id: 'ind-c09-cloth', segmentId: 'c09-cloth', name: '高端电子布交期', layer: 'leading', percentile: 55, direction: 'up', asOf: '2026-11-27', note: '薄布/Q布织机交付与扩产节奏', source: 'seed/pcb-chain-report' },
  { id: 'ind-c09-equip', segmentId: 'c09-equip', name: '板厂设备/钻针开工', layer: 'coincident', percentile: 65, direction: 'up', asOf: '2026-11-27', note: '钻针/铣刀与 LDI/电镀设备随稼动同步', source: 'seed/pcb-chain-report' },
  { id: 'ind-c09-auto', segmentId: 'c09-app', name: '汽车板认证与出海', layer: 'lagging', percentile: 52, direction: 'up', asOf: '2026-11-27', note: '汽车电子认证周期与东南亚产能投放', source: 'seed/pcb-chain-report' },
];
