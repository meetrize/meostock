/**
 * P2 中央/侧栏视图：沙盘结果、背离雷达、跨市场对照、checklist
 */

import type {
  CascadeHit,
  ChainCenterView,
  DivergencePoint,
  EventChecklistItem,
  IndustrialChainGraph,
  PortfolioExposureRow,
  RestructureMove,
  ShockScenario,
} from './types';
import { quadrantLabel } from './divergence';
import { SHOCK_PRESETS } from './shockSandbox';
import styles from './IndustrialChain.module.css';

const TIER_SHORT = {
  core: '核心',
  elastic: '弹性',
  indirect: '间接',
  concept: '概念',
} as const;

const THEME_LABEL = {
  nearshore: '近岸',
  friendshore: '友岸',
  china_plus_one: '中国+1',
  onshore: '国产/在岸',
} as const;

const STATUS_LABEL = {
  ongoing: '进行中',
  early: '早期',
  mature: '成熟',
} as const;

export function CenterViewSwitch({
  value,
  onChange,
}: {
  value: ChainCenterView;
  onChange: (v: ChainCenterView) => void;
}) {
  const items: { id: ChainCenterView; label: string }[] = [
    { id: 'graph', label: '图谱' },
    { id: 'sandbox', label: '沙盘' },
    { id: 'radar', label: '背离' },
    { id: 'markets', label: '跨市场' },
    { id: 'restructure', label: '重构' },
    { id: 'exposure', label: '暴露' },
  ];
  return (
    <div className={styles.centerSwitch}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`${styles.tabBtn} ${value === it.id ? styles.tabActive : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function SandboxPanel({
  graph,
  shock,
  onShockChange,
  hits,
  checklist,
  checklistDone,
  onToggleCheck,
  onFocusSegment,
}: {
  graph: IndustrialChainGraph;
  shock: ShockScenario;
  onShockChange: (next: ShockScenario) => void;
  hits: CascadeHit[];
  checklist: EventChecklistItem[];
  checklistDone: Record<string, boolean>;
  onToggleCheck: (id: string) => void;
  onFocusSegment: (segmentId: string) => void;
}) {
  return (
    <div className={styles.p2Panel}>
      <p className={styles.detailP}>
        拖动强度并选择冲击芯片；沿边四参数扩散为 L1–L3（系数区间中点 × 权重）。
      </p>
      <div className={styles.chipRow}>
        {SHOCK_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.chip} ${shock.id === p.id ? styles.chipActive : ''}`}
            onClick={() =>
              onShockChange({
                ...p,
                intensity: shock.intensity,
              })
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className={styles.detailP}>{shock.description}</p>
      <label className={styles.sliderLabel}>
        冲击强度 {Math.round(shock.intensity * 100)}%
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(shock.intensity * 100)}
          onChange={(e) =>
            onShockChange({
              ...shock,
              intensity: Number(e.target.value) / 100,
            })
          }
        />
      </label>
      <label className={styles.sliderLabel}>
        落点环节
        <select
          value={shock.epicenterSegmentId}
          onChange={(e) =>
            onShockChange({ ...shock, epicenterSegmentId: e.target.value })
          }
        >
          {graph.segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.panelTitle} style={{ padding: '8px 0', border: 'none' }}>
        传导结果
      </div>
      {hits.length === 0 ? (
        <div className={styles.detailEmpty}>提高强度以生成传导</div>
      ) : (
        <ul className={styles.cascadeList}>
          {hits.map((h) => (
            <li key={`${h.layer}-${h.segmentId}`}>
              <button
                type="button"
                className={styles.cascadeHit}
                onClick={() => onFocusSegment(h.segmentId)}
              >
                <span className={styles.badge}>{h.layer}</span>
                <strong>{h.segmentName}</strong>
                <span className={styles.memberSymbols}>
                  score {h.score} · lag {h.lagWeeks}w
                </span>
                <span className={styles.detailP}>{h.pathNote}</span>
                <span className={styles.detailP}>
                  {h.beneficiaries.length
                    ? h.beneficiaries
                        .map((b) => `${b.name}(${TIER_SHORT[b.tier]})`)
                        .join('、')
                    : '无合格挂载'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.panelTitle} style={{ padding: '8px 0', border: 'none' }}>
        事件倒计时清单
      </div>
      <ul className={styles.checkList}>
        {checklist.map((c) => (
          <li key={c.id}>
            <label className={styles.checkItem}>
              <input
                type="checkbox"
                checked={!!checklistDone[c.id]}
                onChange={() => onToggleCheck(c.id)}
              />
              <span className={styles.badge}>{c.horizon}</span>
              <span>{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DivergenceRadar({
  points,
  onFocus,
  onWatch,
}: {
  points: DivergencePoint[];
  onFocus: (segmentId: string, entityId: string) => void;
  onWatch?: (symbol: string, name: string) => void;
}) {
  const size = 360;
  const pad = 36;
  const mid = size / 2;
  const scale = (v: number) => mid + (v / 50) * (mid - pad);

  const gold = points.filter((p) => p.quadrant === 'value_gap');

  return (
    <div className={styles.p2Panel}>
      <p className={styles.detailP}>
        横轴=景气分位相对 50；纵轴=价格分位相对 50。左下黄金坑=景气改善、价格未动（种子数据）。
      </p>
      <svg
        className={styles.radarSvg}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="背离雷达"
      >
        <rect
          x={pad}
          y={pad}
          width={size - pad * 2}
          height={size - pad * 2}
          className={styles.radarFrame}
        />
        <line x1={mid} y1={pad} x2={mid} y2={size - pad} className={styles.radarAxis} />
        <line x1={pad} y1={mid} x2={size - pad} y2={mid} className={styles.radarAxis} />
        <text x={size - pad} y={mid - 6} className={styles.radarLabel}>
          景气→
        </text>
        <text x={mid + 6} y={pad + 12} className={styles.radarLabel}>
          价格↑
        </text>
        <text x={pad + 4} y={size - pad - 8} className={styles.radarLabel}>
          黄金坑
        </text>
        {points.map((p) => {
          const x = scale(p.cycleDelta);
          const y = scale(-p.priceDelta);
          const fill =
            p.quadrant === 'value_gap'
              ? '#1a7f4b'
              : p.quadrant === 'overheated'
                ? '#b42318'
                : p.quadrant === 'value_trap'
                  ? '#888'
                  : '#2b6cb0';
          return (
            <g
              key={`${p.entityId}-${p.segmentId}`}
              className={styles.radarPoint}
              onClick={() => onFocus(p.segmentId, p.entityId)}
            >
              <circle cx={x} cy={y} r={5} fill={fill} opacity={0.85} />
              <title>
                {p.name} {p.symbol} · {quadrantLabel(p.quadrant)}
              </title>
            </g>
          );
        })}
      </svg>
      <div className={styles.panelTitle} style={{ padding: '8px 0', border: 'none' }}>
        黄金坑列表（{gold.length}）
      </div>
      <ul className={styles.memberList}>
        {gold.slice(0, 12).map((p) => (
          <li key={`${p.entityId}-g`}>
            <button
              type="button"
              className={styles.memberCard}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => onFocus(p.segmentId, p.entityId)}
            >
              <div className={styles.memberTop}>
                <span className={styles.memberName}>
                  {p.name} · {p.symbol}
                </span>
                <span className={styles.badge}>景气{p.cycleDelta > 0 ? '+' : ''}{p.cycleDelta}</span>
              </div>
              <div className={styles.memberSymbols}>
                {p.segmentName} · 估值P{p.valuationPercentile ?? '—'} · 拥挤
                {p.crowding ?? '—'}
              </div>
              <p className={styles.detailP}>{p.note}</p>
            </button>
            {onWatch && (
              <button
                type="button"
                className={styles.btn}
                style={{ marginTop: 6 }}
                onClick={() => onWatch(p.symbol, p.name)}
              >
                加入自选
              </button>
            )}
          </li>
        ))}
        {gold.length === 0 && <li className={styles.detailP}>当前种子下无黄金坑点</li>}
      </ul>
    </div>
  );
}

export function RestructurePanel({
  moves,
  graph,
  onFocusSegment,
}: {
  moves: RestructureMove[];
  graph: IndustrialChainGraph;
  onFocusSegment: (segmentId: string) => void;
}) {
  return (
    <div className={styles.p2Panel}>
      <p className={styles.detailP}>
        近岸 / 友岸 / 中国+1 / 国产在岸：长期骨架迁移叙事（精编示意，低频更新）。
      </p>
      <ul className={styles.memberList}>
        {moves.length === 0 && (
          <li className={styles.detailP}>
            本链暂无地理重构叙事（C05 以报告锚点与利润带为主；近岸/友岸叙事见 C01）。
          </li>
        )}
        {moves.map((mv) => (
          <li key={mv.id} className={styles.memberCard}>
            <div className={styles.memberTop}>
              <span className={styles.memberName}>{mv.title}</span>
              <span className={styles.badge}>{THEME_LABEL[mv.theme]}</span>
            </div>
            <div className={styles.memberSymbols}>
              {mv.fromRegion} → {mv.toRegion} · {STATUS_LABEL[mv.status]} · {mv.asOf}
            </div>
            <p className={styles.detailP}>{mv.summary}</p>
            {mv.evidence && <p className={styles.detailP}>{mv.evidence}</p>}
            <div className={styles.chipRow}>
              {mv.segmentIds.map((id) => {
                const name = graph.segments.find((s) => s.id === id)?.name ?? id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={styles.chip}
                    onClick={() => onFocusSegment(id)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExposurePanel({
  rows,
  matched,
  unmatched,
  hiddenConcentration,
  watchCount,
  onFocusSegment,
}: {
  rows: PortfolioExposureRow[];
  matched: number;
  unmatched: string[];
  hiddenConcentration: string[];
  watchCount: number;
  onFocusSegment: (segmentId: string) => void;
}) {
  return (
    <div className={styles.p2Panel}>
      <p className={styles.detailP}>
        自选共 {watchCount} 只 · 命中 C01 {matched} 只 · 未映射 {unmatched.length} 只
      </p>
      {hiddenConcentration.length > 0 && (
        <div className={styles.warnBox}>
          <strong>隐性集中</strong>
          <ul>
            {hiddenConcentration.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.length === 0 ? (
        <div className={styles.detailEmpty}>
          自选中暂无本链挂载标的。可在背离/信号里「加入自选」，或先把相关 A 股加入自选。
        </div>
      ) : (
        <ul className={styles.cascadeList}>
          {rows.map((r) => (
            <li key={r.segmentId}>
              <button
                type="button"
                className={styles.cascadeHit}
                onClick={() => onFocusSegment(r.segmentId)}
              >
                <div className={styles.memberTop}>
                  <strong>{r.segmentName}</strong>
                  <span className={styles.badge}>
                    {r.count} 只
                    {r.chokeRisk === 'high' ? ' · 卡脖子' : ''}
                  </span>
                </div>
                <span className={styles.detailP}>{r.names.join('、')}</span>
                <span className={styles.memberSymbols}>{r.codes.join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {unmatched.length > 0 && (
        <p className={styles.detailP}>
          未映射示例：{unmatched.slice(0, 8).join('、')}
          {unmatched.length > 8 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

export function CrossMarketTable({
  graph,
  onFocusSegment,
}: {
  graph: IndustrialChainGraph;
  onFocusSegment: (segmentId: string) => void;
}) {
  const rows = graph.memberships
    .filter((m) => m.status === 'active')
    .map((m) => {
      const ent = graph.entities.find((e) => e.id === m.entityId);
      const seg = graph.segments.find((s) => s.id === m.segmentId);
      if (!ent || !seg) return null;
      return { m, ent, seg };
    })
    .filter(Boolean) as {
    m: IndustrialChainGraph['memberships'][0];
    ent: IndustrialChainGraph['entities'][0];
    seg: IndustrialChainGraph['segments'][0];
  }[];

  rows.sort((a, b) => a.seg.column - b.seg.column || a.ent.name.localeCompare(b.ent.name));

  return (
    <div className={styles.p2Panel}>
      <p className={styles.detailP}>
        同一环节跨市场挂载对照（A/美/台/韩/日）。点击行定位环节。
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.marketTable}>
          <thead>
            <tr>
              <th>环节</th>
              <th>公司</th>
              <th>代码</th>
              <th>市场</th>
              <th>分层</th>
              <th>证据</th>
              <th>占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, ent, seg }) => (
              <tr
                key={m.id}
                onClick={() => onFocusSegment(seg.id)}
                className={styles.marketRow}
              >
                <td>{seg.name}</td>
                <td>{ent.name}</td>
                <td className={styles.mono}>{ent.symbols.join(', ')}</td>
                <td>{ent.market ?? '—'}</td>
                <td>{TIER_SHORT[m.tier]}</td>
                <td>{m.evidenceGrade}</td>
                <td>{m.revenueSharePct != null ? `${m.revenueSharePct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
