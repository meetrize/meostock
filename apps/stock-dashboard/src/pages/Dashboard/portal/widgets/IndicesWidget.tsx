import { useDashboardData } from '../dashboardDataContext';
import type { IndexWidgetType } from '../indexCatalog';
import { getIndexCodeByType } from '../indexCatalog';
import { sameCode, SparkQuoteWidget } from './SparkQuoteWidget';

interface Props {
  type: IndexWidgetType;
}

/** A 股主要指数 — 复用 SparkQuoteWidget */
export function IndexWidget({ type }: Props) {
  const { indices } = useDashboardData();
  const code = getIndexCodeByType(type);
  const quote = indices.find((q) => sameCode(q.code, code));
  return (
    <SparkQuoteWidget code={code} klineSymbol={code} quote={quote} showAmount />
  );
}
