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
    { id: "zthist", title: "涨跌停历史" },
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
      const open = state.open ? "1" : "0";
      const ratio = String(state.ratio);
      const tab = state.tab;
      localStorage.setItem(LS.open, open);
      localStorage.setItem(LS.ratio, ratio);
      localStorage.setItem(LS.tab, tab);
      const prefs = global.MeoUserPrefs;
      if (prefs && typeof prefs.noteWrite === "function") {
        prefs.noteWrite(LS.open, open);
        prefs.noteWrite(LS.ratio, ratio);
        prefs.noteWrite(LS.tab, tab);
      }
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
    // 兼容 300413 / sz300413 / 300413.sz / sz300413.sz
    const m = s.match(/^(?:sh|sz|bj)?(\d{6})(?:\.(?:ss|sh|sz|bj))?$/);
    if (m) return m[1];
    const digits = s.replace(/\D/g, "");
    return digits.length >= 6 ? digits.slice(-6) : null;
  }

  function f10Url(symbol) {
    const code = cnCodeFromSymbol(symbol);
    return code ? `https://basic.10jqka.com.cn/${code}/` : null;
  }

  function ztHistUrl(symbol) {
    const code = cnCodeFromSymbol(symbol);
    // 犀利涨跌停异动页（本站 /zt 中转；用当前页 origin，避免写成 127.0.0.1）
    if (!code) return null;
    const path = `/zt/${encodeURIComponent(code)}?bg=ffffff&hidenav=1`;
    try {
      return `${window.location.origin}${path}`;
    } catch (_) {
      return path;
    }
  }

  function refreshEmbedFrame({ frameId, hintId, openBtnId, url, emptyHint, okHint, force = false }) {
    const frame = el(frameId);
    const hint = el(hintId);
    const openBtn = el(openBtnId);
    if (!url) {
      if (frame) {
        frame.removeAttribute("src");
        frame.removeAttribute("srcdoc");
        frame.removeAttribute("data-src");
        frame.style.display = "none";
      }
      if (hint) {
        hint.textContent = emptyHint;
        hint.style.display = "";
      }
      if (openBtn) {
        openBtn.href = "#";
        openBtn.style.visibility = "hidden";
      }
      return;
    }
    if (hint) {
      hint.textContent = okHint(url);
      hint.style.display = "";
    }
    if (openBtn) {
      openBtn.href = url;
      openBtn.style.visibility = "visible";
    }
    if (frame) {
      frame.style.display = "";
      // 局域网 /zt 已可直开；履历用 iframe.src（勿用 srcdoc，document.write 会把文档冲掉）
      if (force || frame.dataset.src !== url) {
        frame.dataset.src = url;
        frame.removeAttribute("srcdoc");
        frame.src = url;
      }
    }
  }

  function refreshF10() {
    const url = f10Url(state.symbol);
    refreshEmbedFrame({
      frameId: "f10Frame",
      hintId: "f10Hint",
      openBtnId: "f10OpenBtn",
      url,
      emptyHint: "F10 暂仅支持 A 股六位代码（如 605378）",
      okHint: (u) => `同花顺 F10 · ${u}`,
    });
  }

  function refreshZtHist({ force = false } = {}) {
    const url = ztHistUrl(state.symbol);
    refreshEmbedFrame({
      frameId: "ztHistFrame",
      hintId: "ztHistHint",
      openBtnId: "ztHistOpenBtn",
      url,
      emptyHint: "涨跌停历史暂仅支持 A 股六位代码",
      okHint: (u) => `犀利 · ${u}`,
      force,
    });
  }

  function setSymbol(symbol, market) {
    const next = String(symbol || "").trim();
    const changed = next !== state.symbol;
    state.symbol = next;
    if (market) state.market = market;
    if (changed) {
      refreshF10();
      refreshZtHist();
      if (typeof state.onSymbolChange === "function") {
        try {
          state.onSymbolChange(state.symbol, state.market);
        } catch (_) {}
      }
    } else {
      refreshF10();
      refreshZtHist();
    }
  }

  function init(opts = {}) {
    readStored();
    if (typeof opts.onLayoutChange === "function") state.onLayoutChange = opts.onLayoutChange;
    if (typeof opts.onTabChange === "function") state.onTabChange = opts.onTabChange;
    if (typeof opts.onSymbolChange === "function") state.onSymbolChange = opts.onSymbolChange;

    window.addEventListener("meo:kline-prefs-applied", () => {
      readStored();
      applyRatio();
      applyOpen();
      setTab(state.tab, { openPanel: state.open });
    });

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
    refreshZtHist();

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
    ztHistUrl,
    refreshZtHist,
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

    const liveHint = data.live_today ? "含今日实时池" : "含当日快照";
    setHtml(`<div class="zt-side-inner">
      <div class="zt-side-summary">${esc(title)} · ${esc(liveHint)}</div>
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
 * 资讯侧栏：
 * - 全部/异动/栏目：选股宝消息（不含公告 Style=3）
 * - 公告：本地巨潮库 /api/cninfo/announcements，点击打开 PDF
 */
(function (global) {
  const PAGE_SIZE = 20;
  const NOTICE_PAGE = 50;
  const FILTERS = [
    { id: "all", label: "全部", style: null },
    { id: "flash", label: "异动", style: 1 },
    { id: "column", label: "栏目", style: 2 },
    { id: "notice", label: "公告", style: null, source: "cninfo" },
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
  let lastNoticeKey = "";
  let filterId = "all";
  let items = [];
  let notices = [];
  let noticeTotal = 0;
  let noticeOffset = 0;
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

  /** CreatedAt / announce_time_ms：秒或毫秒均可 */
  function parseMsgTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtTimeFull(ts) {
    const d = parseMsgTime(ts);
    if (!d) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
      d.getHours()
    )}:${pad2(d.getMinutes())}`;
  }

  /**
   * 简写完整日期时间（始终含时分）：
   * - 同年：M/D HH:mm
   * - 跨年：YY/M/D HH:mm
   */
  function fmtTimeShort(ts) {
    const d = parseMsgTime(ts);
    if (!d) return "";
    const now = new Date();
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) return `${mo}/${day} ${hm}`;
    return `${String(d.getFullYear()).slice(-2)}/${mo}/${day} ${hm}`;
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

  /** 选股宝流：去掉公告（Style=3），公告改读巨潮本地库 */
  function xgbItemsNoNotice() {
    return items.filter((m) => Number(m.Style) !== 3);
  }

  function filteredItems() {
    const f = FILTERS.find((x) => x.id === filterId) || FILTERS[0];
    if (f.id === "notice") return notices;
    const base = xgbItemsNoNotice();
    if (f.style == null) return base;
    return base.filter((m) => Number(m.Style) === f.style);
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

  function renderNoticeRow(a) {
    const ms = Number(a.announce_time_ms) || 0;
    const tShort = fmtTimeShort(ms);
    const tFull = a.announce_time || fmtTimeFull(ms);
    const titleText = a.title || "（无标题）";
    const href = String(a.pdf_url || "").trim();
    const impact = a.impact && typeof a.impact === "object" ? a.impact : null;
    const level = String(impact?.final_level || "").trim();
    const levelLabel = String(impact?.final_level_label || level || "").trim();
    const summary = String(impact?.core_summary || "").trim();
    const dir = String(impact?.direction || "").trim();
    const first = impact?.is_first_disclosure !== false;
    const badge =
      level && level !== "S"
        ? `<span class="notice-impact-badge notice-impact-${esc(level)}" title="影响力 ${esc(
            levelLabel
          )} ${esc(dir)}">${esc(levelLabel || level)}</span>`
        : "";
    const stageTag =
      impact && !first
        ? `<span class="notice-impact-stage" title="非首次披露">进展</span>`
        : "";
    const titleHtml = href
      ? `<a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(
          titleText
        )}">${esc(titleText)}</a>`
      : `<span class="news-title" title="${esc(titleText)}">${esc(titleText)}</span>`;
    const summaryHtml = summary
      ? `<div class="notice-impact-summary" title="${esc(summary)}">${esc(summary)}</div>`
      : "";
    const dots = [
      renderDot("notice", "类型：公告"),
      renderDot("source", "来源：巨潮资讯"),
      href ? renderDot("related", "PDF") : "",
      level === "XL" || level === "L" ? renderDot("related", `影响：${levelLabel || level}`) : "",
    ].join("");
    return `<tr class="news-row" data-style="notice">
      <td class="news-col-title">
        <div class="notice-title-row">${badge}${stageTag}${titleHtml}</div>
        ${summaryHtml}
      </td>
      <td class="news-col-time" title="${esc(tFull)}">${esc(tShort)}</td>
      <td class="news-col-dots"><div class="news-dots">${dots}</div></td>
    </tr>`;
  }

  function renderTable(list, { notice = false } = {}) {
    return `<div class="news-table-wrap">
      <table class="news-table">
        <thead>
          <tr>
            <th class="news-col-title">标题</th>
            <th class="news-col-time">时间</th>
            <th class="news-col-dots" title="${
              notice ? "类型 / 来源 / PDF" : "类型 / 栏目 / 来源 / 关联"
            }">标记</th>
          </tr>
        </thead>
        <tbody>${list
          .map((row) => (notice ? renderNoticeRow(row) : renderRow(row)))
          .join("")}</tbody>
      </table>
    </div>`;
  }

  function render() {
    const code = codeOf(pageSymbol);
    const isNotice = filterId === "notice";
    const list = filteredItems();
    let moreBtn = "";
    if (isNotice) {
      const canMore = notices.length < noticeTotal;
      moreBtn = canMore
        ? `<button type="button" class="news-more-btn" data-news-more${
            loadingMore ? " disabled" : ""
          }>${loadingMore ? "加载中…" : "加载更多"}</button>`
        : "";
    } else {
      const canMore = Boolean(nextMark) && filterId === "all";
      moreBtn = canMore
        ? `<button type="button" class="news-more-btn" data-news-more${
            loadingMore ? " disabled" : ""
          }>${loadingMore ? "加载中…" : "加载更多"}</button>`
        : nextMark && filterId !== "all"
          ? `<div class="news-more-hint">筛选下仅展示已加载条目；切回「全部」可继续翻页</div>`
          : "";
    }

    const emptyMsg = isNotice
      ? notices.length || noticeTotal
        ? "暂无更多公告"
        : "暂无本地公告（夜间任务同步巨潮后可见）"
      : xgbItemsNoNotice().length
        ? "当前筛选下暂无资讯"
        : "暂无相关资讯";

    const body =
      list.length === 0
        ? `<div class="side-empty">${emptyMsg}</div>`
        : `${renderTable(list, { notice: isNotice })}${moreBtn}`;

    const summary = isNotice
      ? `${esc(code || pageSymbol || "—")} · 巨潮公告 · ${noticeTotal || notices.length} 条`
      : `${esc(code || pageSymbol || "—")} · 选股宝消息 · ${xgbItemsNoNotice().length} 条`;

    setHtml(`<div class="news-side-inner">
      <div class="news-side-summary">${summary}</div>
      ${renderFilters()}
      ${body}
    </div>`);
  }

  async function fetchNotices({ append = false } = {}) {
    const symbol = getSymbol() || global.SidePanel?.getState?.()?.symbol || "";
    const code = codeOf(symbol);
    if (!code) {
      lastNoticeKey = "";
      notices = [];
      noticeTotal = 0;
      noticeOffset = 0;
      pageSymbol = symbol;
      renderEmpty("请选择 A 股六位代码");
      return;
    }

    if (append) loadingMore = true;
    else {
      loading = true;
      if (!root?.querySelector?.(".news-side-inner")) {
        setHtml(`<div class="side-empty">加载公告…</div>`);
      }
    }

    try {
      const offset = append ? noticeOffset : 0;
      const qs = new URLSearchParams({
        symbol: String(symbol),
        limit: String(NOTICE_PAGE),
        offset: String(offset),
      });
      // 首屏且本地可能为空时，按需拉该股近两年（全市场回填未完成也能看）
      if (!append) qs.set("ensure", "1");
      if (!append) {
        setHtml(`<div class="side-empty">加载公告（若本地无数据将即时拉取）…</div>`);
      }
      const res = await fetch(`/api/cninfo/announcements?${qs}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        if (!append) {
          renderEmpty(data?.error || `加载失败（HTTP ${res.status}）`);
          lastNoticeKey = "";
        }
        return;
      }
      const batch = Array.isArray(data.announcements) ? data.announcements : [];
      pageSymbol = symbol;
      noticeTotal = Number(data.total) || batch.length;
      if (append) {
        const seen = new Set(notices.map((a) => a.announcement_id));
        for (const a of batch) {
          if (a?.announcement_id && !seen.has(a.announcement_id)) {
            notices.push(a);
            seen.add(a.announcement_id);
          }
        }
      } else {
        notices = batch;
        lastNoticeKey = code;
      }
      noticeOffset = notices.length;
      render();
    } catch (e) {
      if (!append) {
        renderEmpty(e?.message || "加载失败");
        lastNoticeKey = "";
      }
    } finally {
      loading = false;
      loadingMore = false;
      if (append && root?.querySelector?.("[data-news-more]")) render();
    }
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
      const batch = (Array.isArray(data.messages) ? data.messages : []).filter(
        (m) => Number(m?.Style) !== 3
      );
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

  async function applyFilter(id) {
    if (!id || id === filterId) return;
    filterId = id;
    if (id === "notice") {
      const code = codeOf(getSymbol() || global.SidePanel?.getState?.()?.symbol || "");
      if (code && code === lastNoticeKey && notices.length) {
        render();
        return;
      }
      await fetchNotices({ append: false });
      return;
    }
    if (!items.length) {
      await fetchPage({ append: false });
      return;
    }
    render();
  }

  async function refresh({ force = false } = {}) {
    if (!root) return;
    const symbol = getSymbol() || global.SidePanel?.getState?.()?.symbol || "";
    const code = codeOf(symbol);
    if (!code) {
      lastKey = "";
      lastNoticeKey = "";
      items = [];
      notices = [];
      renderEmpty("请选择 A 股六位代码");
      return;
    }
    if (filterId === "notice") {
      if (
        !force &&
        code === lastNoticeKey &&
        notices.length &&
        root.querySelector(".news-side-inner")
      ) {
        render();
        return;
      }
      await fetchNotices({ append: false });
      return;
    }
    if (!force && code === lastKey && items.length && root.querySelector(".news-side-inner")) {
      render();
      return;
    }
    nextMark = "";
    await fetchPage({ append: false });
  }

  function onSymbol(symbol) {
    const st = global.SidePanel?.getState?.();
    if (st?.tab === "news" && st?.open) {
      refresh({ force: true });
    } else {
      lastKey = "";
      lastNoticeKey = "";
      items = [];
      notices = [];
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
          void applyFilter(id);
          return;
        }
        const moreBtn = e.target?.closest?.("[data-news-more]");
        if (moreBtn && root.contains(moreBtn) && !loadingMore) {
          if (filterId === "notice") {
            if (notices.length < noticeTotal) void fetchNotices({ append: true });
          } else if (nextMark) {
            fetchPage({ mark: nextMark, append: true });
          }
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
