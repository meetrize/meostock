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
            <span>蜡烛图类型</span>
            <select data-field="candleType">
              ${CANDLE_TYPES.map(
                (t) => `<option value="${t.value}">${t.label}</option>`
              ).join("")}
            </select>
          </label>
          <label class="mp-setting-item">
            <span>最新价显示</span>
            <input type="checkbox" data-field="lastPrice" />
          </label>
          <label class="mp-setting-item">
            <span>最高价显示</span>
            <input type="checkbox" data-field="highPrice" />
          </label>
          <label class="mp-setting-item">
            <span>最低价显示</span>
            <input type="checkbox" data-field="lowPrice" />
          </label>
          <label class="mp-setting-item">
            <span>指标最新值</span>
            <input type="checkbox" data-field="indLast" />
          </label>
          <label class="mp-setting-item">
            <span>价格轴类型</span>
            <select data-field="axisType">
              <option value="normal">线性轴</option>
              <option value="percentage">百分比轴</option>
              <option value="log">对数轴</option>
            </select>
          </label>
          <label class="mp-setting-item">
            <span>倒置坐标</span>
            <input type="checkbox" data-field="axisReverse" />
          </label>
          <label class="mp-setting-item">
            <span>网格线显示</span>
            <input type="checkbox" data-field="grid" />
          </label>
          <label class="mp-setting-item">
            <span>隐藏右侧坐标轴</span>
            <input type="checkbox" data-field="hideYAxis" />
          </label>
        </div>
        <p class="mp-setting-note">分时周期仍强制面积图。应用仅作用于当前面板；「设为默认」写入本机，供新建面板继承。</p>
      </div>
      <div class="mp-modal-ft">
        <button type="button" data-act="reset">恢复默认</button>
        <button type="button" data-act="save-default">设为默认</button>
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
    settingsTarget.setSettings(next);
    updateChrome(settingsTarget);
    closeSettingsModal();
  });

  settingsMask.querySelector('[data-act="save-default"]').addEventListener("click", () => {
    const next = readSettingsForm(settingsMask);
    saveChartSettings(next);
    if (settingsTarget) {
      settingsTarget.setSettings(next);
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
      // fixed 定位，避免被 .mp-cell overflow:hidden 裁切
      const rect = gear.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      menu.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
      menu.style.left = "auto";
      menu.hidden = false;
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
      `<button type="button" class="mp-menu-btn" data-act="unlock-period">周期已锁定 · 跟随全体</button>`
    );
  }
  if (panel.chartTypeLocked) {
    lockHints.push(
      `<button type="button" class="mp-menu-btn" data-act="unlock-candle">图形已锁定 · 跟随全体</button>`
    );
  }

  menu.innerHTML = `
    <div class="mp-menu-sec">
      <div class="mp-menu-label">周期${panel.periodLocked ? " · 已单独设置" : ""}</div>
      <div class="mp-period-row">${periodBtns}</div>
    </div>
    <div class="mp-menu-sec">
      <div class="mp-menu-label">图形类型${
        panel.period === "fs"
          ? "（分时强制面积）"
          : panel.chartTypeLocked
            ? " · 已单独设置"
            : ""
      }</div>
      <select class="mp-menu-select" data-act="candle" ${
        panel.period === "fs" ? "disabled" : ""
      }>${candleOpts}</select>
    </div>
    ${
      lockHints.length
        ? `<div class="mp-menu-sec">${lockHints.join("")}</div>`
        : ""
    }
    <div class="mp-menu-sec">
      <label class="mp-menu-check">
        <input type="checkbox" data-act="hide-y" ${s.hideYAxis ? "checked" : ""} />
        隐藏右侧坐标轴
      </label>
    </div>
    <div class="mp-menu-sec">
      <button type="button" class="mp-menu-btn" data-act="indicators">指标…</button>
      <button type="button" class="mp-menu-btn" data-act="ma" style="margin-top:4px">MA 参数…</button>
      <button type="button" class="mp-menu-btn" data-act="settings" style="margin-top:4px">图表设置…</button>
    </div>
    <div class="mp-menu-sec">
      <div class="mp-menu-label">更换标的</div>
      <div class="mp-symbol-row">
        <input type="text" class="mp-symbol-input" maxlength="32" value="${escapeAttr(
          panel.symbol || ""
        )}" placeholder="代码" />
        <button type="button" class="mp-menu-btn" data-act="apply-symbol">确定</button>
      </div>
    </div>
    <div class="mp-menu-sec">
      <a class="mp-menu-link" data-act="single" href="${singleChartUrl(
        panel.symbol,
        panel.period
      )}" target="_blank" rel="noopener">在单图页打开</a>
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

  menu.querySelector('[data-act="hide-y"]')?.addEventListener("change", (e) => {
    panel.setHideYAxis(e.target.checked);
    updateChrome(panel);
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
