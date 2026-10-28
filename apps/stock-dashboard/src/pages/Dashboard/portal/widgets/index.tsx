import type { ReactNode } from 'react';
import type { PortalWidgetType } from '../types';
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

export function renderWidget(
  type: PortalWidgetType,
  gridW: number,
  gridH: number
): ReactNode {
  if (isIndexWidgetType(type)) {
    return <IndexWidget type={type} />;
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
    case 'watchlist':
      return <WatchlistWidget gridH={gridH} />;
    case 'marketRanking':
      return <MarketRankingWidget gridH={gridH} gridW={gridW} />;
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
      return <TopicListWidget type={type} gridH={gridH} />;
    case 'rank.hk':
    case 'rank.cb':
      return <RankListWidget type={type} gridH={gridH} />;
    default:
      return null;
  }
}
