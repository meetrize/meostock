/**
 * 主要交易所常规交易时段（本地墙钟；不含节假日 / 半日市）
 */

export type MarketSessionWindow = {
  /** 距当地 00:00 的分钟数 */
  start: number;
  end: number;
};

export type FinancialMarket = {
  id: string;
  /** 顶栏短名 */
  shortName: string;
  /** 完整名称 */
  fullName: string;
  timeZone: string;
  sessions: MarketSessionWindow[];
  /** 展示用起止（午休合并为一段文案时仍可写跨午休区间） */
  hoursLabel: string;
};

/** 按亚太开市顺序 → 欧美收市：东京 → 沪深 → 香港 → 伦敦 → 纽约 */
export const FINANCIAL_MARKETS: FinancialMarket[] = [
  {
    id: 'jp',
    shortName: '东京',
    fullName: '东京证券交易所',
    timeZone: 'Asia/Tokyo',
    sessions: [
      { start: 9 * 60, end: 11 * 60 + 30 },
      { start: 12 * 60 + 30, end: 15 * 60 },
    ],
    hoursLabel: '09:00-15:00',
  },
  {
    id: 'cn',
    shortName: '沪深',
    fullName: '上海 / 深圳证券交易所',
    timeZone: 'Asia/Shanghai',
    sessions: [
      { start: 9 * 60 + 30, end: 11 * 60 + 30 },
      { start: 13 * 60, end: 15 * 60 },
    ],
    hoursLabel: '09:30-15:00',
  },
  {
    id: 'hk',
    shortName: '香港',
    fullName: '香港交易所',
    timeZone: 'Asia/Hong_Kong',
    sessions: [
      { start: 9 * 60 + 30, end: 12 * 60 },
      { start: 13 * 60, end: 16 * 60 },
    ],
    hoursLabel: '09:30-16:00',
  },
  {
    id: 'uk',
    shortName: '伦敦',
    fullName: '伦敦证券交易所',
    timeZone: 'Europe/London',
    sessions: [{ start: 8 * 60, end: 16 * 60 + 30 }],
    hoursLabel: '08:00-16:30',
  },
  {
    id: 'us',
    shortName: '纽约',
    fullName: '纽约证券交易所 / 纳斯达克',
    timeZone: 'America/New_York',
    sessions: [{ start: 9 * 60 + 30, end: 16 * 60 }],
    hoursLabel: '09:30-16:00',
  },
];

export type ZonedClockParts = {
  hour: number;
  minute: number;
  second: number;
  month: number;
  day: number;
  weekday: number;
  /** 周几数字：周一=1 … 周日=7 */
  weekdayLabel: string;
  /** 月日，如 11-19 */
  dateLabel: string;
  timeLabel: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function zonedClockParts(ms: number, timeZone: string): ZonedClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms));

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const wd = get('weekday');
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[wd] ?? 0;
  // 周一=1 … 周日=7
  const weekdayNum = weekday === 0 ? 7 : weekday;

  return {
    hour,
    minute,
    second,
    month,
    day,
    weekday,
    weekdayLabel: String(weekdayNum),
    dateLabel: `${pad2(month)}-${pad2(day)}`,
    timeLabel: `${pad2(hour)}:${pad2(minute)}`,
  };
}

export function isMarketOpen(market: FinancialMarket, ms: number = Date.now()): boolean {
  const { hour, minute, weekday } = zonedClockParts(ms, market.timeZone);
  if (weekday === 0 || weekday === 6) return false;
  const now = hour * 60 + minute;
  return market.sessions.some((s) => now >= s.start && now < s.end);
}

export type MarketClockSnapshot = {
  market: FinancialMarket;
  timeLabel: string;
  weekdayLabel: string;
  dateLabel: string;
  open: boolean;
};

export function formatSessionsLabel(market: FinancialMarket): string {
  return market.sessions
    .map((s) => `${pad2(Math.floor(s.start / 60))}:${pad2(s.start % 60)}-${pad2(Math.floor(s.end / 60))}:${pad2(s.end % 60)}`)
    .join(' / ');
}

export function snapshotMarketClocks(ms: number = Date.now()): MarketClockSnapshot[] {
  return FINANCIAL_MARKETS.map((market) => {
    const parts = zonedClockParts(ms, market.timeZone);
    return {
      market,
      timeLabel: parts.timeLabel,
      weekdayLabel: parts.weekdayLabel,
      dateLabel: parts.dateLabel,
      open: isMarketOpen(market, ms),
    };
  });
}
