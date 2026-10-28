/**
 * 独立报价/面积图面板注册表（全球指数、期货、商品等）
 */

export type SparkPanelDef = {
  type: string;
  name: string;
  /** snapshot 市场 id */
  market: string;
  /** snapshot 内 code */
  code: string;
  /** /api/cache/kline symbol */
  klineSymbol: string;
  group: 'global' | 'futures' | 'metals' | 'fx' | 'crypto' | 'rates';
};

function yf(type: string, market: string, code: string, name: string, group: SparkPanelDef['group']): SparkPanelDef {
  return { type, name, market, code, klineSymbol: `yf:${code}`, group };
}

function fut(type: string, code: string, name: string): SparkPanelDef {
  return {
    type,
    name,
    market: 'futures',
    code,
    klineSymbol: `fut:${code}`,
    group: 'futures',
  };
}

export const SPARK_PANELS = [
  yf('spark.dji', 'yf:US', '^DJI', '道指', 'global'),
  yf('spark.ixic', 'yf:US', '^IXIC', '纳指', 'global'),
  yf('spark.gspc', 'yf:US', '^GSPC', '标普500', 'global'),
  yf('spark.vix', 'yf:US', '^VIX', 'VIX', 'global'),
  yf('spark.hsi', 'yf:ASIA', '^HSI', '恒生', 'global'),
  yf('spark.n225', 'yf:ASIA', '^N225', '日经', 'global'),
  yf('spark.ks11', 'yf:ASIA', '^KS11', '韩国综指', 'global'),
  yf('spark.gdaxi', 'yf:EUROPE', '^GDAXI', 'DAX', 'global'),
  yf('spark.ftse', 'yf:EUROPE', '^FTSE', '富时100', 'global'),
  yf('spark.stoxx50e', 'yf:EUROPE', '^STOXX50E', '欧股50', 'global'),

  fut('spark.fut.aum', 'AUM', '沪金'),
  fut('spark.fut.agm', 'AGM', '沪银'),
  fut('spark.fut.cum', 'CUM', '沪铜'),
  fut('spark.fut.rbm', 'RBM', '螺纹'),
  fut('spark.fut.scm', 'SCM', '原油'),
  fut('spark.fut.rum', 'RUM', '橡胶'),
  fut('spark.fut.mam', 'MM', '豆粕'),
  fut('spark.fut.ifm', 'IFM', '沪深300期'),
  fut('spark.fut.icm', 'ICM', '中证500期'),
  fut('spark.fut.imm', 'IMM', '中证1000期'),

  yf('spark.gc', 'yf:METALS', 'GC=F', '黄金', 'metals'),
  yf('spark.si', 'yf:METALS', 'SI=F', '白银', 'metals'),
  yf('spark.cl', 'yf:METALS', 'CL=F', 'WTI原油', 'metals'),
  yf('spark.bz', 'yf:METALS', 'BZ=F', '布伦特', 'metals'),
  yf('spark.hg', 'yf:METALS', 'HG=F', '铜', 'metals'),
  yf('spark.ng', 'yf:METALS', 'NG=F', '天然气', 'metals'),

  yf('spark.usdcny', 'yf:CURRENCIES', 'USDCNY=X', '美元人民币', 'fx'),
  yf('spark.eurusd', 'yf:CURRENCIES', 'EURUSD=X', '欧元美元', 'fx'),
  yf('spark.jpy', 'yf:CURRENCIES', 'JPY=X', '美元日元', 'fx'),
  yf('spark.gbpusd', 'yf:CURRENCIES', 'GBPUSD=X', '英镑美元', 'fx'),
  yf('spark.audusd', 'yf:CURRENCIES', 'AUDUSD=X', '澳元美元', 'fx'),
  yf('spark.hkd', 'yf:CURRENCIES', 'HKD=X', '美元港币', 'fx'),

  yf('spark.btc', 'yf:CRYPTOCURRENCIES', 'BTC-USD', '比特币', 'crypto'),
  yf('spark.eth', 'yf:CRYPTOCURRENCIES', 'ETH-USD', '以太坊', 'crypto'),
  yf('spark.sol', 'yf:CRYPTOCURRENCIES', 'SOL-USD', 'Solana', 'crypto'),
  yf('spark.bnb', 'yf:CRYPTOCURRENCIES', 'BNB-USD', 'BNB', 'crypto'),

  yf('spark.irx', 'yf:RATES', '^IRX', '美债3月', 'rates'),
  yf('spark.tnx', 'yf:RATES', '^TNX', '美债10年', 'rates'),
  yf('spark.tyx', 'yf:RATES', '^TYX', '美债30年', 'rates'),
] as const satisfies readonly SparkPanelDef[];

export type SparkWidgetType = (typeof SPARK_PANELS)[number]['type'];

const BY_TYPE = Object.fromEntries(SPARK_PANELS.map((p) => [p.type, p])) as Record<
  SparkWidgetType,
  SparkPanelDef
>;

export function isSparkWidgetType(type: string): type is SparkWidgetType {
  return type in BY_TYPE;
}

export function getSparkPanel(type: SparkWidgetType): SparkPanelDef {
  return BY_TYPE[type];
}

export const DEFAULT_GLOBAL_SPARK_TYPES: SparkWidgetType[] = SPARK_PANELS.filter(
  (p) => p.group === 'global'
).map((p) => p.type);

export const DEFAULT_FUTURES_SPARK_TYPES: SparkWidgetType[] = SPARK_PANELS.filter(
  (p) => p.group === 'futures'
).map((p) => p.type);
