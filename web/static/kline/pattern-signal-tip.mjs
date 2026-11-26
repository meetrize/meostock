/**
 * K 线「信号」标签悬停 tip（公告摘要等）
 * localStorage 交接（noopener 新标签不可用 sessionStorage）
 */

export const SIGNAL_TIP_STORE_KEY = "kline_signal_tips_v1";
export const SIGNAL_TIP_TTL_MS = 24 * 60 * 60 * 1000;

/** @param {string} symbol @param {string} dateYmd */
export function signalTipKey(symbol, dateYmd) {
  const sym = String(symbol || "")
    .trim()
    .toLowerCase();
  const day = String(dateYmd || "")
    .trim()
    .slice(0, 10);
  return `${sym}|${day}`;
}

/** @param {any} tip */
export function normalizeSignalTip(tip) {
  if (!tip || typeof tip !== "object") return null;
  const date = String(tip.date || "").trim().slice(0, 10);
  const symbol = String(tip.symbol || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && !symbol) return null;
  return {
    symbol,
    date,
    title: String(tip.title || "").trim(),
    stockName: String(tip.stockName || tip.stock_name || "").trim(),
    level: String(tip.level || tip.final_level || "").trim(),
    levelLabel: String(tip.levelLabel || tip.final_level_label || "").trim(),
    direction: String(tip.direction || "").trim(),
    score: Number.isFinite(Number(tip.score)) ? Number(tip.score) : null,
    summary: String(tip.summary || tip.core_summary || "").trim(),
    reasons: Array.isArray(tip.reasons)
      ? tip.reasons.map((r) => String(r || "").trim()).filter(Boolean)
      : [],
    ts: Number(tip.ts) || Date.now(),
  };
}

