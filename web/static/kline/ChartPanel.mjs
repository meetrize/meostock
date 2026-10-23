/**
 * 单格 K 线面板（可多实例；不依赖页面级全局 chart）
 */
import { PERIOD_MAP, isValidPeriod } from "./period.mjs";
import {
  DEFAULT_SETTINGS,
  buildChartStyles,
  applyYAxisOptions,
  activeMaParams,
  loadMaParams,
  loadChartSettings,
  THEME_KEY,
} from "./styles.mjs";
import { FS_DAY_SLOTS, padCnFsBarsLatestDay } from "./fs.mjs";
import { mountChrome, updateChrome, unmountChrome } from "./chrome.mjs";

function readTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" ? "dark" : "light";
  } catch (_) {
    return "light";
  }
}

function marketTimezone(market) {
  if (market === "US") return "America/New_York";
  if (market === "HK") return "Asia/Hong_Kong";
  return "Asia/Shanghai";
}

function featureColor() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "#8b98a8"
    : "#6b7785";
}

function buildFeatures(visible) {
  const base = {
    position: "middle",
    marginLeft: 6,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    paddingLeft: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    size: 14,
    color: featureColor(),
    activeColor: featureColor(),
    backgroundColor: "transparent",
    activeBackgroundColor: "rgba(47, 111, 237, 0.15)",
    borderRadius: 2,
    type: "icon_font",
  };
  return [
    {
      ...base,
      id: visible ? "invisible" : "visible",
      content: { family: "sans-serif", code: visible ? "⊘" : "◉" },
    },
    {
      ...base,
      id: "close",
      content: { family: "sans-serif", code: "✕" },
    },
  ];
}

function tooltipSource({ indicator }) {
  return { features: buildFeatures(!!indicator.visible) };
}

/**
 * @typedef {object} ChartPanelOptions
 * @property {HTMLElement} container  面板根节点（会清空并放入 chart-host）
 * @property {ReturnType<import('./data.mjs').createKlineData>} data
 * @property {(msg: string, panel?: ChartPanel) => void} [onStatus]
 * @property {(fn: () => Promise<any>) => Promise<any>} [schedule]  并发池
 * @property {string} [symbol]
 * @property {string} [period]
 * @property {object} [settings]
 * @property {boolean} [withVolume=true]  默认挂 VOL 副图
 */

export class ChartPanel {
  /**
   * @param {ChartPanelOptions} opts
   */
  constructor(opts) {
    if (!opts?.container) throw new Error("ChartPanel: container required");
    if (!opts?.data) throw new Error("ChartPanel: data required");

    this.container = opts.container;
    this.data = opts.data;
    this.onStatus = opts.onStatus || (() => {});
    this.schedule = opts.schedule || ((fn) => fn());
    /** 后台 force 刷新用（建议更小并发，如 2） */
    this.scheduleRefresh = opts.scheduleRefresh || this.schedule;
    /** @type {(data: object, panel: ChartPanel) => void} */
    this.onCrosshair = opts.onCrosshair || null;

    this.symbol = String(opts.symbol || "").trim();
    this.period = isValidPeriod(opts.period) ? opts.period : "1d";
    this.settings = { ...DEFAULT_SETTINGS, ...loadChartSettings(), ...(opts.settings || {}) };
    this.maParams = loadMaParams();
    this.withVolume = opts.withVolume !== false;
    /** 单格改过周期后，全体周期切换跳过本格 */
    this.periodLocked = !!opts.periodLocked;
    /** 单格改过图形类型后，全体图形切换跳过本格 */
    this.chartTypeLocked = !!opts.chartTypeLocked;

    this.chart = null;
    this._host = null;
    this._ro = null;
    this._loadSeq = 0;
    this._disposed = false;
    this._quote = null;
    this._name = "";
    this.mainIndicators = [];
    this.subIndicators = {};
    this._syncingCrosshair = false;
    /** @type {any[]|null} resetData 时直接喂给 getBars，避免二次请求 */
    this._pendingBars = null;

    this._ensureDom();
  }

