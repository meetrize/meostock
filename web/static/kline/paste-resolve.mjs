/**
 * 粘贴文本 → 抽取 token；多面板 URL / sessionStorage 交接
 */

const NOISE = new Set([
  "股票",
  "概念",
  "板块",
  "涨停",
  "跌停",
  "今日",
  "昨日",
  "今日涨停",
  "昨日涨停",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "代码",
  "名称",
  "现价",
  "涨幅",
  "跌幅",
  "成交额",
  "换手",
  "市值",
  "连板",
  "首板",
  "二板",
  "三板",
  "复盘",
  "选股",
  "关注",
  "还有",
  "以及",
  "或者",
  "其中",
  "包括",
  "相关",
  "分别",
  "目前",
  "盘中",
  "尾盘",
  "早盘",
  "午盘",
  "行情",
  "个股",
  "标的",
  "列表",
  "如下",
]);

const CODE_TOKEN =
  /(?:^|[^A-Za-z0-9])((?:SH|SZ|BJ|SS)[-_]?)\d{6}(?:\.(?:SH|SZ|BJ|SS))?|\b\d{6}(?:\.(?:SH|SZ|BJ|SS))?\b/gi;
const CN_RUN = /[\u4e00-\u9fff]{2,24}/g;

export function extractTokens(text) {
  const raw = String(text || "");
  const out = [];
  const seen = new Set();

  function push(tok) {
    const t = String(tok || "").trim();
    if (!t || t.length > 32) return;
    if (NOISE.has(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  }

  /** 长中文串：整段 + 常见股名长度前缀（2–6），便于「华胜天成华为算力」拆出华胜天成 */
  function pushCnRun(run) {
    if (!run || NOISE.has(run)) return;
    push(run);
    const max = Math.min(run.length, 6);
    for (let len = max; len >= 2; len--) {
      push(run.slice(0, len));
    }
  }

  // 分隔片段优先
  for (const part of raw.split(/[\s,，、;；|/\\|]+/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^(?:sh|sz|bj|ss)?[-_]?\d{6}(?:\.(?:sh|sz|bj|ss))?$/i.test(p)) {
      push(p);
      continue;
    }
    if (/^[\u4e00-\u9fff]{2,24}$/.test(p)) {
      pushCnRun(p);
    }
  }

  let m;
  const codeRe = new RegExp(CODE_TOKEN.source, "gi");
  while ((m = codeRe.exec(raw))) {
    const full = m[0].replace(/^[^A-Za-z0-9]+/, "");
    push(full);
  }
  const nameRe = new RegExp(CN_RUN.source, "g");
  while ((m = nameRe.exec(raw))) {
    pushCnRun(m[0]);
  }

  return out.slice(0, 500);
}

export function pickMultipanelLayout(count) {
  const n = Math.max(0, Math.floor(count));
  if (n <= 1) return "1x1";
  if (n === 2) return "1x2";
  if (n === 3) return "1+2";
  if (n <= 4) return "2x2";
  if (n <= 6) return "2x3";
  return "3x3";
}

const MP_STORAGE_KEY = "mp_symbols";
const PASTE_CACHE_KEY = "kline_paste_resolve_cache";

export function getMpStorageKey() {
  return MP_STORAGE_KEY;
}

export function getPasteCacheKey() {
  return PASTE_CACHE_KEY;
}

export function buildMultipanelUrl(symbols, options = {}) {
  const max = Math.min(500, Math.max(1, options.max ?? 200));
  const list = [
    ...new Set(
      (symbols || []).map((s) => String(s || "").trim()).filter(Boolean)
    ),
  ].slice(0, max);
  const layout =
    options.layout || pickMultipanelLayout(Math.min(list.length || 1, 9));
  const period = options.period || "1d";
  const qs = new URLSearchParams();
  qs.set("layout", layout);
  qs.set("period", period);
  const joined = list.join(",");
  // URL 过长时用 sessionStorage 交接
  if (joined.length > 1500) {
    try {
      sessionStorage.setItem(MP_STORAGE_KEY, JSON.stringify(list));
      qs.set("from", "paste");
    } catch (_) {
      qs.set("symbols", joined.slice(0, 1500));
    }
  } else if (list.length) {
    qs.set("symbols", joined);
  }
  return `/multipanel?${qs.toString()}`;
}

export function openMultipanel(symbols, options = {}) {
  const url = buildMultipanelUrl(symbols, options);
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export function confidenceLabel(c) {
  switch (c) {
    case "exact_code":
      return "精确代码";
    case "exact_name":
      return "名称唯一";
    case "fuzzy":
      return "模糊/多候选";
    default:
      return "未命中";
  }
}

export function isHighConfidence(c) {
  return c === "exact_code" || c === "exact_name";
}
