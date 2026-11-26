import type { CommandItem, IndustrialChainGraph } from './types';

export function buildCommandItems(graph: IndustrialChainGraph | null): CommandItem[] {
  const items: CommandItem[] = [
    {
      id: 'view-graph',
      title: '打开图谱',
      keywords: ['图谱', 'graph', '拓扑'],
      action: { type: 'view', view: 'graph' },
    },
    {
      id: 'view-sandbox',
      title: '打开传导沙盘',
      keywords: ['沙盘', '冲击', 'sandbox', '传导'],
      action: { type: 'view', view: 'sandbox' },
    },
    {
      id: 'view-radar',
      title: '打开背离雷达',
      keywords: ['背离', '黄金坑', 'radar', '预期差'],
      action: { type: 'view', view: 'radar' },
    },
    {
      id: 'view-markets',
      title: '打开跨市场对照',
      keywords: ['跨市场', 'markets', '对照'],
      action: { type: 'view', view: 'markets' },
    },
    {
      id: 'view-restructure',
      title: '打开重构叙事',
      keywords: ['重构', '近岸', '友岸', '中国+1', 'restructure'],
      action: { type: 'view', view: 'restructure' },
    },
    {
      id: 'view-exposure',
      title: '打开组合链暴露',
      keywords: ['暴露', '自选', '持仓', 'exposure', '组合'],
      action: { type: 'view', view: 'exposure' },
    },
    {
      id: 'tab-signals',
      title: '右侧：信号流',
      keywords: ['信号', 'signals'],
      action: { type: 'tab', tab: 'signals' },
    },
    {
      id: 'tab-candidates',
      title: '右侧：候选箱',
      keywords: ['候选', 'candidates'],
      action: { type: 'tab', tab: 'candidates' },
    },
    {
      id: 'tab-indicators',
      title: '右侧：景气指标',
      keywords: ['景气', '指标', 'indicators'],
      action: { type: 'tab', tab: 'indicators' },
    },
    {
      id: 'mode-edit',
      title: '进入编辑链',
      keywords: ['编辑', 'edit', '草稿'],
      action: { type: 'edit' },
    },
  ];

  if (!graph) return items;

  for (const seg of graph.segments) {
    items.push({
      id: `seg-${seg.id}`,
      title: `环节：${seg.name}`,
      hint: seg.nameEn,
      keywords: [seg.name, seg.nameEn ?? '', seg.id, '瓶颈', seg.chokeRisk === 'high' ? '卡脖子' : ''],
      action: { type: 'segment', segmentId: seg.id },
    });
  }

  for (const m of graph.memberships) {
    if (m.status === 'deprecated') continue;
    const ent = graph.entities.find((e) => e.id === m.entityId);
    if (!ent) continue;
    items.push({
      id: `ent-${ent.id}-${m.segmentId}`,
      title: `${ent.name} → 定位环节`,
      hint: ent.symbols.join(' · '),
      keywords: [ent.name, ...ent.symbols, m.segmentId],
      action: { type: 'entity', entityId: ent.id, segmentId: m.segmentId },
    });
  }

  return items;
}

export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, 24);
  return items
    .filter((it) => {
      const blob = `${it.title} ${it.hint ?? ''} ${it.keywords.join(' ')}`.toLowerCase();
      return blob.includes(q) || q.split(/\s+/).every((part) => blob.includes(part));
    })
    .slice(0, 24);
}
