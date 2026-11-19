/**
 * K 线侧栏 AI：SSE 对话、按标的线程、Skill chips、报告卡片。
 */
(function (global) {
  const THREADS_KEY = "kline.ai.threads.v1";
  const REPORT_MIN_LEN = 80;

  const state = {
    symbol: "",
    period: "1d",
    skills: [],
    health: null,
    abort: null,
    streaming: false,
    getSymbol: null,
  };

  function uid() {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadThreads() {
    try {
      const raw = localStorage.getItem(THREADS_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (_) {
      return {};
    }
  }

  function saveThreads(all) {
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  /** A 股统一成 6 位代码；其它标的小写去空白，避免 sh605378 / 605378 分裂 */
  function threadKey(symbol) {
    const s = String(symbol || "").trim().toLowerCase();
    if (!s) return "_";
    const m = s.match(/^(?:sh|sz|bj)?(\d{6})$/);
    if (m) return m[1];
    return s.replace(/^yf:/, "yf:").replace(/^fut:/, "fut:");
  }

  function liveSymbol() {
    try {
      if (typeof state.getSymbol === "function") {
        const s = String(state.getSymbol() || "").trim();
        if (s) return s;
      }
    } catch (_) {}
    try {
      const s = String(global.SidePanel?.getState?.()?.symbol || "").trim();
      if (s) return s;
    } catch (_) {}
    return String(state.symbol || "").trim();
  }

  function getThread(symbol) {
    const all = loadThreads();
    const key = threadKey(symbol);
    // 合并旧 key（带 sh/sz 前缀）到规范 key，避免报告散落
    const aliases = Object.keys(all).filter(
      (k) => k !== key && threadKey(k) === key
    );
    const existed = !!all[key];
    let t = all[key] || {
      id: key,
      symbol: symbol || key,
      updatedAt: Date.now(),
      messages: [],
    };
    if (!Array.isArray(t.messages)) t.messages = [];
    aliases.forEach((ak) => {
      const old = all[ak];
      if (!old) return;
      const seen = new Set(t.messages.map((m) => m && m.id).filter(Boolean));
      (old.messages || []).forEach((m) => {
        if (m && m.id && !seen.has(m.id)) {
          t.messages.push(m);
          seen.add(m.id);
        }
      });
      delete all[ak];
    });
    t.id = key;
    t.symbol = symbol || t.symbol || key;
    all[key] = t;
    if (aliases.length || !existed) saveThreads(all);
    return t;
  }

  function updateThread(symbol, mutator) {
    const all = loadThreads();
    const key = threadKey(symbol);
    // 先走 getThread 合并别名
    const merged = getThread(symbol);
    const t = all[key] || merged;
    mutator(t);
    t.updatedAt = Date.now();
    t.symbol = symbol;
    t.id = key;
    all[key] = t;
    // 清掉同标的旧别名
    Object.keys(all).forEach((k) => {
      if (k !== key && threadKey(k) === key) delete all[k];
    });
    saveThreads(all);
    return t;
  }

  function stripMd(text) {
    return String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[`*_>#\-\[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const SKILL_LABELS = {
    limit_reason: "涨跌停原因",
    sector_catchup: "板块补涨",
    brief: "一句话解读",
    levels: "支撑阻力",
    risk: "风险提示",
    compare: "对比口径",
    f10_guide: "F10读法",
  };

  const TAG_COLORS = [
    "#1677FF",
    "#E53935",
    "#00897B",
    "#FB8C00",
    "#8E24AA",
    "#3949AB",
    "#00838F",
    "#6D4C41",
  ];

  function titleOf(text) {
    const line = String(text || "")
      .split(/\n/)
      .map((s) => s.trim())
      .find(Boolean);
    const plain = stripMd(line || text).slice(0, 24);
    return plain || "AI 回复";
  }

  function reportLabelOf(msg) {
    if (!msg) return "AI报告";
    if (msg.label) return String(msg.label);
    const sid = msg.skillId || "";
    if (sid && SKILL_LABELS[sid]) return SKILL_LABELS[sid];
    if (sid) {
      const sk = (state.skills || []).find((s) => s.id === sid);
      if (sk?.title) return sk.title;
    }
    return "AI报告";
  }

  function shanghaiYmd(ts = Date.now()) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ts));
    } catch (_) {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  function isReportWorthy(msg) {
    if (!msg || msg.role !== "assistant") return false;
    if (msg.error) return false;
    if (String(msg.content || "").startsWith("加载失败")) return false;
    if (msg.skillId) return true;
    return stripMd(msg.content).length >= REPORT_MIN_LEN;
  }

  function colorForSkill(skillId, label) {
    const key = String(skillId || label || "ai");
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
  }

  function notifyChartTags() {
    try {
      if (typeof global.placeAiReportTags === "function") {
        global.placeAiReportTags();
      }
    } catch (_) {}
  }

  function sameSymbol(a, b) {
    return threadKey(a) === threadKey(b);
  }

  /** 仅收集「当前 K 线标的」线程里的报告（按规范代码匹配） */
  function collectReports(symbol) {
    const symNow = String(symbol || liveSymbol() || "").trim();
    const want = threadKey(symNow);
    const cards = [];
    if (!want || want === "_") return cards;
    // 确保别名已合并到规范 key
    getThread(symNow);
    const all = loadThreads();
    const thread = all[want];
    if (!thread) return cards;
    const displaySym = thread.symbol || symNow || want;
    (thread.messages || []).forEach((msg) => {
      if (!isReportWorthy(msg)) return;
      const label = reportLabelOf(msg);
      cards.push({
        messageId: msg.id,
        symbol: displaySym,
        updatedAt: msg.ts || thread.updatedAt || 0,
        skillId: msg.skillId || "",
        label,
        tradeDate: msg.tradeDate || shanghaiYmd(msg.ts || Date.now()),
        title: titleOf(msg.content),
        summary: stripMd(msg.content).slice(0, 120),
        content: msg.content,
        color: colorForSkill(msg.skillId, label),
      });
    });
    cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return cards;
  }

  /** 供 K 线挂标签：按 tradeDate 锚定 */
  function listChartTags(symbol) {
    return collectReports(symbol).filter((c) => c.tradeDate && c.content);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setComposerEnabled(on) {
    const ta = el("aiInput");
    const send = el("aiSendBtn");
    const stop = el("aiStopBtn");
    if (ta) ta.disabled = !on && state.streaming ? true : false;
    if (send) {
      send.disabled = state.streaming;
      send.style.display = state.streaming ? "none" : "";
    }
    if (stop) {
      stop.style.display = state.streaming ? "" : "none";
      stop.disabled = !state.streaming;
    }
  }

  function renderMessages() {
    const box = el("aiMsgs");
    if (!box) return;
    const thread = getThread(state.symbol);
    box.innerHTML = "";
    if (!thread.messages.length) {
      const note = document.createElement("div");
      note.className = "ai-bubble system-note";
      note.textContent = state.symbol
        ? `与 ${state.symbol} 的对话会按标的保存。可点下方 Skill 快速提问。`
        : "加载标的后开始对话";
      box.appendChild(note);
    }
    thread.messages.forEach((msg) => {
      const div = document.createElement("div");
      div.className = `ai-bubble ${msg.role === "user" ? "user" : "assistant"}`;
      div.dataset.id = msg.id;
      if (msg.role === "assistant") {
        fillMarkdown(div, msg.content || "", { streaming: !!msg.streaming });
      } else {
        div.textContent = msg.content || "";
      }
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function renderSkills() {
    const row = el("aiSkills");
    if (!row) return;
    row.innerHTML = "";
    state.skills.forEach((sk) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-skill-chip";
      btn.title = sk.description || sk.title;
      btn.textContent = sk.title || sk.id;
      btn.addEventListener("click", () => {
        const hint = sk.userHint || sk.title || "";
        const ta = el("aiInput");
        if (ta && hint) ta.value = hint;
        void sendMessage({ skillId: sk.id, text: hint });
      });
      row.appendChild(btn);
    });
  }

  function renderHealthBanner() {
    const banner = el("aiHealthBanner");
    if (!banner) return;
    if (!state.health) {
      banner.style.display = "none";
      return;
    }
    if (state.health.configured) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "";
    banner.textContent =
      "未配置 AI 模型：请到设置 → AI 模型 添加配置并设为使用中。";
  }

  function renderReports() {
    const list = el("reportList");
    if (!list) return;
    const sym = liveSymbol();
    if (sym) state.symbol = sym;
    const cards = collectReports(sym);
    list.innerHTML = "";
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "side-empty";
      empty.textContent = sym
        ? `暂无与 ${sym} 相关的报告。在 AI 对话中得到较长回复后会出现在这里。`
        : "暂无报告。加载股票并在 AI 对话后会出现在这里。";
      list.appendChild(empty);
      return;
    }
    cards.forEach((card) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "report-card";
      btn.innerHTML = `
        <div class="report-card-meta">${escapeHtml(card.symbol)} · ${formatTime(card.updatedAt)}</div>
        <div class="report-card-title">${escapeHtml(card.title)}</div>
        <div class="report-card-summary">${escapeHtml(card.summary)}</div>
      `;
      btn.addEventListener("click", () => openReport(card));
      list.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sanitizeHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(
        `<div class="ai-md-root">${html}</div>`,
        "text/html"
      );
      const root = doc.body.querySelector(".ai-md-root") || doc.body;
      root
        .querySelectorAll("script,iframe,object,embed,link,meta,style,form")
        .forEach((n) => n.remove());
      root.querySelectorAll("*").forEach((node) => {
        [...node.attributes].forEach((attr) => {
          const name = attr.name || "";
          const val = attr.value || "";
          if (/^on/i.test(name) || (name === "href" && /^\s*javascript:/i.test(val))) {
            node.removeAttribute(name);
          }
        });
      });
      return root.innerHTML;
    } catch (_) {
      return escapeHtml(html);
    }
  }

  function renderMarkdown(text) {
    const raw = String(text || "");
    if (!raw) return "";
    try {
      if (global.marked && typeof global.marked.parse === "function") {
        if (global.marked.setOptions) {
          global.marked.setOptions({ gfm: true, breaks: true });
        }
        return sanitizeHtml(global.marked.parse(raw));
      }
    } catch (_) {}
    return escapeHtml(raw).replace(/\n/g, "<br>");
  }

  function fillMarkdown(node, text, { streaming = false } = {}) {
    if (!node) return;
    node.innerHTML = `<div class="ai-md">${renderMarkdown(text)}</div>`;
    node.classList.toggle("streaming-caret", !!streaming);
  }

  function formatTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("zh-CN", { hour12: false });
    } catch (_) {
      return "";
    }
  }

  function openReport(card) {
    const drawer = el("reportDrawer");
    const body = el("reportDrawerBody");
    const title = el("reportDrawerTitle");
    if (!drawer || !body) return;
    if (title) title.textContent = card.title || "报告";
    fillMarkdown(body, card.content || "");
    drawer.classList.add("show");
    const askBtn = el("reportAskBtn");
    if (askBtn) {
      askBtn.onclick = () => {
        drawer.classList.remove("show");
        if (global.SidePanel) global.SidePanel.setTab("ai");
        const ta = el("aiInput");
        if (ta) {
          ta.value = `基于你上次关于「${card.title}」的分析，继续补充：`;
          ta.focus();
        }
      };
    }
  }

  async function refreshHealth() {
    try {
      const res = await fetch("/api/ai/health");
      state.health = await res.json();
    } catch (_) {
      state.health = { configured: false };
    }
    renderHealthBanner();
  }

  async function refreshSkills() {
    try {
      const res = await fetch("/api/ai/skills");
      const data = await res.json();
      state.skills = Array.isArray(data.skills) ? data.skills : [];
    } catch (_) {
      state.skills = [];
    }
    renderSkills();
  }

  async function sendMessage({ text, skillId } = {}) {
    const input = el("aiInput");
    const content = String(text ?? input?.value ?? "").trim();
    if (!content && !skillId) return;
    if (!state.symbol) return;
    if (state.streaming) return;
    if (state.health && state.health.configured === false) {
      renderHealthBanner();
      return;
    }

    const userText = content || "请分析";
    if (input) input.value = "";

    const userMsg = { id: uid(), role: "user", content: userText, ts: Date.now(), skillId: skillId || "" };
    const asstMsg = {
      id: uid(),
      role: "assistant",
      content: "",
      ts: Date.now(),
      skillId: skillId || "",
      streaming: true,
    };

    updateThread(state.symbol, (t) => {
      t.messages.push(userMsg, asstMsg);
    });
    renderMessages();

    const thread = getThread(state.symbol);
    const history = (thread.messages || [])
      .filter((m) => m.id !== asstMsg.id && !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    state.streaming = true;
    setComposerEnabled(false);
    const ac = new AbortController();
    state.abort = ac;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          symbol: state.symbol,
          period: state.period || "1d",
          skillId: skillId || null,
          messages: history,
        }),
        signal: ac.signal,
      });

      if (!res.ok) {
        let err = `请求失败 HTTP ${res.status}`;
        try {
          const j = await res.json();
          err = j.error || j.hint || err;
        } catch (_) {}
        throw new Error(err);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式读取");
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") continue;
          let obj;
          try {
            obj = JSON.parse(raw);
          } catch (_) {
            continue;
          }
          if (obj.error) throw new Error(obj.error + (obj.detail ? `: ${obj.detail}` : ""));
          if (obj.event === "start") continue;
          if (obj.content) {
            full += obj.content;
            updateThread(state.symbol, (t) => {
              const m = t.messages.find((x) => x.id === asstMsg.id);
              if (m) {
                m.content = full;
                m.streaming = true;
              }
            });
            const node = el("aiMsgs")?.querySelector(`[data-id="${asstMsg.id}"]`);
            if (node) {
              fillMarkdown(node, full, { streaming: true });
              el("aiMsgs").scrollTop = el("aiMsgs").scrollHeight;
            } else {
              renderMessages();
            }
          }
        }
      }

      updateThread(state.symbol, (t) => {
        const m = t.messages.find((x) => x.id === asstMsg.id);
        if (m) {
          m.content = full || m.content || "（空回复）";
          m.streaming = false;
          m.ts = Date.now();
          m.skillId = skillId || m.skillId || "";
          m.label = reportLabelOf(m);
          // 锚定生成当日（上海交易日），过后仍挂在该日 K 线上
          if (!m.tradeDate) m.tradeDate = shanghaiYmd(m.ts);
        }
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        updateThread(state.symbol, (t) => {
          const m = t.messages.find((x) => x.id === asstMsg.id);
          if (m) {
            m.streaming = false;
            if (!m.content) m.content = "（已停止）";
          }
        });
      } else {
        updateThread(state.symbol, (t) => {
          const m = t.messages.find((x) => x.id === asstMsg.id);
          if (m) {
            m.streaming = false;
            m.content = `加载失败：${e.message || e}`;
            m.error = true;
          }
        });
      }
    } finally {
      state.streaming = false;
      state.abort = null;
      setComposerEnabled(true);
      renderMessages();
      renderReports();
      notifyChartTags();
    }
  }

  function stop() {
    if (state.abort) {
      try {
        state.abort.abort();
      } catch (_) {}
    }
  }

  function newChat() {
    if (!state.symbol) return;
    if (state.streaming) stop();
    updateThread(state.symbol, (t) => {
      t.messages = [];
    });
    renderMessages();
    renderReports();
    notifyChartTags();
  }

  function setSymbol(symbol, { period } = {}) {
    const next = String(symbol || "").trim();
    if (period) state.period = period;
    if (sameSymbol(next, state.symbol)) {
      state.symbol = next || state.symbol;
      renderMessages();
      renderReports();
      notifyChartTags();
      return;
    }
    if (state.streaming) stop();
    state.symbol = next;
    renderMessages();
    renderReports();
    notifyChartTags();
  }

  function setPeriod(period) {
    if (period) state.period = period;
    notifyChartTags();
  }

  function openReportFromChart(cardOrId) {
    let card = null;
    if (typeof cardOrId === "string") {
      card = collectReports(liveSymbol()).find((c) => c.messageId === cardOrId);
    } else if (cardOrId && cardOrId.messageId) {
      card =
        collectReports(liveSymbol()).find((c) => c.messageId === cardOrId.messageId) ||
        {
          messageId: cardOrId.messageId,
          title: cardOrId.title || cardOrId.label || "报告",
          content: cardOrId.content || "",
          symbol: cardOrId.symbol || liveSymbol(),
          skillId: cardOrId.skillId || "",
          label: cardOrId.label || "",
        };
    }
    if (!card || !card.content) return;
    try {
      global.SidePanel?.setOpen?.(true);
      global.SidePanel?.setTab?.("report");
    } catch (_) {}
    openReport(card);
  }

  function onTab(tabId) {
    const sym = liveSymbol();
    if (sym) state.symbol = sym;
    if (tabId === "report") renderReports();
    if (tabId === "ai") renderMessages();
  }

  function init(opts = {}) {
    if (typeof opts.getSymbol === "function") state.getSymbol = opts.getSymbol;
    void refreshHealth();
    void refreshSkills();
    const sym = liveSymbol();
    if (sym) state.symbol = sym;
    renderMessages();
    renderReports();
    setComposerEnabled(true);

    el("aiSendBtn")?.addEventListener("click", () => void sendMessage());
    el("aiStopBtn")?.addEventListener("click", stop);
    el("aiNewBtn")?.addEventListener("click", newChat);
    el("aiInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    });
    el("reportDrawerClose")?.addEventListener("click", () => {
      el("reportDrawer")?.classList.remove("show");
    });
  }

  global.KlineAI = {
    init,
    setSymbol,
    setPeriod,
    onTab,
    refreshReports: renderReports,
    listChartTags,
    openReportFromChart,
    openReport,
    sendMessage,
    stop,
    newChat,
  };
})(window);
