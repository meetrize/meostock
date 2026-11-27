import type { LeadingIndicator } from '../types';

/** C05 关键变量：云计算数据中心报告景气指标（2026-11-27） */
export const C05_INDICATORS: LeadingIndicator[] = [
  { id: 'ind-c05-ai-capex', segmentId: 'c05-server', name: '云厂商/AI 资本开支', layer: 'leading', percentile: 70, direction: 'up', asOf: '2026-11-27', note: '领先服务器招标、光模块与液冷订单', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-optical', segmentId: 'c05-optical', name: '高速光模块出货/交期', layer: 'leading', percentile: 68, direction: 'up', asOf: '2026-11-27', note: '800G/1.6T 与 OCS 部署节奏', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-liquid', segmentId: 'c05-facility', name: '液冷/机电订单', layer: 'leading', percentile: 62, direction: 'up', asOf: '2026-11-27', note: '智算中心机电与冷板/浸没液冷渗透', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-chip', segmentId: 'c05-chip', name: '国产算力芯片供给', layer: 'leading', percentile: 55, direction: 'up', asOf: '2026-11-27', note: 'GPU/ASIC 出货与代工产能分配', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-idc-util', segmentId: 'c05-idc', name: 'IDC/智算上架率', layer: 'coincident', percentile: 58, direction: 'up', asOf: '2026-11-27', note: '第三方 IDC 与智算中心出租/上架', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-gpuas', segmentId: 'c05-gpuas', name: '算力租赁/Token 价格', layer: 'coincident', percentile: 52, direction: 'flat', asOf: '2026-11-27', note: 'GPUaaS 利用率与 Token 服务单价', source: 'seed/cloud-dc-report' },
  { id: 'ind-c05-policy', segmentId: 'c05-hub', name: '东数西算/国产化政策', layer: 'lagging', percentile: 60, direction: 'up', asOf: '2026-11-27', note: '区域枢纽政策与国产算力优先采购', source: 'seed/cloud-dc-report' },
];