  _ensureDom() {
    this.container.innerHTML = "";
    this.container.classList.add("mp-cell");
    this._host = document.createElement("div");
    this._host.className = "chart-host";
    this.container.appendChild(this._host);

    this._ro = new ResizeObserver(() => {
      this.resize();
    });
    this._ro.observe(this.container);

    mountChrome(this);
  }

  _refreshChrome() {
    try {
      updateChrome(this);
    } catch (_) {}
  }

  _status(msg) {
    this.onStatus(msg, this);
  }

  _kc() {
    const kc = typeof klinecharts !== "undefined" ? klinecharts : null;
    if (!kc?.init) throw new Error("klinecharts 未加载");
    return kc;
  }

  _applyStyles() {
    if (!this.chart) return;
    this.chart.setStyles(
      buildChartStyles({ settings: this.settings, period: this.period })
    );
    applyYAxisOptions(this.chart, this.settings);
  }

  _createInd(name, isStack, paneId) {
    const params = activeMaParams(this.maParams);
    const opts = {
      name,
      createTooltipDataSource: tooltipSource,
    };
    if (paneId) opts.paneId = paneId;
    if (name === "MA" || name === "VOL" || name === "EMA") {
      opts.calcParams = [...params];
    }
    return this.chart.createIndicator(opts, isStack);
  }

  _ensureChart(market) {
    const tz = marketTimezone(market);
    if (this.chart) {
      try {
        this.chart.setTimezone(tz);
      } catch (_) {}
      return this.chart;
    }
    const { init } = this._kc();
    const theme = readTheme();
    this.chart = init(this._host, {
      locale: "zh-CN",
      timezone: tz,
      styles: theme,
      layout: {
        yAxis: {
          type: this.settings.axisType || "normal",
          reverse: !!this.settings.axisReverse,
        },
      },
    });
    this._applyStyles();
    this.mainIndicators = ["MA"];
    this.subIndicators = {};
    this._createInd("MA", true, "candle_pane");
    if (this.withVolume) {
      const volPane = this._createInd("VOL", false);
      if (volPane) this.subIndicators.VOL = volPane;
    }

    this.chart.subscribeAction("onIndicatorTooltipFeatureClick", (data) => {
      const featureId = data?.feature?.id;
      const ind = data?.indicator;
      const paneId = data?.paneId;
      if (!featureId || !ind || !this.chart) return;
      if (featureId === "visible") {
        this.chart.overrideIndicator({
          id: ind.id,
          visible: true,
          createTooltipDataSource: tooltipSource,
        });
      } else if (featureId === "invisible") {
        this.chart.overrideIndicator({
          id: ind.id,
          visible: false,
          createTooltipDataSource: tooltipSource,
        });
      } else if (featureId === "close") {
        if (paneId === "candle_pane") {
          this.chart.removeIndicator({ paneId: "candle_pane", name: ind.name });
          this.mainIndicators = this.mainIndicators.filter((n) => n !== ind.name);
        } else if (paneId) {
          this.chart.removeIndicator({ paneId, name: ind.name });
          delete this.subIndicators[ind.name];
        }
      }
    });

    this.chart.subscribeAction("onCrosshairChange", (data) => {
      if (this._syncingCrosshair || !this.onCrosshair) return;
      try {
        this.onCrosshair(data, this);
      } catch (_) {}
    });

    requestAnimationFrame(() => this.resize());
    return this.chart;
  }

  toggleMain(name, added) {
    if (!this.chart) return;
    if (added) {
      if (!this.mainIndicators.includes(name)) {
        this._createInd(name, true, "candle_pane");
        this.mainIndicators.push(name);
      }
    } else {
      this.chart.removeIndicator({ paneId: "candle_pane", name });
      this.mainIndicators = this.mainIndicators.filter((n) => n !== name);
    }
  }