function readStore() {
  try {
    const raw = localStorage.getItem(SIGNAL_TIP_STORE_KEY);
    if (!raw) return { v: 1, tips: {}, ts: Date.now() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { v: 1, tips: {}, ts: Date.now() };
    const tips = parsed.tips && typeof parsed.tips === "object" ? parsed.tips : {};
    return { v: 1, tips, ts: Number(parsed.ts) || Date.now() };
  } catch (_) {
    return { v: 1, tips: {}, ts: Date.now() };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(SIGNAL_TIP_STORE_KEY, JSON.stringify(store));
  } catch (_) {}
}

export function pruneExpiredSignalTips(now = Date.now()) {
  const store = readStore();
  let changed = false;
  for (const k of Object.keys(store.tips || {})) {
    const tip = store.tips[k];
    const ts = Number(tip?.ts) || 0;
    if (!ts || now - ts > SIGNAL_TIP_TTL_MS) {
      delete store.tips[k];
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

/** @param {any|any[]} tips */
export function writeSignalTips(tips) {
  const list = Array.isArray(tips) ? tips : [tips];
  const store = readStore();
  const now = Date.now();
  for (const raw of list) {
    const tip = normalizeSignalTip({ ...raw, ts: now });
    if (!tip) continue;
    const key = signalTipKey(tip.symbol, tip.date);
    if (!key.includes("|") || key.endsWith("|") || key.startsWith("|")) continue;
    store.tips[key] = tip;
  }
  store.ts = now;
  writeStore(store);
  pruneExpiredSignalTips(now);
}

/** @param {string} symbol @param {string} dateYmd */
export function readSignalTip(symbol, dateYmd) {
  pruneExpiredSignalTips();
  const key = signalTipKey(symbol, dateYmd);
  const tip = readStore().tips?.[key];
  return normalizeSignalTip(tip);
}

function codeOfSymbol(symbol) {
  const s = String(symbol || "").trim();
  const m = s.match(/(\d{6})$/);
  return m ? m[1] : s.replace(/^(sh|sz|bj)/i, "").slice(-6);
}

function dirLabel(direction) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  if (direction === "mixed") return "混合";
  if (direction === "neutral") return "中性";
  return direction || "";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 从公告影响力 API 补全 tip（缓存未命中时） */
export async function fetchSignalTipFromImpact(symbol, dateYmd) {
  const code = codeOfSymbol(symbol);
  const day = String(dateYmd || "").trim().slice(0, 10);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  try {
    const qs = new URLSearchParams({
      code,
      days: "90",
      levels: "XL,L,M,S",
      limit: "40",
      hide_small: "0",
    });
    const res = await fetch(`/api/cninfo/impact/list?${qs}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return null;
    const items = Array.isArray(data.items) ? data.items : [];
    const hit =
      items.find((it) => String(it?.announce_time || "").slice(0, 10) === day) ||
      items[0];
    if (!hit) return null;
    const tip = normalizeSignalTip({
      symbol,
      date: day,
      title: hit.title,
      stockName: hit.stock_name,
      level: hit.final_level,
      levelLabel: hit.final_level_label,
      direction: hit.direction,
      score: hit.score,
      summary: hit.core_summary,
      reasons: hit.reasons,
    });
    if (tip) writeSignalTips(tip);
    return tip;
  } catch (_) {
    return null;
  }
}

/**
 * @param {HTMLElement|null} tipEl
 * @param {any} tip
 * @param {{ event?: any, wrapEl?: HTMLElement|null }} [pos]
 */
export function renderSignalTip(tipEl, tip, pos = {}) {
  if (!tipEl) return;
  const data = normalizeSignalTip(tip) || {};
  const level =
    data.levelLabel ||
    (data.level === "XL"
      ? "特大"
      : data.level === "L"
        ? "大"
        : data.level === "M"
          ? "中"
          : data.level || "信号");
  const dir = dirLabel(data.direction);
  const title = data.title || "形态/公告信号";
  const summary = data.summary || "";
  const reasons = Array.isArray(data.reasons) ? data.reasons.slice(0, 5) : [];
  const name = data.stockName || "";

  const row = (k, v, cls = "") => {
    if (!v) return "";
    return `<div class="zt-reason-tip-row">
      <div class="zt-reason-tip-k">${esc(k)}</div>
      <div class="zt-reason-tip-v ${cls}">${esc(v)}</div>
    </div>`;
  };

  const body =
    row("标题", title, "theme") +
    (name ? row("股票", name) : "") +
    (summary ? row("摘要", summary, "reason") : "") +
    (reasons.length
      ? row("要点", reasons.map((r) => `· ${r}`).join("\n"), "reason")
      : !summary
        ? `<div class="zt-reason-tip-empty">暂无更多详情</div>`
        : "");

  tipEl.innerHTML = `
    <div class="zt-reason-tip-hd">
      <span class="zt-reason-tip-badge">${esc(level)}</span>
      ${dir ? `<span class="zt-reason-tip-badge signal-dir">${esc(dir)}</span>` : ""}
      <span class="zt-reason-tip-date">${esc(data.date || "")}</span>
    </div>
    <div class="zt-reason-tip-body">${body}</div>
    <div class="zt-reason-tip-ft">悬停「信号」查看详情</div>
  `;
  tipEl.classList.add("show", "signal-tip");
  tipEl.setAttribute("aria-hidden", "false");

  const wrap = pos.wrapEl || tipEl.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const ev = pos.event;
  const pageX = Number(ev?.pageX ?? ev?.x ?? 0);
  const pageY = Number(ev?.pageY ?? ev?.y ?? 0);
  const localX =
    Number.isFinite(pageX) && pageX > 0
      ? pageX - rect.left
      : Number(ev?.figure?.attrs?.x ?? ev?.overlay?.points?.[0]?.x ?? rect.width / 2);
  const localY =
    Number.isFinite(pageY) && pageY > 0
      ? pageY - rect.top
      : Number(ev?.figure?.attrs?.y ?? 40);

  const tw = tipEl.offsetWidth || 300;
  const th = tipEl.offsetHeight || 160;
  let left = localX + 14;
  let top = Math.max(8, localY - 20);
  if (left + tw > rect.width - 8) left = Math.max(8, localX - tw - 14);
  if (top + th > rect.height - 8) top = Math.max(8, rect.height - th - 8);
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

export function hideSignalTip(tipEl) {
  if (!tipEl) return;
  tipEl.classList.remove("show", "pinned");
  tipEl.setAttribute("aria-hidden", "true");
  tipEl.innerHTML = "";
}

/**
 * 解析 tip：本地缓存 → 传入 tip → API
 * @param {{ symbol: string, date: string, tip?: any }} opts
 */
export async function resolveSignalTip(opts) {
  const symbol = String(opts?.symbol || "").trim();
  const date = String(opts?.date || "").trim().slice(0, 10);
  const fromArg = normalizeSignalTip(opts?.tip);
  if (fromArg && (fromArg.title || fromArg.summary || fromArg.reasons?.length)) {
    return fromArg;
  }
  const cached = readSignalTip(symbol, date);
  if (cached && (cached.title || cached.summary || cached.reasons?.length)) {
    return cached;
  }
  const fetched = await fetchSignalTipFromImpact(symbol, date);
  if (fetched) return fetched;
  return (
    cached ||
    fromArg ||
    normalizeSignalTip({
      symbol,
      date,
      title: "信号日",
      summary: "该日存在形态或公告信号",
    })
  );
}
