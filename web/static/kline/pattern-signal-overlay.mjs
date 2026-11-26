/**
 * 形态/公告信号日标记（klinecharts custom overlay）
 * - 默认：标签贴蜡烛面板顶边下方 + 短引线到 K 线高点（不画全日蓝色竖向高亮）
 * - stack：垂直错层，避免与邻近顶部标签重叠
 * - 可选窗口半透明带（形态回测 windowStart）
 * - 标签可悬停，由调用方挂 tip
 */

export const PATTERN_SIGNAL_OVERLAY = "patternSignalMark";

export const SIGNAL_CHIP_TOP_INSET = 6;
export const SIGNAL_CHIP_PILL_H = 18;
export const SIGNAL_CHIP_STACK_GAP = 6;
export const SIGNAL_CHIP_TEXT_SIZE = 10;
export const SIGNAL_CHIP_PAD_X = 6;

let registered = false;

export function signalChipWidth(label = "信号") {
  const text = String(label || "信号");
  const textW = Math.max(18, text.length * SIGNAL_CHIP_TEXT_SIZE * 0.92);
  return SIGNAL_CHIP_PAD_X * 2 + textW;
}

/**
 * 按柱宽估算水平碰撞，邻近标签向下错层
 * @param {Array<{ barIndex: number, w: number, stack?: number }>} candidates 会原地写入 stack
 * @param {number} barSpace
 * @param {Array<{ barIndex: number, w: number, stack: number }>} [occupied] 已占用的其它顶部标签
 */
export function assignTopChipStacks(candidates, barSpace, occupied = []) {
  const gap = 6;
  const bs = Math.max(4, Number(barSpace) || 8);
  const placed = (occupied || []).map((p) => ({
    barIndex: Number(p.barIndex) || 0,
    w: Number(p.w) || 24,
    stack: Math.max(0, Number(p.stack) || 0),
  }));
  const list = Array.isArray(candidates) ? candidates : [];
  list.forEach((c) => {
    let stack = 0;
    for (;;) {
      const hit = placed.some((p) => {
        if (p.stack !== stack) return false;
        const dx = Math.abs(p.barIndex - c.barIndex) * bs;
        return dx < (p.w + c.w) / 2 + gap;
      });
      if (!hit) break;
      stack += 1;
      if (stack > 12) break;
    }
    c.stack = stack;
    placed.push({
      barIndex: Number(c.barIndex) || 0,
      w: Number(c.w) || 24,
      stack,
    });
  });
  return list;
}

/**
 * @param {(def: object) => void} registerOverlay
 */
