/**
 * 验证：期货 AUM/au0 可叠加到比较弹窗
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
  await page.waitForTimeout(1000);

  const result = await page.evaluate(async () => {
    const out = {};
    // 解析别名
    out.au0 = window.__overlayApi
      ? null
      : null;
    // 打开比较 → 期货 → 搜索 au0
    document.getElementById("btnCompare").click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('#cmpFilters [data-filter="futures"]').click();
    await new Promise((r) => setTimeout(r, 500));
    out.browseCount = document.querySelectorAll("#cmpList .cmp-item").length;
    out.browseSample = [...document.querySelectorAll("#cmpList .cmp-item")]
      .slice(0, 3)
      .map((li) => ({ symbol: li.dataset.symbol, name: li.dataset.name }));

    const input = document.getElementById("cmpQuery");
    input.value = "au0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    out.searchAu0 = [...document.querySelectorAll("#cmpList .cmp-item")].map((li) => ({
      symbol: li.dataset.symbol,
      name: li.dataset.name,
      text: li.innerText,
    }));

    input.value = "黄金";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    out.searchGold = [...document.querySelectorAll("#cmpList .cmp-item")].map((li) => ({
      symbol: li.dataset.symbol,
      name: li.dataset.name,
    }));

    // 用 au0 搜索结果点沪金主连叠加
    input.value = "au0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const gold =
      [...document.querySelectorAll("#cmpList .cmp-item")].find((li) =>
        String(li.dataset.symbol || "").includes("AUM")
      ) || document.querySelector("#cmpList .cmp-item");
    out.picked = { symbol: gold?.dataset.symbol, name: gold?.dataset.name };
    if (!gold) {
      out.error = "no gold row";
      return out;
    }
    gold.click();
    await new Promise((r) => setTimeout(r, 4000));

    out.status = document.getElementById("status")?.textContent || "";
    out.chips = document.getElementById("overlayChips")?.innerText || "";
    const ind = (window.__chart.getIndicators({ name: "OVERLAY_CMP" }) || [])[0];
    const vals = (ind?.result || []).map((r) => r?.v).filter((v) => Number.isFinite(v));
    out.resultWithVal = vals.length;
    out.sample = vals.slice(-3);
    out.overlays = window.__overlayApi?.list?.() || [];
    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: "/tmp/futures-compare.png", fullPage: true });
  const ok =
    result.browseCount > 10 &&
    result.searchAu0.some((x) => /AUM|沪金/.test(JSON.stringify(x))) &&
    result.searchGold.some((x) => /AUM|沪金/.test(JSON.stringify(x))) &&
    result.resultWithVal > 50 &&
    /期货|沪金|AUM/.test(result.status + result.chips);
  console.log(ok ? "PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
