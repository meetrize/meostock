/**
 * K 线 / 行情数据层（从 index.html 抽出，供单图页与多面板复用）
 * 优先 GET /api/cache/kline，失败回退 stock-sdk / yfinance / 期货。
 */
import { StockSDK, normalizeSymbol } from "/static/stock-sdk.mjs";
import { FUTURES_CATALOG } from "./futures-catalog.mjs";
import { MINUTE_PERIOD, HISTORY_PERIOD } from "./period.mjs";

const FUTURES_NAME_ALIASES = {
  黄金: ["金", "au", "aum", "au0"],
  白银: ["银", "ag", "agm", "ag0"],
  原油: ["sc", "scm", "sc0", "油"],
  螺纹: ["rb", "rbm", "rb0", "螺"],
  股指: ["if", "ih", "ic", "im", "沪深", "上证", "中证"],
  国债: ["tf", "t", "债"],
  铜: ["cu", "cum", "cu0"],
  铝: ["al", "alm"],
  锌: ["zn", "znm"],
  镍: ["ni", "nim"],
  橡胶: ["ru", "rum"],
  铁矿: ["i", "矿"],
  焦煤: ["jm", "jmm"],
  焦炭: ["j", "jm"],
  豆粕: ["m", "mm", "粕"],
  甲醇: ["ma", "mam"],
  棉花: ["cf", "cfm", "棉"],
  白糖: ["sr", "srm", "糖"],
};

/**
 * @param {InstanceType<typeof StockSDK>} [sdk]
 */
