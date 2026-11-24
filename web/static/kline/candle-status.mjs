/**
 * 日 K 涨跌停 / 一字板状态着色（与 index.html 单图逻辑对齐）
 */
import { DEFAULT_SETTINGS } from "./styles.mjs";

export const CANDLE_STATUS_NAME = "CANDLE_STATUS";
const CYB_20PCT_SINCE = Date.parse("2020-08-24T00:00:00+08:00");

/** @type {WeakMap<object, { id: string|null, ver: number }>} */
const chartState = new WeakMap();

let registered = false;

export function extractAshareCode(symbol) {
  const s = String(symbol || "").trim().toLowerCase();
  const m = s.match(/(\d{6})/);
  return m ? m[1] : "";
}

/** 仅 A 股个股参与涨跌停着色（指数等跳过） */
export function isAshareStockSymbol(symbol, market) {
  const mkt = String(market || "").toUpperCase();
  if (mkt && mkt !== "CN") return false;
  const s = String(symbol || "").trim().toLowerCase();
  const code = extractAshareCode(s);
  if (!code || code.length !== 6) return false;
  if (code.startsWith("399")) return false;
  if (s.startsWith("sh") && code.startsWith("000")) return false;
  return /^(60|68|00|30|4|8)/.test(code);
}

function isBjStock(symbol, code) {
  const s = String(symbol || "").trim().toLowerCase();
  if (s.startsWith("bj")) return true;
  const c = code || extractAshareCode(s);
  return /^(4|8)\d{5}$/.test(c);
}

export function resolveCnLimitRate(symbol, name, timestamp) {
  const nm = String(name || "");
  if (/ST/i.test(nm)) return 0.05;
  const code = extractAshareCode(symbol);
  if (isBjStock(symbol, code)) return 0.3;
  if (/^688|^689/.test(code)) return 0.2;
  if (/^300|^301/.test(code)) {
    const ts = Number(timestamp);
    if (Number.isFinite(ts) && ts < CYB_20PCT_SINCE) return 0.1;
    return 0.2;
  }
  return 0.1;
}

function roundLimitPrice(prevClose, rate) {
  const p = Number(prevClose);
  const r = Number(rate);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(r)) return null;
  return Math.round(p * (1 + r) * 100) / 100;
}

function priceEqFen(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.round(x * 100) === Math.round(y * 100);
}

export function isOneWordBar(k) {
  return (
    priceEqFen(k.open, k.close) &&
    priceEqFen(k.open, k.high) &&
    priceEqFen(k.open, k.low)
  );
}

/**
 * @returns {'oneWordUp'|'limitUp'|'oneWordDown'|'limitDown'|null}
 */
export function classifyCandleStatus(k, prevClose, timestamp, symbol, name) {
  if (!k || !isAshareStockSymbol(symbol)) return null;
  const prev = Number(prevClose);
  if (!Number.isFinite(prev) || prev <= 0) return null;
  const close = Number(k.close);
  if (!Number.isFinite(close)) return null;
  const rate = resolveCnLimitRate(symbol, name, timestamp ?? k.timestamp);
  const limitUp = roundLimitPrice(prev, rate);
  const limitDown = roundLimitPrice(prev, -rate);
  if (limitUp == null || limitDown == null) return null;
  const hitUp = close + 1e-8 >= limitUp;
  const hitDown = close - 1e-8 <= limitDown;
  if (hitUp) return isOneWordBar(k) ? "oneWordUp" : "limitUp";
  if (hitDown) return isOneWordBar(k) ? "oneWordDown" : "limitDown";
  return null;
}

export function resolveStatusDrawColor(kind, s = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...s };
  if (!kind) return null;
  if (kind === "oneWordUp") {
    if (cfg.statusOneWordUp) return cfg.colorOneWordUp || DEFAULT_SETTINGS.colorOneWordUp;
    if (cfg.statusLimitUp) return cfg.colorLimitUp || DEFAULT_SETTINGS.colorLimitUp;
    return null;
  }
  if (kind === "oneWordDown") {
    if (cfg.statusOneWordDown) {
      return cfg.colorOneWordDown || DEFAULT_SETTINGS.colorOneWordDown;
    }
    if (cfg.statusLimitDown) return cfg.colorLimitDown || DEFAULT_SETTINGS.colorLimitDown;
    return null;
  }
  if (kind === "limitUp" && cfg.statusLimitUp) {
    return cfg.colorLimitUp || DEFAULT_SETTINGS.colorLimitUp;
  }
  if (kind === "limitDown" && cfg.statusLimitDown) {
    return cfg.colorLimitDown || DEFAULT_SETTINGS.colorLimitDown;
  }
  return null;
}

