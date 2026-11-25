/**
 * 形态回测信号日标记（klinecharts custom overlay）
 * - 信号日竖向高亮带 + 虚线 + 「信号」标签
 * - X 轴日期胶囊高亮
 * - 可选窗口起止半透明区间
 */

export const PATTERN_SIGNAL_OVERLAY = "patternSignalMark";

let registered = false;

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
      const figures = [];

      const gap =
        typeof barSpace === "number"
          ? barSpace
          : Number(barSpace?.gapBar ?? barSpace?.bar) || 6;
      const half = Math.max(2, gap * 0.45);

      // 齐升窗口半透明带（两点：window_start → signal）
      if (coordinates.length >= 2) {
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
      // 信号日柱位加粗高亮
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

      const textSize = 10;
      const padX = 6;
      const pillH = 18;
      const pillW = Math.max(pillH, label.length * textSize + padX * 2);
      const tipY = sig.y - 36;
      const pillBottom = tipY - 5;
      const labelCenterY = pillBottom - pillH / 2;
      const pillTop = pillBottom - pillH;

      figures.push(
        {
          type: "line",
          attrs: {
            coordinates: [
              { x: sig.x, y: sig.y - 4 },
              { x: sig.x, y: tipY },
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
            x: sig.x - pillW / 2,
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
          ignoreEvent: true,
        },
        {
          type: "text",
          attrs: {
            x: sig.x,
            y: labelCenterY - 2,
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
    createXAxisFigures: ({ overlay, coordinates }) => {
      if (!coordinates?.length) return [];
      const ext = overlay.extendData || {};
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
  let windowBar = null;
  const windowStart = String(opts?.windowStart || "").trim().slice(0, 10);
  const wantWindow = /^\d{4}-\d{2}-\d{2}$/.test(windowStart) && windowStart < signalDate;

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const day = barDayKey(b?.timestamp);
    if (day === signalDate) signalBar = b;
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

  try {
    const id = chart.createOverlay({
      name: PATTERN_SIGNAL_OVERLAY,
      id: oid,
      paneId: "candle_pane",
      lock: true,
      points,
      extendData: {
        label: opts?.label || "信号",
        color: opts?.color || "#2563eb",
        tradeDate: signalDate,
        windowStart: wantWindow ? windowStart : "",
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
