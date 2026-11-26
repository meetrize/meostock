import type { EntityRelationType } from './types';

export const RELATION_META: Record<
  EntityRelationType,
  { label: string; color: string; desc: string }
> = {
  supply: { label: '供货', color: '#38bdf8', desc: '零部件、整机、云资源或服务供应' },
  invest: { label: '投资', color: '#a78bfa', desc: '股权、战略投资与资本绑定' },
  tech: { label: '技术', color: '#f5b75c', desc: '技术授权、生态适配或联合方案' },
  capacity: { label: '产能', color: '#34d399', desc: '代工、机柜/算力产能与协同' },
};

export const RELATION_TYPES = Object.keys(RELATION_META) as EntityRelationType[];

/** 沙盘默认允许映射的关系类型（invest/tech 默认排除） */
export const SANDBOX_RELATION_TYPES: EntityRelationType[] = ['supply', 'capacity'];