  toggleSub(name, added) {
    if (!this.chart) return;
    if (added) {
      if (!(name in this.subIndicators)) {
        const paneId = this._createInd(name, false);
        if (paneId) this.subIndicators[name] = paneId;
      }
    } else if (this.subIndicators[name]) {
      this.chart.removeIndicator({ paneId: this.subIndicators[name], name });
      delete this.subIndicators[name];
    }
  }

  setMaParams(params) {
    this.maParams = Array.isArray(params) ? params : loadMaParams();
    this.syncMaToChart();
    return this;
  }

  syncMaToChart() {
    if (!this.chart) return;
    const params = activeMaParams(this.maParams);
    const list = this.chart.getIndicators?.() || [];
    list.forEach((ind) => {
      if (ind.name === "MA" || ind.name === "VOL" || ind.name === "EMA") {
        try {
          this.chart.overrideIndicator({
            id: ind.id,
            calcParams: [...params],
          });
        } catch (_) {}
      }
    });
  }

  /**
   * 十字线同步：按时间戳对齐（其它面板调用）
   * @param {{ timestamp?: number, paneId?: string, y?: number } | null} payload
   */
  syncCrosshairFrom(payload) {
    if (!this.chart || this._disposed) return;
    this._syncingCrosshair = true;
    try {
      const ts = Number(payload?.timestamp);
      if (!Number.isFinite(ts) || typeof this.chart.timestampToDataIndex !== "function") {
        return;
      }
      const idx = this.chart.timestampToDataIndex(ts);
      if (!Number.isFinite(idx) || idx < 0) return;
      const x = this.chart.dataIndexToCoordinate?.(idx);
      if (!Number.isFinite(x)) return;
      const point = {
        x,
        paneId: payload.paneId || "candle_pane",
      };
      if (Number.isFinite(Number(payload.y))) point.y = Number(payload.y);
      this.chart.setCrosshair?.(point, { notExecuteAction: true });
    } catch (_) {
    } finally {
      queueMicrotask(() => {
        this._syncingCrosshair = false;
      });
    }
  }

  /**
   * 从本图十字线事件提取可同步字段
   */
  static extractCrosshairPayload(data, chart) {
    if (!data || !data.paneId) return null;
    let timestamp = data.timestamp ?? data?.kLineData?.timestamp;
    let dataIndex = data.dataIndex ?? data.realDataIndex;
    if (!Number.isFinite(Number(timestamp)) && chart) {
      try {
        if (Number.isFinite(Number(dataIndex)) && typeof chart.dataIndexToTimestamp === "function") {
          timestamp = chart.dataIndexToTimestamp(Number(dataIndex));
        } else if (Number.isFinite(Number(data.x)) && typeof chart.coordinateToDataIndex === "function") {
          dataIndex = chart.coordinateToDataIndex(Number(data.x));
          timestamp = chart.dataIndexToTimestamp?.(dataIndex);
        }
      } catch (_) {}
    }
    if (!Number.isFinite(Number(timestamp))) return null;
    return {
      timestamp: Number(timestamp),
      paneId: data.paneId || "candle_pane",
      y: Number.isFinite(Number(data.y)) ? Number(data.y) : undefined,
    };
  }

  _fitFsViewport() {
    if (!this.chart || !this._host) return;
    try {
      const w = this._host.clientWidth || 400;
      const space = Math.max(1.5, Math.min(6, (w - 48) / FS_DAY_SLOTS));
      this.chart.setBarSpace(space);
      if (typeof this.chart.scrollToRealTime === "function") {
        this.chart.scrollToRealTime();
      } else if (typeof this.chart.setOffsetRightDistance === "function") {
        this.chart.setOffsetRightDistance(0);
      }
    } catch (_) {}
  }

  _prepareBars(rawBars) {
    let bars = rawBars || [];
    if (this.period === "fs") {
      bars = padCnFsBarsLatestDay(bars);
      try {
        const w = this._host?.clientWidth || 400;
        this.chart?.setBarSpace(Math.max(1.5, Math.min(6, (w - 48) / FS_DAY_SLOTS)));
      } catch (_) {}
    }
    return bars;
  }