export function packStatusSettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  return {
    statusLimitUp: !!s.statusLimitUp,
    statusLimitDown: !!s.statusLimitDown,
    statusOneWordUp: !!s.statusOneWordUp,
    statusOneWordDown: !!s.statusOneWordDown,
    colorLimitUp: s.colorLimitUp || DEFAULT_SETTINGS.colorLimitUp,
    colorLimitDown: s.colorLimitDown || DEFAULT_SETTINGS.colorLimitDown,
    colorOneWordUp: s.colorOneWordUp || DEFAULT_SETTINGS.colorOneWordUp,
    colorOneWordDown: s.colorOneWordDown || DEFAULT_SETTINGS.colorOneWordDown,
  };
}

/**
 * @param {(def: object) => void} registerIndicator klinecharts.registerIndicator
 */
export function ensureCandleStatusIndicator(registerIndicator) {
  if (registered) return;
  if (typeof registerIndicator !== "function") return;
  registerIndicator({
    name: CANDLE_STATUS_NAME,
    shortName: "",
    series: "price",
    precision: 2,
    figures: [],
    calcParams: [1],
    createTooltipDataSource: () => ({
      name: "",
      calcParamsText: "",
      values: [],
      features: [],
    }),
    calc: (dataList, indicator) => {
      const pack = indicator.extendData || {};
      const symbol = pack.symbol || "";
      const name = pack.name || "";
      const period = pack.period || "";
      const market = pack.market || "";
      const s = { ...DEFAULT_SETTINGS, ...(pack.settings || {}) };
      if (period !== "1d" || !isAshareStockSymbol(symbol, market)) {
        return (dataList || []).map(() => ({}));
      }
      return (dataList || []).map((bar, i) => {
        const prev = i > 0 ? dataList[i - 1]?.close : null;
        const kind = classifyCandleStatus(bar, prev, bar?.timestamp, symbol, name);
        const color = resolveStatusDrawColor(kind, s);
        if (!color) return {};
        return { kind, color };
      });
    },
    draw: ({ ctx, chart: c, indicator, xAxis, yAxis }) => {
      if (!ctx || !c || !xAxis || !yAxis) return false;
      const result = indicator?.result || [];
      if (!result.length) return false;
      const dataList = c.getDataList?.() || [];
      const range = c.getVisibleRange?.() || { from: 0, to: dataList.length };
      const barSpace = c.getBarSpace?.() || {};
      const halfGap =
        Number(barSpace.halfGapBar) ||
        (Number(barSpace.gapBar) ? Number(barSpace.gapBar) / 2 : 3);
      const pack = indicator.extendData || {};
      const candleType = pack.candleType || "candle_solid";
      if (candleType === "area") return false;

      const from = Math.max(0, Math.floor(Number(range.from) || 0));
      const to = Math.min(
        dataList.length - 1,
        Math.ceil(Number(range.to) || dataList.length - 1)
      );

      for (let i = from; i <= to; i++) {
        const tag = result[i];
        const color = tag?.color;
        if (!color) continue;
        const k = dataList[i];
        if (!k || !Number.isFinite(Number(k.close))) continue;
        const o = Number(k.open);
        const h = Number(k.high);
        const l = Number(k.low);
        const cl = Number(k.close);
        if (![o, h, l, cl].every(Number.isFinite)) continue;

        const x = xAxis.convertToPixel(i);
        if (!Number.isFinite(x)) continue;
        const yO = yAxis.convertToPixel(o);
        const yC = yAxis.convertToPixel(cl);
        const yH = yAxis.convertToPixel(h);
        const yL = yAxis.convertToPixel(l);
        if (![yO, yC, yH, yL].every(Number.isFinite)) continue;

        const bodyTop = Math.min(yO, yC);
        const bodyBottom = Math.max(yO, yC);
        const bodyH = Math.max(1, bodyBottom - bodyTop);
        const wickX = Math.round(x) + 0.5;
        const left = Math.round(x - halfGap);
        const width = Math.max(1, Math.round(halfGap * 2));

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wickX, yH);
        ctx.lineTo(wickX, yL);
        ctx.stroke();
        const strokeOnly =
          candleType === "candle_stroke" ||
          (candleType === "candle_up_stroke" && cl >= o) ||
          (candleType === "candle_down_stroke" && cl < o);
        if (strokeOnly || candleType === "ohlc") {
          if (candleType === "ohlc") {
            ctx.beginPath();
            ctx.moveTo(left, yO);
            ctx.lineTo(wickX, yO);
            ctx.moveTo(wickX, yC);
            ctx.lineTo(left + width, yC);
            ctx.moveTo(wickX, yH);
            ctx.lineTo(wickX, yL);
            ctx.stroke();
          } else {
            ctx.strokeRect(left + 0.5, bodyTop + 0.5, Math.max(1, width - 1), bodyH);
          }
        } else {
          ctx.fillRect(left, bodyTop, width, bodyH);
        }
        ctx.restore();
      }
      return false;
    },
  });
  registered = true;
}

