/**
 * 策略选股预设：对接 /api/research/strategy-presets
 * 官方预设 SSOT 在后端；此处保留最小 fallback 以免接口未就绪时页面空白。
 */

import type { EndOfDayFilters } from '@/services/analysis';
import officialPresetsFallback from '@/services/officialPresets.fallback';

export type PresetHorizon = 'short' | 'swing' | 'long';
export type RiskLevel = 'low' | 'low_medium' | 'medium' | 'medium_high' | 'high';
export type RunEngine = 'eod_intraday' | 'research_scanner' | 'pending';

export interface RuleBlock {
  op: string;
  params: Record<string, unknown>;
}

export interface StrategyCopy {
  headline: string;
  one_liner: string;
  fit_when: string;
  avoid_when: string;
  how_to_buy: string;
  how_to_exit: string;
  position_hint: string;
  conditions?: string[];
  disclaimer: string;
}

export interface StrategyPreset {
  id: string;
  name: string;
  horizon: PresetHorizon;
  version: number;
  risk_level: RiskLevel | string;
  enabled_by_default?: boolean;
  runnable: boolean;
  run_engine: RunEngine | string;
  scanner_template_id?: string;
  tags?: string[];
  environment?: { prefer?: string[]; avoid?: string[] };
  gates?: { block_on_emotion?: string[] };
  rules: { all: RuleBlock[] };
  copy: StrategyCopy;
  result_columns?: string[];
  sort_default?: { field: string; order: 'asc' | 'desc' | string };
  outputs?: { allow_trade_card?: boolean; require_tradability_flag?: boolean };
}

export const HORIZON_TABS: { id: PresetHorizon; label: string }[] = [
  { id: 'short', label: '短线' },
  { id: 'swing', label: '波段' },
  { id: 'long', label: '长线' },
];

export const RISK_LABEL: Record<string, string> = {
  low: '低',
  low_medium: '中低',
  medium: '中',
  medium_high: '中高',
  high: '高',
};

export const DISCLAIMER = '规则候选池，仅供观察与学习，不构成投资建议。';

/** 与后端 OFFICIAL_PRESETS 同步的本地副本；API 未重启/404 时仍能展示全部预设 */
export const FALLBACK_PRESETS: StrategyPreset[] = officialPresetsFallback as StrategyPreset[];

export function eodFiltersFromPreset(preset: StrategyPreset): EndOfDayFilters {
  const defaults: EndOfDayFilters = {
    marketCapMin: 50,
    marketCapMax: 200,
    volumeRatioMin: 1.2,
    changePercentMin: 3,
    changePercentMax: 5,
    turnoverRateMin: 5,
    turnoverRateMax: 10,
    excludeST: true,
    timelineAboveAvgRatio: 80,
  };
  for (const block of preset.rules?.all || []) {
    const p = block.params || {};
    switch (block.op) {
      case 'quote.market_cap':
        defaults.marketCapMin = Number(p.min ?? 0);
        defaults.marketCapMax = p.max == null ? null : Number(p.max);
        break;
      case 'quote.volume_ratio':
        defaults.volumeRatioMin = Number(p.min ?? 0);
        break;
      case 'quote.change_percent':
        defaults.changePercentMin = Number(p.min ?? 0);
        defaults.changePercentMax = p.max == null ? null : Number(p.max);
        break;
      case 'quote.turnover_rate':
        defaults.turnoverRateMin = Number(p.min ?? 0);
        defaults.turnoverRateMax = p.max == null ? null : Number(p.max);
        break;
      case 'quote.exclude_st':
        defaults.excludeST = Boolean(p.enabled ?? true);
        break;
      case 'intraday.timeline_above_avg':
        defaults.timelineAboveAvgRatio = Number(p.min ?? 0);
        break;
      default:
        break;
    }
  }
  return defaults;
}

export function presetRulesFromEodFilters(filters: EndOfDayFilters): { all: RuleBlock[] } {
  return {
    all: [
      {
        op: 'quote.market_cap',
        params: { min: filters.marketCapMin, max: filters.marketCapMax },
      },
      { op: 'quote.volume_ratio', params: { min: filters.volumeRatioMin } },
      {
        op: 'quote.change_percent',
        params: { min: filters.changePercentMin, max: filters.changePercentMax },
      },
      {
        op: 'quote.turnover_rate',
        params: { min: filters.turnoverRateMin, max: filters.turnoverRateMax },
      },
      { op: 'quote.exclude_st', params: { enabled: filters.excludeST } },
      {
        op: 'intraday.timeline_above_avg',
        params: { min: filters.timelineAboveAvgRatio },
      },
    ],
  };
}

function fmtRange(lo: unknown, hi: unknown, unit = ''): string {
  const left = lo == null ? '不限' : `${lo}${unit}`;
  const right = hi == null ? '不限' : `${hi}${unit}`;
  return `${left} ~ ${right}`;
}

