import type { ChainCatalogItem } from './types';

/** 官方主链目录（§1.2）；已开放 C01 / C04 / C05 / C06 / C08 */
export const CHAIN_CATALOG: ChainCatalogItem[] = [
  {
    id: 'C01',
    name: '半导体',
    depth: 'price',
    blurb: '设备/材料 → 设计制造 → 封测 → 应用 · 重构/暴露/⌘K',
  },
  {
    id: 'C05',
    name: '云计算数据中心',
    depth: 'observe',
    blurb: '输入 I1–I9 → 数据中心枢纽 → 输出 O1–O6 · 报告全文可点 K 线',
  },
  {
    id: 'C06',
    name: '华为昇腾',
    depth: 'observe',
    blurb: 'L1–L5 + 输入/输出 · 报告全文可点 K 线',
  },
  {
    id: 'C04',
    name: '国产算力芯片',
    depth: 'observe',
    blurb: '输入 I1–I9 → 芯片枢纽 → 输出 O1–O5 · 报告全文可点 K 线',
  },
  {
    id: 'C08',
    name: '机器人',
    depth: 'observe',
    blurb: 'N1–N8 输入 → N9 本体枢纽 → 场景输出 · 报告全文可点 K 线',
  },
  {
    id: 'C02',
    name: '铜',
    depth: 'placeholder',
    building: true,
    blurb: '矿 → 冶炼 → 加工 → 下游用电（建设中）',
  },
  {
    id: 'C03',
    name: '新能源车 / 锂电',
    depth: 'placeholder',
    building: true,
    blurb: '资源 → 电芯 → 整车 / 储能（建设中）',
  },
  {
    id: 'C07',
    name: '关键矿扩展',
    depth: 'placeholder',
    building: true,
    blurb: '铝 / 锂 / 镍（原 C06 顺延占位）',
  },
];

export function depthLabel(depth: ChainCatalogItem['depth']): string {
  switch (depth) {
    case 'graph':
      return 'L-图谱';
    case 'observe':
      return 'L-观察';
    case 'simulate':
      return 'L-推演';
    case 'price':
      return 'L-定价';
    default:
      return '建设中';
  }
}