/**
 * 在指定 chart 上挂载/刷新状态着色
 * @param {object} chart
 * @param {{ symbol: string, name?: string, period: string, market?: string, settings?: object, candleType?: string }} pack
 * @param {(def: object) => void} [registerIndicator]
 */
export function refreshCandleStatusOnChart(chart, pack, registerIndicator) {
  if (!chart) return;
  if (typeof registerIndicator === "function") {
    ensureCandleStatusIndicator(registerIndicator);
  } else if (!registered) {
    return;
  }

  let st = chartState.get(chart);
  if (!st) {
    st = { id: null, ver: 1 };
    chartState.set(chart, st);
  }
  st.ver += 1;
  const extendData = {
    symbol: pack.symbol || "",
    name: pack.name || "",
    period: pack.period || "",
    market: pack.market || "",
    candleType: pack.candleType || pack.settings?.candleType || "candle_solid",
    settings: packStatusSettings(pack.settings),
  };
  const calcParams = [st.ver];
  try {
    // 清掉误建到独立副图的实例（会多出第三栏）
    try {
      const inds = chart.getIndicators?.() || [];
      for (const ind of inds) {
        if (ind?.name !== CANDLE_STATUS_NAME) continue;
        const paneId = ind.paneId || "";
        if (paneId && paneId !== "candle_pane") {
          try {
            chart.removeIndicator({ id: ind.id });
          } catch (_) {
            try {
              chart.removeIndicator({ paneId, name: CANDLE_STATUS_NAME });
            } catch (_) {}
          }
          if (st.id === ind.id) st.id = null;
        }
      }
    } catch (_) {}

    if (st.id) {
      chart.overrideIndicator({
        id: st.id,
        calcParams,
        extendData,
        visible: true,
      });
      return;
    }
    const existing = (chart.getIndicators?.() || []).find(
      (ind) =>
        ind.name === CANDLE_STATUS_NAME &&
        (!ind.paneId || ind.paneId === "candle_pane")
    );
    if (existing?.id) {
      st.id = existing.id;
      chart.overrideIndicator({
        id: st.id,
        calcParams,
        extendData,
        visible: true,
      });
      return;
    }
    // 与单图一致：paneId 写进配置 + isStack=true，叠在主图而非新开副图
    const id = chart.createIndicator(
      {
        name: CANDLE_STATUS_NAME,
        paneId: "candle_pane",
        calcParams,
        extendData,
        visible: true,
        createTooltipDataSource: () => ({
          name: "",
          calcParamsText: "",
          values: [],
          features: [],
        }),
      },
      true
    );
    if (id) st.id = id;
  } catch (e) {
    console.warn("refreshCandleStatusOnChart", e);
  }
}
