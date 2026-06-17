'use client';

/**
 * 知识成长曲线（V17）—— 轻量内联 SVG 折线图，不引图表依赖。
 *
 * 三条累计曲线（笔记 / 概念 / 卡片）叠在同一坐标系，用 viewBox 自适应宽度（responsive）。
 * 顶部图例可单独开关某条线（至少保留一条）；窗口切换（30/90 天）由父组件控制、本组件只渲染传入数据。
 * 数据来自 /api/insights 的 growth.{notes,concepts,cards}（密集升序、值为累计量）。
 */

import { useMemo, useState } from 'react';
import { cn } from '@/components/ui';

export interface GrowthPoint {
  date: string;
  count: number;
}
export interface GrowthSeries {
  notes: GrowthPoint[];
  concepts: GrowthPoint[];
  cards: GrowthPoint[];
}

type SeriesKey = 'notes' | 'concepts' | 'cards';

const SERIES_META: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'notes', label: '笔记', color: '#10b981' },
  { key: 'concepts', label: '概念', color: '#6366f1' },
  { key: 'cards', label: '卡片', color: '#f59e0b' },
];

// viewBox 坐标系（与渲染像素解耦，靠 width=100% 自适应）。
const VB_W = 600;
const VB_H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 30 };

export default function GrowthChart({ growth }: { growth: GrowthSeries }) {
  // 各线显隐（默认全开）。
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    notes: true,
    concepts: true,
    cards: true,
  });

  const toggle = (key: SeriesKey) => {
    setVisible((v) => {
      const next = { ...v, [key]: !v[key] };
      // 至少保留一条可见，避免空图。
      if (!next.notes && !next.concepts && !next.cards) return v;
      return next;
    });
  };

  const model = useMemo(() => buildModel(growth, visible), [growth, visible]);

  return (
    <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      {/* 图例（可点击开关） */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {SERIES_META.map((s) => {
          const on = visible[s.key];
          const latest = growth[s.key].at(-1)?.count ?? 0;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={on}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-xs font-medium transition',
                on
                  ? 'text-zinc-700 dark:text-zinc-200'
                  : 'text-zinc-300 line-through dark:text-zinc-600'
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: on ? s.color : 'currentColor' }}
              />
              {s.label}
              <span className="tabular-nums text-zinc-400">{latest}</span>
            </button>
          );
        })}
      </div>

      {/* 折线图 */}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="知识成长曲线"
      >
        {/* 横向网格线 + Y 轴刻度 */}
        {model.yTicks.map((t) => (
          <g key={t.value}>
            <line
              x1={PAD.left}
              y1={t.y}
              x2={VB_W - PAD.right}
              y2={t.y}
              className="stroke-zinc-100 dark:stroke-zinc-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 5}
              y={t.y + 3}
              textAnchor="end"
              className="fill-zinc-400 text-[9px] tabular-nums"
            >
              {t.value}
            </text>
          </g>
        ))}

        {/* X 轴端点日期（首/末） */}
        {model.xLabels.map((l) => (
          <text
            key={l.x}
            x={l.x}
            y={VB_H - 6}
            textAnchor={l.anchor}
            className="fill-zinc-400 text-[9px]"
          >
            {l.label}
          </text>
        ))}

        {/* 各条曲线（面积 + 折线） */}
        {model.paths.map((p) => (
          <g key={p.key}>
            <path d={p.area} fill={p.color} fillOpacity={0.08} stroke="none" />
            <path
              d={p.line}
              fill="none"
              stroke={p.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

interface ChartModel {
  yTicks: { value: number; y: number }[];
  xLabels: { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  paths: { key: SeriesKey; color: string; line: string; area: string }[];
}

/** 把可见序列折算成 SVG 路径 + 坐标轴刻度。空/单点也安全。 */
function buildModel(growth: GrowthSeries, visible: Record<SeriesKey, boolean>): ChartModel {
  const innerW = VB_W - PAD.left - PAD.right;
  const innerH = VB_H - PAD.top - PAD.bottom;

  // 取一条参考序列定 X 轴长度（三条等长，由后端密集补全保证）。
  const ref =
    growth.notes.length > 0
      ? growth.notes
      : growth.concepts.length > 0
        ? growth.concepts
        : growth.cards;
  const n = ref.length;

  // Y 轴上界 = 所有可见序列的最大累计值（至少 1，避免除零）。
  let maxY = 0;
  for (const meta of SERIES_META) {
    if (!visible[meta.key]) continue;
    for (const pt of growth[meta.key]) maxY = Math.max(maxY, pt.count);
  }
  maxY = Math.max(maxY, 1);
  const niceMax = niceCeil(maxY);

  const xAt = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;

  // Y 刻度：0 / 中 / 上界 三档。
  const yTicks = [0, Math.round(niceMax / 2), niceMax]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((value) => ({ value, y: yAt(value) }));

  const xLabels: ChartModel['xLabels'] = [];
  if (n > 0) {
    xLabels.push({ x: PAD.left, label: shortDate(ref[0].date), anchor: 'start' });
    xLabels.push({ x: VB_W - PAD.right, label: shortDate(ref[n - 1].date), anchor: 'end' });
  }

  const paths: ChartModel['paths'] = [];
  for (const meta of SERIES_META) {
    if (!visible[meta.key]) continue;
    const pts = growth[meta.key];
    if (pts.length === 0) continue;
    const coords = pts.map((pt, i) => [xAt(i), yAt(pt.count)] as const);
    const line = coords
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    const baseY = yAt(0);
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${baseY.toFixed(1)} L${coords[0][0].toFixed(1)},${baseY.toFixed(1)} Z`;
    paths.push({ key: meta.key, color: meta.color, line, area });
  }

  return { yTicks, xLabels, paths };
}

/** 把上界取整到「好看」的刻度（1/2/5×10^k），让 Y 轴不出现奇怪数字。 */
function niceCeil(v: number): number {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const base = v / pow;
  const step = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return step * pow;
}

/** 'YYYY-MM-DD' → 'M/D'（X 轴端点用）。 */
function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}
