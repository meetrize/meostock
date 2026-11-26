/**
 * 自定义个股面板：复用 SparkQuoteWidget；空态 / 编辑可换股
 */

import { useMemo, useState } from 'react';
import { usePortalMarkets } from '../portalMarketsContext';
import {
  readCustomStockConfig,
  type CustomStockConfig,
} from '../customStock';
import type { PortalWidgetInstance } from '../types';
import { sameCode, SparkQuoteWidget } from './SparkQuoteWidget';
import { StockPickerModal } from './StockPickerModal';
import styles from './CustomStockWidget.module.css';

interface Props {
  widget: PortalWidgetInstance;
  editing?: boolean;
  onUpdate?: (patch: Partial<PortalWidgetInstance>) => void;
}

export function CustomStockWidget({ widget, editing, onUpdate }: Props) {
  const { customQuotes } = usePortalMarkets();
  const [pickerOpen, setPickerOpen] = useState(false);

  const config = useMemo(() => readCustomStockConfig(widget), [widget]);

  const quote = useMemo(() => {
    if (!config) return undefined;
    return customQuotes.find((q) => sameCode(q.code, config.code));
  }, [config, customQuotes]);

  const applyConfig = (next: CustomStockConfig) => {
    onUpdate?.({
      title: next.name,
      config: { ...next },
    });
    setPickerOpen(false);
  };

  if (!config) {
    return (
      <>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>尚未选择股票</div>
          <div className={styles.emptyDesc}>从 A股 / 港股 / 美股中挑一只放到总览</div>
          <button
            type="button"
            className={styles.emptyBtn}
            onClick={() => setPickerOpen(true)}
          >
            选择股票
          </button>
        </div>
        <StockPickerModal
          open={pickerOpen}
          title="选择股票"
          confirmLabel="确认"
          onClose={() => setPickerOpen(false)}
          onConfirm={applyConfig}
        />
      </>
    );
  }

  return (
    <>
      {editing ? (
        <div className={styles.editBar}>
          <button
            type="button"
            className={styles.changeBtn}
            onClick={() => setPickerOpen(true)}
          >
            更换股票
          </button>
        </div>
      ) : null}
      <div className={editing ? styles.chartWithBar : styles.chartFill}>
        <SparkQuoteWidget
          code={config.code}
          klineSymbol={config.klineSymbol}
          quote={quote}
          showAmount
        />
      </div>
      <StockPickerModal
        open={pickerOpen}
        title="更换股票"
        confirmLabel="确认更换"
        initialMarket={config.market}
        initialCode={config.code}
        onClose={() => setPickerOpen(false)}
        onConfirm={applyConfig}
      />
    </>
  );
}
