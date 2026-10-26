import { Tabs } from '@/components/common';
import { formatPercent, formatYuanAmount, getChangeColorClass } from '@/utils/format';
import { useDashboardData } from '../dashboardDataContext';
import { estimateVisibleRows } from '../widgetCatalog';
import styles from '../widgetContent.module.css';

interface Props {
  gridH: number;
}

export function HotBoardsWidget({ gridH }: Props) {
  const { boardTab, setBoardTab, currentBoards, onBoardClick } = useDashboardData();
  const limit = Math.max(3, estimateVisibleRows(gridH) - 1);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Tabs
          items={[
            { key: 'industry', label: '行业' },
            { key: 'concept', label: '概念' },
          ]}
          activeKey={boardTab}
          onChange={(key) => setBoardTab(key as 'industry' | 'concept')}
          size="sm"
        />
      </div>
      <div className={styles.boardList}>
        {currentBoards.slice(0, limit).map((item) => (
          <div
            key={item.code}
            className={styles.boardItem}
            onClick={() => onBoardClick(item.code, boardTab)}
          >
            <div className={styles.boardLeft}>
              <span className={styles.boardRank}>{item.rank}</span>
              <div className={styles.boardInfo}>
                <span className={styles.boardName}>{item.name}</span>
                <span className={styles.boardLeader}>
                  领涨：{item.leadingStock}
                  <span className={getChangeColorClass(item.leadingStockChangePercent)}>
                    {' '}
                    {formatPercent(item.leadingStockChangePercent)}
                  </span>
                </span>
              </div>
            </div>
            <div className={styles.boardRight}>
              <div
                className={`${styles.boardChange} ${getChangeColorClass(item.changePercent)}`}
              >
                {formatPercent(item.changePercent)}
              </div>
              <div className={styles.boardStats}>
                <span className="text-rise">
                  {item.riseCount != null ? `${item.riseCount}↑` : '--'}
                </span>
                <span className="text-fall">
                  {item.fallCount != null ? `${item.fallCount}↓` : '--'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardFundFlowWidget({ gridH }: Props) {
  const { boardTab, setBoardTab, currentFundFlowBoards, onBoardClick } =
    useDashboardData();
  const limit = Math.max(3, estimateVisibleRows(gridH) - 1);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Tabs
          items={[
            { key: 'industry', label: '行业' },
            { key: 'concept', label: '概念' },
          ]}
          activeKey={boardTab}
          onChange={(key) => setBoardTab(key as 'industry' | 'concept')}
          size="sm"
        />
      </div>
      <div className={styles.boardList}>
        {currentFundFlowBoards.slice(0, limit).map((item, index) => (
          <div
            key={`${item.code}-flow`}
            className={styles.boardItem}
            onClick={() => onBoardClick(item.code, boardTab)}
          >
            <div className={styles.boardLeft}>
              <span className={styles.boardRank}>{index + 1}</span>
              <div className={styles.boardInfo}>
                <span className={styles.boardName}>{item.name}</span>
                <span className={styles.boardLeader}>
                  领流：{item.topStockName || '--'}
                  {item.topStockCode ? ` · ${item.topStockCode}` : ''}
                </span>
              </div>
            </div>
            <div className={styles.boardRight}>
              <div
                className={`${styles.boardChange} ${getChangeColorClass(item.mainNetInflow)}`}
              >
                {formatYuanAmount(item.mainNetInflow)}
              </div>
              <div className={styles.boardStats}>
                <span className={getChangeColorClass(item.changePercent)}>
                  {formatPercent(item.changePercent)}
                </span>
                <span className={getChangeColorClass(item.mainNetInflowPercent)}>
                  {formatPercent(item.mainNetInflowPercent)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
