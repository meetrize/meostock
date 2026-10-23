/**
 * 各市场「当日开盘」时间，用于隐 Y 轴后把视口左缘对齐开盘、右缘贴最新 K。
 */

function partsInTz(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour") === "24" ? "0" : get("hour")),
    mi: Number(get("minute")),
  };
}

/** 将某时区的本地年月日时分转为 UTC ms */
function localToUtcMs(timeZone, y, mo, d, h, mi) {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 5; i++) {
    const p = partsInTz(t, timeZone);
    const deltaMin = h * 60 + mi - (p.h * 60 + p.mi);
    const deltaDay =
      (Date.UTC(y, mo - 1, d) - Date.UTC(p.y, p.mo - 1, p.d)) / 86_400_000;
    if (deltaMin === 0 && deltaDay === 0) break;
    t += deltaMin * 60_000 + deltaDay * 86_400_000;
  }
  return t;
}

/**
 * @param {string} market  CN|HK|US|FUT|YF
 * @param {string} [symbol]
 * @returns {{ timeZone: string, openHour: number, openMinute: number, label: string }}
 */
export function getSessionOpenSpec(market, symbol = "") {
  const m = String(market || "CN").toUpperCase();
  const sym = String(symbol || "");

  if (m === "HK") {
    return { timeZone: "Asia/Hong_Kong", openHour: 9, openMinute: 30, label: "港股 09:30" };
  }
  if (m === "US") {
    return { timeZone: "America/New_York", openHour: 9, openMinute: 30, label: "美股 09:30 ET" };
  }
  if (m === "FUT") {
    // 国内商品日盘多数 09:00；股指期货 09:30
    const code = sym.replace(/^fut:/i, "").toUpperCase();
    const isIndex = /^(IF|IH|IC|IM|TS|TF|T|TL)/.test(code);
    return {
      timeZone: "Asia/Shanghai",
      openHour: isIndex ? 9 : 9,
      openMinute: isIndex ? 30 : 0,
      label: isIndex ? "股指期 09:30" : "商品期 09:00",
    };
  }
  if (m === "YF") {
    const s = sym.replace(/^yf:/i, "").toUpperCase();
    // 加密 / 外汇近似 7×24：用「当天 0 点」UTC 作为窗口起点
    if (
      /-USD$/.test(s) ||
      /USDT|BTC|ETH|CRYPTO/.test(s) ||
      /=X$/.test(s) ||
      s.includes("=X")
    ) {
      return { timeZone: "UTC", openHour: 0, openMinute: 0, label: "24h 当日 00:00 UTC" };
    }
    // 其它 yfinance 标的按美股常规时段
    return { timeZone: "America/New_York", openHour: 9, openMinute: 30, label: "YF≈美股 09:30 ET" };
  }
  // A 股 / 基金 / 指数
  return { timeZone: "Asia/Shanghai", openHour: 9, openMinute: 30, label: "A股 09:30" };
}

/**
 * 以数据最后一根所在交易日为准，返回该日开盘时间戳（ms）。
 * @param {string} market
 * @param {string} symbol
 * @param {Array<{timestamp:number}>} bars
 * @returns {number|null}
 */
export function resolveSessionOpenTs(market, symbol, bars) {
  const list = Array.isArray(bars) ? bars.filter((b) => b && Number.isFinite(b.timestamp)) : [];
  if (!list.length) return null;
  // 跳过分时补齐产生的未来空槽，用最后一根有效 close
  let ref = list[list.length - 1];
  for (let i = list.length - 1; i >= 0; i--) {
    if (Number.isFinite(list[i].close)) {
      ref = list[i];
      break;
    }
  }
  const spec = getSessionOpenSpec(market, symbol);
  const p = partsInTz(ref.timestamp, spec.timeZone);
  return localToUtcMs(spec.timeZone, p.y, p.mo, p.d, spec.openHour, spec.openMinute);
}

/** 分钟/分时周期：适合「当日起」铺满 */
export function isIntradayPeriod(period) {
  return ["fs", "1m", "5m", "15m", "1h"].includes(String(period || "").toLowerCase());
}
