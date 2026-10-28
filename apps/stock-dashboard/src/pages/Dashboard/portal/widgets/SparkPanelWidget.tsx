/**
 * Catalog 注册的独立 spark 面板（全球/期货/…）
 */

import { usePortalMarkets } from '../portalMarketsContext';
import { getSparkPanel, type SparkWidgetType } from '../sparkCatalog';
import { sameCode, SparkQuoteWidget } from './SparkQuoteWidget';

interface Props {
  type: SparkWidgetType;
}

export function SparkPanelWidget({ type }: Props) {
  const def = getSparkPanel(type);
  const { sparkQuotes } = usePortalMarkets();
  const list = sparkQuotes[def.market] || [];
  const quote = list.find((q) => sameCode(q.code, def.code));
  // 全球/有成交额的品种显示额；期货等无 amount 时 Header 自动隐藏
  const showAmount = def.group !== 'fx' && def.group !== 'rates';
  return (
    <SparkQuoteWidget
      code={def.code}
      klineSymbol={def.klineSymbol}
      quote={quote}
      showAmount={showAmount}
    />
  );
}