  _applyLoadedMeta(data, bars, { soft = false } = {}) {
    if (data.name) this._name = data.name;
    else if (data.yf?.name) this._name = data.yf.name;
    else if (data.futures?.name) this._name = data.futures.name;
    this._refreshChrome();

    const src =
      data.source === "yfinance"
        ? `yfinance${data.yf?.symbol ? `(${data.yf.symbol})` : ""}`
        : data.source || "stock-sdk";
    const tag = data.fromCache
      ? data.stale
        ? "缓存·刷新中"
        : "缓存"
      : src;
    this._status(
      `${this.symbol} · ${this.period} · ${bars.length} 根 · ${tag}` +
        (this._name ? ` · ${this._name}` : "") +
        (soft ? "" : "")
    );
  }

  /**
   * 后台 force 刷新后用 resetData 换图（不阻塞首屏）
   */
  _scheduleBackgroundRefresh(symbol, seq) {
    const fetchFresh =
      typeof this.data.fetchKline === "function"
        ? () => this.data.fetchKline(symbol, this.period, { force: true })
        : null;
    if (!fetchFresh) return;

    this.scheduleRefresh(() =>
      fetchFresh()
        .then((data) => {
          if (this._disposed || seq !== this._loadSeq || !this.chart) return;
          const bars = this._prepareBars(data.bars || []);
          if (!bars.length) return;
          this._pendingBars = bars;
          this._applyLoadedMeta(data, bars);
          try {
            this.chart.resetData();
          } catch (_) {
            this._pendingBars = null;
          }
          queueMicrotask(() => {
            if (this._disposed || seq !== this._loadSeq) return;
            try {
              this.chart.resize();
            } catch (_) {}
            if (this.period === "fs") this._fitFsViewport();
          });
        })
        .catch(() => {
          /* 后台失败保留首屏缓存图 */
        })
    );
  }

  _bindDataLoader() {
    const symbol = this.symbol;
    let market = "CN";
    try {
      market = this.data.resolveMarket(symbol);
    } catch (_) {}
    const c = this._ensureChart(market);
    c.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
    c.setPeriod(PERIOD_MAP[this.period] || PERIOD_MAP["1d"]);

    const seq = ++this._loadSeq;
    const self = this;
    this._pendingBars = null;

    c.setDataLoader({
      async getBars({ type, callback }) {
        if (self._disposed || seq !== self._loadSeq) {
          callback([], false);
          return;
        }
        if (type !== "init") {
          callback([], false);
          return;
        }

        // resetData 注入的新数据：直接出图，不再打网
        if (self._pendingBars) {
          const bars = self._pendingBars;
          self._pendingBars = null;
          callback(
            bars,
            self.period === "fs" ? { forward: false, backward: false } : false
          );
          return;
        }

        try {
          self._status(`加载 ${symbol} ${self.period} …`);
          const fetchFast =
            typeof self.data.fetchKlineFast === "function"
              ? () => self.data.fetchKlineFast(symbol, self.period)
              : () => self.data.fetchKline(symbol, self.period, { localFirst: true });
          const data = await self.schedule(fetchFast);
          if (self._disposed || seq !== self._loadSeq) {
            callback([], false);
            return;
          }
          self._ensureChart(data.market);
          self._applyStyles();

          const bars = self._prepareBars(data.bars || []);
          callback(
            bars,
            self.period === "fs" ? { forward: false, backward: false } : false
          );
          self._applyLoadedMeta(data, bars);

          // 缓存脏数据 / 服务端已在刷：客户端再 force 一次，保证图更新
          const needRefresh = !!(data.fromCache && (data.stale || data.refreshing));
          if (needRefresh) {
            self._scheduleBackgroundRefresh(symbol, seq);
          }

          queueMicrotask(() => {
            if (self._disposed || seq !== self._loadSeq) return;
            try {
              self.chart.resize();
            } catch (_) {}
            if (self.period === "fs") self._fitFsViewport();
          });
        } catch (e) {
          self._status(`加载失败 ${symbol}: ${e.message || e}`);
          callback([], false);
        }
      },
    });
  }

