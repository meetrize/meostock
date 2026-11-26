/**
 * 多面板紧凑 Chrome：浮层标题 + ⚙ 菜单 + 共享设置弹层
 */
import { PERIOD_BUTTONS } from "./period.mjs";
import {
  CANDLE_TYPES,
  DEFAULT_SETTINGS,
  loadChartSettings,
  saveChartSettings,
} from "./styles.mjs";
import {
  openIndicatorModal,
  openMaModal,
  closeAllIndicatorModals,
} from "./indicators.mjs";

/** @type {WeakMap<object, HTMLElement>} */
const chromeMap = new WeakMap();

/** @type {HTMLElement | null} */
let openMenuEl = null;

/** @type {HTMLElement | null} */
let settingsMask = null;

/** @type {object | null} */
let settingsTarget = null;

/** 顶栏「显示涨停主题」：页级共享 */
let ztReasonEnabled = false;
/** @type {Record<string, { theme?: string, drive?: string, reason?: string }>} */
let ztReasonByCode = {};

/** @type {Map<string, { at: number, items: any[] }>} */
const ztHistCache = new Map();
const ZT_HIST_TTL_MS = 5 * 60 * 1000;

/** @type {HTMLElement | null} */
let ztTipEl = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let ztTipHideTimer = null;

/**
 * @param {{ enabled?: boolean, byCode?: Record<string, { theme?: string, drive?: string, reason?: string }> }} opts
 */
export function setZtReasonDisplay(opts = {}) {
  ztReasonEnabled = !!opts.enabled;
  ztReasonByCode =
    opts.byCode && typeof opts.byCode === "object" ? opts.byCode : {};
  // 池数据更新后清历史缓存，下次悬停会并入今日主题/驱动/原因
  ztHistCache.clear();
}

/** @param {Iterable<object> | object[]} panels */
export function refreshChromeForPanels(panels) {
  for (const p of panels || []) {
    if (p) updateChrome(p);
  }
}

function closeOpenMenu() {
  if (openMenuEl) {
    openMenuEl.hidden = true;
    openMenuEl = null;
  }
}

function pureAshareCode(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{6})/);
  return m ? m[1] : "";
}

