import type { LeadingIndicator } from '../types';

/** C10 关键变量：光刻机（胶）景气指标（2026-11-27） */
export const C10_INDICATORS: LeadingIndicator[] = [
  { id: 'ind-c10-duv', segmentId: 'c10-tool', name: '国产 DUV 整机交付/验证', layer: 'leading', percentile: 55, direction: 'up', asOf: '2026-11-27', note: '上海微电子浸没式交付与客户验证节奏', source: 'seed/lithography-report' },
  { id: 'ind-c10-arf', segmentId: 'c10-resist', name: 'ArF/KrF 光刻胶导入', layer: 'leading', percentile: 48, direction: 'up', asOf: '2026-11-27', note: '送样→订单转化；ArF 国产化仍低', source: 'seed/lithography-report' },
  { id: 'ind-c10-optics', segmentId: 'c10-optics', name: '物镜/光学部件订单', layer: 'leading', percentile: 62, direction: 'up', asOf: '2026-11-27', note: '193nm 物镜商业化交付与在手订单', source: 'seed/lithography-report' },
  { id: 'ind-c10-track', segmentId: 'c10-equip', name: '涂胶显影/直写设备出货', layer: 'coincident', percentile: 60, direction: 'up', asOf: '2026-11-27', note: 'Track 与先进封装直写光刻渗透', source: 'seed/lithography-report' },
  { id: 'ind-c10-foundry', segmentId: 'c10-foundry', name: '晶圆厂验证产线稼动', layer: 'coincident', percentile: 52, direction: 'up', asOf: '2026-11-27', note: '中芯/存储对国产机胶验证与放量', source: 'seed/lithography-report' },
  { id: 'ind-c10-policy', segmentId: 'c10-tool', name: '半导体设备国产化政策', layer: 'lagging', percentile: 68, direction: 'up', asOf: '2026-11-27', note: '政策定调与地方规划对硬科技资本开支', source: 'seed/lithography-report' },
];
