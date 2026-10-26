/**
 * 热力图涨跌幅色阶：
 * - |涨跌幅| < 1%：偏黑（含 0.5% / -0.5%）
 * - |涨跌幅| ≥ 1%：尽量鲜艳
 * - |涨跌幅| ≥ 2%：更鲜艳
 * - |涨跌幅| ≥ 4%：接近最鲜艳，并掺入辅色以便区分
 */

/** 图例刻度 */
export const CHANGE_PERCENT_STOPS = [-4, -2, -1, 0, 1, 2, 4] as const;

/** 平盘 / 近零：深灰接近黑 */
export const HEATMAP_ZERO_COLOR = '#141416';

const NEON_RED = '#ff2d2d';
const NEON_GREEN = '#00e676';
/** ≥4% 涨侧辅色（橙）/ 跌侧辅色（嫩黄绿）——再按 colorMode 对调 */
const EXTREME_WARM = '#ff9100';
const EXTREME_LIME = '#b2ff59';

function parseRgb(hex: string): [number, number, number] {
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const value = Number.parseInt(normalized.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const ratio = Math.min(1, Math.max(0, t));
  const [ar, ag, ab] = parseRgb(a);
  const [br, bg, bb] = parseRgb(b);
  return rgbToHex(
    ar + (br - ar) * ratio,
    ag + (bg - ag) * ratio,
    ab + (bb - ab) * ratio
  );
}

function darken(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}

function lighten(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', amount);
}

function boostChroma(hex: string, amount: number): string {
  const [r, g, b] = parseRgb(hex);
  const avg = (r + g + b) / 3;
  const scale = 1 + amount;
  return rgbToHex(
    avg + (r - avg) * scale,
    avg + (g - avg) * scale,
    avg + (b - avg) * scale
  );
}

function isRedRise(rise: string): boolean {
  const [r, , b] = parseRgb(rise);
  return r > b;
}

/** 主霓虹色（红涨绿跌 / 绿涨红跌） */
function neonAccent(isRise: boolean, redRise: boolean): string {
  const wantRed = redRise ? isRise : !isRise;
  return wantRed ? NEON_RED : NEON_GREEN;
}

/** ≥4% 辅色：涨侧偏橙、跌侧偏嫩绿（随 colorMode 对调） */
function extremeAccent(isRise: boolean, redRise: boolean): string {
  const wantWarm = redRise ? isRise : !isRise;
  return wantWarm ? EXTREME_WARM : EXTREME_LIME;
}

/**
 * |涨跌幅| → 0..1（兼容旧导出；真实着色走分段逻辑）
 */
export function changeAbsToIntensity(abs: number): number {
  if (abs <= 0) return 0;
  if (abs < 1) return (abs / 1) * 0.15;
  if (abs < 2) return 0.15 + ((abs - 1) / 1) * 0.35;
  if (abs < 4) return 0.5 + ((abs - 2) / 2) * 0.35;
  return Math.min(0.85 + ((abs - 4) / 4) * 0.15, 1);
}

/**
 * 涨跌幅 → 方块填色（分段色阶）
 */
export function getHeatmapChangeColor(
  value: number,
  rise: string,
  fall: string,
  _flat: string,
  theme: 'light' | 'dark' = 'dark'
): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.02) {
    return HEATMAP_ZERO_COLOR;
  }

  const abs = Math.abs(value);
  const isRise = value > 0;
  const base = isRise ? rise : fall;
  const redRise = isRedRise(rise);
  const neon = neonAccent(isRise, redRise);
  const vivid = mixHex(boostChroma(base, 0.5), neon, 0.65);
  const flash = mixHex(vivid, extremeAccent(isRise, redRise), 0.7);

  // —— |x| < 1%：偏黑，仅极淡色相（0.5% 仍接近黑）——
  if (abs < 1) {
    const t = abs / 1; // 0 → 1
    // 最多掺约 12% 深色相，整体仍压在近黑
    return mixHex(HEATMAP_ZERO_COLOR, darken(base, 0.55), 0.04 + t * 0.08);
  }

  // —— 1% ≤ |x| < 2%：迅速拉到鲜艳 ——
  if (abs < 2) {
    const t = (abs - 1) / 1;
    const at1 = mixHex(HEATMAP_ZERO_COLOR, vivid, theme === 'dark' ? 0.55 : 0.5);
    const at2 = vivid;
    return mixHex(at1, at2, t);
  }

  // —— 2% ≤ |x| < 4%：更鲜艳（提亮 + 加彩）——
  if (abs < 4) {
    const t = (abs - 2) / 2;
    const at2 = vivid;
    const at4 = mixHex(lighten(vivid, 0.08), flash, 0.45);
    return mixHex(at2, at4, t);
  }

  // —— |x| ≥ 4%：最鲜艳 + 辅色拉开 ——
  const t = Math.min((abs - 4) / 4, 1); // 4%→8% 继续掺辅色
  const at4 = mixHex(lighten(vivid, 0.08), flash, 0.45);
  const atMax = mixHex(flash, extremeAccent(isRise, redRise), 0.55);
  return mixHex(at4, atMax, t);
}