function truncateText(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max))}…`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTradeDate(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return String(ymd || "—");
}

function ensureZtTip() {
  if (ztTipEl) return ztTipEl;
  ztTipEl = document.createElement("div");
  ztTipEl.className = "mp-zt-tip";
  ztTipEl.hidden = true;
  document.body.appendChild(ztTipEl);
  return ztTipEl;
}

function hideZtTipSoon() {
  if (ztTipHideTimer) clearTimeout(ztTipHideTimer);
  ztTipHideTimer = setTimeout(() => {
    if (ztTipEl) ztTipEl.hidden = true;
  }, 120);
}

function placeZtTip(anchor) {
  const tip = ensureZtTip();
  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  const tipW = Math.min(360, window.innerWidth - 16);
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + tipW > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - pad - tipW);
  }
  tip.style.width = `${tipW}px`;
  tip.hidden = false;
  // 先显示再量高度，必要时翻到上方
  const h = tip.offsetHeight || 160;
  if (top + h > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - h - 6);
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function todayYmdCompact() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function normTradeDate(ymd) {
  return String(ymd || "").replace(/\D/g, "").slice(0, 8);
}

/** 用当日涨停池 JSON（页内已拉的 byCode）补一条「今日」记录 */
function todayLiveRowFromPool(code6) {
  const info = ztReasonByCode[code6];
  if (!info) return null;
  const theme = String(info.theme || "").trim();
  const drive = String(info.drive || "").trim();
  const reason = String(info.reason || "").trim();
  if (!theme && !drive && !reason) return null;
  return {
    trade_date: todayYmdCompact(),
    pool: "limit_up",
    plate_name: theme || null,
    plate_reason: drive || null,
    stock_reason: reason || null,
    source: "live_pool",
  };
}

/**
 * 历史库 + 当日实时池（stock-panel 服务端已合并 live；
 * 再以页内 /api/zt/pool 结果兜底，确保今日主题/驱动/原因一定能显示）
 */
async function loadZtHistory(code6) {
  const hit = ztHistCache.get(code6);
  if (hit && Date.now() - hit.at < ZT_HIST_TTL_MS) return hit.items;

  let items = [];
  try {
    const res = await fetch(
      `/api/zt/history/stock-panel?code=${encodeURIComponent(code6)}&limit=40&theme_limit=1`,
      { cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && Array.isArray(data.items)) {
      items = data.items.slice();
    }
  } catch (_) {
    items = [];
  }

  // 若 stock-panel 未带上今日，直接用页内已解析的涨停池 JSON 插入
  const live = todayLiveRowFromPool(code6);
  const today = todayYmdCompact();
  if (live) {
    const idx = items.findIndex(
      (it) =>
        normTradeDate(it.trade_date) === today &&
        String(it.pool || "").includes("up")
    );
    if (idx < 0) {
      items = [live, ...items];
    } else {
      const cur = items[idx] || {};
      items[idx] = {
        ...cur,
        plate_name: cur.plate_name || live.plate_name,
        plate_reason: cur.plate_reason || live.plate_reason,
        stock_reason: cur.stock_reason || live.stock_reason,
        source: cur.source || "live_pool",
      };
    }
  }

  ztHistCache.set(code6, { at: Date.now(), items });
  return items;
}

function renderZtHistoryHtml(code6, items) {
  if (!items.length) {
    return `<div class="mp-zt-tip-hd">${escapeHtml(code6)} · 涨跌停历史</div>
      <div class="mp-zt-tip-empty">暂无记录</div>`;
  }
  const today = todayYmdCompact();
  const rows = items
    .map((it) => {
      const pool = String(it.pool || "");
      const isDown = pool.includes("down");
      const poolCls = isDown ? "mp-zt-tip-pool-dn" : "mp-zt-tip-pool-up";
      const poolLab = isDown ? "跌停" : "涨停";
      const theme = String(it.plate_name || "").trim();
      const drive = String(it.plate_reason || "").trim();
      const reason = String(it.stock_reason || "").trim();
      const isToday =
        normTradeDate(it.trade_date) === today ||
        String(it.source || "") === "live_pool";
      const dateLab = isToday
        ? `${fmtTradeDate(it.trade_date || today)} · 今日`
        : fmtTradeDate(it.trade_date);
      return `<div class="mp-zt-tip-row">
        <div class="mp-zt-tip-meta">
          <span>${escapeHtml(dateLab)}</span>
          <span class="${poolCls}">${poolLab}</span>
          ${theme ? `<span class="mp-zt-tip-theme">${escapeHtml(theme)}</span>` : ""}
        </div>
        ${
          drive
            ? `<div class="mp-zt-tip-drive">驱动：${escapeHtml(drive)}</div>`
            : ""
        }
        ${
          reason
            ? `<div class="mp-zt-tip-reason">原因：${escapeHtml(reason)}</div>`
            : ""
        }
      </div>`;
    })
    .join("");
  return `<div class="mp-zt-tip-hd">${escapeHtml(code6)} · 涨跌停历史（${items.length}）</div>${rows}`;
}

function bindZtHover(el, code6) {
  if (!el || el.dataset.ztBound === "1") return;
  el.dataset.ztBound = "1";
  el.addEventListener("mouseenter", () => {
    if (ztTipHideTimer) {
      clearTimeout(ztTipHideTimer);
      ztTipHideTimer = null;
    }
    const tip = ensureZtTip();
    tip.innerHTML = `<div class="mp-zt-tip-hd">${escapeHtml(code6)} · 涨跌停历史</div>
      <div class="mp-zt-tip-empty">加载中…</div>`;
    placeZtTip(el);
    void loadZtHistory(code6)
      .then((items) => {
        if (!ztTipEl || ztTipEl.hidden) return;
        // 仍悬停在同一锚点相关区域时才更新
        tip.innerHTML = renderZtHistoryHtml(code6, items);
        placeZtTip(el);
      })
      .catch(() => {
        if (!ztTipEl || ztTipEl.hidden) return;
        tip.innerHTML = `<div class="mp-zt-tip-hd">${escapeHtml(code6)}</div>
          <div class="mp-zt-tip-empty">加载失败</div>`;
      });
  });
  el.addEventListener("mouseleave", () => hideZtTipSoon());
}

function ensureDocListeners() {
  if (ensureDocListeners._done) return;
  ensureDocListeners._done = true;
  document.addEventListener("click", (e) => {
    if (!openMenuEl) return;
    if (openMenuEl.contains(e.target)) return;
    if (e.target?.closest?.(".mp-gear")) return;
    closeOpenMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeOpenMenu();
      closeSettingsModal();
      closeAllIndicatorModals();
    }
  });
}

function fmtQuote(quote) {
  if (!quote || quote.price == null || !Number.isFinite(Number(quote.price))) {
    return { text: "", cls: "" };
  }
  const change = Number(quote.change ?? 0);
  const pct = Number(quote.changePercent ?? 0);
  const cls = change >= 0 ? "up" : "down";
  const sign = change >= 0 ? "+" : "";
  return {
    text: `${Number(quote.price).toFixed(2)} ${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    cls,
  };
}

