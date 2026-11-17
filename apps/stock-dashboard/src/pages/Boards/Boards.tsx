/**
 * 板块页面：支持东财 / 同花顺 / 合并显示
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Lightbulb, Search, RefreshCw, Database } from 'lucide-react';
import { Card, Tabs, Loading, Empty, useToast } from '@/components/common';
import {
  getConceptList,
  getIndustryList,
  startBoardConceptsSync,
  getBoardConceptsSyncProgress,
  getBoardConceptsStats,
  type BoardConceptSyncProgress,
  type BoardDataSource,
  type BoardListItem,
} from '@/services/sdk';
import {
  formatPercent,
  formatMarketCap,
  formatTurnover,
  getChangeColorClass,
} from '@/utils/format';
import styles from './Boards.module.css';

const BOARD_TYPES = [
  { key: 'concept', label: '概念板块', icon: <Lightbulb size={14} /> },
  { key: 'industry', label: '行业板块', icon: <Building2 size={14} /> },
];

const PLATFORM_TABS: { key: BoardDataSource; label: string }[] = [
  { key: 'all', label: '合并全部' },
  { key: 'eastmoney', label: '东方财富' },
  { key: 'ths', label: '同花顺' },
];

function sourceBadgeClass(sources?: string[]): string {
  const set = new Set((sources || []).map((s) => String(s).toLowerCase()));
  const hasEm = set.has('eastmoney');
  const hasThs = set.has('ths');
  if (hasEm && hasThs) return styles.sourceBoth;
  if (hasThs) return styles.sourceThs;
  return styles.sourceEm;
}

function sourceBadgeText(sources?: string[]): string {
  const set = new Set((sources || []).map((s) => String(s).toLowerCase()));
  const parts: string[] = [];
  if (set.has('eastmoney')) parts.push('东财');
  if (set.has('ths')) parts.push('同花顺');
  if (set.has('sina')) parts.push('新浪');
  return parts.join('+') || '未知';
}

export function Boards() {
  const navigate = useNavigate();
  const toast = useToast();
  const [boardType, setBoardType] = useState<'industry' | 'concept'>('concept');
  const [platform, setPlatform] = useState<BoardDataSource>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [items, setItems] = useState<BoardListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<BoardConceptSyncProgress | null>(null);
  const [statsText, setStatsText] = useState('');

  const refreshStats = useCallback(async () => {
    try {
      const s = await getBoardConceptsStats();
      if (s.catalog || s.stocks) {
        setStatsText(
          `库内：目录 ${s.catalog ?? 0} · 股票 ${s.stocks ?? 0} · 概念行 ${s.concept_rows ?? 0} · 板块行 ${s.board_rows ?? 0}`
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 行业暂无同花顺目录时，合并/同花顺回退东财
      const source: BoardDataSource =
        boardType === 'industry' && (platform === 'ths' || platform === 'all')
          ? platform === 'ths'
            ? 'eastmoney'
            : 'all'
          : platform;
      const list =
        boardType === 'industry'
          ? await getIndustryList(source === 'all' ? 'eastmoney' : source)
          : await getConceptList(source);
      setItems(list as BoardListItem[]);
      void refreshStats();
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [boardType, platform, refreshStats]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshStats();
    let cancelled = false;
    const tick = async () => {
      try {
        const p = await getBoardConceptsSyncProgress();
        if (cancelled) return;
        setSyncProgress(p);
        setSyncing(Boolean(p.active));
        if (p.active === false && p.phase === 'done') {
          void load();
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load, refreshStats]);

  const handleSyncAll = async () => {
    if (syncing) return;
    try {
      setSyncing(true);
      const p = await startBoardConceptsSync(true);
      setSyncProgress(p);
      toast.success('已开始全量同步板块/概念入库');
    } catch (e) {
      setSyncing(false);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredData = useMemo(() => {
    if (!searchKeyword.trim()) return items;
    const keyword = searchKeyword.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.leadingStock?.toLowerCase().includes(keyword)
    );
  }, [items, searchKeyword]);

  const handleBoardClick = (item: BoardListItem) => {
    const code = String(item.code || '');
    if (!code) return;
    // 同花顺：进入本库聚合详情页；东财：原详情页
    navigate(`/boards/${boardType}/${encodeURIComponent(code)}`);
  };

  return (
    <div className={styles.boards}>
      <div className={styles.controls}>
        <Tabs
          items={BOARD_TYPES}
          activeKey={boardType}
          onChange={(key) => setBoardType(key as 'industry' | 'concept')}
        />

        <div className={styles.searchWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="搜索板块..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.platformBar}>
        {boardType === 'concept' ? (
          <Tabs
            items={PLATFORM_TABS}
            activeKey={platform}
            onChange={(key) => setPlatform(key as BoardDataSource)}
          />
        ) : (
          <span className={styles.platformHint}>行业板块（东财）</span>
        )}
        <div className={styles.syncActions}>
          <button
            type="button"
            className={styles.syncBtn}
            onClick={() => void handleSyncAll()}
            disabled={syncing}
            title="全量拉取东财+同花顺并入库（分板块/概念）"
          >
            {syncing ? <RefreshCw size={14} className={styles.spin} /> : <Database size={14} />}
            {syncing ? '同步中…' : '全量入库'}
          </button>
          <span className={styles.platformHint}>
            {syncing && syncProgress
              ? `${syncProgress.message || ''} ${syncProgress.done ?? 0}/${syncProgress.total ?? 0}`
              : statsText || '蓝=东财 · 橙=同花顺 · 紫=双源'}
          </span>
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <Loading text="加载板块数据..." />
        ) : error ? (
          <Empty title="加载失败" description={error} />
        ) : filteredData.length === 0 ? (
          <Empty title="未找到匹配的板块" />
        ) : (
          <div className={styles.boardGrid}>
            {filteredData.map((item, index) => {
              const sources = item.sources?.length
                ? item.sources
                : item.source
                  ? [String(item.source)]
                  : ['eastmoney'];
              const thsOnly = sources.length === 1 && sources[0] === 'ths';
              return (
                <motion.div
                  key={`${item.code}-${item.name}`}
                  className={`${styles.boardCard} ${sourceBadgeClass(sources)}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(index, 20) * 0.02 }}
                  onClick={() => handleBoardClick(item)}
                  title={
                    thsOnly
                      ? '同花顺概念（行情由本库成份股聚合）'
                      : undefined
                  }
                >
                  <div className={styles.boardHeader}>
                    <span className={styles.boardRank}>{item.rank}</span>
                    <h4 className={styles.boardName}>{item.name}</h4>
                    <span className={styles.sourceBadge}>{sourceBadgeText(sources)}</span>
                  </div>

                  <div
                    className={`${styles.boardChange} ${getChangeColorClass(item.changePercent)}`}
                  >
                    {formatPercent(item.changePercent)}
                  </div>

                  <div className={styles.boardMeta}>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>总市值</span>
                      <span className={styles.metaValue}>
                        {formatMarketCap(item.totalMarketCap)}
                      </span>
                    </div>
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>换手率</span>
                      <span className={styles.metaValue}>
                        {formatTurnover(item.turnoverRate)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.boardStats}>
                    <span className="text-rise">{item.riseCount ?? '--'} 涨</span>
                    <span className="text-fall">{item.fallCount ?? '--'} 跌</span>
                  </div>

                  <div className={styles.boardLeader}>
                    <span className={styles.leaderLabel}>领涨</span>
                    <span className={styles.leaderName}>{item.leadingStock || '--'}</span>
                    <span className={getChangeColorClass(item.leadingStockChangePercent)}>
                      {formatPercent(item.leadingStockChangePercent)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
