/**
 * 策略选股页（由尾盘选股法升级，M1：多预设 + 文案 + 保留尾盘/质量扫描跑批）
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  Target,
  ChevronLeft,
  SearchX,
  SlidersHorizontal,
  Check,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Zap,
  Plus,
  Save,
  FolderOpen,
  Trash2,
  Clock,
  CircleStop,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckSquare,
  Square,
  X,
  LayoutGrid,
} from 'lucide-react';
import { NumberField, useToast } from '@/components/common';
import {
  analyzeEndOfDayStocks,
  type AnalysisProgress,
  type EndOfDayFilters,
  type EndOfDayStock,
  isAnalysisAborted,
  type TimelinePoint,
} from '@/services/analysis';
import { getEodPickerState, saveEodPickerState } from '@/services/storage';
import {
  buildResolvedCopy,
  eodFiltersFromPreset,
  fetchStrategyPresets,
  isEodEngine,
  presetRulesFromEodFilters,
  runButtonLabel,
  type PresetHorizon,
  type StrategyCopy,
  type StrategyPreset,
} from '@/services/strategyPresets';
import { watchlistActions } from '@/services/watchlistStore';
import { useIsInWatchlist } from '@/hooks';
import { formatAmount } from '@/utils/format';
import { openKlineTool, openMultipanel } from '@/utils/multipanel';
import { HorizonTabs, PresetStrip, StrategyCopyPanel } from './StrategyChrome';
import styles from './EndOfDayPicker.module.css';

const DEFAULT_PRESET_ID = 'eod_intraday_strength';

// ========== 类型定义 ==========

interface SavedScheme {
  id: string;
  name: string;
  filters: EndOfDayFilters;
  createdAt: number;
}

interface RecentUsage {
  filters: EndOfDayFilters;
  usedAt: number;
}

type SortField = 'changePercent' | 'timelineAboveAvgRatio' | 'turnoverRate' | 'circulatingMarketCap' | 'volumeRatio';
type SortOrder = 'asc' | 'desc';

// ========== 常量 ==========

const MAX_RECENT_USAGE = 5;

const DEFAULT_FILTERS: EndOfDayFilters = {
  marketCapMin: 50,
  marketCapMax: 200,
  volumeRatioMin: 1.2,
  changePercentMin: 3,
  changePercentMax: 5,
  turnoverRateMin: 5,
  turnoverRateMax: 10,
  excludeST: true,
  timelineAboveAvgRatio: 80,
};

function mapScannerHitToStock(hit: Record<string, unknown>): EndOfDayStock {
  const rawCode = String(hit.symbol || hit.code || '');
  const routeFromApi = typeof hit.route_code === 'string' ? hit.route_code : '';
  const routeCode =
    routeFromApi ||
    (rawCode.includes('.')
      ? rawCode
      : rawCode.startsWith('6') || rawCode.startsWith('5') || rawCode.startsWith('9')
        ? `${rawCode}.SH`
        : `${rawCode}.SZ`);
  const display = routeCode.split('.')[0] || rawCode;
  const price = typeof hit.price === 'number' ? hit.price : Number(hit.price) || 0;
  const changePercent =
    typeof hit.change_percent === 'number'
      ? hit.change_percent
      : Number(hit.change_percent) || 0;
  const amount =
    typeof hit.amount === 'number' ? hit.amount : hit.amount == null ? 0 : Number(hit.amount) || 0;
  const whyHit = Array.isArray(hit.why_hit)
    ? hit.why_hit.filter((x): x is string => typeof x === 'string')
    : undefined;
  const trad = hit.tradability as {
    tradable?: boolean;
    label?: string;
    reason?: string;
    reasons?: string[];
  } | undefined;
  const tradeable =
    typeof hit.tradeable === 'boolean'
      ? hit.tradeable
      : typeof trad?.tradable === 'boolean'
        ? trad.tradable
        : undefined;
  const tradabilityLabel =
    trad?.label ||
    trad?.reason ||
    (trad?.reasons && trad.reasons.length ? trad.reasons.join('/') : undefined);
  return {
    code: display,
    routeCode,
    name: String(hit.name || display),
    price,
    changePercent,
    change: 0,
    volume: 0,
    amount,
    turnoverRate:
      typeof hit.turnover_rate === 'number'
        ? hit.turnover_rate
        : hit.turnover_rate == null
          ? null
          : Number(hit.turnover_rate),
    volumeRatio:
      typeof hit.volume_ratio === 'number'
        ? hit.volume_ratio
        : hit.volume_ratio == null
          ? null
          : Number(hit.volume_ratio),
    circulatingMarketCap:
      typeof hit.circulating_market_cap === 'number'
        ? hit.circulating_market_cap
        : hit.circulating_market_cap == null
          ? null
          : Number(hit.circulating_market_cap),
    totalMarketCap: null,
    pe: typeof hit.pe === 'number' ? hit.pe : hit.pe == null ? null : Number(hit.pe),
    pb: typeof hit.pb === 'number' ? hit.pb : hit.pb == null ? null : Number(hit.pb),
    high: price,
    low: price,
    open: price,
    prevClose: price,
    whyHit,
    tradeable,
    tradabilityLabel,
    dividendYield:
      typeof hit.dividend_yield === 'number'
        ? hit.dividend_yield
        : hit.dividend_yield == null
          ? null
          : Number(hit.dividend_yield),
    roe: typeof hit.roe === 'number' ? hit.roe : hit.roe == null ? null : Number(hit.roe),
    growth:
      typeof hit.growth === 'number' ? hit.growth : hit.growth == null ? null : Number(hit.growth),
    peg: typeof hit.peg === 'number' ? hit.peg : hit.peg == null ? null : Number(hit.peg),
    dataGaps: Array.isArray(hit.data_gaps)
      ? hit.data_gaps.filter((x): x is string => typeof x === 'string')
      : undefined,
  };
}

function horizonToStrategyTemplateId(horizon: PresetHorizon | undefined): string {
  if (horizon === 'short') return 'short';
  if (horizon === 'swing') return 'swing';
  return 'long';
}

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'changePercent', label: '涨幅' },
  { field: 'timelineAboveAvgRatio', label: '分时强度' },
  { field: 'turnoverRate', label: '换手率' },
  { field: 'circulatingMarketCap', label: '流通市值' },
  { field: 'volumeRatio', label: '量比' },
];

// ========== 工具函数 ==========

// 自愈旧版 bug 持久化的 max=0（清空输入被存成 0，导致过滤条件全灭）
const healFilters = (filters: EndOfDayFilters): EndOfDayFilters => {
  const healed = { ...filters };
  for (const key of ['marketCapMax', 'changePercentMax', 'turnoverRateMax'] as const) {
    if (healed[key] === 0) healed[key] = null;
  }
  return healed;
};

const loadFiltersFromStorage = (): EndOfDayFilters => {
  const stored = getEodPickerState<Partial<EndOfDayFilters>>('filters', {});
  return healFilters({ ...DEFAULT_FILTERS, ...stored });
};

const saveFiltersToStorage = (filters: EndOfDayFilters): void => {
  saveEodPickerState('filters', filters);
};

const loadSchemesFromStorage = (): SavedScheme[] =>
  getEodPickerState<SavedScheme[]>('schemes', []);

const saveSchemesToStorage = (schemes: SavedScheme[]): void => {
  saveEodPickerState('schemes', schemes);
};

const loadRecentUsageFromStorage = (): RecentUsage[] =>
  getEodPickerState<RecentUsage[]>('recent', []);

const saveRecentUsageToStorage = (recentUsage: RecentUsage[]): void => {
  saveEodPickerState('recent', recentUsage);
};

const addRecentUsage = (filters: EndOfDayFilters): void => {
  const recent = loadRecentUsageFromStorage();
  const newEntry: RecentUsage = { filters, usedAt: Date.now() };
  // 检查是否已存在相同配置
  const isDuplicate = recent.some(
    (r) => JSON.stringify(r.filters) === JSON.stringify(filters)
  );
  if (!isDuplicate) {
    const updated = [newEntry, ...recent].slice(0, MAX_RECENT_USAGE);
    saveRecentUsageToStorage(updated);
  }
};

const formatNumber = (num: number | null, decimals = 2): string => {
  if (num === null || num === undefined) return '-';
  return num.toFixed(decimals);
};

// ========== 子组件 ==========

// 分时图组件
function TimelineChart({ data, prevClose }: { data: TimelinePoint[]; prevClose: number }) {
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return null;

    const width = 320;
    const height = 100;
    const padding = { top: 6, right: 6, bottom: 6, left: 6 };

    const prices = data.map((d) => d.price);
    const avgPrices = data.map((d) => d.avgPrice);
    const allValues = [...prices, ...avgPrices, prevClose];

    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = maxValue - minValue || 1;

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // 单点分时（开盘首分钟）分母为 0 会产生 NaN 路径
    const getX = (index: number) =>
      padding.left + (index / Math.max(data.length - 1, 1)) * chartWidth;
    const getY = (value: number) => padding.top + ((maxValue - value) / range) * chartHeight;

    const pricePath = data
      .map((d, i) => {
        const x = getX(i);
        const y = getY(d.price);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(' ');

    const avgPath = data
      .map((d, i) => {
        const x = getX(i);
        const y = getY(d.avgPrice);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      })
      .join(' ');

    const fillPath =
      pricePath +
      ` L ${getX(data.length - 1)} ${height - padding.bottom}` +
      ` L ${padding.left} ${height - padding.bottom} Z`;

    const prevCloseY = getY(prevClose);
    const lastPoint = data[data.length - 1];
    const lastX = getX(data.length - 1);
    const lastY = getY(lastPoint.price);

    return {
      width,
      height,
      pricePath,
      avgPath,
      fillPath,
      prevCloseY,
      lastX,
      lastY,
      isPositive: lastPoint.price >= prevClose,
    };
  }, [data, prevClose]);

  if (!chartData) {
    return <div className={styles.chartEmpty}>暂无分时数据</div>;
  }

  return (
    <div className={styles.timelineChart}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${chartData.width} ${chartData.height}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="priceGradientEOD" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop
              offset="0%"
              stopColor={chartData.isPositive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}
            />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0)" />
          </linearGradient>
        </defs>

        <path d={chartData.fillPath} fill="url(#priceGradientEOD)" />

        <line
          x1={5}
          y1={chartData.prevCloseY}
          x2={chartData.width - 5}
          y2={chartData.prevCloseY}
          stroke="var(--text-tertiary)"
          strokeWidth={1}
          strokeDasharray="4 2"
          opacity={0.5}
        />

        <path
          d={chartData.avgPath}
          fill="none"
          stroke="var(--color-warning)"
          strokeWidth={1.5}
          opacity={0.8}
        />

        <path
          d={chartData.pricePath}
          fill="none"
          stroke={chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)'}
          strokeWidth={1.5}
        />

        <circle
          cx={chartData.lastX}
          cy={chartData.lastY}
          r={3}
          fill={chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)'}
        />
      </svg>
      <div className={styles.chartLegend}>
        <span className={styles.legendItem}>
          <span
            className={styles.legendLine}
            style={{
              background: chartData.isPositive ? 'var(--color-rise)' : 'var(--color-fall)',
            }}
          />
          价格
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} style={{ background: 'var(--color-warning)' }} />
          均价
        </span>
      </div>
    </div>
  );
}

// 股票卡片组件
function StockCard({
  stock,
  index,
  inWatchlist,
  onAddWatchlist,
  onOpenKline,
  onOpenResearch,
  onCreateCard,
  cardBusy,
  isSelected,
  onToggleSelect,
  showSelect,
}: {
  stock: EndOfDayStock;
  index: number;
  inWatchlist: boolean;
  onAddWatchlist: (routeCode: string, name: string) => void;
  onOpenKline?: (stock: EndOfDayStock) => void;
  onOpenResearch?: (routeCode: string) => void;
  onCreateCard?: (stock: EndOfDayStock) => void;
  cardBusy?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (code: string) => void;
  showSelect?: boolean;
}) {
  const isPositive = stock.changePercent >= 0;

  const handleOpenKline = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onOpenKline?.(stock);
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect?.(stock.code);
  };

  return (
    <motion.div
      className={`${styles.stockCard} ${isPositive ? styles.positive : styles.negative} ${isSelected ? styles.selected : ''}`}
      initial={{ opacity: 0, y: 30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index, 12) * 0.05,
        ease: 'easeOut',
      }}
      whileHover={{
        scale: 1.02,
        y: -3,
        transition: { duration: 0.2 },
      }}
      onClick={() => onOpenKline?.(stock)}
    >
      <div className={styles.stockHeader}>
        <div className={styles.stockInfo}>
          <div className={styles.stockNameRow}>
            {showSelect && (
              <button className={styles.selectBtn} onClick={handleSelectClick}>
                {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
            )}
            <h3
              className={styles.stockName}
              onClick={handleOpenKline}
              title="新窗口打开日K（↑↓ 翻页）"
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenKline?.(stock);
                }
              }}
            >
              {stock.name}
            </h3>
          </div>
          <span className={styles.stockCode}>{stock.code}</span>
        </div>
        <motion.div
          className={styles.changeBadge}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: Math.min(index, 12) * 0.05 + 0.2, type: 'spring' }}
        >
          <span className={styles.changeIcon}>{isPositive ? '▲' : '▼'}</span>
          <span className={styles.changePercent}>{formatNumber(stock.changePercent)}%</span>
        </motion.div>
      </div>

      <div className={styles.priceSection}>
        <div className={styles.currentPrice}>
          <span className={styles.priceLabel}>现价</span>
          <span className={styles.priceValue}>{formatNumber(stock.price)}</span>
        </div>
        <div className={styles.priceChange}>
          <span className={styles.changeValue}>
            {isPositive ? '+' : ''}
            {formatNumber(stock.change)}
          </span>
          {stock.timelineAboveAvgRatio !== undefined && (
            <span className={styles.timelineRatio}>
              强度 {stock.timelineAboveAvgRatio.toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {stock.timeline && stock.timeline.length > 0 && (
        <div className={styles.timelineSection}>
          <TimelineChart data={stock.timeline} prevClose={stock.prevClose} />
        </div>
      )}

      {stock.whyHit && stock.whyHit.length > 0 && (
        <ul className={styles.whyHitList}>
          {stock.whyHit.slice(0, 4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {stock.tradeable === false && (
        <div className={styles.untradeableBadge}>
          不可成交{stock.tradabilityLabel ? ` · ${stock.tradabilityLabel}` : ''}
        </div>
      )}
      {stock.tradeable === true && (
        <div className={styles.tradeableBadge}>可成交</div>
      )}
      {stock.dataGaps && stock.dataGaps.length > 0 && (
        <div className={styles.dataGapBadge}>{stock.dataGaps[0]}</div>
      )}

      <div className={styles.dataGrid}>
        {stock.dividendYield != null ? (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>股息率</span>
            <span className={styles.dataValue}>{formatNumber(stock.dividendYield)}%</span>
          </div>
        ) : stock.circulatingMarketCap != null ? (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>流通市值</span>
            <span className={styles.dataValue}>{formatNumber(stock.circulatingMarketCap)}亿</span>
          </div>
        ) : (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>PE</span>
            <span className={styles.dataValue}>{formatNumber(stock.pe)}</span>
          </div>
        )}
        {stock.roe != null ? (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>ROE</span>
            <span className={styles.dataValue}>{formatNumber(stock.roe)}%</span>
          </div>
        ) : stock.volumeRatio != null ? (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>量比</span>
            <span className={styles.dataValue}>{formatNumber(stock.volumeRatio)}</span>
          </div>
        ) : (
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>PB</span>
            <span className={styles.dataValue}>{formatNumber(stock.pb)}</span>
          </div>
        )}
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>
            {stock.growth != null ? '增速' : stock.peg != null ? 'PEG' : '换手率'}
          </span>
          <span className={styles.dataValue}>
            {stock.growth != null
              ? `${formatNumber(stock.growth)}%`
              : stock.peg != null
                ? formatNumber(stock.peg)
                : stock.turnoverRate == null
                  ? '-'
                  : `${formatNumber(stock.turnoverRate)}%`}
          </span>
        </div>
        <div className={styles.dataItem}>
          <span className={styles.dataLabel}>
            {stock.peg != null && stock.growth != null ? 'PEG' : '成交额'}
          </span>
          <span className={styles.dataValue}>
            {stock.peg != null && stock.growth != null
              ? formatNumber(stock.peg)
              : stock.amount
                ? formatAmount(stock.amount)
                : '-'}
          </span>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          className={`${styles.addWatchlistBtn} ${inWatchlist ? styles.added : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!inWatchlist) {
              onAddWatchlist(stock.routeCode, stock.name);
            }
          }}
          disabled={inWatchlist}
        >
          {inWatchlist ? <Check size={14} /> : <Plus size={14} />}
          {inWatchlist ? '已自选' : '加自选'}
        </button>
        <button
          className={styles.secondaryActionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onOpenResearch?.(stock.routeCode);
          }}
        >
          研判
        </button>
        <button
          className={styles.secondaryActionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onCreateCard?.(stock);
          }}
          disabled={cardBusy}
        >
          草稿卡片
        </button>
      </div>
    </motion.div>
  );
}

// 加载遮罩组件
function LoadingOverlay({
  progress,
  onCancel,
}: {
  progress: AnalysisProgress;
  onCancel: () => void;
}) {
  const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <motion.div
      className={styles.loadingOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className={styles.loadingContent}>
        <div className={styles.loadingSpinner}>
          <motion.div
            className={styles.spinnerRing}
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
          <div className={styles.spinnerCenter}>
            <motion.span
              className={styles.loadingPercentage}
              key={percentage}
              initial={{ scale: 1.2, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {percentage}%
            </motion.span>
          </div>
        </div>

        <div className={styles.loadingProgress}>
          <motion.div
            className={styles.loadingProgressFill}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>

        <div className={styles.loadingStatus}>
          <p className={styles.loadingText}>{progress.stage || '正在扫描全市场股票数据...'}</p>
          <p className={styles.loadingDetail}>
            {progress.total > 0
              ? `已处理 ${progress.completed} / ${progress.total}`
              : '正在初始化连接...'}
          </p>
        </div>

        <button className={styles.cancelAnalysisBtn} onClick={onCancel}>
          <CircleStop size={16} />
          取消分析
        </button>
      </div>
    </motion.div>
  );
}

// ========== 主组件 ==========

export function EndOfDayPicker() {
  const toast = useToast();
  const [horizon, setHorizon] = useState<PresetHorizon>(() =>
    getEodPickerState<PresetHorizon>('horizon', 'short')
  );
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState(() =>
    getEodPickerState<string>('preset', DEFAULT_PRESET_ID)
  );
  const [activePreset, setActivePreset] = useState<StrategyPreset | null>(null);
  const [resolvedCopy, setResolvedCopy] = useState<StrategyCopy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [filters, setFilters] = useState<EndOfDayFilters>(loadFiltersFromStorage);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<AnalysisProgress>({
    completed: 0,
    total: 0,
    stage: '',
  });
  const [stocks, setStocks] = useState<EndOfDayStock[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [resultMode, setResultMode] = useState<'eod' | 'scanner'>('eod');
  const abortRef = useRef<AbortController | null>(null);

  // 离开页面即中止分析：全市场扫描请求量大，不中止会在后台跑完
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // 方案管理
  const [savedSchemes, setSavedSchemes] = useState<SavedScheme[]>(loadSchemesFromStorage);
  const [recentUsage, setRecentUsage] = useState<RecentUsage[]>(loadRecentUsageFromStorage);
  const [showSchemePanel, setShowSchemePanel] = useState(false);
  const [showRecentPanel, setShowRecentPanel] = useState(false);
  const [newSchemeName, setNewSchemeName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  // 排序
  const [sortField, setSortField] = useState<SortField>('timelineAboveAvgRatio');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 批量选择
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set());
  const [showSelectMode, setShowSelectMode] = useState(false);

  const canEditEodRules = isEodEngine(activePreset);
  const canRun =
    !!activePreset &&
    (activePreset.run_engine === 'eod_intraday' ||
      (activePreset.run_engine === 'research_scanner' && activePreset.runnable));

  // 拉取官方预设
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchStrategyPresets(horizon);
      if (cancelled) return;
      setPresets(rows);
      const preferred =
        rows.find((p) => p.id === activePresetId) ||
        rows.find((p) => p.enabled_by_default !== false) ||
        rows[0];
      if (preferred) {
        setActivePresetId(preferred.id);
        setActivePreset(preferred);
        setResolvedCopy(buildResolvedCopy(preferred));
        setDirty(false);
        if (preferred.run_engine === 'eod_intraday') {
          // 保留用户已持久化的 filters；仅在与默认预设首次对齐时不强制覆盖
        } else {
          setIsEditing(false);
        }
      } else {
        setActivePreset(null);
        setResolvedCopy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 仅随 horizon 刷新列表；选中逻辑在 rows 内处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon]);

  useEffect(() => {
    saveEodPickerState('horizon', horizon);
  }, [horizon]);

  useEffect(() => {
    saveEodPickerState('preset', activePresetId);
  }, [activePresetId]);

  // 保存筛选条件（debounce：filters 随交互高频变化，不必每次都同步写盘）
  useEffect(() => {
    const timer = window.setTimeout(() => saveFiltersToStorage(filters), 500);
    return () => clearTimeout(timer);
  }, [filters]);

  // EOD 参数变更 → 刷新条件文案
  useEffect(() => {
    if (!activePreset || activePreset.run_engine !== 'eod_intraday') return;
    const rules = presetRulesFromEodFilters(filters);
    const baseline = eodFiltersFromPreset(activePreset);
    const changed = JSON.stringify(filters) !== JSON.stringify(baseline);
    setDirty(changed);
    setResolvedCopy(buildResolvedCopy(activePreset, rules));
  }, [filters, activePreset]);

  const handleSelectPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      setActivePresetId(id);
      setActivePreset(preset);
      setResolvedCopy(buildResolvedCopy(preset));
      setDirty(false);
      setHasAnalyzed(false);
      setStocks([]);
      if (preset.run_engine === 'eod_intraday') {
        setFilters(eodFiltersFromPreset(preset));
        setSortField('timelineAboveAvgRatio');
        setResultMode('eod');
      } else {
        setIsEditing(false);
        setResultMode(preset.run_engine === 'research_scanner' ? 'scanner' : 'eod');
      }
    },
    [presets]
  );

  const handleHorizonChange = useCallback((h: PresetHorizon) => {
    setHorizon(h);
    setHasAnalyzed(false);
    setStocks([]);
    setDirty(false);
  }, []);

  // 恢复默认设置
  const handleResetFilters = useCallback(() => {
    if (activePreset?.run_engine === 'eod_intraday') {
      setFilters(eodFiltersFromPreset(activePreset));
    } else {
      setFilters(DEFAULT_FILTERS);
    }
    setDirty(false);
  }, [activePreset]);

  // 开始分析
  const handleStartAnalysis = useCallback(async () => {
    if (!activePreset) {
      toast.warning('请先选择策略预设');
      return;
    }
    if (!canRun) {
      toast.info(`「${activePreset.name}」跑批能力将在后续版本接入，可先阅读右侧策略说明`);
      return;
    }

    setIsLoading(true);
    setLoadingProgress({ completed: 0, total: 0, stage: '准备运行' });
    setStocks([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (activePreset.run_engine === 'eod_intraday') {
        addRecentUsage(filters);
        setRecentUsage(loadRecentUsageFromStorage());
        setResultMode('eod');
        setLoadingProgress({ completed: 0, total: 0, stage: '获取行情数据' });
        const finalStocks = await analyzeEndOfDayStocks(filters, {
          signal: controller.signal,
          onProgress: setLoadingProgress,
        });

        if (finalStocks.length === 0) {
          toast.info('没有符合基础条件的股票，请尝试调整筛选条件');
          setHasAnalyzed(true);
          return;
        }

        if (!controller.signal.aborted) {
          setStocks(finalStocks);
        }
        setHasAnalyzed(true);
        return;
      }

      if (activePreset.run_engine === 'research_scanner') {
        setResultMode('scanner');
        const templateId = activePreset.scanner_template_id || activePreset.id;
        const isTech = ['ma_bull_stack', 'dual_ma_coil', 'breakout_volume'].includes(templateId);
        const isDividend = templateId === 'dividend_roe';
        const isGrowth = templateId === 'growth_trend';
        setLoadingProgress({
          completed: 0,
          total: 1,
          stage: isTech
            ? `扫描「${activePreset.name}」（流动性靠前股票池 + K线，约数十秒）`
            : isDividend
              ? `扫描「${activePreset.name}」（全市场股息 + 抽样 ROE）`
              : isGrowth
                ? `扫描「${activePreset.name}」（增速 + 均线，约一分钟）`
                : `运行「${activePreset.name}」`,
        });
        const params = isTech
          ? { universe_size: 250, concurrency: 8, limit: 50 }
          : isDividend
            ? { limit: 40, roe_probe_n: 100, concurrency: 6 }
            : isGrowth
              ? { universe_size: 120, limit: 30, concurrency: 6 }
              : undefined;
        const res = await fetch('/api/research/scanner/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_id: templateId, params }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          ok?: boolean;
          results?: Record<string, unknown>[];
          error?: string;
          scanned?: number;
          universe?: number;
          hit_count?: number;
          data_gaps?: string[];
          degraded?: boolean;
        };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '扫描失败');
        }
        const mapped = (data.results || []).map(mapScannerHitToStock);
        setLoadingProgress({ completed: 1, total: 1, stage: '扫描完成' });
        if (data.degraded || (data.data_gaps && data.data_gaps.length > 0)) {
          toast.info(data.data_gaps?.[0] || '本次扫描存在数据降级');
        }
        if (mapped.length === 0) {
          toast.info(
            isTech
              ? '当前股票池内无命中；可换时段或稍后重试（需拉取日K）'
              : '没有符合条件的股票，请稍后重试或换预设'
          );
        } else if (isTech && data.universe) {
          toast.success(
            `在 ${data.universe} 只候选中命中 ${data.hit_count ?? mapped.length} 只（展示 ${mapped.length}）`
          );
        } else {
          toast.success(`命中 ${data.hit_count ?? mapped.length} 只（展示 ${mapped.length}）`);
        }
        if (!controller.signal.aborted) {
          setStocks(mapped);
          setSortField('changePercent');
        }
        setHasAnalyzed(true);
      }
    } catch (error) {
      if (isAnalysisAborted(error) || (error instanceof DOMException && error.name === 'AbortError')) {
        toast.info('已取消分析');
      } else {
        console.error('获取股票数据失败:', error);
        toast.error('获取股票数据失败，请重试');
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [activePreset, canRun, filters, toast]);

  const handleCancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 加入自选
  const handleAddWatchlist = useCallback(
    (routeCode: string, name: string) => {
      watchlistActions.add(routeCode);
      toast.success(`已将 ${name} 加入自选`);
    },
    [toast]
  );

  const navigate = useNavigate();
  const [cardBusy, setCardBusy] = useState(false);

  const handleOpenResearch = useCallback(
    (routeCode: string) => {
      navigate(`/s/${routeCode}`);
    },
    [navigate]
  );

  const handleCreateTradeCard = useCallback(
    async (stock: EndOfDayStock) => {
      if (!activePreset) {
        toast.warning('请先选择策略预设');
        return;
      }
      setCardBusy(true);
      try {
        const thesisParts = [
          `来自策略选股「${activePreset.name}」`,
          resolvedCopy?.one_liner,
          ...(stock.whyHit || []).slice(0, 3),
        ].filter(Boolean);
        const res = await fetch('/api/research/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: stock.routeCode,
            thesis: thesisParts.join('；'),
            status: 'draft',
            strategy_template_id: horizonToStrategyTemplateId(activePreset.horizon),
            stop_rule: resolvedCopy?.how_to_exit || '逻辑证伪或破关键位离场',
            falsify_conditions: stock.whyHit?.slice(0, 3) || [],
            business_mode_state: 'unverified',
            entry_price: stock.price || null,
            pricing:
              stock.dividendYield != null
                ? `股息率 ${stock.dividendYield.toFixed(2)}%`
                : stock.pe != null
                  ? `PE ${stock.pe}`
                  : undefined,
            position_pct: 5,
            evidence: [],
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string; card?: { id?: string } };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || '创建失败');
        }
        toast.success(`已生成草稿卡片 ${data.card?.id?.slice(0, 8) || ''}…`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '创建交易卡片失败');
      } finally {
        setCardBusy(false);
      }
    },
    [activePreset, resolvedCopy, toast]
  );

  // 更新筛选条件
  const handleFilterChange = (
    key: keyof EndOfDayFilters,
    value: number | boolean | null
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // 保存方案
  const handleSaveScheme = useCallback(() => {
    if (!newSchemeName.trim()) {
      toast.warning('请输入方案名称');
      return;
    }
    const newScheme: SavedScheme = {
      id: Date.now().toString(),
      name: newSchemeName.trim(),
      filters: { ...filters },
      createdAt: Date.now(),
    };
    const updated = [...savedSchemes, newScheme];
    setSavedSchemes(updated);
    saveSchemesToStorage(updated);
    setNewSchemeName('');
    setShowSaveInput(false);
    toast.success(`方案「${newScheme.name}」已保存`);
  }, [newSchemeName, filters, savedSchemes, toast]);

  // 加载方案
  const handleLoadScheme = useCallback((scheme: SavedScheme) => {
    setFilters(healFilters(scheme.filters));
    setShowSchemePanel(false);
    toast.success(`已加载方案「${scheme.name}」`);
  }, [toast]);

  // 删除方案
  const handleDeleteScheme = useCallback((schemeId: string) => {
    const updated = savedSchemes.filter((s) => s.id !== schemeId);
    setSavedSchemes(updated);
    saveSchemesToStorage(updated);
    toast.success('方案已删除');
  }, [savedSchemes, toast]);

  // 加载最近使用
  const handleLoadRecent = useCallback((recent: RecentUsage) => {
    setFilters(healFilters(recent.filters));
    setShowRecentPanel(false);
    toast.success('已加载历史配置');
  }, [toast]);

  // 排序股票
  const sortedStocks = useMemo(() => {
    return [...stocks].sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      return sortOrder === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });
  }, [stocks, sortField, sortOrder]);

  /** 新窗口打开日K；写入当前结果列表供 ↑↓ 翻页 */
  const handleOpenKline = useCallback(
    (stock: EndOfDayStock) => {
      const sym = String(stock.code || '').trim();
      if (!sym) return;
      const codes = sortedStocks.map((s) => String(s.code || '').trim()).filter(Boolean);
      let index = codes.indexOf(sym);
      if (index < 0) {
        index = sortedStocks.findIndex(
          (s) => s.code === stock.code || s.routeCode === stock.routeCode
        );
      }
      openKlineTool(sym, '1d', {
        symbols: codes,
        index: index >= 0 ? index : 0,
      });
    },
    [sortedStocks]
  );

  /** 勾选优先，否则当前筛选结果全部；多面板内可翻页 */
  const handleOpenMultipanel = useCallback(() => {
    const picked =
      selectedStocks.size > 0
        ? sortedStocks
            .filter((s) => selectedStocks.has(s.code))
            .map((s) => String(s.code || '').trim())
            .filter(Boolean)
        : sortedStocks.map((s) => String(s.code || '').trim()).filter(Boolean);
    if (!picked.length) {
      toast.info('当前结果暂无标的');
      return;
    }
    openMultipanel(picked, { period: '1d' });
  }, [selectedStocks, sortedStocks, toast]);

  // 切换排序
  const handleSortChange = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }, [sortField]);

  // 切换选择
  const handleToggleSelect = useCallback((code: string) => {
    setSelectedStocks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(code)) {
        newSet.delete(code);
      } else {
        newSet.add(code);
      }
      return newSet;
    });
  }, []);

  // 全选/取消全选
  const handleSelectAll = useCallback(() => {
    if (selectedStocks.size === sortedStocks.length) {
      setSelectedStocks(new Set());
    } else {
      setSelectedStocks(new Set(sortedStocks.map((s) => s.code)));
    }
  }, [selectedStocks.size, sortedStocks]);

  const isInWatchlist = useIsInWatchlist();

  // 批量加入自选
  const handleBatchAddWatchlist = useCallback(() => {
    const routeCodes = stocks
      .filter((stock) => selectedStocks.has(stock.code) && !isInWatchlist(stock.routeCode))
      .map((stock) => stock.routeCode);
    const addedCount = routeCodes.length > 0 ? watchlistActions.batchAdd(routeCodes) : 0;
    if (addedCount > 0) {
      toast.success(`已将 ${addedCount} 只股票加入自选`);
    } else {
      toast.info('所选股票已在自选中');
    }
    setSelectedStocks(new Set());
    setShowSelectMode(false);
  }, [isInWatchlist, selectedStocks, stocks, toast]);

  return (
    <div className={styles.container}>
      {/* 页面头部 */}
      <motion.header
        className={styles.header}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className={styles.titleSection}>
          <h1 className={styles.title}>
            <TrendingUp size={24} />
            策略选股
          </h1>
          <p className={styles.subtitle}>
            {activePreset
              ? `${activePreset.name} · ${resolvedCopy?.one_liner || '规则候选池'}`
              : '多策略扫描 · 预设 / 自定义 / 自动文案'}
          </p>
        </div>
      </motion.header>

      <main className={styles.main}>
        {!hasAnalyzed && (
          <div className={styles.strategyChrome}>
            <HorizonTabs value={horizon} onChange={handleHorizonChange} />
            <PresetStrip
              presets={presets}
              activeId={activePresetId}
              dirty={dirty}
              onSelect={handleSelectPreset}
            />
          </div>
        )}

        <AnimatePresence mode="wait">
          {!hasAnalyzed ? (
            <motion.div
              key="start-screen"
              className={styles.startScreen}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
            >
              {/* 开始按钮 */}
              <motion.div
                className={styles.startButtonContainer}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                <motion.button
                  className={`${styles.startButton} ${!canRun ? styles.startButtonPending : ''}`}
                  onClick={handleStartAnalysis}
                  disabled={isLoading}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className={styles.buttonGlow} />
                  <span className={styles.buttonContent}>
                    <Zap size={28} />
                    <span>{runButtonLabel(activePreset)}</span>
                  </span>
                </motion.button>
                {!canRun && activePreset && (
                  <p className={styles.runHint}>M2/M3 将接入该预设跑批；当前可浏览规则与文案</p>
                )}
              </motion.div>

              <div className={styles.workspaceRow}>
              {/* 筛选条件卡片 */}
              <motion.div
                className={`${styles.filterCard} ${isEditing ? styles.editing : ''} ${
                  !canEditEodRules ? styles.filterReadOnly : ''
                }`}
                onClick={() => {
                  if (canEditEodRules && !isEditing) setIsEditing(true);
                }}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                whileHover={canEditEodRules && !isEditing ? { scale: 1.01 } : undefined}
              >
                <div className={styles.filterHeader}>
                  <div className={styles.filterTitle}>
                    <SlidersHorizontal size={20} />
                    <span>{canEditEodRules ? '筛选条件' : '规则概览'}</span>
                  </div>
                  <div className={styles.filterActions}>
                    <AnimatePresence mode="wait">
                      {canEditEodRules && isEditing ? (
                        <motion.div
                          key="editing"
                          className={styles.editActions}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <button
                            className={styles.resetBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResetFilters();
                            }}
                            title="恢复默认"
                          >
                            <RotateCcw size={14} />
                            默认
                          </button>
                          <button
                            className={styles.schemeBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowSchemePanel(!showSchemePanel);
                              setShowRecentPanel(false);
                            }}
                            title="管理方案"
                          >
                            <FolderOpen size={14} />
                            方案
                          </button>
                          <button
                            className={styles.recentBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowRecentPanel(!showRecentPanel);
                              setShowSchemePanel(false);
                            }}
                            title="最近使用"
                          >
                            <Clock size={14} />
                            历史
                          </button>
                          <button
                            className={styles.saveBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsEditing(false);
                              setShowSchemePanel(false);
                              setShowRecentPanel(false);
                            }}
                          >
                            <Check size={14} />
                            完成
                          </button>
                        </motion.div>
                      ) : (
                        <motion.span
                          key="hint"
                          className={styles.editHint}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          {canEditEodRules ? '点击编辑' : '只读规则'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* 方案管理面板 */}
                <AnimatePresence>
                  {showSchemePanel && (
                    <motion.div
                      className={styles.schemePanel}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={styles.schemePanelHeader}>
                        <span>保存的方案</span>
                        <button
                          className={styles.addSchemeBtn}
                          onClick={() => setShowSaveInput(!showSaveInput)}
                        >
                          <Plus size={14} />
                          保存当前
                        </button>
                      </div>
                      {showSaveInput && (
                        <div className={styles.saveInputRow}>
                          <input
                            type="text"
                            placeholder="输入方案名称"
                            value={newSchemeName}
                            onChange={(e) => setNewSchemeName(e.target.value)}
                            className={styles.schemeNameInput}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveScheme()}
                          />
                          <button className={styles.confirmSaveBtn} onClick={handleSaveScheme}>
                            <Save size={14} />
                          </button>
                        </div>
                      )}
                      {savedSchemes.length > 0 ? (
                        <div className={styles.schemeList}>
                          {savedSchemes.map((scheme) => (
                            <div key={scheme.id} className={styles.schemeItem}>
                              <button
                                className={styles.schemeLoadBtn}
                                onClick={() => handleLoadScheme(scheme)}
                              >
                                {scheme.name}
                              </button>
                              <button
                                className={styles.schemeDeleteBtn}
                                onClick={() => handleDeleteScheme(scheme.id)}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>暂无保存的方案</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 最近使用面板 */}
                <AnimatePresence>
                  {showRecentPanel && (
                    <motion.div
                      className={styles.recentPanel}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={styles.schemePanelHeader}>
                        <span>最近使用</span>
                      </div>
                      {recentUsage.length > 0 ? (
                        <div className={styles.schemeList}>
                          {recentUsage.map((recent, idx) => (
                            <button
                              key={idx}
                              className={styles.recentItem}
                              onClick={() => handleLoadRecent(recent)}
                            >
                              <span className={styles.recentSummary}>
                                市值 {recent.filters.marketCapMin} ~ {recent.filters.marketCapMax ?? '不限'}亿 · 
                                涨幅 {recent.filters.changePercentMin} ~ {recent.filters.changePercentMax ?? '不限'}%
                              </span>
                              <span className={styles.recentTime}>
                                {new Date(recent.usedAt).toLocaleString('zh-CN', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.emptyHint}>暂无使用记录</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {!canEditEodRules ? (
                  <ul className={styles.ruleReadonlyList}>
                    {(resolvedCopy?.conditions || []).map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                <div className={styles.filterGrid}>
                  {/* 流通市值 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>流通市值</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.marketCapMin}
                            min={0}
                            onCommit={(v) => handleFilterChange('marketCapMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.marketCapMax}
                            nullable
                            min={0}
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('marketCapMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>亿</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.marketCapMin} ~ {filters.marketCapMax ?? '不限'}
                          <span className={styles.filterUnit}>亿</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 量比 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>量比</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <NumberField
                          value={filters.volumeRatioMin}
                          min={0}
                          step="0.1"
                          onCommit={(v) => handleFilterChange('volumeRatioMin', v ?? 0)}
                          className={styles.filterInput}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className={styles.filterDisplay}>≥ {filters.volumeRatioMin}</span>
                      )}
                    </div>
                  </div>

                  {/* 当日涨幅 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>当日涨幅</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.changePercentMin}
                            step="0.5"
                            onCommit={(v) => handleFilterChange('changePercentMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.changePercentMax}
                            nullable
                            step="0.5"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('changePercentMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.changePercentMin} ~ {filters.changePercentMax ?? '不限'}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 换手率 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>换手率</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.turnoverRateMin}
                            min={0}
                            step="0.5"
                            onCommit={(v) => handleFilterChange('turnoverRateMin', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterSeparator}>~</span>
                          <NumberField
                            value={filters.turnoverRateMax}
                            nullable
                            min={0}
                            step="0.5"
                            placeholder="不限"
                            onCommit={(v) => handleFilterChange('turnoverRateMax', v)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.turnoverRateMin} ~ {filters.turnoverRateMax ?? '不限'}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 过滤ST */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>过滤ST股票</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <button
                          className={`${styles.toggleBtn} ${filters.excludeST ? styles.active : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFilterChange('excludeST', !filters.excludeST);
                          }}
                        >
                          {filters.excludeST ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                          <span>{filters.excludeST ? '开启' : '关闭'}</span>
                        </button>
                      ) : (
                        <span className={styles.filterDisplay}>
                          {filters.excludeST ? '开启' : '关闭'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 分时强度 */}
                  <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>分时强度</span>
                    <div className={styles.filterValue}>
                      {isEditing ? (
                        <>
                          <NumberField
                            value={filters.timelineAboveAvgRatio}
                            min={0}
                            max={100}
                            step="5"
                            onCommit={(v) => handleFilterChange('timelineAboveAvgRatio', v ?? 0)}
                            className={styles.filterInput}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className={styles.filterUnit}>%</span>
                        </>
                      ) : (
                        <span className={styles.filterDisplay}>
                          ≥ {filters.timelineAboveAvgRatio}
                          <span className={styles.filterUnit}>%</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                )}
              </motion.div>

              <StrategyCopyPanel copy={resolvedCopy} preset={activePreset} dirty={dirty} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="results-screen"
              className={styles.resultsScreen}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              {/* 结果头部 */}
              <div className={styles.resultsHeader}>
                <motion.div
                  className={styles.resultsSummary}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Target size={20} />
                  <span className={styles.summaryText}>
                    {activePreset ? `「${activePreset.name}」` : ''}共筛选出{' '}
                    <strong>{stocks.length}</strong> 只候选
                    {resultMode === 'scanner' ? '（质量扫描）' : ''}
                  </span>
                </motion.div>
                <motion.div
                  className={styles.resultsActions}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {/* 多面板 / 批量选择 */}
                  {stocks.length > 0 && (
                    <>
                      <button
                        type="button"
                        className={styles.selectModeBtn}
                        onClick={handleOpenMultipanel}
                        title={
                          selectedStocks.size > 0
                            ? `多面板查看已选 ${selectedStocks.size} 只（超出一屏可翻页）`
                            : '多面板查看当前结果（超出一屏可翻页）'
                        }
                      >
                        <LayoutGrid size={16} />
                        多面板
                        {selectedStocks.size > 0 ? ` (${selectedStocks.size})` : ''}
                      </button>
                      <button
                        className={`${styles.selectModeBtn} ${showSelectMode ? styles.active : ''}`}
                        onClick={() => {
                          setShowSelectMode(!showSelectMode);
                          if (showSelectMode) {
                            setSelectedStocks(new Set());
                          }
                        }}
                      >
                        {showSelectMode ? <X size={16} /> : <CheckSquare size={16} />}
                        {showSelectMode ? '取消' : '批量选'}
                      </button>
                    </>
                  )}
                  <button
                    className={styles.backButton}
                    onClick={() => {
                      setHasAnalyzed(false);
                      setStocks([]);
                      setShowSelectMode(false);
                      setSelectedStocks(new Set());
                    }}
                  >
                    <ChevronLeft size={18} />
                    重新筛选
                  </button>
                </motion.div>
              </div>

              {/* 排序和批量操作栏 */}
              {stocks.length > 0 && (
                <motion.div
                  className={styles.sortBar}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <div className={styles.sortSection}>
                    <ArrowUpDown size={14} />
                    <span className={styles.sortLabel}>排序：</span>
                    {SORT_OPTIONS.filter((option) =>
                      resultMode === 'scanner'
                        ? option.field === 'changePercent'
                        : true
                    ).map((option) => (
                      <button
                        key={option.field}
                        className={`${styles.sortOption} ${sortField === option.field ? styles.active : ''}`}
                        onClick={() => handleSortChange(option.field)}
                      >
                        {option.label}
                        {sortField === option.field && (
                          sortOrder === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />
                        )}
                      </button>
                    ))}
                  </div>
                  {showSelectMode && (
                    <div className={styles.batchSection}>
                      <button className={styles.selectAllBtn} onClick={handleSelectAll}>
                        {selectedStocks.size === sortedStocks.length ? '取消全选' : '全选'}
                      </button>
                      <button
                        className={styles.batchAddBtn}
                        onClick={handleOpenMultipanel}
                        disabled={selectedStocks.size === 0}
                        title="用已选标的打开多面板"
                      >
                        <LayoutGrid size={14} />
                        多面板 ({selectedStocks.size})
                      </button>
                      <button
                        className={styles.batchAddBtn}
                        onClick={handleBatchAddWatchlist}
                        disabled={selectedStocks.size === 0}
                      >
                        <Plus size={14} />
                        加入自选 ({selectedStocks.size})
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* 结果列表 */}
              {sortedStocks.length > 0 ? (
                <motion.div
                  className={styles.stockGrid}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                >
                  {sortedStocks.map((stock, index) => (
                    <StockCard
                      key={stock.code}
                      stock={stock}
                      index={index}
                      inWatchlist={isInWatchlist(stock.routeCode)}
                      onAddWatchlist={handleAddWatchlist}
                      onOpenKline={handleOpenKline}
                      onOpenResearch={handleOpenResearch}
                      onCreateCard={handleCreateTradeCard}
                      cardBusy={cardBusy}
                      isSelected={selectedStocks.has(stock.code)}
                      onToggleSelect={handleToggleSelect}
                      showSelect={showSelectMode}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  className={styles.noResults}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <SearchX size={64} strokeWidth={1} />
                  <p className={styles.noResultsTitle}>没有找到符合条件的股票</p>
                  <p className={styles.noResultsHint}>请尝试调整筛选条件后重新分析</p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 加载遮罩 */}
      <AnimatePresence>
        {isLoading && (
          <LoadingOverlay progress={loadingProgress} onCancel={handleCancelAnalysis} />
        )}
      </AnimatePresence>
    </div>
  );
}