/** 换手率 / 量比：低值偏黑，高值鲜艳 */
export function getHeatmapMetricColor(
  value: number,
  accent: string,
  _flat: string,
  maxValue: number,
  theme: 'light' | 'dark' = 'dark'
): string {
  const ratio = Math.min(Math.max(value, 0) / maxValue, 1);
  if (ratio < 0.02) return HEATMAP_ZERO_COLOR;

  // 映射到类似 0/1/2/4 的分段感
  const absLike = ratio * 4;
  return getHeatmapChangeColor(
    absLike,
    accent,
    accent,
    HEATMAP_ZERO_COLOR,
    theme
  );
}

export interface HeatmapLegendStop {
  value: number;
  color: string;
  label: string;
}

export function buildChangeLegendStops(
  rise: string,
  fall: string,
  flat: string,
  theme: 'light' | 'dark' = 'dark'
): HeatmapLegendStop[] {
  return CHANGE_PERCENT_STOPS.map((value) => ({
    value,
    color:
      value === 0
        ? HEATMAP_ZERO_COLOR
        : getHeatmapChangeColor(value, rise, fall, flat, theme),
    label: value === 0 ? '0' : `${value > 0 ? '+' : ''}${value}%`,
  }));
}

/** 图例胶囊条渐变：按真实幅度比例定位刻度（-4…+4） */
export function buildChangeLegendGradient(
  rise: string,
  fall: string,
  flat: string,
  theme: 'light' | 'dark' = 'dark'
): string {
  const min = CHANGE_PERCENT_STOPS[0];
  const max = CHANGE_PERCENT_STOPS[CHANGE_PERCENT_STOPS.length - 1];
  const span = max - min;

  const stops = buildChangeLegendStops(rise, fall, flat, theme);
  const dense: { color: string; pct: number }[] = [];

  for (const s of stops) {
    const pct = ((s.value - min) / span) * 100;
    dense.push({ color: s.color, pct });
    if (s.value === 0) {
      // 中心加宽深色段，避免插值发白
      dense.push({ color: HEATMAP_ZERO_COLOR, pct: pct - 4 });
      dense.push({ color: HEATMAP_ZERO_COLOR, pct });
      dense.push({ color: HEATMAP_ZERO_COLOR, pct: pct + 4 });
    }
  }

  // 补采样 ±0.5，确认「1% 内偏黑」
  for (const v of [-0.5, 0.5] as const) {
    const pct = ((v - min) / span) * 100;
    dense.push({
      color: getHeatmapChangeColor(v, rise, fall, flat, theme),
      pct,
    });
  }

  dense.sort((a, b) => a.pct - b.pct);
  return `linear-gradient(to right, ${dense.map((d) => `${d.color} ${d.pct}%`).join(', ')})`;
}
