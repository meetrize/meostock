/**
 * 验证：叠加线形态适配主图，且调节面板可用
 */
import { chromium } from "playwright-core";
import path from "path";
import os from "os";

const chromePath = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
);

async function main() {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://127.0.0.1:8765/?symbol=600036&period=1d", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__chart, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    document.getElementById("btnCompare").click();
    await new Promise((r) => setTimeout(r, 900));
    let items = [];
    for (let i = 0; i < 20; i++) {
      items = [...document.querySelectorAll("#cmpList .cmp-item")];
      if (items.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const target =
      items.find((li) => !String(li.dataset.symbol || "").includes("600036")) || items[0];
    target.click();
    await new Promise((r) => setTimeout(r, 3500));

    const chart = window.__chart;
    const primary = chart.getDataList();
    const pMin = Math.min(...primary.map((b) => b.low ?? b.close));
    const pMax = Math.max(...primary.map((b) => b.high ?? b.close));
    const ind = (chart.getIndicators({ name: "OVERLAY_CMP" }) || [])[0];
    const vals = (ind?.result || []).map((r) => r?.v).filter((v) => Number.isFinite(v));
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);

    const scaleBefore = ind.extendData?.scale;
    const apiBefore = window.__overlayApi.list()[0];
    window.__overlayApi.setScale(50);
    await new Promise((r) => setTimeout(r, 800));
    const ind2 = (chart.getIndicators({ name: "OVERLAY_CMP" }) || [])[0];
    const vals2 = (ind2?.result || []).map((r) => r?.v).filter((v) => Number.isFinite(v));
    const span1 = vMax - vMin;
    const span2 = vals2.length ? Math.max(...vals2) - Math.min(...vals2) : span1;
    const scaleAfter = ind2.extendData?.scale;
    const apiAfter = window.__overlayApi.list()[0];

    return {
      status: document.getElementById("status")?.textContent,
      adjustShow: document.getElementById("overlayAdjust")?.classList.contains("show"),
      resultWithVal: vals.length,
      pRange: [pMin, pMax],
      vRange: [vMin, vMax],
      // 适配后应大致落在主图价格带附近（允许一定越界）
      overlapOk: vMin < pMax && vMax > pMin && vMax - vMin < (pMax - pMin) * 1.5,
      span1,
      span2,
      scaleBefore,
      scaleAfter,
      apiBefore,
      apiAfter,
      scaleShrinkOk:
        (apiAfter?.userScale != null && apiAfter.userScale <= 0.55) ||
        (Number.isFinite(scaleBefore) &&
          Number.isFinite(scaleAfter) &&
          scaleAfter < scaleBefore * 0.7) ||
        span2 < span1 * 0.7,
      sample: vals.slice(-3),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: "/tmp/overlay-adjust.png", fullPage: true });
  const ok =
    result.adjustShow && result.overlapOk && result.scaleShrinkOk && result.resultWithVal > 50;
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
