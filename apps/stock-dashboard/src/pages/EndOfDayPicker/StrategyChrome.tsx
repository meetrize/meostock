/**
 * 策略选股：周期 Tab + 预设条 + 文案面板（M1）
 */

import {
  HORIZON_TABS,
  RISK_LABEL,
  type PresetHorizon,
  type StrategyCopy,
  type StrategyPreset,
} from '@/services/strategyPresets';
import styles from './EndOfDayPicker.module.css';

export function HorizonTabs({
  value,
  onChange,
}: {
  value: PresetHorizon;
  onChange: (h: PresetHorizon) => void;
}) {
  return (
    <div className={styles.horizonTabs} role="tablist" aria-label="策略周期">
      {HORIZON_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`${styles.horizonTab} ${value === tab.id ? styles.active : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function PresetStrip({
  presets,
  activeId,
  dirty,
  onSelect,
}: {
  presets: StrategyPreset[];
  activeId: string;
  dirty: boolean;
  onSelect: (id: string) => void;
}) {
  if (presets.length === 0) {
    return <p className={styles.presetEmpty}>该周期暂无官方预设</p>;
  }
  return (
    <div className={styles.presetStrip}>
      {presets.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            type="button"
            className={`${styles.presetChip} ${active ? styles.active : ''} ${
              !p.runnable ? styles.pending : ''
            }`}
            onClick={() => onSelect(p.id)}
            title={p.copy?.one_liner || p.name}
          >
            <span className={styles.presetChipName}>
              {p.name}
              {active && dirty ? ' · 未保存' : ''}
            </span>
            <span className={styles.presetChipMeta}>
              风险{RISK_LABEL[p.risk_level] || p.risk_level}
              {!p.runnable ? ' · 待跑批' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StrategyCopyPanel({
  copy,
  preset,
  dirty,
}: {
  copy: StrategyCopy | null;
  preset: StrategyPreset | null;
  dirty: boolean;
}) {
  if (!copy || !preset) {
    return (
      <div className={styles.copyPanel}>
        <p className={styles.copyMuted}>选择预设后显示策略说明</p>
      </div>
    );
  }
  return (
    <aside className={styles.copyPanel}>
      <div className={styles.copyHeader}>
        <h3 className={styles.copyHeadline}>{copy.headline}</h3>
        {dirty && <span className={styles.copyDirtyBadge}>基于预设的变体</span>}
      </div>
      <p className={styles.copyOneLiner}>{copy.one_liner}</p>

      <div className={styles.copySection}>
        <h4>适用 / 慎用</h4>
        <p>
          <span className={styles.copyLabel}>适用</span>
          {copy.fit_when}
        </p>
        <p>
          <span className={styles.copyLabel}>慎用</span>
          {copy.avoid_when}
        </p>
      </div>

      {(copy.conditions?.length ?? 0) > 0 && (
        <div className={styles.copySection}>
          <h4>当前筛选条件</h4>
          <ul className={styles.copyConditions}>
            {copy.conditions!.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.copySection}>
        <h4>观察要点</h4>
        <p>
          <span className={styles.copyLabel}>买入侧</span>
          {copy.how_to_buy}
        </p>
        <p>
          <span className={styles.copyLabel}>离场侧</span>
          {copy.how_to_exit}
        </p>
        <p>
          <span className={styles.copyLabel}>仓位</span>
          {copy.position_hint}
        </p>
      </div>

      {(preset.environment?.prefer?.length || preset.environment?.avoid?.length) && (
        <div className={styles.copySection}>
          <h4>环境提示</h4>
          {!!preset.environment?.prefer?.length && (
            <p>
              <span className={styles.copyLabel}>偏好</span>
              {preset.environment.prefer.join('、')}
            </p>
          )}
          {!!preset.environment?.avoid?.length && (
            <p>
              <span className={styles.copyLabel}>回避</span>
              {preset.environment.avoid.join('、')}
            </p>
          )}
        </div>
      )}

      <p className={styles.copyDisclaimer}>{copy.disclaimer}</p>
    </aside>
  );
}