export function ensurePatternSignalOverlay(registerOverlay) {
  if (registered || typeof registerOverlay !== "function") return;
  registerOverlay({
    name: PATTERN_SIGNAL_OVERLAY,
    totalStep: 3,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding, barSpace }) => {
      if (!coordinates?.length || !bounding) return [];
      const ext = overlay.extendData || {};
      const color = String(ext.color || "#2563eb");
      const label = String(ext.label || "信号");
      const showBand = Boolean(ext.showBand);
      const showWindow = Boolean(ext.showWindow);
      const stack = Math.max(0, Number(ext.stack) || 0);
      const figures = [];

      const gap =
        typeof barSpace === "number"
          ? barSpace
          : Number(barSpace?.gapBar ?? barSpace?.bar) || 6;
      const half = Math.max(2, gap * 0.45);

      // 齐升窗口半透明带（仅形态回测显式开启）
      if (showWindow && coordinates.length >= 2) {
        const x1 = Math.min(coordinates[0].x, coordinates[1].x);
        const x2 = Math.max(coordinates[0].x, coordinates[1].x);
        figures.push({
          type: "rect",
          attrs: {
            x: x1 - half,
            y: bounding.top,
            width: Math.max(half * 2, x2 - x1 + half * 2),
            height: bounding.height,
          },
          styles: {
            style: "fill",
            color: "rgba(37, 99, 235, 0.08)",
          },
          ignoreEvent: true,
        });
      }

      const sig = coordinates[coordinates.length - 1];

      // 旧样式：全日蓝色竖向高亮（默认关闭）
      if (showBand) {
        figures.push({
          type: "rect",
          attrs: {
            x: sig.x - half,
            y: bounding.top,
            width: half * 2,
            height: bounding.height,
          },
          styles: {
            style: "fill",
            color: "rgba(37, 99, 235, 0.18)",
          },
          ignoreEvent: true,
        });
        figures.push({
          type: "line",
          attrs: {
            coordinates: [
              { x: sig.x, y: bounding.top },
              { x: sig.x, y: bounding.top + bounding.height },
            ],
          },
          styles: {
            style: "dashed",
            color,
            size: 1,
            dashedValue: [4, 3],
          },
          ignoreEvent: true,
        });
      }

      const textSize = SIGNAL_CHIP_TEXT_SIZE;
      const pillH = SIGNAL_CHIP_PILL_H;
      const pillW = signalChipWidth(label);
      // 贴蜡烛面板顶边下方；stack 向下错层，避免与邻近标签重叠
      const paneTop = Number.isFinite(bounding?.top) ? bounding.top : 0;
      const pillTop =
        paneTop + SIGNAL_CHIP_TOP_INSET + stack * (pillH + SIGNAL_CHIP_STACK_GAP);
      const pillBottom = pillTop + pillH;
      const pillLeft = sig.x - pillW / 2;
      const tipY = pillBottom + 2;
      const labelCenterY = pillTop + pillH / 2 - 2;
      const candleY = sig.y;

      figures.push(
        {
          type: "line",
          attrs: {
            coordinates: [
              { x: sig.x, y: tipY },
              { x: sig.x, y: candleY },
            ],
          },
          styles: { style: "dashed", color, size: 1, dashedValue: [3, 3] },
          ignoreEvent: true,
        },
        {
          type: "polygon",
          attrs: {
            coordinates: [
              { x: sig.x, y: tipY },
              { x: sig.x - 3.5, y: pillBottom },
              { x: sig.x + 3.5, y: pillBottom },
            ],
          },
          styles: { style: "fill", color },
          ignoreEvent: true,
        },
        {
          type: "rect",
          attrs: {
            x: pillLeft,
            y: pillTop,
            width: pillW,
            height: pillH,
          },
          styles: {
            style: "fill",
            color,
            borderRadius: 4,
            borderSize: 0,
          },
          // 可悬停/点击
        },
        {
          type: "text",
          attrs: {
            x: sig.x,
            y: labelCenterY,
            text: label,
            align: "center",
            baseline: "middle",
          },
          styles: {
            color: "#FFFFFF",
            size: textSize,
            family: "PingFang SC, Microsoft YaHei, sans-serif",
            weight: "600",
            backgroundColor: "transparent",
            borderSize: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
          },
          ignoreEvent: true,
        }
      );
      return figures;
    },
    // 默认不在 X 轴再画蓝色日期胶囊，避免「整日高亮」观感
    createXAxisFigures: ({ overlay, coordinates }) => {
      const ext = overlay.extendData || {};
      if (!ext.showAxisMark || !coordinates?.length) return [];
      const color = String(ext.color || "#2563eb");
      const ymd = String(ext.tradeDate || "").trim();
      const text = ymd.length >= 10 ? ymd.slice(5) : String(ext.label || "信号");
      const sig = coordinates[coordinates.length - 1];
      return [
        {
          type: "text",
          attrs: {
            x: sig.x,
            y: sig.y,
            text,
            align: "center",
            baseline: "top",
          },
          styles: {
            color: "#FFFFFF",
            size: 10,
            family: "PingFang SC, Microsoft YaHei, sans-serif",
            weight: "600",
            backgroundColor: color,
            borderRadius: 3,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
          },
          ignoreEvent: true,
        },
      ];
    },
  });
  registered = true;
}

/**
 * @param {object} chart
 * @param {{
 *   signalDate: string,
 *   windowStart?: string,
 *   barDayKey: (ts: any) => string,
 *   label?: string,
 *   color?: string,
 *   overlayId?: string,
 *   showBand?: boolean,
 *   showWindow?: boolean,
 *   showAxisMark?: boolean,
 *   stack?: number,
 *   occupied?: Array<{ barIndex: number, w: number, stack: number }>,
 *   tip?: Record<string, any>,
 *   onMouseEnter?: (event: any, tip: any) => void,
 *   onMouseLeave?: (event: any) => void,
 *   onClick?: (event: any, tip: any) => boolean | void,
 * }} opts
 * @returns {string|null} overlay id
 */
