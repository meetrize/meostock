import type { LeadingIndicator } from '../types';

/** C08 关键变量：机器人产业链景气指标 */
export const C08_INDICATORS: LeadingIndicator[] = [
  { id: 'ind-c08-drive-orders', segmentId: 'c08-drive', name: '精密传动件订单/交期', layer: 'leading', percentile: 62, direction: 'up', asOf: '2026-11-27', note: '谐波/丝杠/RV 扩产与交期；本体量产前的硬约束', source: 'seed/robot-chain-report' },
  { id: 'ind-c08-motor-ship', segmentId: 'c08-motor', name: '无框力矩/空心杯出货', layer: 'leading', percentile: 55, direction: 'up', asOf: '2026-11-27', note: '关节电机样品→小批→量产节奏', source: 'seed/robot-chain-report' },
  { id: 'ind-c08-body-ship', segmentId: 'c08-body', name: '人形/工业本体出货', layer: 'coincident', percentile: 48, direction: 'up', asOf: '2026-11-27', note: '整机厂交付与客户验证进度；枢纽兑现信号', source: 'seed/robot-chain-report' },
  { id: 'ind-c08-scene', segmentId: 'c08-scene', name: '场景订单与运营渗透', layer: 'coincident', percentile: 45, direction: 'up', asOf: '2026-11-27', note: '工业/商业/特种场景落地合同与复购', source: 'seed/robot-chain-report' },
  { id: 'ind-c08-equip', segmentId: 'c08-equip', name: '制造装备资本开支', layer: 'leading', percentile: 50, direction: 'up', asOf: '2026-11-27', note: '精密加工与自动化产线投资，供给扩容领先指标', source: 'seed/robot-chain-report' },
  { id: 'ind-c08-policy', segmentId: 'c08-software', name: '具身智能政策与标准', layer: 'lagging', percentile: 58, direction: 'up', asOf: '2026-11-27', note: '地方产业基金、标准与示范区节奏', source: 'seed/robot-chain-report' },
];