function singleChartUrl(symbol, period) {
  const q = new URLSearchParams();
  q.set("symbol", symbol || "");
  if (period) q.set("period", period === "fs" ? "fs" : period);
  return `/?${q.toString()}`;
}

function ensureSettingsModal() {
  if (settingsMask) return settingsMask;
  settingsMask = document.createElement("div");
  settingsMask.className = "mp-modal-mask";
  settingsMask.innerHTML = `
    <div class="mp-modal" role="dialog" aria-label="图表设置">
      <div class="mp-modal-hd">
        <span>图表设置</span>
        <button type="button" class="mp-modal-x" data-close>×</button>
      </div>
      <div class="mp-modal-bd">
        <div class="mp-setting-grid">
          <label class="mp-setting-item">
            <span>蜡烛类型</span>
            <select data-field="candleType">
              ${CANDLE_TYPES.map(
                (t) => `<option value="${t.value}">${t.label}</option>`
              ).join("")}
            </select>
          </label>
          <label class="mp-setting-item">
            <span>价格轴</span>
            <select data-field="axisType">
              <option value="normal">线性</option>
              <option value="percentage">百分比</option>
              <option value="log">对数</option>
            </select>
          </label>
          <div class="mp-setting-checks">
            <label class="mp-setting-check"><input type="checkbox" data-field="lastPrice" /><span>最新价</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="highPrice" /><span>最高价</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="lowPrice" /><span>最低价</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="indLast" /><span>指标值</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="axisReverse" /><span>倒置轴</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="grid" /><span>网格</span></label>
            <label class="mp-setting-check"><input type="checkbox" data-field="hideYAxis" /><span>隐Y轴</span></label>
          </div>
          <div class="mp-setting-status">
            <div class="mp-setting-status-title">K 线状态颜色（仅日线）</div>
            <label class="mp-setting-status-row">
              <span>收盘涨停</span>
              <span class="mp-setting-status-ctrls">
                <input type="color" data-field="colorLimitUp" value="#F5C518" title="涨停颜色" />
                <input type="checkbox" data-field="statusLimitUp" title="启用" />
              </span>
            </label>
            <label class="mp-setting-status-row">
              <span>收盘跌停</span>
              <span class="mp-setting-status-ctrls">
                <input type="color" data-field="colorLimitDown" value="#7C3AED" title="跌停颜色" />
                <input type="checkbox" data-field="statusLimitDown" title="启用" />
              </span>
            </label>
            <label class="mp-setting-status-row">
              <span>一字涨停</span>
              <span class="mp-setting-status-ctrls">
                <input type="color" data-field="colorOneWordUp" value="#FF9800" title="一字涨停颜色" />
                <input type="checkbox" data-field="statusOneWordUp" title="启用" />
              </span>
            </label>
            <label class="mp-setting-status-row">
              <span>一字跌停</span>
              <span class="mp-setting-status-ctrls">
                <input type="color" data-field="colorOneWordDown" value="#5B21B6" title="一字跌停颜色" />
                <input type="checkbox" data-field="statusOneWordDown" title="启用" />
              </span>
            </label>
          </div>
        </div>
        <p class="mp-setting-note">分时仍为面积图。状态颜色与单图共用本机设置，默认开启。「应用」仅当前面板；「设为默认」全体新建面板继承。</p>
      </div>
      <div class="mp-modal-ft">
        <button type="button" data-act="reset">默认</button>
        <button type="button" data-act="save-default">存默认</button>
        <button type="button" class="primary" data-act="apply">应用</button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsMask);

  settingsMask.addEventListener("click", (e) => {
    if (e.target === settingsMask || e.target.closest("[data-close]")) {
      closeSettingsModal();
    }
  });

  settingsMask.querySelector('[data-act="apply"]').addEventListener("click", () => {
    if (!settingsTarget) return;
    const next = readSettingsForm(settingsMask);
    const prevHide = !!settingsTarget.settings?.hideYAxis;
    settingsTarget.setSettings(next);
    if (prevHide !== !!next.hideYAxis) {
      settingsTarget.yAxisLocked = true;
      try {
        settingsTarget.chart?.resize?.();
      } catch (_) {}
      try {
        settingsTarget.onYAxisChange?.(settingsTarget);
      } catch (_) {}
    }
    updateChrome(settingsTarget);
    closeSettingsModal();
  });

  settingsMask.querySelector('[data-act="save-default"]').addEventListener("click", () => {
    const next = readSettingsForm(settingsMask);
    // 与单图共用 localStorage：合并写入，避免冲掉 cacheMode / refreshInterval 等
    const merged = { ...loadChartSettings(), ...next };
    saveChartSettings(merged);
    if (settingsTarget) {
      const prevHide = !!settingsTarget.settings?.hideYAxis;
      settingsTarget.setSettings(merged);
      if (prevHide !== !!next.hideYAxis) {
        settingsTarget.yAxisLocked = true;
        try {
          settingsTarget.chart?.resize?.();
        } catch (_) {}
        try {
          settingsTarget.onYAxisChange?.(settingsTarget);
        } catch (_) {}
      }
      updateChrome(settingsTarget);
    }
    try {
      window.dispatchEvent(
        new CustomEvent("kline-settings-saved", { detail: merged })
      );
    } catch (_) {}
    closeSettingsModal();
  });

  settingsMask.querySelector('[data-act="reset"]').addEventListener("click", () => {
    fillSettingsForm(settingsMask, { ...DEFAULT_SETTINGS });
  });

  return settingsMask;
}

function fillSettingsForm(mask, settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  mask.querySelector('[data-field="candleType"]').value = s.candleType || "candle_solid";
  mask.querySelector('[data-field="lastPrice"]').checked = !!s.lastPrice;
  mask.querySelector('[data-field="highPrice"]').checked = !!s.highPrice;
  mask.querySelector('[data-field="lowPrice"]').checked = !!s.lowPrice;
  mask.querySelector('[data-field="indLast"]').checked = !!s.indLast;
  mask.querySelector('[data-field="axisType"]').value = s.axisType || "normal";
  mask.querySelector('[data-field="axisReverse"]').checked = !!s.axisReverse;
  mask.querySelector('[data-field="grid"]').checked = !!s.grid;
  mask.querySelector('[data-field="hideYAxis"]').checked = !!s.hideYAxis;
  const colorOr = (key, fallback) => s[key] || fallback;
  const setColor = (field, val) => {
    const el = mask.querySelector(`[data-field="${field}"]`);
    if (el) el.value = val;
  };
  const setCheck = (field, on) => {
    const el = mask.querySelector(`[data-field="${field}"]`);
    if (el) el.checked = !!on;
  };
  setColor("colorLimitUp", colorOr("colorLimitUp", DEFAULT_SETTINGS.colorLimitUp));
  setColor("colorLimitDown", colorOr("colorLimitDown", DEFAULT_SETTINGS.colorLimitDown));
  setColor("colorOneWordUp", colorOr("colorOneWordUp", DEFAULT_SETTINGS.colorOneWordUp));
  setColor("colorOneWordDown", colorOr("colorOneWordDown", DEFAULT_SETTINGS.colorOneWordDown));
  setCheck("statusLimitUp", s.statusLimitUp !== false);
  setCheck("statusLimitDown", s.statusLimitDown !== false);
  setCheck("statusOneWordUp", s.statusOneWordUp !== false);
  setCheck("statusOneWordDown", s.statusOneWordDown !== false);
}

function readSettingsForm(mask) {
  const colorVal = (field, fallback) =>
    mask.querySelector(`[data-field="${field}"]`)?.value || fallback;
  const checkVal = (field, defaultOn = true) => {
    const el = mask.querySelector(`[data-field="${field}"]`);
    if (!el) return defaultOn;
    return !!el.checked;
  };
  return {
    candleType: mask.querySelector('[data-field="candleType"]').value,
    lastPrice: mask.querySelector('[data-field="lastPrice"]').checked,
    highPrice: mask.querySelector('[data-field="highPrice"]').checked,
    lowPrice: mask.querySelector('[data-field="lowPrice"]').checked,
    indLast: mask.querySelector('[data-field="indLast"]').checked,
    axisType: mask.querySelector('[data-field="axisType"]').value,
    axisReverse: mask.querySelector('[data-field="axisReverse"]').checked,
    grid: mask.querySelector('[data-field="grid"]').checked,
    hideYAxis: mask.querySelector('[data-field="hideYAxis"]').checked,
    statusLimitUp: checkVal("statusLimitUp"),
    statusLimitDown: checkVal("statusLimitDown"),
    statusOneWordUp: checkVal("statusOneWordUp"),
    statusOneWordDown: checkVal("statusOneWordDown"),
    colorLimitUp: colorVal("colorLimitUp", DEFAULT_SETTINGS.colorLimitUp),
    colorLimitDown: colorVal("colorLimitDown", DEFAULT_SETTINGS.colorLimitDown),
    colorOneWordUp: colorVal("colorOneWordUp", DEFAULT_SETTINGS.colorOneWordUp),
    colorOneWordDown: colorVal("colorOneWordDown", DEFAULT_SETTINGS.colorOneWordDown),
  };
}

export function openSettingsModal(panel) {
  const mask = ensureSettingsModal();
  settingsTarget = panel;
  fillSettingsForm(mask, panel.settings);
  mask.classList.add("show");
  closeOpenMenu();
}

export function closeSettingsModal() {
  if (settingsMask) settingsMask.classList.remove("show");
  settingsTarget = null;
}

/**
 * 在面板容器上挂载紧凑浮层（幂等）
 * @param {import('./ChartPanel.mjs').ChartPanel} panel
 */
export function mountChrome(panel) {
  ensureDocListeners();
  let root = chromeMap.get(panel);
  if (root && root.isConnected) {
    updateChrome(panel);
    return root;
  }

  root = document.createElement("div");
  root.className = "mp-chrome";
  root.innerHTML = `
    <div class="mp-id">
      <div class="mp-id-row">
        <button type="button" class="mp-name" title="打开单图 K 线">--</button>
        <span class="mp-code"></span>
        <span class="mp-zt-reason" hidden></span>
      </div>
      <div class="mp-quote"></div>
    </div>
    <div class="mp-chrome-actions">
      <button type="button" class="mp-gear" title="面板设置" aria-haspopup="menu" aria-expanded="false">⚙</button>
      <div class="mp-menu" role="menu" hidden></div>
    </div>
  `;
  panel.container.appendChild(root);
  chromeMap.set(panel, root);

  const gear = root.querySelector(".mp-gear");
  const menu = root.querySelector(".mp-menu");
  const nameBtn = root.querySelector(".mp-name");

  nameBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sym = String(panel.symbol || "").trim();
    if (!sym) return;
    if (typeof panel.onOpenSingle === "function") {
      try {
        panel.onOpenSingle(panel);
        return;
      } catch (err) {
        console.warn("onOpenSingle failed", err);
      }
    }
    // noopener 下返回值常为 null，勿用 location.href 兜底（会把多面板页也跳走）
    window.open(singleChartUrl(sym, panel.period), "_blank", "noopener");
  });

  // 点代码同样打开单图
  root.querySelector(".mp-code")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    nameBtn?.click();
  });

  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.container.classList.add("is-active");
    document.querySelectorAll(".mp-cell.is-active").forEach((el) => {
      if (el !== panel.container) el.classList.remove("is-active");
    });
    const willOpen = menu.hidden;
    closeOpenMenu();
    if (willOpen) {
      renderMenu(panel, menu);
      placeMenuNearGear(menu, gear);
      openMenuEl = menu;
      gear.setAttribute("aria-expanded", "true");
    } else {
      gear.setAttribute("aria-expanded", "false");
    }
  });

  panel.container.addEventListener("click", () => {
    panel.container.classList.add("is-active");
    document.querySelectorAll(".mp-cell.is-active").forEach((el) => {
      if (el !== panel.container) el.classList.remove("is-active");
    });
  });

  updateChrome(panel);
  return root;
}

/** fixed 定位菜单，贴齿轮并夹在视口内（必要时上翻 / 限高） */
function placeMenuNearGear(menu, gear) {
  const pad = 6;
  const rect = gear.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.left = "auto";
  menu.style.right = `${Math.round(Math.max(pad, window.innerWidth - rect.right))}px`;
  menu.style.top = "0px";
  menu.style.maxHeight = "";
  menu.style.visibility = "hidden";
  menu.hidden = false;

  const mh = menu.offsetHeight || 280;
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const openUp = spaceBelow < Math.min(mh, 220) && spaceAbove > spaceBelow;
  const avail = Math.max(120, openUp ? spaceAbove : spaceBelow);
  menu.style.maxHeight = `${Math.round(Math.min(360, avail))}px`;

  const finalH = Math.min(menu.scrollHeight || mh, avail);
  if (openUp) {
    menu.style.top = `${Math.round(Math.max(pad, rect.top - finalH - 4))}px`;
  } else {
    menu.style.top = `${Math.round(rect.bottom + 4)}px`;
  }
  menu.style.visibility = "";
}

function renderMenu(panel, menu) {
  const s = panel.settings || {};
  const candleOpts = CANDLE_TYPES.map(
    (t) =>
      `<option value="${t.value}" ${
        (s.candleType || "candle_solid") === t.value ? "selected" : ""
      }>${t.label}</option>`
  ).join("");

  const periodBtns = PERIOD_BUTTONS.map(
    (b) =>
      `<button type="button" class="mp-period-btn${
        panel.period === b.id ? " active" : ""
      }" data-period="${b.id}" title="${b.title || b.label}">${b.label}</button>`
  ).join("");

  const lockHints = [];
  if (panel.periodLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn mp-menu-btn-block" data-act="unlock-period">周期解锁 · 跟随全体</button>`
    );
  }
  if (panel.chartTypeLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn mp-menu-btn-block" data-act="unlock-candle">图形解锁 · 跟随全体</button>`
    );
  }
  if (panel.volumeLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn mp-menu-btn-block" data-act="unlock-vol">量能解锁 · 跟随全体</button>`
    );
  }
  if (panel.yAxisLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn mp-menu-btn-block" data-act="unlock-y">Y轴解锁 · 跟随全体</button>`
    );
  }
  if (panel.maLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn mp-menu-btn-block" data-act="unlock-ma">均线解锁 · 跟随全体</button>`
    );
  }

  const graphHint =
    panel.period === "fs" ? "分时面积" : panel.chartTypeLocked ? "单独" : "";

  menu.innerHTML = `
    <div class="mp-menu-sec">
      <div class="mp-period-row" title="周期${panel.periodLocked ? " · 单独" : ""}">${periodBtns}</div>
    </div>
    <div class="mp-menu-sec">
      <div class="mp-menu-row" title="${graphHint ? `图形 · ${graphHint}` : "图形 / 指标"}">
        <select class="mp-menu-select mp-menu-select-compact" data-act="candle" ${
          panel.period === "fs" ? "disabled" : ""
        }>${candleOpts}</select>
        <label class="mp-menu-check" title="隐藏右侧 Y 轴（铺满主图）${
          panel.yAxisLocked ? " · 已单独设置" : ""
        }">
          <input type="checkbox" data-act="hide-y" ${s.hideYAxis ? "checked" : ""} />
          Y
        </label>
        <label class="mp-menu-check" title="显示量能 VOL${panel.volumeLocked ? " · 已单独设置" : ""}">
          <input type="checkbox" data-act="vol" ${panel.withVolume ? "checked" : ""} />
          量
        </label>
        <label class="mp-menu-check" title="显示均线 MA${panel.maLocked ? " · 已单独设置" : ""}">
          <input type="checkbox" data-act="ma-line" ${panel.withMa !== false ? "checked" : ""} />
          均
        </label>
        <button type="button" class="mp-menu-btn" data-act="indicators" title="指标">指标</button>
        <button type="button" class="mp-menu-btn" data-act="ma" title="MA 参数">MA</button>
        <button type="button" class="mp-menu-btn" data-act="settings" title="图表设置">设</button>
      </div>
    </div>
    ${
      lockHints.length
        ? `<div class="mp-menu-sec mp-menu-sec-lock">${lockHints.join("")}</div>`
        : ""
    }
    <div class="mp-menu-sec">
      <div class="mp-menu-row">
        <input type="text" class="mp-symbol-input" maxlength="32" value="${escapeAttr(
          panel.symbol || ""
        )}" placeholder="代码" />
        <button type="button" class="mp-menu-btn" data-act="apply-symbol">换</button>
        <a class="mp-menu-link" data-act="single" href="${singleChartUrl(
          panel.symbol,
          panel.period
        )}" target="_blank" rel="noopener">单图</a>
      </div>
    </div>
  `;

  menu.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.dataset.period;
      panel.setPeriod(period, { lock: true });
      panel.load();
      updateChrome(panel);
      closeOpenMenu();
    });
  });

  menu.querySelector('[data-act="candle"]')?.addEventListener("change", (e) => {
    panel.setCandleType(e.target.value, { lock: true });
    updateChrome(panel);
  });

  menu.querySelector('[data-act="unlock-period"]')?.addEventListener("click", () => {
    panel.clearPeriodLock();
    closeOpenMenu();
  });
  menu.querySelector('[data-act="unlock-candle"]')?.addEventListener("click", () => {
    panel.clearChartTypeLock();
    closeOpenMenu();
  });
  menu.querySelector('[data-act="unlock-vol"]')?.addEventListener("click", () => {
    panel.clearVolumeLock();
    closeOpenMenu();
  });
  menu.querySelector('[data-act="unlock-y"]')?.addEventListener("click", () => {
    panel.clearYAxisLock();
    closeOpenMenu();
  });
  menu.querySelector('[data-act="unlock-ma"]')?.addEventListener("click", () => {
    panel.clearMaLock();
    closeOpenMenu();
  });

  menu.querySelector('[data-act="hide-y"]')?.addEventListener("change", (e) => {
    panel.setHideYAxis(!!e.target.checked, { lock: true });
    updateChrome(panel);
    try {
      panel.onYAxisChange?.(panel);
    } catch (_) {}
  });

  menu.querySelector('[data-act="vol"]')?.addEventListener("change", (e) => {
    panel.setWithVolume(!!e.target.checked, { lock: true });
    updateChrome(panel);
    try {
      panel.onVolumeChange?.(panel);
    } catch (_) {}
  });

  menu.querySelector('[data-act="ma-line"]')?.addEventListener("change", (e) => {
    panel.setWithMa(!!e.target.checked, { lock: true });
    updateChrome(panel);
    try {
      panel.onMaChange?.(panel);
    } catch (_) {}
  });

  menu.querySelector('[data-act="settings"]')?.addEventListener("click", () => {
    openSettingsModal(panel);
  });
  menu.querySelector('[data-act="indicators"]')?.addEventListener("click", () => {
    closeOpenMenu();
    openIndicatorModal(panel);
  });
  menu.querySelector('[data-act="ma"]')?.addEventListener("click", () => {
    closeOpenMenu();
    openMaModal(panel);
  });

  const applySym = () => {
    const input = menu.querySelector(".mp-symbol-input");
    const next = String(input?.value || "").trim();
    if (!next) return;
    if (!panel.data.canLoadSymbol(next)) {
      panel._status?.(`无效代码: ${next}`);
      return;
    }
    panel.setSymbol(next);
    panel.load();
    updateChrome(panel);
    closeOpenMenu();
  };
  menu.querySelector('[data-act="apply-symbol"]')?.addEventListener("click", applySym);
  menu.querySelector(".mp-symbol-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applySym();
  });
  menu.querySelector('[data-act="single"]')?.addEventListener("click", (e) => {
    if (typeof panel.onOpenSingle !== "function") return;
    e.preventDefault();
    closeOpenMenu();
    panel.onOpenSingle(panel);
  });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * 刷新浮层名称 / 代码 / 行情 / 涨停主题
 * @param {import('./ChartPanel.mjs').ChartPanel} panel
 */
