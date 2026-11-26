import type { ChainCatalogItem } from './types';

/** 官方主链目录（§1.2）；P0 仅 C01 可点开 */
export const CHAIN_CATALOG: ChainCatalogItem[] = [
  {
    id: 'C01',
    name: '半导体',
    depth: 'price',
    blurb: '设备/材料 → 设计制造 → 封测 → 应用 · 重构/暴露/⌘K',
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
    id: 'C04',
    name: 'AI 算力',
    depth: 'placeholder',
    building: true,
    blurb: '可与 C01 交叉视图（建设中）',
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
