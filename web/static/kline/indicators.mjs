/**
 * 主/副图指标目录 + 面板级指标 / MA 弹层（对齐 index.html）
 */
import { activeMaParams, loadMaParams, MA_KEY, DEFAULT_MA } from "./styles.mjs";

export const MAIN_INDS = [
  { name: "MA", label: "MA(移动平均线)" },
  { name: "EMA", label: "EMA(指数平滑移动平均线)" },
  { name: "SMA", label: "SMA" },
  { name: "BOLL", label: "BOLL(布林线)" },
  { name: "SAR", label: "SAR(停损点转向指标)" },
  { name: "BBI", label: "BBI(多空指数)" },
];

export const SUB_INDS = [
  { name: "MA", label: "MA(移动平均线)" },
  { name: "EMA", label: "EMA(指数平滑移动平均线)" },
  { name: "VOL", label: "VOL(成交量)" },
  { name: "MACD", label: "MACD" },
  { name: "BOLL", label: "BOLL(布林线)" },
  { name: "KDJ", label: "KDJ" },
  { name: "RSI", label: "RSI" },
  { name: "BIAS", label: "BIAS" },
  { name: "CCI", label: "CCI" },
  { name: "DMI", label: "DMI" },
  { name: "WR", label: "WR" },
  { name: "OBV", label: "OBV" },
  { name: "SAR", label: "SAR" },
  { name: "BBI", label: "BBI" },
];

/** @type {HTMLElement | null} */
let indMask = null;
/** @type {HTMLElement | null} */
let maMask = null;
/** @type {object | null} */
let indTarget = null;
/** @type {object | null} */
let maTarget = null;

function ensureIndModal() {
  if (indMask) return indMask;
  indMask = document.createElement("div");
  indMask.className = "mp-modal-mask";
  indMask.innerHTML = `
    <div class="mp-modal mp-modal-wide" role="dialog" aria-label="指标">
      <div class="mp-modal-hd">
        <span>指标</span>
        <button type="button" class="mp-modal-x" data-close>×</button>
      </div>
      <div class="mp-modal-bd" id="mpIndBody"></div>
      <div class="mp-modal-ft">
        <button type="button" class="primary" data-close>完成</button>
      </div>
    </div>
  `;
  document.body.appendChild(indMask);
  indMask.addEventListener("click", (e) => {
    if (e.target === indMask || e.target.closest("[data-close]")) {
      closeIndicatorModal();
    }
  });
  return indMask;
}

function ensureMaModal() {
  if (maMask) return maMask;
  maMask = document.createElement("div");
  maMask.className = "mp-modal-mask";
  maMask.innerHTML = `
    <div class="mp-modal" role="dialog" aria-label="MA 参数">
      <div class="mp-modal-hd">
        <span>MA 参数</span>
        <button type="button" class="mp-modal-x" data-close>×</button>
      </div>
      <div class="mp-modal-bd" id="mpMaBody"></div>
      <div class="mp-modal-ft">
        <button type="button" data-act="reset">恢复默认</button>
        <button type="button" class="primary" data-act="apply">应用并保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(maMask);
  maMask.addEventListener("click", (e) => {
    if (e.target === maMask || e.target.closest("[data-close]")) {
      closeMaModal();
    }
  });
  maMask.querySelector('[data-act="reset"]').addEventListener("click", () => {
    fillMaForm([...DEFAULT_MA, "", ""]);
  });
  maMask.querySelector('[data-act="apply"]').addEventListener("click", () => {
    if (!maTarget) return;
    const next = readMaForm();
    try {
      localStorage.setItem(MA_KEY, JSON.stringify(next));
    } catch (_) {}
    maTarget.setMaParams(next);
    closeMaModal();
  });
  return maMask;
}

function fillMaForm(vals) {
  const body = document.getElementById("mpMaBody");
  if (!body) return;
  const list = Array.isArray(vals) ? [...vals] : loadMaParams();
  while (list.length < 5) list.push("");
  body.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const row = document.createElement("label");
    row.className = "mp-setting-item";
    row.innerHTML = `
      <span>MA${i + 1}</span>
      <input type="number" min="1" step="1" data-idx="${i}" value="${
      list[i] ?? ""
    }" style="width:100px;border:1px solid var(--line);background:var(--input-bg);color:var(--text);border-radius:4px;padding:3px 6px;font:inherit;font-size:12px" />
    `;
    body.appendChild(row);
  }
}

function readMaForm() {
  const inputs = [...document.querySelectorAll("#mpMaBody input")];
  return inputs.map((el) => {
    const v = el.value.trim();
    if (v === "") return "";
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : "";
  });
}

/**
 * @param {import('./ChartPanel.mjs').ChartPanel} panel
 */
export function openIndicatorModal(panel) {
  const mask = ensureIndModal();
  indTarget = panel;
  const body = mask.querySelector("#mpIndBody");
  body.innerHTML = "";

  const mainSec = document.createElement("div");
  mainSec.className = "mp-ind-section";
  mainSec.innerHTML = "<h4>主图</h4>";
  const mainGrid = document.createElement("div");
  mainGrid.className = "mp-ind-grid";
  MAIN_INDS.forEach((item) => {
    const checked = panel.mainIndicators?.includes(item.name);
    const row = document.createElement("label");
    row.className = "mp-ind-item";
    row.title = item.label;
    row.innerHTML = `<input type="checkbox" data-kind="main" data-name="${item.name}" ${
      checked ? "checked" : ""
    }/><span>${item.name}</span>`;
    mainGrid.appendChild(row);
  });
  mainSec.appendChild(mainGrid);
  body.appendChild(mainSec);

  const subSec = document.createElement("div");
  subSec.className = "mp-ind-section";
  subSec.innerHTML = "<h4>副图</h4>";
  const subGrid = document.createElement("div");
  subGrid.className = "mp-ind-grid";
  SUB_INDS.forEach((item) => {
    const checked = panel.subIndicators && item.name in panel.subIndicators;
    const row = document.createElement("label");
    row.className = "mp-ind-item";
    row.title = item.label;
    row.innerHTML = `<input type="checkbox" data-kind="sub" data-name="${item.name}" ${
      checked ? "checked" : ""
    }/><span>${item.name}</span>`;
    subGrid.appendChild(row);
  });
  subSec.appendChild(subGrid);
  body.appendChild(subSec);

  body.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      const name = input.dataset.name;
      const kind = input.dataset.kind;
      if (!indTarget) return;
      if (kind === "main") {
        indTarget.toggleMain(name, input.checked);
      } else if (name === "VOL") {
        // 与面板「量」开关一致：单独设置后全体「隐藏量能」不再覆盖
        indTarget.setWithVolume(input.checked, { lock: true });
        try {
          indTarget.onVolumeChange?.(indTarget);
        } catch (_) {}
      } else {
        indTarget.toggleSub(name, input.checked);
      }
    });
  });

  mask.classList.add("show");
}

export function closeIndicatorModal() {
  if (indMask) indMask.classList.remove("show");
  indTarget = null;
}

/**
 * @param {import('./ChartPanel.mjs').ChartPanel} panel
 */
export function openMaModal(panel) {
  ensureMaModal();
  maTarget = panel;
  fillMaForm(panel.maParams || loadMaParams());
  maMask.classList.add("show");
}

export function closeMaModal() {
  if (maMask) maMask.classList.remove("show");
  maTarget = null;
}

export function closeAllIndicatorModals() {
  closeIndicatorModal();
  closeMaModal();
}

export { activeMaParams };
