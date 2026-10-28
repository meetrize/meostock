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
  return (
    <SparkQuoteWidget
      code={def.code}
      klineSymbol={def.klineSymbol}
      quote={quote}
      showAmount={def.group === 'global'}
    />
  );
}
