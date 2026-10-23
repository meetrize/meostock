/**
 * 多面板会话持久化
 */
const SESSION_KEY = "kline-multipanel-session";

export function loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} session
 */
export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {}
}

/**
 * @param {object} partial
 */
export function patchSession(partial) {
  const cur = loadSession() || {};
  const next = { ...cur, ...partial };
  saveSession(next);
  return next;
}
