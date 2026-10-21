/**
 * 实际验证比较商品叠加是否画到主图上
 */
import { chromium } from "playwright-core";
import path from "path";
import fs from "fs";
import os from "os";

const chromePath = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
);

const BASE = "http://127.0.0.1:8765/?symbol=600036&period=1d";

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") logs.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => window.__chart, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const layout = await page.evaluate(() => {
    const rect = document.getElementById("chart").getBoundingClientRect();
    const canvas = document.querySelector("#chart canvas");
    return {
      chartH: Math.round(rect.height),
      chartW: Math.round(rect.width),
      canvasH: canvas?.height,
      canvasW: canvas?.width,
      fillOk: rect.height >= 700,
    };
  });
  console.log("LAYOUT", layout);

  const result = await page.evaluate(async () => {
    const out = {};
    document.getElementById("btnCompare").click();
    await new Promise((r) => setTimeout(r, 1000));
    let items = [];
    for (let i = 0; i < 25; i++) {
      items = [...document.querySelectorAll("#cmpList .cmp-item")];
      if (items.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    out.listCount = items.length;
    const target =
      items.find((li) => !String(li.dataset.symbol || "").includes("600036")) || items[0];
    out.picked = { symbol: target?.dataset.symbol, name: target?.dataset.name };
    target.click();
    await new Promise((r) => setTimeout(r, 4000));

    out.status = document.getElementById("status")?.textContent || "";
    out.chipsShow = document.getElementById("overlayChips")?.classList.contains("show");

    const chart = window.__chart;
    const inds = chart.getIndicators({ name: "OVERLAY_CMP" }) || [];
    out.indicatorCount = inds.length;
    const ind = inds[0];
    if (ind) {
      const resultArr = ind.result || [];
      const withVal = resultArr.filter((r) => r && r.v != null && Number.isFinite(r.v));
      out.resultLen = resultArr.length;
      out.resultWithVal = withVal.length;
      out.sampleVals = withVal.slice(-5).map((r) => r.v);
      out.extendKeys = ind.extendData ? Object.keys(ind.extendData) : [];
      out.byTsSample = ind.extendData?.byTs
        ? Object.keys(ind.extendData.byTs).slice(0, 3)
        : [];
    }
    return out;
  });

  console.log("OVERLAY", JSON.stringify(result, null, 2));

  const shot = "/tmp/overlay-test2.png";
  await page.screenshot({ path: shot, fullPage: true });
  console.log("SHOT", shot);

  const ok =
    layout.fillOk &&
    result.indicatorCount >= 1 &&
    result.resultWithVal > 50 &&
    /对齐/.test(result.status);

  console.log(ok ? "PASS" : "FAIL");
  if (logs.length) console.log("ERRORS", logs.join("\n"));

  await browser.close();
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
