'use client';

/**
 * 知识成长洞察页主视图（V17 收官）——一处汇总成长全景：
 *   1) 总览四项（笔记/概念/卡片/复习累计）+ 连续天数 + 保留率；
 *   2) 成长曲线（GrowthChart，内联 SVG 折线，30/90 天可切）；
 *   3) 领域分布（DomainBars）；
 *   4) 成就徽章（AchievementGrid，纯派生）；
 *   5) 复习热力（复用 V7/V14 的 ReviewHeatmap）；
 *   6) 知识体检（CheckupReport，独立拉 /api/checkup）。
 *
 * 数据：挂载时 + 切窗口时 GET /api/insights?days=30|90（已鉴权 + userId 过滤）。
 * 加载中骨架；失败友好降级（顶部给错误提示，不白屏）。深浅色与既有设计系统一致。
 */

import { useEffect, useState } from 'react';
import {
  SectionTitle,
  StreakIcon,
  GoalIcon,
  NoteIcon,
  LibraryIcon,
  ReviewIcon,
  TrendIcon,
  cn,
} from '@/components/ui';
import ReviewHeatmap from '@/features/review/components/ReviewHeatmap';
import GrowthChart, { type GrowthSeries } from './GrowthChart';
import DomainBars, { type DomainCount } from './DomainBars';
import AchievementGrid, { type Achievement } from './AchievementGrid';
import CheckupReport from './CheckupReport';

interface Insights {
  days: number;
  growth: GrowthSeries;
  retention: number;
  streak: number;
  domains: DomainCount[];
  totals: { notes: number; concepts: number; cards: number; reviews: number };
  achievements: Achievement[];
}

const WINDOWS = [30, 90] as const;

export default function InsightsView() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetch(`/api/insights?days=${days}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('insights');
        return json as Insights;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const loading = data === null && !error;

  return (
    <div className="space-y-9">
      {/* 总览 */}
      <section className="space-y-2.5">
        <SectionTitle className="mb-1">总览</SectionTitle>
        {error && data === null ? (
          <p className="rounded-card border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-800">
            洞察加载失败，稍后重试。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            <Stat icon={<NoteIcon className="h-3.5 w-3.5" />} label="笔记" value={data?.totals.notes} loading={loading} />
            <Stat icon={<LibraryIcon className="h-3.5 w-3.5" />} label="概念" value={data?.totals.concepts} loading={loading} />
            <Stat icon={<ReviewIcon className="h-3.5 w-3.5" />} label="卡片" value={data?.totals.cards} loading={loading} />
            <Stat icon={<TrendIcon className="h-3.5 w-3.5" />} label="复习" value={data?.totals.reviews} loading={loading} />
            <Stat icon={<StreakIcon className="h-3.5 w-3.5 text-amber-500" />} label="连续天数" value={data?.streak} loading={loading} />
            <Stat
              icon={<GoalIcon className="h-3.5 w-3.5 text-emerald-500" />}
              label="保留率"
              value={data ? Math.round(data.retention * 100) : undefined}
              unit="%"
              loading={loading}
            />
          </div>
        )}
      </section>

      {/* 成长曲线 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <SectionTitle className="mb-0">成长曲线</SectionTitle>
          <WindowToggle days={days} onChange={setDays} />
        </div>
        {loading || !data ? (
          <div className="h-[232px] animate-pulse rounded-card bg-zinc-100 dark:bg-zinc-800" />
        ) : (
          <GrowthChart growth={data.growth} />
        )}
      </section>

      {/* 领域分布 */}
      <section className="space-y-2.5">
        <SectionTitle className="mb-1">领域分布</SectionTitle>
        {loading || !data ? (
          <div className="h-40 animate-pulse rounded-card bg-zinc-100 dark:bg-zinc-800" />
        ) : (
          <DomainBars domains={data.domains} />
        )}
      </section>

      {/* 成就徽章 */}
      {data && data.achievements.length > 0 && (
        <section className="space-y-2.5">
          <SectionTitle className="mb-1">成就</SectionTitle>
          <AchievementGrid achievements={data.achievements} />
        </section>
      )}

      {/* 复习热力（复用 V7/V14） */}
      <section className="space-y-2.5">
        <SectionTitle className="mb-1">复习活跃</SectionTitle>
        <ReviewHeatmap />
      </section>

      {/* 知识体检 */}
      <CheckupReport />
    </div>
  );
}

/** 窗口切换 30 / 90 天（分段控件）。 */
function WindowToggle({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: (typeof WINDOWS)[number]) => void;
}) {
  return (
    <div className="inline-flex rounded-pill border border-zinc-200 bg-zinc-50 p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          aria-pressed={days === w}
          className={cn(
            'rounded-pill px-2.5 py-1 font-medium tabular-nums transition',
            days === w
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          )}
        >
          {w} 天
        </button>
      ))}
    </div>
  );
}

/** 总览小卡。 */
function Stat({
  icon,
  label,
  value,
  unit,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  unit?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-2 py-3 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-400">
        <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-0.5">
        <span
          className={cn(
            'text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50',
            loading && 'animate-pulse text-zinc-300 dark:text-zinc-700'
          )}
        >
          {loading || value === undefined ? '—' : value}
        </span>
        {unit && !loading && value !== undefined && (
          <span className="text-[11px] text-zinc-400">{unit}</span>
        )}
      </div>
    </div>
  );
}
