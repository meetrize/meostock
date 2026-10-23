/**
 * K 线样式 / 默认设置（对齐 index.html chartStyles）
 */

export const DEFAULT_SETTINGS = {
  candleType: "candle_solid",
  lastPrice: true,
  highPrice: true,
  lowPrice: true,
  indLast: false,
  axisType: "normal",
  axisReverse: false,
  grid: true,
  hideYAxis: false,
};

/** 与 index.html #setCandleType 对齐 */
export const CANDLE_TYPES = [
  { value: "candle_solid", label: "全实心" },
  { value: "candle_stroke", label: "全空心" },
  { value: "candle_up_stroke", label: "涨空心" },
  { value: "candle_down_stroke", label: "跌空心" },
  { value: "ohlc", label: "OHLC" },
  { value: "area", label: "面积图" },
];

export const DEFAULT_MA = [5, 20, 120];
export const SETTING_KEY = "kline-chart-settings";
export const MA_KEY = "kline-ma-params";
export const THEME_KEY = "kline-theme";

export function loadChartSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTING_KEY) || "null");
    if (raw && typeof raw === "object") return { ...DEFAULT_SETTINGS, ...raw };
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
}

export function saveChartSettings(settings) {
  try {
    localStorage.setItem(SETTING_KEY, JSON.stringify(settings));
  } catch (_) {}
}

export function loadMaParams() {
  try {
    const raw = JSON.parse(localStorage.getItem(MA_KEY) || "null");
    if (Array.isArray(raw) && raw.some((n) => Number(n) > 0)) {
      return raw.map((n) => (n === "" || n == null ? "" : Number(n)));
    }
  } catch (_) {}
  return [...DEFAULT_MA, "", ""];
}

export function activeMaParams(maParams) {
  const list = (maParams || loadMaParams())
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? list : [...DEFAULT_MA];
}

/**
 * 多面板：名称/代码/行情叠在图左上角时，为 MA 行让出的高度。
 * KLineChart 在 candle+indicator 均为 standard 时，指标行起点用的是
 * candle.tooltip.offsetTop（candle 不显示时仍占这个 y），不是 indicator 的。
 */
const MULTIPANEL_CHROME_TOOLTIP_TOP = 42;

/**
 * @param {object} opts
 * @param {object} opts.settings
 * @param {string} opts.period
 * @param {boolean} [opts.multipanelChrome]  图上浮层标题，下移 MA
 */
export function buildChartStyles({ settings, period, multipanelChrome = false } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const up = "#F92855";
  const down = "#2DC08E";
  const upA = "rgba(249, 40, 85, 0.7)";
  const downA = "rgba(45, 192, 142, 0.7)";
  const hideY = !!s.hideYAxis;
  const tipTop = multipanelChrome ? MULTIPANEL_CHROME_TOOLTIP_TOP : 6;
  return {
    grid: {
      show: !!s.grid,
      horizontal: { show: !!s.grid },
      vertical: { show: !!s.grid },
    },
    yAxis: {
      show: !hideY,
    },
    candle: {
      type: period === "fs" ? "area" : s.candleType || "candle_solid",
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: "#888888",
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: "#888888",
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: "#888888",
      },
      area: {
        lineSize: 1.5,
        lineColor: "#2F6FED",
        smooth: false,
        value: "close",
        backgroundColor: [
          { offset: 0, color: "rgba(47, 111, 237, 0.28)" },
          { offset: 1, color: "rgba(47, 111, 237, 0.02)" },
        ],
        point: { show: false },
      },
      priceMark: {
        high: { show: period === "fs" ? false : !!s.highPrice },
        low: { show: period === "fs" ? false : !!s.lowPrice },
        last: {
          show: !!s.lastPrice,
          upColor: up,
          downColor: down,
          noChangeColor: "#888888",
        },
      },
      tooltip: {
        showRule: "none",
        showType: "standard",
        title: { show: false },
        offsetLeft: 4,
        // 决定主图 MA 行垂直起点（见上方注释）
        offsetTop: tipTop,
        offsetRight: 4,
        offsetBottom: 6,
      },
    },
    indicator: {
      tooltip: {
        showRule: "always",
        showType: "standard",
        offsetLeft: 4,
        offsetTop: tipTop,
        offsetRight: 4,
        offsetBottom: 6,
        text: { show: false },
      },
      lastValueMark: {
        show: !!s.indLast,
        text: { show: !!s.indLast },
      },
      ohlc: {
        upColor: upA,
        downColor: downA,
        noChangeColor: "#888888",
      },
      bars: [
        {
          upColor: upA,
          downColor: downA,
          noChangeColor: "#888888",
        },
      ],
    },
  };
}

export function applyYAxisOptions(chart, settings) {
  if (!chart || typeof chart.overrideYAxis !== "function") return;
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  try {
    chart.overrideYAxis({
      paneId: "candle_pane",
      type: s.axisType || "normal",
      reverse: !!s.axisReverse,
      show: !s.hideYAxis,
    });
  } catch (_) {}
}