  setSymbol(symbol) {
    this.symbol = String(symbol || "").trim();
    this._quote = null;
    this._name = "";
    this._refreshChrome();
    return this;
  }

  /**
   * @param {string} period
   * @param {{ lock?: boolean }} [opts] lock=true 表示单格手动切换，全体周期不再覆盖
   */
  setPeriod(period, opts = {}) {
    if (!isValidPeriod(period)) return this;
    this.period = period;
    if (opts.lock) this.periodLocked = true;
    if (this.chart) this._applyStyles();
    this._refreshChrome();
    return this;
  }

  /** 全体周期：已锁定的面板跳过 */
  applyGlobalPeriod(period) {
    if (this.periodLocked) return this;
    return this.setPeriod(period, { lock: false });
  }

  clearPeriodLock() {
    this.periodLocked = false;
    this._refreshChrome();
    return this;
  }

  /**
   * @param {string} type
   * @param {{ lock?: boolean }} [opts]
   */
  setCandleType(type, opts = {}) {
    this.settings = { ...this.settings, candleType: type };
    if (opts.lock) this.chartTypeLocked = true;
    this._applyStyles();
    this._refreshChrome();
    return this;
  }

  applyGlobalCandleType(type) {
    if (this.chartTypeLocked) return this;
    return this.setCandleType(type, { lock: false });
  }

  clearChartTypeLock() {
    this.chartTypeLocked = false;
    this._refreshChrome();
    return this;
  }

  setSettings(partial) {
    this.settings = { ...this.settings, ...(partial || {}) };
    this._applyStyles();
    this._refreshChrome();
    return this;
  }

  setHideYAxis(hide) {
    return this.setSettings({ hideYAxis: !!hide });
  }

  /**
   * 主题变更后重刷样式（不重建实例）
   */
  refreshTheme() {
    if (!this.chart) return;
    try {
      const theme = readTheme();
      // setStyles 命名主题 + 自定义覆盖
      this.chart.setStyles(theme);
    } catch (_) {}
    this._applyStyles();
    this.resize();
  }

  async load() {
    if (this._disposed) return;
    const symbol = this.symbol;
    if (!symbol) {
      this._status("空面板");
      return;
    }
    if (!this.data.canLoadSymbol(symbol)) {
      this._status(`无效代码: ${symbol}`);
      return;
    }
    this._refreshChrome();
    this._bindDataLoader();
    try {
      const { quote } = await this.schedule(() => this.data.fetchQuote(symbol));
      if (!this._disposed) {
        this._quote = quote;
        if (quote?.name) this._name = quote.name;
        this._refreshChrome();
      }
    } catch (_) {
      /* 报价失败不影响 K 线 */
    }
  }

  resize() {
    if (!this.chart || this._disposed) return;
    try {
      this.chart.resize();
    } catch (_) {}
  }

  getState() {
    return {
      symbol: this.symbol,
      period: this.period,
      name: this._name,
      quote: this._quote,
      settings: { ...this.settings },
      periodLocked: this.periodLocked,
      chartTypeLocked: this.chartTypeLocked,
    };
  }

  dispose() {
    this._disposed = true;
    this._loadSeq += 1;
    try {
      unmountChrome(this);
    } catch (_) {}
    if (this._ro) {
      try {
        this._ro.disconnect();
      } catch (_) {}
      this._ro = null;
    }
    if (this.chart) {
      const chartRef = this.chart;
      const hostRef = this._host;
      this.chart = null;
      try {
        const { dispose } = this._kc();
        try {
          dispose(chartRef);
        } catch (_) {
          if (hostRef) dispose(hostRef);
        }
      } catch (_) {}
    }
    if (this.container) {
      this.container.innerHTML = "";
    }
    this._host = null;
  }
}
