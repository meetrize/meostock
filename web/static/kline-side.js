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

    try {
      global.SideNews?.mount?.(el("newsSideRoot"), {
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
        const sym = codeOf(s.symbol || s.code) || String(s.code || "").trim();
        const nameText = esc(s.name || s.code || "");
        const codeText = esc(s.code || sym || "");
        const nameEl = sym
          ? `<a class="zt-peer-name zt-peer-link" href="/?symbol=${encodeURIComponent(
              sym
            )}&period=1d" data-zt-symbol="${esc(sym)}" title="打开 K 线">${nameText}</a>`
          : `<span class="zt-peer-name">${nameText}</span>`;
        const codeEl = sym
          ? `<a class="zt-peer-code zt-peer-link" href="/?symbol=${encodeURIComponent(
              sym
            )}&period=1d" data-zt-symbol="${esc(sym)}" title="打开 K 线">${codeText}</a>`
          : `<span class="zt-peer-code">${codeText}</span>`;
        return `<div class="zt-peer">
          <div class="zt-peer-hd">
            ${nameEl}
            ${codeEl}
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

  function openPeerKline(sym, e) {
    const code = codeOf(sym) || String(sym || "").replace(/\D/g, "").slice(-6);
    if (!code) return;
    if (typeof global.openKlineSymbol === "function") {
      e?.preventDefault?.();
      try {
        global.openKlineSymbol(code, { pushUrl: true });
      } catch (_) {
        location.href = `/?symbol=${encodeURIComponent(code)}&period=1d`;
      }
      return;
    }
    // 无同页加载钩子时走默认链接跳转
  }

  function mount(el, opts = {}) {
    root = el || document.getElementById("ztSideRoot");
    if (typeof opts.getSymbol === "function") getSymbol = opts.getSymbol;
    if (root && !root.dataset.mounted) {
      root.dataset.mounted = "1";
      renderEmpty("打开涨停标签查看原因");
      root.addEventListener("click", (e) => {
        const a = e.target?.closest?.("a[data-zt-symbol]");
        if (!a || !root.contains(a)) return;
        // 保留 Cmd/Ctrl/中键新窗口
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
        openPeerKline(a.getAttribute("data-zt-symbol"), e);
      });
    }
  }

  global.SideZt = {
    mount,
    refresh,
    onSymbol,
  };
})(window);

/**
 * 资讯侧栏：选股宝个股消息流。
 * API: GET /api/xgb/stocks/messages?symbol=&limit=&mark=
 */
(function (global) {
  const PAGE_SIZE = 20;
  const FILTERS = [
    { id: "all", label: "全部", style: null },
    { id: "flash", label: "异动", style: 1 },
    { id: "column", label: "栏目", style: 2 },
    { id: "notice", label: "公告", style: 3 },
  ];

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let root = null;
  let getSymbol = () => "";
  let abortCtrl = null;
  let loading = false;
  let loadingMore = false;
  let lastKey = "";
  let filterId = "all";
  let items = [];
  let nextMark = "";
  let yahooSymbol = "";
  let pageSymbol = "";

  function codeOf(symbol) {
    const s = String(symbol || "").trim();
    if (!s) return "";
    const bare = s.replace(/^(sh|sz|bj)/i, "");
    const digits = bare.replace(/\D/g, "");
    return digits.length >= 6 ? digits.slice(-6) : "";
  }

  function styleMeta(style) {
    const n = Number(style) || 0;
    if (n === 1) return { key: "flash", label: "异动" };
    if (n === 3) return { key: "notice", label: "公告" };
    return { key: "column", label: "栏目" };
  }

  function fmtTimeFull(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${day} ${hh}:${mm}`;
  }

  /** 最短时间：今日 HH:mm；同年 M/D；跨年 YY/M/D */
  function fmtTimeShort(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return `${hh}:${mm}`;
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    if (d.getFullYear() === now.getFullYear()) return `${mo}/${day}`;
    const yy = String(d.getFullYear()).slice(-2);
    return `${yy}/${mo}/${day}`;
  }

  function renderDot(kind, tip) {
    const t = String(tip || "").trim();
    if (!t) return "";
    return `<span class="news-dot news-dot-${kind}" title="${esc(t)}" aria-label="${esc(
      t
    )}"></span>`;
  }

  function linkOf(m) {
    return (
      String(m?.OriginalUrl || "").trim() ||
      String(m?.ShareUrl2 || "").trim() ||
      String(m?.Url || "").trim() ||
      String(m?.ShareUrl || "").trim() ||
      ""
    );
  }

  function filteredItems() {
    const f = FILTERS.find((x) => x.id === filterId) || FILTERS[0];
    if (f.style == null) return items;
    return items.filter((m) => Number(m.Style) === f.style);
  }

  function setHtml(html) {
    if (!root) return;
    root.innerHTML = html;
  }

  function renderEmpty(msg) {
    setHtml(`<div class="side-empty">${esc(msg)}</div>`);
  }

  function renderFilters() {
    return `<div class="news-filters" role="tablist">
      ${FILTERS.map(
        (f) =>
          `<button type="button" class="news-filter-btn${
            f.id === filterId ? " active" : ""
          }" data-news-filter="${f.id}">${esc(f.label)}</button>`
      ).join("")}
    </div>`;
  }

  function renderRow(m) {
    const meta = styleMeta(m.Style);
    const tShort = fmtTimeShort(m.CreatedAt);
    const tFull = fmtTimeFull(m.CreatedAt);
    const subj = String(m?.FromSubject?.Title || "").trim();
    const source = String(m.Source || "").trim();
    const href = linkOf(m);
    const relatedN = Number(m.related_count) || 0;
    const weak =
      relatedN > 30 &&
      !(m.Stocks || []).some(
        (s) => s?.Symbol && yahooSymbol && s.Symbol === yahooSymbol
      );
    const titleText = m.Title || "（无标题）";
    const titleHtml = href
      ? `<a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(
          titleText
        )}">${esc(titleText)}</a>`
      : `<span class="news-title" title="${esc(titleText)}">${esc(titleText)}</span>`;

    const dots = [
      renderDot(meta.key, `类型：${meta.label}`),
      subj ? renderDot("subj", `栏目：${subj}`) : "",
      source ? renderDot("source", `来源：${source}`) : "",
      relatedN > 0 ? renderDot("related", `关联 ${relatedN} 只`) : "",
      m.IsPremium ? renderDot("premium", "付费") : "",
      weak ? renderDot("weak", "弱相关") : "",
    ].join("");

    return `<tr class="news-row${weak ? " news-weak" : ""}" data-style="${meta.key}">
      <td class="news-col-title">${titleHtml}</td>
      <td class="news-col-time" title="${esc(tFull)}">${esc(tShort)}</td>
      <td class="news-col-dots"><div class="news-dots">${dots}</div></td>
    </tr>`;
  }

  function renderTable(list) {
    return `<div class="news-table-wrap">
      <table class="news-table">
        <thead>
          <tr>
            <th class="news-col-title">标题</th>
            <th class="news-col-time">时间</th>
            <th class="news-col-dots" title="类型 / 栏目 / 来源 / 关联">标记</th>
          </tr>
        </thead>
        <tbody>${list.map(renderRow).join("")}</tbody>
      </table>
    </div>`;
  }

  function render() {
    const code = codeOf(pageSymbol);
    const list = filteredItems();
    const canMore = Boolean(nextMark) && filterId === "all";
    const moreBtn = canMore
      ? `<button type="button" class="news-more-btn" data-news-more${
          loadingMore ? " disabled" : ""
        }>${loadingMore ? "加载中…" : "加载更多"}</button>`
      : nextMark && filterId !== "all"
        ? `<div class="news-more-hint">筛选下仅展示已加载条目；切回「全部」可继续翻页</div>`
        : "";

    const body =
      list.length === 0
        ? `<div class="side-empty">${
            items.length ? "当前筛选下暂无资讯" : "暂无相关资讯"
          }</div>`
        : `${renderTable(list)}${moreBtn}`;

    setHtml(`<div class="news-side-inner">
      <div class="news-side-summary">${esc(code || pageSymbol || "—")} · 选股宝消息 · ${items.length} 条</div>
      ${renderFilters()}
      ${body}
    </div>`);
  }

  async function fetchPage({ mark = "", append = false } = {}) {
    const symbol = getSymbol() || global.SidePanel?.getState?.()?.symbol || "";
    const code = codeOf(symbol);
    if (!code) {
      lastKey = "";
      items = [];
      nextMark = "";
      yahooSymbol = "";
      pageSymbol = symbol;
      renderEmpty("请选择 A 股六位代码");
      return;
    }

    if (abortCtrl && !append) {
      try {
        abortCtrl.abort();
      } catch (_) {}
    }
    const ctrl = new AbortController();
    if (!append) abortCtrl = ctrl;

    if (append) loadingMore = true;
    else {
      loading = true;
      setHtml(`<div class="side-empty">加载资讯…</div>`);
    }

    try {
      const qs = new URLSearchParams({
        symbol: String(symbol),
        limit: String(PAGE_SIZE),
      });
      if (mark) qs.set("mark", String(mark));
      const res = await fetch(`/api/xgb/stocks/messages?${qs}`, {
        cache: "no-store",
        signal: append ? undefined : ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        if (!append) {
          renderEmpty(data?.error || `加载失败（HTTP ${res.status}）`);
          lastKey = "";
        }
        return;
      }
      const batch = Array.isArray(data.messages) ? data.messages : [];
      pageSymbol = symbol;
      yahooSymbol = String(data.yahoo_symbol || "");
      nextMark = String(data.next_mark || "");
      if (append) {
        const seen = new Set(items.map((m) => m.Id));
        for (const m of batch) {
          if (m?.Id && !seen.has(m.Id)) {
            items.push(m);
            seen.add(m.Id);
          }
        }
      } else {
        items = batch;
        lastKey = code;
      }
      render();
    } catch (e) {
      if (e?.name === "AbortError") return;
      if (!append) {
        renderEmpty(e?.message || "加载失败");
        lastKey = "";
      }
    } finally {
      loading = false;
      loadingMore = false;
      if (append && root?.querySelector?.("[data-news-more]")) render();
    }
  }

  async function refresh({ force = false } = {}) {
    if (!root) return;
    const symbol = getSymbol() || global.SidePanel?.getState?.()?.symbol || "";
    const code = codeOf(symbol);
    if (!code) {
      lastKey = "";
      items = [];
      renderEmpty("请选择 A 股六位代码");
      return;
    }
    if (!force && code === lastKey && items.length && root.querySelector(".news-side-inner")) {
      render();
      return;
    }
    filterId = "all";
    nextMark = "";
    await fetchPage({ append: false });
  }

  function onSymbol(symbol) {
    const st = global.SidePanel?.getState?.();
    if (st?.tab === "news" && st?.open) {
      refresh({ force: true });
    } else {
      lastKey = "";
      items = [];
      nextMark = "";
      if (root && !loading) {
        const code = codeOf(symbol);
        renderEmpty(code ? "打开资讯标签查看消息" : "请选择 A 股六位代码");
      }
    }
  }

  function mount(el, opts = {}) {
    root = el || document.getElementById("newsSideRoot");
    if (typeof opts.getSymbol === "function") getSymbol = opts.getSymbol;
    if (root && !root.dataset.mounted) {
      root.dataset.mounted = "1";
      renderEmpty("打开资讯标签查看消息");
      root.addEventListener("click", (e) => {
        const filterBtn = e.target?.closest?.("[data-news-filter]");
        if (filterBtn && root.contains(filterBtn)) {
          const id = filterBtn.getAttribute("data-news-filter");
          if (id && id !== filterId) {
            filterId = id;
            render();
          }
          return;
        }
        const moreBtn = e.target?.closest?.("[data-news-more]");
        if (moreBtn && root.contains(moreBtn) && !loadingMore && nextMark) {
          fetchPage({ mark: nextMark, append: true });
        }
      });
    }
  }

  global.SideNews = {
    mount,
    refresh,
    onSymbol,
  };
})(window);
