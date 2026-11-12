/**
 * 分时补齐：按市场交易时段生成全日分钟轴。
 * - A 股：09:30–11:30 + 13:00–15:00（242）
 * - 港股：09:30–12:00 + 13:00–16:00（332）
 * - 美股/YF：09:30–16:00 ET（391）
 */

const CN_FS_DAY_SLOTS = 242;
const HK_FS_DAY_SLOTS = 332;
const US_FS_DAY_SLOTS = 391;

/** @deprecated 兼容旧引用：默认 A 股槽位数 */
const FS_DAY_SLOTS = CN_FS_DAY_SLOTS;

export { FS_DAY_SLOTS, CN_FS_DAY_SLOTS, HK_FS_DAY_SLOTS, US_FS_DAY_SLOTS };

function partsInTz(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
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

/** 将某时区本地年月日时分转为 UTC ms */
function localToUtcMs(timeZone, y, mo, d, h, mi) {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 5; i++) {
    const p = partsInTz(t, timeZone);
    const deltaMin = h * 60 + mi - (p.h * 60 + p.mi);
    const deltaDay =
      (Date.UTC(y, mo - 1, d) - Date.UTC(p.y, p.mo - 1, p.d)) / 86_400_000;
    if (deltaMin === 0 && deltaDay === 0) break;
    t += deltaMin * 60_000 + deltaDay * 86_400_000;
  }
  return t;
}

/**
 * @param {string} [market]
 * @returns {{ timeZone: string, daySlots: number, buildSlots: (dayTs: number) => number[] }}
 */
export function getFsSessionSpec(market) {
  const m = String(market || "CN").toUpperCase();
  if (m === "US" || m === "YF") {
    const timeZone = "America/New_York";
    return {
      timeZone,
      daySlots: US_FS_DAY_SLOTS,
      buildSlots(dayTs) {
        const p = partsInTz(dayTs, timeZone);
        const slots = [];
        for (let t = 9 * 60 + 30; t <= 16 * 60; t += 1) {
          slots.push(localToUtcMs(timeZone, p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
        }
        return slots;
      },
    };
  }
  if (m === "HK") {
    const timeZone = "Asia/Hong_Kong";
    return {
      timeZone,
      daySlots: HK_FS_DAY_SLOTS,
      buildSlots(dayTs) {
        const p = partsInTz(dayTs, timeZone);
        const slots = [];
        for (let t = 9 * 60 + 30; t <= 12 * 60; t += 1) {
          slots.push(localToUtcMs(timeZone, p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
        }
        for (let t = 13 * 60; t <= 16 * 60; t += 1) {
          slots.push(localToUtcMs(timeZone, p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
        }
        return slots;
      },
    };
  }
  const timeZone = "Asia/Shanghai";
  return {
    timeZone,
    daySlots: CN_FS_DAY_SLOTS,
    buildSlots(dayTs) {
      const p = partsInTz(dayTs, timeZone);
      const slots = [];
      for (let t = 9 * 60 + 30; t <= 11 * 60 + 30; t += 1) {
        slots.push(localToUtcMs(timeZone, p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
      }
      for (let t = 13 * 60; t <= 15 * 60; t += 1) {
        slots.push(localToUtcMs(timeZone, p.y, p.mo, p.d, Math.floor(t / 60), t % 60));
      }
      return slots;
    },
  };
}

export function dayRangeInTz(ts = Date.now(), timeZone = "Asia/Shanghai") {
  const p = partsInTz(ts, timeZone);
  return {
    ymd: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`,
    start: localToUtcMs(timeZone, p.y, p.mo, p.d, 0, 0),
    end: localToUtcMs(timeZone, p.y, p.mo, p.d, 23, 59),
  };
}

/** @deprecated 兼容旧名 */
export function shanghaiDayRangeUtc(ts = Date.now()) {
  return dayRangeInTz(ts, "Asia/Shanghai");
}

function floorMinuteUtc(ts, timeZone) {
  const p = partsInTz(ts, timeZone);
  return localToUtcMs(timeZone, p.y, p.mo, p.d, p.h, p.mi);
}

export function groupBarsByMarketDay(bars, market = "CN") {
  const { timeZone } = getFsSessionSpec(market);
  const map = new Map();
  (bars || []).forEach((b) => {
    if (!b || !Number.isFinite(b.timestamp)) return;
    const { ymd } = dayRangeInTz(b.timestamp, timeZone);
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
  return { days, byDay: map, timeZone };
}

/** @deprecated 兼容旧名（按上海日分组） */
export function groupBarsByShanghaiDay(bars) {
  return groupBarsByMarketDay(bars, "CN");
}

export function padFsDayBars(dayBars, market = "CN") {
  const list = Array.isArray(dayBars)
    ? dayBars.filter((b) => b && Number.isFinite(b.timestamp))
    : [];
  if (!list.length) return [];
  const spec = getFsSessionSpec(market);
  const slots = spec.buildSlots(list[0].timestamp);
  const byMin = new Map();
  list.forEach((b) => {
    byMin.set(floorMinuteUtc(b.timestamp, spec.timeZone), b);
  });
  const todayYmd = dayRangeInTz(Date.now(), spec.timeZone).ymd;
  const dayYmd = dayRangeInTz(list[0].timestamp, spec.timeZone).ymd;
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

/**
 * 准备分时入图数据：按市场交易日拆分并补齐，旧→新拼接。
 * @returns {{ days: string[], bars: number[]|object[], daySlots: number, latest: string|null }}
 */
export function prepareFsChartBars(bars, market = "CN") {
  const spec = getFsSessionSpec(market);
  const { days, byDay } = groupBarsByMarketDay(bars, market);
  if (!days.length) {
    return { days: [], bars: [], daySlots: spec.daySlots, latest: null };
  }
  const out = days.flatMap((ymd) => padFsDayBars(byDay.get(ymd) || [], market));
  return {
    days,
    bars: out,
    daySlots: spec.daySlots,
    latest: days[days.length - 1],
  };
}

/** 只取今天（或最近交易日）并补齐 */
export function padCnFsBarsLatestDay(bars, market = "CN") {
  const prepared = prepareFsChartBars(bars, market);
  if (!prepared.days.length) return [];
  const { timeZone } = getFsSessionSpec(market);
  const todayYmd = dayRangeInTz(Date.now(), timeZone).ymd;
  const ymd = prepared.days.includes(todayYmd)
    ? todayYmd
    : prepared.days[prepared.days.length - 1];
  return padFsDayBars(
    groupBarsByMarketDay(bars, market).byDay.get(ymd) || [],
    market
  );
}