export function ruleBlockToSentence(block: RuleBlock): string {
  const p = block.params || {};
  switch (block.op) {
    case 'quote.market_cap':
      return `流通市值（亿）：${fmtRange(p.min, p.max, '亿')}`;
    case 'quote.change_percent':
      return `涨跌幅（%）：${fmtRange(p.min, p.max, '%')}`;
    case 'quote.turnover_rate':
      return `换手率（%）：${fmtRange(p.min, p.max, '%')}`;
    case 'quote.volume_ratio':
      return `量比 ≥ ${p.min ?? '-'}`;
    case 'quote.exclude_st':
      return `排除 ST：${p.enabled === false ? '关闭' : '开启'}`;
    case 'intraday.timeline_above_avg':
      return `分时均线上方占比（%） ≥ ${p.min ?? '-'}%`;
    case 'ma.bull_stack': {
      const periods = (p.periods as number[]) || [5, 10, 20, 60];
      const above = p.require_price_above;
      return `均线多头排列：${periods.map((x) => `MA${x}`).join(' > ')}${
        above ? `；价站上 MA${above}` : ''
      }`;
    }
    case 'ma.dual_coil':
      return `双线粘合/发散：MA${p.slow ?? 60}/MA${p.slower ?? 89}，间距≤${p.max_gap_pct ?? '-'}%${
        p.require_price_above ? '；价站上双线' : ''
      }`;
    case 'ma.above':
      return `股价站上均线：MA${p.period ?? 60}`;
    case 'breakout.volume':
      return `放量突破：近 ${p.lookback ?? '-'} 日，量≥${p.volume_multiple ?? '-'}×均量`;
    case 'limit.board_count':
      return `连板数区间：${fmtRange(p.min, p.max)}`;
    case 'board.theme_top_n':
      return `所属板块进入主线 TopN：Top ${p.n ?? '-'}`;
    case 'fina.roe':
      return `ROE（%） ≥ ${p.min ?? '-'}%（约 ${p.years ?? '-'} 年）`;
    case 'fina.growth':
      return `业绩增速：营收≥${p.revenue_min ?? '-'}%，净利≥${p.profit_min ?? '-'}%`;
    case 'valuation.pe_pb_pct':
      return `PE/PB 分位：PE≤${p.pe_percentile_max ?? '-'}%，PB≤${p.pb_percentile_max ?? '-'}%`;
    case 'valuation.dividend':
      return `股息率（%） ≥ ${p.min ?? '-'}%（约 ${p.years ?? '-'} 年）`;
    case 'valuation.peg':
      return `PEG 上限 ≤ ${p.max ?? '-'}`;
    case 'risk.tradability':
      return `标记不可成交：${p.require_flag === false ? '否' : '是'}`;
    default:
      return `${block.op}：${JSON.stringify(p)}`;
  }
}

export function buildResolvedCopy(preset: StrategyPreset, rules?: { all: RuleBlock[] }): StrategyCopy {
  const conditions = (rules?.all || preset.rules?.all || []).map(ruleBlockToSentence);
  return {
    ...preset.copy,
    conditions,
    disclaimer: preset.copy?.disclaimer || DISCLAIMER,
  };
}

export async function fetchStrategyPresets(horizon?: PresetHorizon): Promise<StrategyPreset[]> {
  const q = horizon ? `?horizon=${encodeURIComponent(horizon)}` : '';
  try {
    const res = await fetch(`/api/research/strategy-presets${q}`);
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; presets?: StrategyPreset[] };
      if (data?.ok && Array.isArray(data.presets) && data.presets.length > 0) {
        return data.presets;
      }
    }
  } catch {
    // fallback below
  }
  if (!horizon) return FALLBACK_PRESETS;
  return FALLBACK_PRESETS.filter((p) => p.horizon === horizon);
}

export async function fetchStrategyPreset(
  presetId: string
): Promise<{ preset: StrategyPreset; resolved_copy: StrategyCopy } | null> {
  try {
    const res = await fetch(`/api/research/strategy-presets/${encodeURIComponent(presetId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      preset?: StrategyPreset;
      resolved_copy?: StrategyCopy;
    };
    if (data?.ok && data.preset) {
      return {
        preset: data.preset,
        resolved_copy: data.resolved_copy || buildResolvedCopy(data.preset),
      };
    }
  } catch {
    // ignore
  }
  const fb = FALLBACK_PRESETS.find((p) => p.id === presetId);
  if (!fb) return null;
  return { preset: fb, resolved_copy: buildResolvedCopy(fb) };
}

export function isEodEngine(preset: StrategyPreset | null | undefined): boolean {
  return preset?.run_engine === 'eod_intraday';
}

export function runButtonLabel(preset: StrategyPreset | null | undefined): string {
  if (!preset) return '开始分析';
  if (preset.run_engine === 'eod_intraday') return '开始分析';
  if (preset.run_engine === 'research_scanner' && preset.runnable) return '运行扫描';
  return '即将支持跑批';
}
