/**
 * 多面板布局预设 + 自定义行列
 */

export const LAYOUT_PRESETS = [
  {
    id: "1x1",
    label: "1×1",
    slots: 1,
    style: { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" },
  },
  {
    id: "1x2",
    label: "1×2",
    slots: 2,
    style: { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" },
  },
  {
    id: "2x1",
    label: "2×1",
    slots: 2,
    style: { gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr" },
  },
  {
    id: "2x2",
    label: "2×2",
    slots: 4,
    style: { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" },
  },
  {
    id: "2x3",
    label: "2×3",
    slots: 6,
    style: { gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr" },
  },
  {
    id: "3x3",
    label: "3×3",
    slots: 9,
    style: {
      gridTemplateColumns: "1fr 1fr 1fr",
      gridTemplateRows: "1fr 1fr 1fr",
    },
  },
  {
    id: "1+2",
    label: "1大+2",
    slots: 3,
    style: {
      gridTemplateColumns: "1.4fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gridTemplateAreas: `"a b" "a c"`,
    },
    areas: ["a", "b", "c"],
  },
  {
    id: "2+1",
    label: "上2下1",
    slots: 3,
    style: {
      gridTemplateColumns: "1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gridTemplateAreas: `"a b" "c c"`,
    },
    areas: ["a", "b", "c"],
  },
];

const CUSTOM_KEY = "kline-multipanel-layouts";
const MAX_DIM = 4;

export function clampDim(n) {
  const v = Math.floor(Number(n) || 1);
  return Math.min(MAX_DIM, Math.max(1, v));
}

export function customLayoutId(rows, cols) {
  return `${clampDim(rows)}x${clampDim(cols)}`;
}

export function makeGridLayout(rows, cols) {
  const r = clampDim(rows);
  const c = clampDim(cols);
  return {
    id: customLayoutId(r, c),
    label: `${r}×${c}`,
    slots: r * c,
    rows: r,
    cols: c,
    custom: true,
    style: {
      gridTemplateColumns: Array(c).fill("1fr").join(" "),
      gridTemplateRows: Array(r).fill("1fr").join(" "),
    },
  };
}

export function findPreset(id) {
  return LAYOUT_PRESETS.find((p) => p.id === id) || null;
}

/**
 * 解析 layout 参数：预设 id、RxC、或自定义 id
 * @param {string} id
 * @param {{rows?:number,cols?:number,name?:string}[]} [customs]
 */
export function resolveLayout(id, customs = []) {
  const raw = String(id || "").trim() || "2x2";
  const preset = findPreset(raw);
  if (preset) return { ...preset };

  const custom = (customs || []).find((c) => c.id === raw);
  if (custom) {
    return makeGridLayout(custom.rows, custom.cols);
  }

  const m = raw.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (m) return makeGridLayout(m[1], m[2]);

  return { ...findPreset("2x2") };
}

export function loadCustomLayouts() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((it) => ({
        id: String(it.id || customLayoutId(it.rows, it.cols)),
        name: String(it.name || "").trim() || `${it.rows}×${it.cols}`,
        rows: clampDim(it.rows),
        cols: clampDim(it.cols),
      }))
      .filter((it) => it.rows >= 1 && it.cols >= 1);
  } catch (_) {
    return [];
  }
}

export function saveCustomLayouts(list) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list || []));
  } catch (_) {}
}

export function upsertCustomLayout({ name, rows, cols }) {
  const r = clampDim(rows);
  const c = clampDim(cols);
  const id = `c-${r}x${c}-${Date.now().toString(36)}`;
  const list = loadCustomLayouts();
  const item = {
    id,
    name: String(name || "").trim() || `自定义 ${r}×${c}`,
    rows: r,
    cols: c,
  };
  list.push(item);
  saveCustomLayouts(list);
  return item;
}

/**
 * 把 layout.style 应用到 grid 元素
 * @param {HTMLElement} el
 * @param {ReturnType<typeof resolveLayout>} layout
 */
export function applyLayoutToGrid(el, layout) {
  if (!el || !layout) return;
  el.style.gridTemplateColumns = layout.style.gridTemplateColumns || "";
  el.style.gridTemplateRows = layout.style.gridTemplateRows || "";
  el.style.gridTemplateAreas = layout.style.gridTemplateAreas || "";
}

/**
 * 为第 i 个单元格设置 gridArea（不规则预设）
 */
export function cellAreaStyle(layout, index) {
  if (layout?.areas?.[index]) {
    return { gridArea: layout.areas[index] };
  }
  return {};
}
