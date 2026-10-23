/**
 * A 股分时补齐（简化版：按日补 09:30–15:00）
 * 多面板一期默认只用「最近一日」；完整多日拖动仍以单图页为准。
 */

const FS_DAY_SLOTS = 242;

export { FS_DAY_SLOTS };

function shanghaiParts(ts) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (t) => parts.find((p) => p.type === t)?.value || "0";
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour") === "24" ? "0" : get("hour")),
    mi: Number(get("minute")),
  };
}

function shanghaiLocalToUtcMs(y, mo, d, h, mi) {
  const pad = (n) => String(n).padStart(2, "0");
  return Date.parse(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+08:00`);
}

function floorShanghaiMinuteUtc(ts) {
  const p = shanghaiParts(ts);
  return shanghaiLocalToUtcMs(p.y, p.mo, p.d, p.h, p.mi);
}

export function shanghaiDayRangeUtc(ts = Date.now()) {
  const p = shanghaiParts(ts);
  return {
    ymd: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
    start: shanghaiLocalToUtcMs(p.y, p.mo, p.d, 0, 0),
    end: shanghaiLocalToUtcMs(p.y, p.mo, p.d, 23, 59),
  };
}

function buildCnFsSlotTimestamps(dayTs) {
  const p = shanghaiParts(dayTs);
  const slots = [];
  for (let t = 9 * 60 + 30; t <= 11 * 60 + 30; t += 1) {
    slots.push(shanghaiLocalToUtcMs(p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
  }
  for (let t = 13 * 60; t <= 15 * 60; t += 1) {
    slots.push(shanghaiLocalToUtcMs(p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
  }
  return slots;
}

export function groupBarsByShanghaiDay(bars) {
  const map = new Map();
  (bars || []).forEach((b) => {
    if (!b || !Number.isFinite(b.timestamp)) return;
    const { ymd } = shanghaiDayRangeUtc(b.timestamp);
    if (!map.has(ymd)) map.set(ymd, []);
    map.get(ymd).push(b);
  });
  const days = [...map.keys()].sort();
  days.forEach((ymd) => {
    map.set(
      ymd,
      map.get(ymd).sort((a, b) => a.timestamp - b.timestamp)
    );
  });
  return { days, byDay: map };
}

export function padFsDayBars(dayBars) {
  const list = Array.isArray(dayBars)
    ? dayBars.filter((b) => b && Number.isFinite(b.timestamp))
    : [];
  if (!list.length) return [];
  const slots = buildCnFsSlotTimestamps(list[0].timestamp);
  const byMin = new Map();
  list.forEach((b) => {
    byMin.set(floorShanghaiMinuteUtc(b.timestamp), b);
  });
  const todayYmd = shanghaiDayRangeUtc(Date.now()).ymd;
  const dayYmd = shanghaiDayRangeUtc(list[0].timestamp).ymd;
  const isToday = dayYmd === todayYmd;
  const now = Date.now();
  let last = null;
  const out = [];
  for (const ts of slots) {
    const hit = byMin.get(ts);
    if (hit) {
      last = { ...hit, timestamp: ts };
      out.push(last);
      continue;
    }
    if (isToday && ts > now) {
      out.push({
        timestamp: ts,
        open: NaN,
        high: NaN,
        low: NaN,
        close: NaN,
        volume: 0,
        turnover: 0,
      });
    } else if (last && Number.isFinite(last.close)) {
      out.push({
        timestamp: ts,
        open: last.close,
        high: last.close,
        low: last.close,
        close: last.close,
        volume: 0,
        turnover: 0,
      });
    } else {
      out.push({
        timestamp: ts,
        open: NaN,
        high: NaN,
        low: NaN,
        close: NaN,
        volume: 0,
        turnover: 0,
      });
    }
  }
  return out;
}

/** 只取今天（或最近交易日）并补齐 */
export function padCnFsBarsLatestDay(bars) {
  const { days, byDay } = groupBarsByShanghaiDay(bars);
  if (!days.length) return [];
  const todayYmd = shanghaiDayRangeUtc(Date.now()).ymd;
  const ymd = byDay.has(todayYmd) ? todayYmd : days[days.length - 1];
  return padFsDayBars(byDay.get(ymd));
}
