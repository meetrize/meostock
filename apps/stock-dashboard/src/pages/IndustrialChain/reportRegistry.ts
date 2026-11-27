/**
 * 产业链绑定报告注册表（前端内嵌副本，不依赖裸 /reports 静态路径）。
 * 生产环境 VITE_BASE=/dashboard/ 时，根路径 /reports/* 会被 SPA 回退吃掉，故优先用打包正文。
 */

import huaweiAscendHtml from './reports/huawei-ascend-chain.html?raw';
import domesticAiChipHtml from './reports/domestic-ai-chip-chain.html?raw';

export type ChainReportMeta = {
  id: string;
  title: string;
  /** public 下相对路径（不含 BASE_URL） */
  publicPath?: string;
  html: string;
};

const REPORTS: Record<string, ChainReportMeta> = {
  'huawei-ascend-chain': {
    id: 'huawei-ascend-chain',
    title: '华为昇腾产业链与输入输出关系图谱（2026-11-27）',
    publicPath: 'reports/huawei-ascend-chain.html',
    html: huaweiAscendHtml,
  },
  'domestic-ai-chip-chain': {
    id: 'domestic-ai-chip-chain',
    title: '国产算力芯片产业链与输入输出关系图谱（2026-11-27）',
    publicPath: 'reports/domestic-ai-chip-chain.html',
    html: domesticAiChipHtml,
  },
};

function joinWithBase(relOrAbs: string): string {
  if (/^https?:\/\//i.test(relOrAbs) || relOrAbs.startsWith('//')) return relOrAbs;
  const base = import.meta.env.BASE_URL || '/';
  const b = base.endsWith('/') ? base : `${base}/`;
  const p = relOrAbs.replace(/^\//, '');
  return `${b}${p}`;
}

export function getBundledReport(reportId: string | undefined | null): ChainReportMeta | null {
  if (!reportId) return null;
  return REPORTS[reportId] ?? null;
}

/** 将 graph.reportUrl（/reports/... 或相对路径）转为带 BASE_URL 的可 fetch 地址 */
export function resolveReportFetchUrl(reportUrl: string | undefined | null): string | null {
  if (!reportUrl) return null;
  return joinWithBase(reportUrl);
}

export function listBundledReports(): ChainReportMeta[] {
  return Object.values(REPORTS);
}
