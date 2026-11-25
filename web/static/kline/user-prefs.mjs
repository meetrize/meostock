/**
 * K 线页用户偏好：本地 localStorage + 登录后防抖同步 namespace=kline
 * 经典脚本可通过 window.MeoUserPrefs 调用。
 */

const NAMESPACE = "kline";

/** 同步白名单（精确或前缀） */
const SYNC_KEYS = new Set([
  "kline-chart-settings",
  "kline-ma-params",
  "kline-theme",
  "kline.side.open",
  "kline.side.ratio",
  "kline.side.tab",
]);

const SYNC_PREFIXES = ["kline-chart-", "kline-ma-", "kline.side."];

let loggedIn = false;
let debounceTimer = null;
const pending = new Map();
const revMap = new Map();

function isSyncable(key) {
  if (!key) return false;
  if (SYNC_KEYS.has(key)) return true;
  return SYNC_PREFIXES.some((p) => key.startsWith(p));
}

export function prefGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

export function prefGetJson(key, fallback = null) {
  try {
    const raw = prefGet(key, null);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function parseValue(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return raw;
  }
}

export function prefSet(key, value) {
  const str =
    typeof value === "string" ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, str);
  } catch (_) {
    return false;
  }
  noteWrite(key, parseValue(str));
  return true;
}

export function prefSetJson(key, value) {
  return prefSet(key, value);
}

/** 本地已写入后通知（供经典脚本在 setItem 后调用） */
export function noteWrite(key, value) {
  if (!loggedIn || !isSyncable(key)) return;
  pending.set(key, value);
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushPending();
  }, 700);
}

async function flushPending() {
  if (!loggedIn || pending.size === 0) return;
  const items = Array.from(pending.entries()).map(([key, value]) => ({
    key,
    value,
    base_rev: revMap.get(key),
  }));
  pending.clear();
  try {
    const res = await fetch("/api/user/prefs", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: NAMESPACE, items }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "prefs put failed");
    for (const item of data.items || []) {
      if (item && item.key && typeof item.rev === "number") {
        revMap.set(item.key, item.rev);
      }
      if (item && item.conflict && item.value !== undefined) {
        try {
          const s =
            typeof item.value === "string"
              ? item.value
              : JSON.stringify(item.value);
          localStorage.setItem(item.key, s);
        } catch (_) {}
      }
    }
  } catch (err) {
    for (const it of items) {
      if (!pending.has(it.key)) pending.set(it.key, it.value);
    }
    console.warn("[MeoUserPrefs] flush failed", err);
  }
}

function applyItems(items) {
  for (const item of items || []) {
    if (!item || !item.key || !isSyncable(item.key)) continue;
    try {
      const s =
        typeof item.value === "string"
          ? item.value
          : JSON.stringify(item.value);
      localStorage.setItem(item.key, s);
    } catch (_) {}
    if (typeof item.rev === "number") revMap.set(item.key, item.rev);
  }
}

export async function hydrateFromServer() {
  try {
    const meRes = await fetch("/api/auth/me", { credentials: "include" });
    const meData = await meRes.json().catch(() => ({}));
    const user = meData && meData.user;
    loggedIn = Boolean(user && user.id);
    if (!loggedIn) return { user: null, keys: [] };

    const res = await fetch(
      `/api/user/prefs?namespace=${encodeURIComponent(NAMESPACE)}`,
      { credentials: "include" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { user, keys: [] };
    applyItems(data.items || []);
    const keys = (data.items || []).map((i) => i.key).filter(Boolean);
    try {
      window.dispatchEvent(
        new CustomEvent("meo:kline-prefs-applied", { detail: { keys } })
      );
    } catch (_) {}
    return { user, keys };
  } catch (_) {
    loggedIn = false;
    return { user: null, keys: [] };
  }
}

export function getAuthUser() {
  return loggedIn;
}

export async function fetchAuthMe() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    return data.user || null;
  } catch (_) {
    return null;
  }
}

const api = {
  prefGet,
  prefSet,
  prefGetJson,
  prefSetJson,
  noteWrite,
  hydrateFromServer,
  fetchAuthMe,
  getAuthUser: () => loggedIn,
};

if (typeof window !== "undefined") {
  window.MeoUserPrefs = api;
  // 页面加载后自动拉取
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void hydrateFromServer();
    });
  } else {
    void hydrateFromServer();
  }
}

export default api;