export function updateChrome(panel) {
  const root = chromeMap.get(panel);
  if (!root) return;
  const nameEl = root.querySelector(".mp-name");
  const codeEl = root.querySelector(".mp-code");
  const quoteEl = root.querySelector(".mp-quote");
  const ztEl = root.querySelector(".mp-zt-reason");
  const name = panel._name || panel.getState?.().name || "";
  nameEl.textContent = name || "--";
  codeEl.textContent = panel.symbol || "";
  const q = fmtQuote(panel._quote);
  quoteEl.textContent = q.text;
  quoteEl.className = `mp-quote ${q.cls}`.trim();

  const link = root.querySelector('[data-act="single"]');
  if (link) {
    link.href = singleChartUrl(panel.symbol, panel.period);
  }

  if (!ztEl) return;
  const code6 = pureAshareCode(panel.symbol);
  const info =
    ztReasonEnabled && code6 ? ztReasonByCode[code6] || null : null;
  const theme = String(info?.theme || "").trim();
  const drive = String(info?.drive || "").trim();
  const reason = String(info?.reason || "").trim();
  const sig = ztReasonEnabled
    ? `${code6}|${theme}|${drive}|${reason}`
    : "";
  if (ztEl.dataset.ztSig === sig) return;
  ztEl.dataset.ztSig = sig;
  if (!info || (!theme && !drive && !reason)) {
    ztEl.hidden = true;
    ztEl.classList.remove("is-on");
    ztEl.innerHTML = "";
    return;
  }
  ztEl.hidden = false;
  ztEl.classList.add("is-on");
  // 不设 HTML title：原生 tooltip 会挡住涨跌停历史浮层
  ztEl.innerHTML = `
    ${
      theme
        ? `<span class="mp-zt-theme">${escapeHtml(truncateText(theme, 8))}</span>`
        : ""
    }
    ${
      drive
        ? `<span class="mp-zt-drive">${escapeHtml(truncateText(drive, 20))}</span>`
        : ""
    }
    ${
      reason
        ? `<span class="mp-zt-stock">${escapeHtml(reason)}</span>`
        : ""
    }
  `;
  ztEl.querySelectorAll(".mp-zt-theme, .mp-zt-drive, .mp-zt-stock").forEach((node) => {
    bindZtHover(node, code6);
  });
}

export function unmountChrome(panel) {
  const root = chromeMap.get(panel);
  if (root) {
    try {
      root.remove();
    } catch (_) {}
    chromeMap.delete(panel);
  }
  if (settingsTarget === panel) closeSettingsModal();
}