export function createKlineData(sdk = new StockSDK()) {
  function futuresHit(item) {
    return {
      symbol: `fut:${item.symbol}`,
      code: item.symbol,
      name: item.name,
      market: "futures",
      marketLabel: "期货",
      exchange: item.exchange,
      category: "futures",
      assetType: "futures",
    };
  }

  function resolveFutures(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    if (/^fut:/i.test(s)) s = s.slice(4);
    const lower = s.toLowerCase();
    const upper = s.toUpperCase();
    const hit = FUTURES_CATALOG.find(
      (f) =>
        f.symbol.toUpperCase() === upper ||
        f.aliases.some((a) => a.toLowerCase() === lower)
    );
    if (hit) return hit;
    const cm = s.match(/^([a-zA-Z]{1,2})(\d{3,4})$/);
    if (cm) {
      const variety = cm[1];
      const month = cm[2];
      const isCffex = /^(IF|IC|IH|IM|TS|TF|T|TL)$/i.test(variety);
      const code = isCffex ? variety.toUpperCase() + month : variety.toLowerCase() + month;
      return { symbol: code, name: code, exchange: "CN", aliases: [] };
    }
    if (/^[a-zA-Z]{1,3}M$/i.test(s)) {
      return { symbol: upper, name: upper, exchange: "CN", aliases: [] };
    }
    return null;
  }

  function searchFuturesCatalog(keyword) {
    const raw = String(keyword || "").trim();
    if (!raw) return FUTURES_CATALOG.map(futuresHit);
    const q = raw.toLowerCase();
    const tokens = new Set([q, raw]);
    for (const [k, vals] of Object.entries(FUTURES_NAME_ALIASES)) {
      if (raw.includes(k) || q.includes(k)) vals.forEach((v) => tokens.add(v.toLowerCase()));
      if (vals.some((v) => v.toLowerCase() === q || raw.includes(v))) tokens.add(k);
    }
    const tokenList = [...tokens];
    return FUTURES_CATALOG.filter((f) => {
      const blob = `${f.symbol} ${f.name} ${f.aliases.join(" ")} ${f.exchange}`.toLowerCase();
      return tokenList.some(
        (t) =>
          t &&
          (blob.includes(t) ||
            f.name.includes(t) ||
            f.symbol.toLowerCase().includes(t) ||
            f.aliases.some((a) => a.toLowerCase().includes(t)))
      );
    }).map(futuresHit);
  }

  function resolveYf(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    const hadPrefix = /^yf:/i.test(s);
    if (hadPrefix) s = s.slice(3);
    if (!s) return null;
    if (
      hadPrefix ||
      /[=^]/.test(s) ||
      /^[A-Z0-9]{2,12}-USD$/i.test(s) ||
      /^\^[A-Z0-9.]+$/i.test(s) ||
      /\.(SS|SZ|HK|L|T|TO|AX|DE|PA|MI|KS|KQ)$/i.test(s)
    ) {
      return { symbol: s, code: s };
    }
    return null;
  }

  function resolveMarket(input) {
    if (/^yf:/i.test(String(input || "")) || resolveYf(input)) return "YF";
    if (resolveFutures(input)) return "FUT";
    return normalizeSymbol(input).market;
  }

  function canLoadSymbol(input) {
    const s = String(input || "").trim();
    if (!s) return false;
    if (/^yf:/i.test(s) || /^fut:/i.test(s)) return true;
    if (resolveFutures(s) || resolveYf(s)) return true;
    try {
      normalizeSymbol(s);
      return true;
    } catch (_) {
      return false;
    }
  }

  function toSdkApiSymbol(input, market) {
    const raw = String(input || "").trim();
    let m = market;
    let code = raw;
    try {
      const n = normalizeSymbol(raw);
      m = m || n.market;
      code = n.code || raw;
    } catch (_) {}
    if (m === "HK") {
      const digits = String(code).replace(/^hk/i, "").replace(/\D/g, "") || code;
      return digits.length <= 5 ? digits.padStart(5, "0") : digits;
    }
    if (m === "US") {
      let t = String(code).replace(/^us/i, "").toUpperCase();
      t = t.replace(/\.(OQ|N|A|O|P|OB|PK|OTC)$/i, "");
      return t;
    }
    return raw;
  }

  function toYahooHkSymbol(hkCode) {
    const digits = String(hkCode || "").replace(/\D/g, "");
    const bare = digits.replace(/^0+/, "") || "0";
    return `${bare.padStart(4, "0")}.HK`;
  }

  function toBars(rows) {
    return (rows || [])
      .map((b) => {
        let ts = b.timestamp;
        if (ts == null) {
          const raw = b.time || b.date;
          if (!raw) return null;
          const parsed = Date.parse(String(raw).replace(/-/g, "/"));
          if (!Number.isFinite(parsed)) return null;
          ts = parsed;
        }
        const close = Number(b.close ?? b.price ?? b.avgPrice);
        if (!Number.isFinite(close)) return null;
        const open = Number(b.open ?? close);
        const high = Number(b.high ?? Math.max(open, close));
        const low = Number(b.low ?? Math.min(open, close));
        const bar = {
          timestamp: Number(ts),
          open,
          high,
          low,
          close,
          volume: Number(b.volume ?? 0),
          turnover: Number(b.amount ?? 0),
        };
        const avg = Number(b.avgPrice);
        if (Number.isFinite(avg)) bar.avgPrice = avg;
        return bar;
      })
      .filter((b) => b && Number.isFinite(b.timestamp) && Number.isFinite(b.close))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async function fetchYfChartBars(yfSymbol, period) {
    let sym = yfSymbol;
    if (/^(CNH|USDCNH)=X$/i.test(sym)) sym = "USDCNY=X";
    const res = await fetch(
      `/api/yf/kline?symbol=${encodeURIComponent(sym)}&period=${encodeURIComponent(period || "1d")}`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "yfinance K线失败");
    let bars = data.bars || [];
    if (bars.length < 5 && /CNY|CNH/i.test(String(yfSymbol))) {
      const fb = await fetch(
        `/api/yf/kline?symbol=${encodeURIComponent("USDCNY=X")}&period=${encodeURIComponent(period || "1d")}`
      );
      const fd = await fb.json();
      if (fd.ok && (fd.bars || []).length > bars.length) {
        bars = fd.bars;
        sym = "USDCNY=X";
        data.name = fd.name || "美元/人民币";
      }
    }
    if (!bars.length) throw new Error(`yfinance 无 K 线: ${yfSymbol}`);
    return { bars, name: data.name || sym, symbol: sym };
  }

  async function fetchQuote(symbol) {
    const fut = resolveFutures(symbol);
    if (fut) {
      const rows = await sdk.futures.kline(fut.symbol, { period: "daily" });
      const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
      if (!last) throw new Error("期货行情为空");
      return {
        market: "FUT",
        quote: {
          code: fut.symbol,
          name: last.name || fut.name,
          price: Number(last.close),
          change: Number(last.change ?? 0),
          changePercent: Number(last.changePercent ?? 0),
          prevClose: Number(last.close) - Number(last.change ?? 0),
        },
      };
    }
    const yf =
      resolveYf(symbol) ||
      (/^yf:/i.test(String(symbol || "")) ? { symbol: String(symbol).slice(3) } : null);
    if (yf && yf.symbol) {
      const code = yf.symbol;
      const res = await fetch(`/api/yf/quotes?symbols=${encodeURIComponent(code)}`);
      const data = await res.json();
      const q = (data.ok && Array.isArray(data.quotes) && data.quotes[0]) || null;
      if (!q) throw new Error("yfinance 行情为空");
      return {
        market: "YF",
        quote: {
          code: q.code || code,
          name: q.name || code,
          price: Number(q.price),
          change: Number(q.change ?? 0),
          changePercent: Number(q.changePercent ?? 0),
          prevClose: q.prevClose != null ? Number(q.prevClose) : undefined,
          open: q.open != null ? Number(q.open) : undefined,
          high: q.high != null ? Number(q.high) : undefined,
          low: q.low != null ? Number(q.low) : undefined,
          volume: q.volume != null ? Number(q.volume) : undefined,
        },
      };
    }
    const market = resolveMarket(symbol);
    const apiSym = toSdkApiSymbol(symbol, market);
    let list;
    if (market === "US") list = await sdk.quotes.us([apiSym]);
    else if (market === "HK") list = await sdk.quotes.hk([apiSym]);
    else if (market === "YF") throw new Error("yfinance 行情为空");
    else list = await sdk.quotes.cnSimple([apiSym]);
    if (!list?.length) throw new Error("行情为空");
    return { market, quote: list[0] };
  }

  /**
   * @param {string} symbol
   * @param {string} period
   * @param {{ force?: boolean, localFirst?: boolean }} [opts]
   */
  async function fetchKlineFromCache(symbol, period, opts = {}) {
    const force = !!opts.force;
    const localFirst = !!opts.localFirst;
    const qs = new URLSearchParams({
      symbol: String(symbol || "").trim(),
      period: period === "fs" ? "1m" : period || "1d",
    });
    if (force) qs.set("force", "1");
    if (localFirst) qs.set("local_first", "1");
    const res = await fetch(`/api/cache/kline?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !Array.isArray(data.bars) || !data.bars.length) {
      throw new Error(data.error || "本地 K 线缓存未命中");
    }
    const mkt = String(data.market || "").toUpperCase();
    const out = {
      market: mkt === "YF" ? "YF" : mkt === "FUTURES" ? "FUT" : mkt || "CN",
      bars: data.bars,
      source: data.from_cache ? `cache:${data.source || "local"}` : data.source || "cache",
      fromCache: Boolean(data.from_cache),
      stale: Boolean(data.stale),
      refreshing: Boolean(data.refreshing),
      name: data.name,
    };
    if (out.market === "YF" || String(symbol).toLowerCase().startsWith("yf:")) {
      out.market = "YF";
      out.yf = { symbol: data.code || String(symbol).replace(/^yf:/i, ""), name: data.name };
    }
    if (out.market === "FUT" || String(symbol).toLowerCase().startsWith("fut:")) {
      const fut = resolveFutures(symbol);
      out.market = "FUT";
      if (fut) out.futures = fut;
    }
    return out;
  }

  async function fetchKlineLegacy(symbol, period) {
    const rawSym = String(symbol || "").trim();
    if (/^yf:/i.test(rawSym)) {
      const code = rawSym.slice(3);
      const yfPeriod = period === "fs" ? "1m" : period || "1d";
      const res = await fetch(
        `/api/yf/kline?symbol=${encodeURIComponent(code)}&period=${encodeURIComponent(yfPeriod)}`
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "yfinance K线失败");
      return { market: "YF", bars: data.bars || [], yf: { symbol: code, name: data.name } };
    }
    const fut = resolveFutures(symbol);
    if (fut) {
      const periodMap = { "1d": "daily", "1w": "weekly" };
      const fp = periodMap[period] || "daily";
      let rows = await sdk.futures.kline(fut.symbol, { period: fp });
      if (!Array.isArray(rows) || !rows.length) {
        throw new Error(`期货 ${fut.symbol} K线为空（主连如 AUM/au0，股指如 IFM）`);
      }
      if (rows.length > 500) rows = rows.slice(-500);
      return { market: "FUT", bars: toBars(rows), futures: fut };
    }
    const market = resolveMarket(symbol);
    const apiSym = toSdkApiSymbol(symbol, market);
    const isMinute = period in MINUTE_PERIOD;

    if (market === "HK" || market === "US") {
      const yfSym = market === "HK" ? toYahooHkSymbol(apiSym) : apiSym;
      const yfPeriod = period === "fs" ? "1m" : period || "1d";
      try {
        const yf = await fetchYfChartBars(yfSym, yfPeriod);
        return {
          market,
          bars: yf.bars,
          yf: { symbol: yf.symbol, name: yf.name },
          source: "yfinance",
        };
      } catch (yfErr) {
        try {
          let rows;
          if (isMinute) {
            const p = MINUTE_PERIOD[period];
            rows =
              market === "US"
                ? await sdk.kline.usMinute(apiSym, { period: p })
                : await sdk.kline.hkMinute(apiSym, { period: p });
          } else {
            const p = HISTORY_PERIOD[period] || "daily";
            rows =
              market === "US"
                ? await sdk.kline.us(apiSym, { period: p, adjust: "qfq" })
                : await sdk.kline.hk(apiSym, { period: p, adjust: "qfq" });
          }
          if (!Array.isArray(rows) || !rows.length) throw new Error("东财 K 线为空");
          if (!isMinute && rows.length > 500) rows = rows.slice(-500);
          return { market, bars: toBars(rows), source: "eastmoney" };
        } catch (_) {
          throw new Error(
            `${market === "HK" ? "港股" : "美股"} K 线不可用：东财 push2his 断连，Yahoo(${yfSym}) 亦失败（${
              yfErr.message || yfErr
            }）`
          );
        }
      }
    }

    // A 股：sdk/东财优先；断连时回退 Yahoo（300298.SZ / 600036.SS）
    const toYahooCn = (raw) => {
      const s = String(raw || "").toLowerCase();
      const code = (s.replace(/^(sh|sz|bj)/, "").match(/\d{6}/) || [])[0] || "";
      if (!code) return "";
      // 北交所优先（92/4/8），勿把 92xxxx 误判为沪市 9xx → .SS
      if (s.startsWith("bj") || code.startsWith("4") || code.startsWith("8") || code.startsWith("92")) {
        return `${code}.BJ`;
      }
      if (s.startsWith("sh") || code.startsWith("5") || code.startsWith("6") || code.startsWith("9")) {
        return `${code}.SS`;
      }
      return `${code}.SZ`;
    };

    try {
      let rows;
      if (isMinute) {
        const p = MINUTE_PERIOD[period];
        if (period === "fs") {
          rows = await sdk.kline.cnMinute(apiSym, { period: "1" });
        } else {
          rows = await sdk.kline.cnMinute(apiSym, { period: p });
        }
      } else {
        const p = HISTORY_PERIOD[period] || "daily";
        rows = await sdk.kline.cn(apiSym, { period: p, adjust: "qfq" });
      }
      if (!isMinute && Array.isArray(rows) && rows.length > 500) rows = rows.slice(-500);
      const bars = toBars(rows);
      if (!bars.length) throw new Error("A股 K 线为空");
      return { market, bars, source: "stock-sdk" };
    } catch (cnErr) {
      const yfSym = toYahooCn(apiSym || symbol);
      if (!yfSym) throw cnErr;
      try {
        const yfPeriod = period === "fs" ? "1m" : period || "1d";
        const yf = await fetchYfChartBars(yfSym, yfPeriod);
        return {
          market,
          bars: yf.bars,
          yf: { symbol: yf.symbol, name: yf.name },
          source: "yfinance",
        };
      } catch (yfErr) {
        throw new Error(
          `A股 K 线不可用：${cnErr.message || cnErr}；Yahoo(${yfSym}) 亦失败（${yfErr.message || yfErr}）`
        );
      }
    }
  }

  async function fetchKline(symbol, period, { force = false, localFirst = false } = {}) {
    try {
      return await fetchKlineFromCache(symbol, period, { force, localFirst });
    } catch (cacheErr) {
      try {
        return await fetchKlineLegacy(symbol, period);
      } catch (legacyErr) {
        throw new Error(
          `${legacyErr.message || legacyErr}（本地缓存：${cacheErr.message || cacheErr}）`
        );
      }
    }
  }

  /**
   * 多面板首选：先读盘（local_first），未命中再走完整拉数。
   * 返回结果若 fromCache+stale，调用方应再 schedule force 刷新。
   */
  async function fetchKlineFast(symbol, period) {
    try {
      return await fetchKlineFromCache(symbol, period, { localFirst: true });
    } catch (_) {
      return await fetchKline(symbol, period, { force: false });
    }
  }

  return {
    sdk,
    toBars,
    fetchKline,
    fetchKlineFast,
    fetchKlineFromCache,
    fetchKlineLegacy,
    fetchQuote,
    resolveMarket,
    resolveFutures,
    resolveYf,
    canLoadSymbol,
    toSdkApiSymbol,
    toYahooHkSymbol,
    searchFuturesCatalog,
    FUTURES_CATALOG,
  };
}

/** 默认单例（多面板 / 页面可直接用） */
let _default = null;
export function getKlineData() {
  if (!_default) _default = createKlineData();
  return _default;
}
