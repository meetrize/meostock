import type { LeadingIndicator } from '../types';

/** C04 关键变量：国产算力芯片报告景气指标 */
export const C04_INDICATORS: LeadingIndicator[] = [
  { id: 'ind-c04-hbm-supply', segmentId: 'c04-hbm', name: '国产 HBM 供给', layer: 'leading', percentile: 30, direction: 'up', asOf: '2026-11-27', note: '长鑫 HBM3 交付窗口与月产能爬坡；供给覆盖率约束国产 GPU 放量', source: 'seed/domestic-ai-chip-report' },
  { id: 'ind-c04-equip-orders', segmentId: 'c04-equip', name: '先进封装/键合设备订单', layer: 'leading', percentile: 58, direction: 'up', asOf: '2026-11-27', note: 'W2W 混合键合、测试、减薄设备交期；扩产周期第一受益', source: 'seed/domestic-ai-chip-report' },
  { id: 'ind-c04-chip-ship', segmentId: 'c04-chip', name: '国产算力芯片出货', layer: 'coincident', percentile: 55, direction: 'up', asOf: '2026-11-27', note: '寒武纪/海光/摩尔线程/沐曦/燧原及昇腾出货与云/运营商招标', source: 'seed/domestic-ai-chip-report' },
  { id: 'ind-c04-foundry-cap', segmentId: 'c04-foundry', name: '先进逻辑代工产能分配', layer: 'leading', percentile: 48, direction: 'up', asOf: '2026-11-27', note: '中芯等代工产能分配表决定芯片厂商真实排位', source: 'seed/domestic-ai-chip-report' },
  { id: 'ind-c04-cluster', segmentId: 'c04-cluster', name: '超节点/万卡集群部署', layer: 'coincident', percentile: 50, direction: 'up', asOf: '2026-11-27', note: '超节点把单卡变成集群，拉动光互联/液冷/交换', source: 'seed/domestic-ai-chip-report' },
  { id: 'ind-c04-policy', segmentId: 'c04-ops', name: '国产化政策与管制', layer: 'lagging', percentile: 68, direction: 'up', asOf: '2026-11-27', note: '地方算力规划国产芯片优先 vs 出口管制变化', source: 'seed/domestic-ai-chip-report' },
];
