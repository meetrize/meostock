/**
 * K 线周期映射（与 index.html PERIOD_MAP 对齐）
 * 分时 fs：当日分钟走势，样式强制 area（见 ChartPanel / applyChartSettings）
 * 文档：https://stock-sdk.linkdiary.cn/api/kline
 */

/** @type {Record<string, { type: string, span: number }>} */
export const PERIOD_MAP = {
  fs: { type: "minute", span: 1 },
  "1m": { type: "minute", span: 1 },
  "5m": { type: "minute", span: 5 },
  "15m": { type: "minute", span: 15 },
  "1h": { type: "minute", span: 60 },
  "1d": { type: "day", span: 1 },
  "1w": { type: "week", span: 1 },
};

/** fs / 1m 均走 cnMinute period=1；fs 额外切面积图 */
export const MINUTE_PERIOD = {
  fs: "1",
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
};

export const HISTORY_PERIOD = {
  "1d": "daily",
  "1w": "weekly",
};

/** UI 按钮顺序与文案 */
export const PERIOD_BUTTONS = [
  { id: "fs", label: "分时", title: "当日分时" },
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
];

export function isMinutePeriod(period) {
  return period in MINUTE_PERIOD;
}

export function isValidPeriod(period) {
  return Boolean(PERIOD_MAP[period]);
}
