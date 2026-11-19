import type { ReactNode } from 'react';
import type { PortalWidgetInstance, PortalWidgetType } from '../types';
import { isIndexWidgetType } from '../indexCatalog';
import { IndexWidget } from './IndicesWidget';
import {
  StatAmountWidget,
  StatBreadthWidget,
  StatLimitWidget,
  StatMainForceWidget,
  StatNorthboundWidget,
  StatStrongestBoardWidget,
} from './StatWidgets';
import { WatchlistWidget } from './WatchlistWidget';
import { MarketRankingWidget } from './MarketRankingWidget';
import { FundFlowRankWidget } from './FundFlowRankWidget';
import { BoardFundFlowWidget, HotBoardsWidget } from './BoardsWidgets';
import { StripWidget } from './StripWidget';
import { TopicListWidget } from './TopicListWidget';
import { RankListWidget } from './RankListWidget';
import { StatMarginWidget } from './StatMarginWidget';
import { MacroRatesWidget } from './MacroRatesWidget';
import { SparkPanelWidget } from './SparkPanelWidget';
import { IframeWidget } from './IframeWidget';
import { isSparkWidgetType } from '../sparkCatalog';

export interface RenderWidgetOptions {
  editing?: boolean;
  onUpdate?: (patch: Partial<PortalWidgetInstance>) => void;
}

export function renderWidget(
  type: PortalWidgetType,
  gridW: number,
  gridH: number,
  widget?: PortalWidgetInstance,
  opts?: RenderWidgetOptions
): ReactNode {
  if (isIndexWidgetType(type)) {
    return <IndexWidget type={type} />;
  }
  if (isSparkWidgetType(type)) {
    return <SparkPanelWidget type={type} />;
  }

  switch (type) {
    case 'stat.breadth':
      return <StatBreadthWidget />;
    case 'stat.limit':
      return <StatLimitWidget />;
    case 'stat.amount':
      return <StatAmountWidget />;
    case 'stat.northbound':
      return <StatNorthboundWidget />;
    case 'stat.mainForce':
      return <StatMainForceWidget />;
    case 'stat.strongestBoard':
      return <StatStrongestBoardWidget />;
    case 'stat.margin':
      return <StatMarginWidget />;
    case 'macro.rates':
      return <MacroRatesWidget />;
    case 'watchlist':
      return <WatchlistWidget />;
    case 'marketRanking':
      return <MarketRankingWidget gridW={gridW} />;
    case 'fundFlowRank':
      return <FundFlowRankWidget gridH={gridH} />;
    case 'hotBoards':
      return <HotBoardsWidget gridH={gridH} />;
    case 'boardFundFlow':
      return <BoardFundFlowWidget gridH={gridH} />;
    case 'strip.globalIndices':
    case 'strip.futures':
    case 'strip.metals':
    case 'strip.fx':
    case 'strip.crypto':
    case 'strip.rates':
      return <StripWidget type={type} />;
    case 'topic.limitList':
    case 'topic.topList':
      return <TopicListWidget type={type} />;
    case 'rank.hk':
    case 'rank.cb':
      return <RankListWidget type={type} gridH={gridH} />;
    case 'embed.iframe':
      if (!widget) return null;
      return (
        <IframeWidget
          widget={widget}
          editing={Boolean(opts?.editing)}
          onUpdate={opts?.onUpdate}
        />
      );
    default:
      return null;
  }
}
