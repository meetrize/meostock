/**
 * K 线右侧分栏：拖拽、开关、Tab 路由。
 * 依赖 DOM：#mainSplit / #sidePanel / #sideSplitter / #sideRail / #sideBody
 */
(function (global) {
  const LS = {
    open: "kline.side.open",
    ratio: "kline.side.ratio",
    tab: "kline.side.tab",
  };

  const TABS = [
    { id: "ai", title: "AI" },
    { id: "report", title: "AI报告" },
    { id: "news", title: "资讯" },
    { id: "f10", title: "F10" },
  ];

  const state = {
    open: true,
    ratio: 0.36,
    tab: "ai",
    symbol: "",
    market: "CN",
    onLayoutChange: null,
    onTabChange: null,
    onSymbolChange: null,
  };

  function clampRatio(r) {
    const n = Number(r);
    if (!Number.isFinite(n)) return 0.36;
    return Math.max(0.1, Math.min(0.9, n));
  }

  function readStored() {
    try {
      const openRaw = localStorage.getItem(LS.open);
      if (openRaw === "0" || openRaw === "false") state.open = false;
      else if (openRaw === "1" || openRaw === "true") state.open = true;
      const ratio = localStorage.getItem(LS.ratio);
      if (ratio != null) state.ratio = clampRatio(ratio);
      const tab = localStorage.getItem(LS.tab);
      if (tab && TABS.some((t) => t.id === tab)) state.tab = tab;
    } catch (_) {}
  }

  function persist() {
    try {
      localStorage.setItem(LS.open, state.open ? "1" : "0");
      localStorage.setItem(LS.ratio, String(state.ratio));
      localStorage.setItem(LS.tab, state.tab);
    } catch (_) {}
  }

  function el(id) {
    return document.getElementById(id);
  }

  function notifyLayout() {
    if (typeof state.onLayoutChange === "function") {
      try {
        state.onLayoutChange();
      } catch (_) {}
    }
  }

  function applyRatio() {
    const split = el("mainSplit");
    if (!split) return;
    split.style.setProperty("--side-ratio", String(state.ratio));
  }

  function applyOpen() {
    const split = el("mainSplit");
    if (!split) return;
    split.setAttribute("data-side-open", state.open ? "1" : "0");
    const closeBtn = el("sideCloseBtn");
    if (closeBtn) closeBtn.title = state.open ? "关闭侧栏" : "打开侧栏";
  }

  function setOpen(open) {
    state.open = !!open;
    applyOpen();
    persist();
    requestAnimationFrame(notifyLayout);
  }

  function setTab(tabId, { openPanel = true } = {}) {
    if (!TABS.some((t) => t.id === tabId)) return;
    state.tab = tabId;
    if (openPanel) state.open = true;
    applyOpen();
    document.querySelectorAll(".side-rail-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".side-tab-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.tab === tabId);
    });
    const title = el("sideHdTitle");
    const meta = TABS.find((t) => t.id === tabId);
    if (title && meta) title.textContent = meta.title;
    persist();
    if (typeof state.onTabChange === "function") {
      try {
        state.onTabChange(tabId, { symbol: state.symbol, market: state.market });
      } catch (_) {}
    }
    requestAnimationFrame(notifyLayout);
  }

  function bindSplitter() {
    const splitter = el("sideSplitter");
    const split = el("mainSplit");
    if (!splitter || !split) return;

    let dragging = false;

    const onMove = (e) => {
      if (!dragging || !state.open) return;
      const rect = split.getBoundingClientRect();
      if (rect.width <= 0) return;
      const right = rect.right - e.clientX;
      state.ratio = clampRatio(right / rect.width);
      applyRatio();
      notifyLayout();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persist();
      notifyLayout();
    };

    splitter.addEventListener("pointerdown", (e) => {
      if (!state.open) return;
      dragging = true;
      splitter.classList.add("is-dragging");
      splitter.setPointerCapture?.(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function cnCodeFromSymbol(symbol) {
    const s = String(symbol || "").trim().toLowerCase();
    const m = s.match(/^(?:sh|sz|bj)?(\d{6})$/);
    return m ? m[1] : null;
  }

  function f10Url(symbol) {
    const code = cnCodeFromSymbol(symbol);
    return code ? `https://basic.10jqka.com.cn/${code}/` : null;
  }

  function refreshF10() {
    const frame = el("f10Frame");
    const hint = el("f10Hint");
    const openBtn = el("f10OpenBtn");
    const url = f10Url(state.symbol);
    if (!url) {
      if (frame) {
        frame.removeAttribute("src");
        frame.style.display = "none";
      }
      if (hint) {
        hint.textContent = "F10 暂仅支持 A 股六位代码（如 605378）";
        hint.style.display = "";
      }
      if (openBtn) {
        openBtn.href = "#";
        openBtn.style.visibility = "hidden";
      }
      return;
    }
    if (hint) {
      hint.textContent = `同花顺 F10 · ${url}`;
      hint.style.display = "";
    }
    if (openBtn) {
      openBtn.href = url;
      openBtn.style.visibility = "visible";
    }
    if (frame) {
      frame.style.display = "";
      if (frame.dataset.src !== url) {
        frame.dataset.src = url;
        frame.src = url;
      }
    }
  }

  function setSymbol(symbol, market) {
    const next = String(symbol || "").trim();
    const changed = next !== state.symbol;
    state.symbol = next;
    if (market) state.market = market;
    if (changed) {
      refreshF10();
      if (typeof state.onSymbolChange === "function") {
        try {
          state.onSymbolChange(state.symbol, state.market);
        } catch (_) {}
      }
    } else {
      refreshF10();
    }
  }

  function init(opts = {}) {
    readStored();
    if (typeof opts.onLayoutChange === "function") state.onLayoutChange = opts.onLayoutChange;
    if (typeof opts.onTabChange === "function") state.onTabChange = opts.onTabChange;
    if (typeof opts.onSymbolChange === "function") state.onSymbolChange = opts.onSymbolChange;

    applyRatio();
    applyOpen();
    setTab(state.tab, { openPanel: state.open });
    bindSplitter();

    el("sideCloseBtn")?.addEventListener("click", () => setOpen(false));

    document.querySelectorAll(".side-rail-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        if (!state.open) {
          setOpen(true);
          setTab(tab);
        } else if (state.tab === tab) {
          // 再点当前 tab：保持打开
          setTab(tab);
        } else {
          setTab(tab);
        }
      });
    });

    const chartWrap = el("chartWrap");
    if (chartWrap && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => notifyLayout());
      ro.observe(chartWrap);
    }

    if (typeof opts.getSymbol === "function") {
      try {
        setSymbol(opts.getSymbol(), opts.getMarket?.());
      } catch (_) {}
    }

    refreshF10();

    // 资讯 tab 预留挂载点（本期空态）
    global.SideNews = global.SideNews || {
      mount(el, _opts) {
        if (el && !el.dataset.mounted) {
          el.dataset.mounted = "1";
        }
      },
    };
    try {
      global.SideNews.mount(el("newsPlaceholder"), {
        getSymbol: () => state.symbol,
      });
    } catch (_) {}
  }

  global.SidePanel = {
    init,
    setSymbol,
    setOpen,
    setTab,
    getState: () => ({ ...state }),
    f10Url,
    TABS,
  };
})(window);
