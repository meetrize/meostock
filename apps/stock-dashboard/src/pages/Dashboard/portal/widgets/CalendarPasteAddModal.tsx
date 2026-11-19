/**
 * 粘贴新闻稿 → AI 解析 → 勾选确认添加入财经日历
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { useToast } from '@/components/common';
import styles from './CalendarPasteAddModal.module.css';

export type ParsedCalDraft = {
  name: string;
  start_at: string;
  end_at?: string | null;
  std_type_code: string;
  fe_type?: string;
  sponsor?: string;
  city?: string;
  summary?: string;
  possible_duplicate?: boolean;
  match_fe_code?: string | null;
  match_reason?: string | null;
  selected: boolean;
  force: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
};

const MAX_CHARS = 20000;

function toDatetimeLocal(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}`;
  const d = iso.slice(0, 10);
  return d ? `${d}T09:30` : '';
}

function fromDatetimeLocal(local: string): string {
  const v = (local || '').trim();
  if (!v) return '';
  // treat as Asia/Shanghai wall time
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return `${v.length === 16 ? `${v}:00` : v}+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T09:30:00+08:00`;
  return v;
}

export function CalendarPasteAddModal({ open, onClose, onAdded }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<ParsedCalDraft[]>([]);
  const [emptyHint, setEmptyHint] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('paste');
    setEmptyHint(false);
    void (async () => {
      try {
        const res = await fetch('/api/ai/health');
        const data = await res.json().catch(() => ({}));
        setAiConfigured(Boolean(data?.configured));
        if (data?.configured && data?.model) {
          setModelLabel(
            `${data.provider === 'deepseek' ? 'DeepSeek' : '兼容'} · ${data.model}`
          );
        } else {
          setModelLabel(null);
        }
      } catch {
        setAiConfigured(null);
      }
    })();
  }, [open]);

  const selectedCount = useMemo(
    () => drafts.filter((d) => d.selected).length,
    [drafts]
  );

  if (!open) return null;

  const runParse = async () => {
    const body = text.trim();
    if (!body) {
      toast.error('请先粘贴文本');
      return;
    }
    setParsing(true);
    setEmptyHint(false);
    try {
      const res = await fetch('/api/calendar/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body.slice(0, MAX_CHARS) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        throw new Error(data?.error || '未配置 AI 模型');
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '解析失败');
      }
      if (data.model) {
        setModelLabel(
          `${data.provider === 'deepseek' ? 'DeepSeek' : '兼容'} · ${data.model}`
        );
      }
      const items = Array.isArray(data.events) ? data.events : [];
      if (!items.length) {
        setEmptyHint(true);
        setDrafts([]);
        toast.error('未识别到未来日程');
        return;
      }
      setDrafts(
        items.map((ev: Record<string, unknown>) => {
          const dup = Boolean(ev.possible_duplicate);
          return {
            name: String(ev.name || ''),
            start_at: String(ev.start_at || ''),
            end_at: (ev.end_at as string | null) || null,
            std_type_code: String(ev.std_type_code || '3'),
            fe_type: String(ev.fe_type || ''),
            sponsor: String(ev.sponsor || ''),
            city: String(ev.city || ''),
            summary: String(ev.summary || ''),
            possible_duplicate: dup,
            match_fe_code: (ev.match_fe_code as string | null) || null,
            match_reason: (ev.match_reason as string | null) || null,
            selected: !dup,
            force: false,
          };
        })
      );
      setStep('review');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  };

  const runCreate = async () => {
    const chosen = drafts.filter((d) => d.selected);
    if (!chosen.length) {
      toast.error('请至少勾选一条');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_excerpt: text.trim().slice(0, 800),
          events: chosen.map((d) => ({
            name: d.name.trim(),
            start_at: d.start_at,
            end_at: d.end_at || null,
            std_type_code: d.std_type_code,
            fe_type: d.fe_type || '',
            sponsor: d.sponsor || '',
            city: d.city || '',
            summary: d.summary || '',
            force: Boolean(d.force),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || '添加失败');
      }
      toast.success(
        data.message ||
          `新建 ${data.inserted ?? 0}，合并 ${data.merged ?? 0}`
      );
      onAdded();
      onClose();
      setText('');
      setDrafts([]);
      setStep('paste');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (idx: number, patch: Partial<ParsedCalDraft>) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, ...patch } : d))
    );
  };

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-paste-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 id="cal-paste-title">
            {step === 'paste' ? '粘贴解析添加日程' : '核对并添加'}
          </h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {aiConfigured === false ? (
            <p className={styles.hint}>
              未配置 AI 模型。请先到{' '}
              <Link to="/settings" onClick={onClose}>
                设置 → AI 模型
              </Link>{' '}
              添加并设为使用中。
            </p>
          ) : null}

          {modelLabel ? (
            <p className={styles.modelLine}>当前模型：{modelLabel}</p>
          ) : null}

          {step === 'paste' ? (
            <>
              <p className={styles.hint}>
                粘贴预告未来事件的新闻稿或通告（中英文均可）。英文会译成中文事件名与字段，解析为一条或多条财经日历（仅未来日期）。
              </p>
              <textarea
                className={styles.textarea}
                value={text}
                rows={14}
                placeholder="粘贴中文或英文文本…"
                maxLength={MAX_CHARS}
                onChange={(e) => setText(e.target.value)}
              />
              <div className={styles.metaRow}>
                <span>
                  {text.length} / {MAX_CHARS}
                </span>
                {emptyHint ? <span className={styles.warn}>未识别到未来日程</span> : null}
              </div>
            </>
          ) : (
            <>
              <div className={styles.reviewToolbar}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() =>
                    setDrafts((prev) => prev.map((d) => ({ ...d, selected: true })))
                  }
                >
                  全选
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() =>
                    setDrafts((prev) => prev.map((d) => ({ ...d, selected: false })))
                  }
                >
                  全不选
                </button>
                <span className={styles.metaMuted}>已选 {selectedCount} / {drafts.length}</span>
              </div>
              <ul className={styles.draftList}>
                {drafts.map((d, idx) => (
                  <li
                    key={`${d.name}-${d.start_at}-${idx}`}
                    className={`${styles.draftCard} ${
                      d.possible_duplicate ? styles.draftDup : ''
                    }`}
                  >
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={d.selected}
                        onChange={(e) =>
                          updateDraft(idx, { selected: e.target.checked })
                        }
                      />
                      <span>添加</span>
                    </label>
                    {d.possible_duplicate ? (
                      <div className={styles.dupBanner}>
                        可能重复
                        {d.match_reason ? ` · ${d.match_reason}` : ''}
                        <label className={styles.forceLabel}>
                          <input
                            type="checkbox"
                            checked={d.force}
                            onChange={(e) =>
                              updateDraft(idx, { force: e.target.checked })
                            }
                          />
                          仍强制新建
                        </label>
                      </div>
                    ) : null}
                    <label className={styles.field}>
                      <span>名称</span>
                      <input
                        className={styles.input}
                        value={d.name}
                        onChange={(e) => updateDraft(idx, { name: e.target.value })}
                      />
                    </label>
                    <div className={styles.row2}>
                      <label className={styles.field}>
                        <span>开始</span>
                        <input
                          className={styles.input}
                          type="datetime-local"
                          value={toDatetimeLocal(d.start_at)}
                          onChange={(e) =>
                            updateDraft(idx, {
                              start_at: fromDatetimeLocal(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span>大类</span>
                        <select
                          className={styles.input}
                          value={d.std_type_code}
                          onChange={(e) =>
                            updateDraft(idx, { std_type_code: e.target.value })
                          }
                        >
                          <option value="1">会议</option>
                          <option value="2">经济数据</option>
                          <option value="3">其他</option>
                        </select>
                      </label>
                    </div>
                    <div className={styles.row2}>
                      <label className={styles.field}>
                        <span>地区</span>
                        <input
                          className={styles.input}
                          value={d.city || ''}
                          onChange={(e) => updateDraft(idx, { city: e.target.value })}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>主办</span>
                        <input
                          className={styles.input}
                          value={d.sponsor || ''}
                          onChange={(e) =>
                            updateDraft(idx, { sponsor: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    {d.summary ? (
                      <p className={styles.summary}>{d.summary}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {step === 'review' ? (
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={parsing || saving}
              onClick={() => setStep('paste')}
            >
              返回修改原文
            </button>
          ) : (
            <button type="button" className={styles.ghostBtn} onClick={onClose}>
              取消
            </button>
          )}
          {step === 'paste' ? (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={parsing || aiConfigured === false || !text.trim()}
              onClick={() => void runParse()}
            >
              {parsing ? <Loader2 size={14} className={styles.spin} /> : null}
              解析日程
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={saving || selectedCount === 0}
              onClick={() => void runCreate()}
            >
              {saving ? <Loader2 size={14} className={styles.spin} /> : null}
              确认添加 {selectedCount} 条
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
