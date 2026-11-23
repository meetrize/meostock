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
    { id: "zt", title: "涨停原因" },
    { id: "news", title: "资讯" },
    { id: "f10", title: "F10" },
  ];

  const state = {
    // 默认关闭；是否打开、上次 Tab 由 localStorage 恢复
    open: false,
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
      // 无记录 → 保持默认关闭；有记录则严格按上次开/关
      if (openRaw === "1" || openRaw === "true") state.open = true;
      else if (openRaw === "0" || openRaw === "false") state.open = false;
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

    try {
      global.SideZt?.mount?.(el("ztSideRoot"), {
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

/**
 * 涨停原因侧栏：履历 + 题材详情。
 * API: GET /api/zt/history/stock-panel?code=
 */
(function (global) {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const fmtDate = (ymd) => {
    const s = String(ymd || "").replace(/\D/g, "");
    if (s.length !== 8) return esc(ymd || "—");
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };

  const fmtPct = (v) => {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return esc(v);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(2)}%`;
  };

  const fmtTs = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const poolLabel = (pool) =>
    pool === "limit_down" ? "跌停" : pool === "limit_up" ? "涨停" : esc(pool || "");

  const poolClass = (pool) =>
    pool === "limit_down" ? "zt-pool-dn" : "zt-pool-up";

  let root = null;
  let getSymbol = () => "";
  let abortCtrl = null;
  let lastKey = "";
  let loading = false;

  function codeOf(symbol) {
    const s = String(symbol || "").trim().toLowerCase();
    const m = s.match(/^(?:sh|sz|bj)?(\d{6})(?:\.\w+)?$/);
    return m ? m[1] : "";
  }

  function setHtml(html) {
    if (root) root.innerHTML = html;
  }

  function renderEmpty(msg) {
    setHtml(`<div class="side-empty">${esc(msg)}</div>`);
  }

  function renderTheme(t) {
    const stocks = Array.isArray(t.stocks) ? t.stocks : [];
    const meta = [
      t.stock_count != null ? `${t.stock_count} 只` : "",
      t.limit_up_count != null ? `涨停 ${t.limit_up_count}` : "",
      t.core_avg_pcp != null ? `核心均涨 ${fmtPct(t.core_avg_pcp)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const peers = stocks
      .slice(0, 12)
      .map((s) => {
        const days =
          s.limit_up_days != null
            ? `${s.limit_up_days}板`
            : s.limit_down_days != null
              ? `跌${s.limit_down_days}`
              : "";
        const reason = s.stock_reason
          ? `<div class="zt-peer-reason">${esc(s.stock_reason)}</div>`
          : "";
        return `<div class="zt-peer">
          <div class="zt-peer-hd">
            <span class="zt-peer-name">${esc(s.name || s.code || "")}</span>
            <span class="zt-peer-code">${esc(s.code || "")}</span>
            <span class="zt-peer-pct">${fmtPct(s.change_percent)}</span>
            ${days ? `<span class="zt-peer-days">${esc(days)}</span>` : ""}
            ${s.is_primary ? `<span class="zt-peer-tag">主</span>` : ""}
          </div>
          ${reason}
        </div>`;
      })
      .join("");

    return `<article class="zt-theme-card">
      <div class="zt-theme-hd">
        <span class="zt-badge ${poolClass(t.pool)}">${poolLabel(t.pool)}</span>
        <span class="zt-theme-date">${fmtDate(t.trade_date)}</span>
        <span class="zt-theme-name">${esc(t.plate_name || "题材")}</span>
      </div>
      ${meta ? `<div class="zt-theme-meta">${esc(meta)}</div>` : ""}
      ${
        t.plate_reason
          ? `<div class="zt-theme-reason">${esc(t.plate_reason)}</div>`
          : ""
      }
      ${
        peers
          ? `<div class="zt-peers">${peers}${
              stocks.length > 12
                ? `<div class="zt-more">另有 ${stocks.length - 12} 只…</div>`
                : ""
            }</div>`
          : ""
      }
    </article>`;
  }

  function renderItem(it) {
    const days =
      it.pool === "limit_down"
        ? it.limit_down_days != null
          ? `连跌 ${it.limit_down_days}`
          : ""
        : it.limit_up_days != null
          ? `${it.limit_up_days} 板`
          : "";
    const times = [
      fmtTs(it.first_limit_ts) ? `首封 ${fmtTs(it.first_limit_ts)}` : "",
      fmtTs(it.last_limit_ts) ? `末封 ${fmtTs(it.last_limit_ts)}` : "",
      it.break_times != null && Number(it.break_times) > 0
        ? `开板 ${it.break_times}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const plateRow =
      it.plate_name || it.plate_reason
        ? `<div class="zt-hist-plate-row">
            <span class="zt-hist-plate">${esc(it.plate_name || "题材")}</span>${
              it.plate_reason
                ? `<span class="zt-hist-plate-reason" title="${esc(
                    it.plate_reason
                  )}">${esc(it.plate_reason)}</span>`
                : ""
            }
          </div>`
        : "";

    return `<article class="zt-hist-card">
      <div class="zt-hist-hd">
        <span class="zt-badge ${poolClass(it.pool)}">${poolLabel(it.pool)}</span>
        <span class="zt-hist-date">${fmtDate(it.trade_date)}</span>
        <span class="zt-hist-pct">${fmtPct(it.change_percent)}</span>
        ${days ? `<span class="zt-hist-days">${esc(days)}</span>` : ""}
      </div>
      ${plateRow}
      ${
        it.stock_reason
          ? `<div class="zt-hist-reason">${esc(it.stock_reason)}</div>`
          : ""
      }
      ${times ? `<div class="zt-hist-meta">${esc(times)}</div>` : ""}
    </article>`;
  }

  function render(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    const themes = Array.isArray(data.themes) ? data.themes : [];
    const title = [data.name, data.code].filter(Boolean).join(" · ") || "涨停原因";

    if (!items.length && !themes.length) {
      renderEmpty(`暂无涨跌停记录（${title}）`);
      return;
    }

    const histHtml = `<section class="zt-sec">
      <div class="zt-sec-hd">涨跌停历史 <span>${items.length}</span></div>
      <div class="zt-sec-bd">${
        items.length
          ? items.map(renderItem).join("")
          : `<div class="zt-muted">暂无历史记录</div>`
      }</div>
    </section>`;

    const themeHtml = themes.length
      ? `<section class="zt-sec">
          <div class="zt-sec-hd">关联题材 <span>${themes.length}</span></div>
          <div class="zt-sec-bd">${themes.map(renderTheme).join("")}</div>
        </section>`
      : "";

    setHtml(`<div class="zt-side-inner">
      <div class="zt-side-summary">${esc(title)} · 含当日快照</div>
      ${histHtml}
      ${themeHtml}
    </div>`);
  }

  async function refresh({ force = false } = {}) {
    if (!root) return;
    const symbol = getSymbol() || global.SidePanel?.getState?.()?.symbol || "";
    const code = codeOf(symbol);
    if (!code) {
      lastKey = "";
      renderEmpty("请选择 A 股六位代码");
      return;
    }
    const key = code;
    if (!force && key === lastKey && root.querySelector(".zt-side-inner")) return;

    if (abortCtrl) {
      try {
        abortCtrl.abort();
      } catch (_) {}
    }
    abortCtrl = new AbortController();
    loading = true;
    setHtml(`<div class="side-empty">加载涨停原因…</div>`);

    try {
      const url = `/api/zt/history/stock-panel?code=${encodeURIComponent(
        code
      )}&limit=90&theme_limit=8`;
      const res = await fetch(url, {
        cache: "no-store",
        signal: abortCtrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        renderEmpty(data?.error || `加载失败（HTTP ${res.status}）`);
        lastKey = "";
        return;
      }
      lastKey = key;
      render(data);
    } catch (e) {
      if (e?.name === "AbortError") return;
      renderEmpty(e?.message || "加载失败");
      lastKey = "";
    } finally {
      loading = false;
    }
  }

  function onSymbol(symbol) {
    const st = global.SidePanel?.getState?.();
    if (st?.tab === "zt" && st?.open) {
      refresh({ force: true });
    } else {
      lastKey = "";
      if (root && !loading) {
        const code = codeOf(symbol);
        renderEmpty(code ? "打开涨停标签查看原因" : "请选择 A 股六位代码");
      }
    }
  }

  function mount(el, opts = {}) {
    root = el || document.getElementById("ztSideRoot");
    if (typeof opts.getSymbol === "function") getSymbol = opts.getSymbol;
    if (root && !root.dataset.mounted) {
      root.dataset.mounted = "1";
      renderEmpty("打开涨停标签查看原因");
    }
  }

  global.SideZt = {
    mount,
    refresh,
    onSymbol,
  };
})(window);
