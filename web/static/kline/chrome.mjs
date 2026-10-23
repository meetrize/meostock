/**
 * 多面板紧凑 Chrome：浮层标题 + ⚙ 菜单 + 共享设置弹层
 */
import { PERIOD_BUTTONS } from "./period.mjs";
import {
  CANDLE_TYPES,
  DEFAULT_SETTINGS,
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

function closeOpenMenu() {
  if (openMenuEl) {
    openMenuEl.hidden = true;
    openMenuEl = null;
  }
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
        </div>
        <p class="mp-setting-note">分时仍为面积图。「应用」仅当前面板；「设为默认」供新建面板继承。</p>
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
    saveChartSettings(next);
    if (settingsTarget) {
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
    }
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
}

function readSettingsForm(mask) {
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
        <span class="mp-name">--</span>
        <span class="mp-code"></span>
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
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * 刷新浮层名称 / 代码 / 行情
 * @param {import('./ChartPanel.mjs').ChartPanel} panel
 */
export function updateChrome(panel) {
  const root = chromeMap.get(panel);
  if (!root) return;
  const nameEl = root.querySelector(".mp-name");
  const codeEl = root.querySelector(".mp-code");
  const quoteEl = root.querySelector(".mp-quote");
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
