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

  function threadKey(symbol) {
    return String(symbol || "").trim().toLowerCase() || "_";
  }

  function getThread(symbol) {
    const all = loadThreads();
    const key = threadKey(symbol);
    if (!all[key]) {
      all[key] = { id: key, symbol, updatedAt: Date.now(), messages: [] };
      saveThreads(all);
    }
    return all[key];
  }

  function updateThread(symbol, mutator) {
    const all = loadThreads();
    const key = threadKey(symbol);
    const t = all[key] || { id: key, symbol, updatedAt: Date.now(), messages: [] };
    mutator(t);
    t.updatedAt = Date.now();
    t.symbol = symbol;
    all[key] = t;
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

  function titleOf(text) {
    const line = String(text || "")
      .split(/\n/)
      .map((s) => s.trim())
      .find(Boolean);
    const plain = stripMd(line || text).slice(0, 24);
    return plain || "AI 回复";
  }

  function isReportWorthy(msg) {
    if (!msg || msg.role !== "assistant") return false;
    if (msg.skillId) return true;
    return stripMd(msg.content).length >= REPORT_MIN_LEN;
  }

  function collectReports() {
    const all = loadThreads();
    const cards = [];
    Object.values(all).forEach((thread) => {
      (thread.messages || []).forEach((msg) => {
        if (!isReportWorthy(msg)) return;
        cards.push({
          messageId: msg.id,
          symbol: thread.symbol || thread.id,
          updatedAt: msg.ts || thread.updatedAt || 0,
          skillId: msg.skillId || "",
          title: titleOf(msg.content),
          summary: stripMd(msg.content).slice(0, 120),
          content: msg.content,
        });
      });
    });
    cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return cards;
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
      div.textContent = msg.content || "";
      if (msg.streaming) div.classList.add("streaming-caret");
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
      "未配置 DEEPSEEK_API_KEY：在项目 .env 填写后重启服务，即可使用 AI 对话。";
  }

  function renderReports() {
    const list = el("reportList");
    if (!list) return;
    const cards = collectReports();
    list.innerHTML = "";
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "side-empty";
      empty.textContent = "暂无报告。在 AI 对话中得到较长回复后会自动出现在这里。";
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
    body.textContent = card.content || "";
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
              node.textContent = full;
              node.classList.add("streaming-caret");
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
          }
        });
      }
    } finally {
      state.streaming = false;
      state.abort = null;
      setComposerEnabled(true);
      renderMessages();
      renderReports();
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
  }

  function setSymbol(symbol, { period } = {}) {
    const next = String(symbol || "").trim();
    if (period) state.period = period;
    if (next === state.symbol) {
      renderMessages();
      return;
    }
    if (state.streaming) stop();
    state.symbol = next;
    renderMessages();
    const box = el("aiMsgs");
    if (box && next) {
      const note = document.createElement("div");
      note.className = "ai-bubble system-note";
      note.textContent = `已切换到 ${next}`;
      // soft hint only once visually via messages empty state; skip injecting into storage
    }
  }

  function setPeriod(period) {
    if (period) state.period = period;
  }

  function onTab(tabId) {
    if (tabId === "report") renderReports();
    if (tabId === "ai") renderMessages();
  }

  function init() {
    void refreshHealth();
    void refreshSkills();
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
    sendMessage,
    stop,
    newChat,
  };
})(window);
