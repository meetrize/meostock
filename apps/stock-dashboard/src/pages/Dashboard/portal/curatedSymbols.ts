/**
 * 首页条带精选标的（控制默认信息密度）
 */

export type CuratedQuote = {
  market: string;
  code: string;
  name: string;
};

/** 全球主要指数（合并 Yahoo 美/欧/亚） */
export const GLOBAL_INDEX_CURATED: CuratedQuote[] = [
  { market: 'yf:US', code: '^DJI', name: '道指' },
  { market: 'yf:US', code: '^IXIC', name: '纳指' },
  { market: 'yf:US', code: '^GSPC', name: '标普500' },
  { market: 'yf:US', code: '^VIX', name: 'VIX' },
  { market: 'yf:ASIA', code: '^HSI', name: '恒生' },
  { market: 'yf:ASIA', code: '^N225', name: '日经' },
  { market: 'yf:ASIA', code: '^KS11', name: '韩国综指' },
  { market: 'yf:EUROPE', code: '^GDAXI', name: 'DAX' },
  { market: 'yf:EUROPE', code: '^FTSE', name: '富时100' },
  { market: 'yf:EUROPE', code: '^STOXX50E', name: '欧股50' },
];

/** 国内主力期货（目录轨） */
export const FUTURES_CURATED: CuratedQuote[] = [
  { market: 'futures', code: 'AUM', name: '沪金' },
  { market: 'futures', code: 'AGM', name: '沪银' },
  { market: 'futures', code: 'CUM', name: '沪铜' },
  { market: 'futures', code: 'RBM', name: '螺纹' },
  { market: 'futures', code: 'SCM', name: '原油' },
  { market: 'futures', code: 'RUM', name: '橡胶' },
  { market: 'futures', code: 'MAM', name: '豆粕' },
  { market: 'futures', code: 'IFM', name: '沪深300期' },
  { market: 'futures', code: 'ICM', name: '中证500期' },
  { market: 'futures', code: 'IMM', name: '中证1000期' },
];

export const METALS_CURATED: CuratedQuote[] = [
  { market: 'yf:METALS', code: 'GC=F', name: '黄金' },
  { market: 'yf:METALS', code: 'SI=F', name: '白银' },
  { market: 'yf:METALS', code: 'CL=F', name: 'WTI原油' },
  { market: 'yf:METALS', code: 'BZ=F', name: '布伦特' },
  { market: 'yf:METALS', code: 'HG=F', name: '铜' },
  { market: 'yf:METALS', code: 'NG=F', name: '天然气' },
];

export const FX_CURATED: CuratedQuote[] = [
  { market: 'yf:CURRENCIES', code: 'USDCNY=X', name: '美元人民币' },
  { market: 'yf:CURRENCIES', code: 'EURUSD=X', name: '欧元美元' },
  { market: 'yf:CURRENCIES', code: 'JPY=X', name: '美元日元' },
  { market: 'yf:CURRENCIES', code: 'GBPUSD=X', name: '英镑美元' },
  { market: 'yf:CURRENCIES', code: 'AUDUSD=X', name: '澳元美元' },
  { market: 'yf:CURRENCIES', code: 'HKD=X', name: '美元港币' },
];

export const CRYPTO_CURATED: CuratedQuote[] = [
  { market: 'yf:CRYPTOCURRENCIES', code: 'BTC-USD', name: '比特币' },
  { market: 'yf:CRYPTOCURRENCIES', code: 'ETH-USD', name: '以太坊' },
  { market: 'yf:CRYPTOCURRENCIES', code: 'SOL-USD', name: 'Solana' },
  { market: 'yf:CRYPTOCURRENCIES', code: 'BNB-USD', name: 'BNB' },
];

export const RATES_CURATED: CuratedQuote[] = [
  { market: 'yf:RATES', code: '^IRX', name: '美债3月' },
  { market: 'yf:RATES', code: '^TNX', name: '美债10年' },
  { market: 'yf:RATES', code: '^TYX', name: '美债30年' },
];