export function placePatternSignalMark(chart, opts) {
  if (!chart || typeof chart.createOverlay !== "function") return null;
  const signalDate = String(opts?.signalDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) return null;
  const barDayKey = opts.barDayKey;
  if (typeof barDayKey !== "function") return null;

  const list = chart.getDataList?.() || [];
  let signalBar = null;
  let signalBarIndex = -1;
  let windowBar = null;
  const windowStart = String(opts?.windowStart || "").trim().slice(0, 10);
  const wantWindow =
    Boolean(opts?.showWindow) &&
    /^\d{4}-\d{2}-\d{2}$/.test(windowStart) &&
    windowStart < signalDate;

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const day = barDayKey(b?.timestamp);
    if (day === signalDate) {
      signalBar = b;
      signalBarIndex = i;
    }
    if (wantWindow && day === windowStart) windowBar = b;
  }
  if (!signalBar || !Number.isFinite(Number(signalBar.timestamp))) return null;

  const high = Number(signalBar.high);
  const close = Number(signalBar.close);
  const value = Number.isFinite(high) ? high : Number.isFinite(close) ? close : null;
  if (value == null) return null;

  const oid = String(opts?.overlayId || "pattern_signal_mark");
  try {
    chart.removeOverlay?.({ id: oid });
  } catch (_) {}

  const points = [];
  if (wantWindow && windowBar && Number.isFinite(Number(windowBar.timestamp))) {
    const wh = Number(windowBar.high);
    const wc = Number(windowBar.close);
    const wv = Number.isFinite(wh) ? wh : Number.isFinite(wc) ? wc : value;
    points.push({ timestamp: Number(windowBar.timestamp), value: wv });
  }
  points.push({ timestamp: Number(signalBar.timestamp), value });

  const label = opts?.label || "信号";
  let stack = Math.max(0, Number(opts?.stack) || 0);
  if (opts?.stack == null && signalBarIndex >= 0) {
    const barSpace =
      Number(chart.getBarSpace?.()?.bar) ||
      Number(chart.getBarSpace?.()?.gapBar) ||
      8;
    const cand = [{ barIndex: signalBarIndex, w: signalChipWidth(label), stack: 0 }];
    assignTopChipStacks(cand, barSpace, opts?.occupied || []);
    stack = cand[0].stack;
  }

  const tip = opts?.tip && typeof opts.tip === "object" ? opts.tip : null;
  const ext = {
    label,
    color: opts?.color || "#2563eb",
    tradeDate: signalDate,
    windowStart: wantWindow ? windowStart : "",
    showBand: Boolean(opts?.showBand),
    showWindow: wantWindow,
    showAxisMark: Boolean(opts?.showAxisMark),
    stack,
    tip,
  };

  try {
    const id = chart.createOverlay({
      name: PATTERN_SIGNAL_OVERLAY,
      id: oid,
      paneId: "candle_pane",
      lock: true,
      points,
      extendData: ext,
      onMouseEnter: (event) => {
        try {
          opts?.onMouseEnter?.(event, event?.overlay?.extendData?.tip || tip || ext);
        } catch (_) {}
        return false;
      },
      onMouseLeave: (event) => {
        try {
          opts?.onMouseLeave?.(event);
        } catch (_) {}
        return false;
      },
      onClick: (event) => {
        try {
          const r = opts?.onClick?.(event, event?.overlay?.extendData?.tip || tip || ext);
          if (r === true) return true;
        } catch (_) {}
        return true;
      },
      onRightClick: (event) => {
        event?.preventDefault?.();
        return true;
      },
    });
    return id || oid;
  } catch (_) {
    return null;
  }
}

export function clearPatternSignalMark(chart, overlayId = "pattern_signal_mark") {
  if (!chart) return;
  try {
    chart.removeOverlay?.({ id: overlayId });
  } catch (_) {}
}
