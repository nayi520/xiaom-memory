'use client';

/**
 * 首页概览面板（V6 Dashboard）——把首页从「纯捕获」升级为「捕获 + 概览」。
 *
 * 三块内容：
 *   1) 连续记录天数 streak（醒目卡，火苗图标）+ 今日待复习（点击进 /review，带数字角标）；
 *   2) 知识概览：概念数 / 笔记数 / 本周新增（来自 /api/stats）；
 *   3) 最近捕获由 CapturePage 复用 RecentNotes 单独渲染，不在本组件内。
 *
 * 数据：挂载时 GET /api/stats（已鉴权 + userId 过滤）。加载中骨架；失败友好降级、不崩溃。
 * 空状态（全 0）友好引导去记录 / 复习。深浅色与既有设计系统一致。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  SectionTitle,
  StreakIcon,
  TrendIcon,
  ReviewIcon,
  LibraryIcon,
  NoteIcon,
  ChevronRight,
  cn,
} from '@/components/ui';

interface Stats {
  noteCount: number;
  conceptCount: number;
  cardCount: number;
  dueCount: number;
  weeklyNoteCount: number;
  streak: number;
}

export default function DashboardPanel({ className }: { className?: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/stats')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('stats');
        return data as Stats;
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 加载失败：整块静默隐藏，不打扰捕获主流程（首页核心是记录）。
  if (error) return null;

  const loading = stats === null;
  const empty = !loading && stats.noteCount === 0 && stats.conceptCount === 0;

  return (
    <section className={cn('space-y-5', className)}>
      {/* 连续记录 + 今日待复习 */}
      <div className="grid grid-cols-2 gap-3">
        <StreakCard streak={stats?.streak ?? 0} loading={loading} empty={empty} />
        <DueCard due={stats?.dueCount ?? 0} loading={loading} />
      </div>

      {/* 知识概览 */}
      <div>
        <SectionTitle>知识概览</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<LibraryIcon aria-hidden className="h-4 w-4" />}
            value={stats?.conceptCount ?? 0}
            label="概念"
            loading={loading}
            href="/library"
          />
          <StatCard
            icon={<NoteIcon aria-hidden className="h-4 w-4" />}
            value={stats?.noteCount ?? 0}
            label="笔记"
            loading={loading}
            href="/timeline"
          />
          <StatCard
            icon={<TrendIcon aria-hidden className="h-4 w-4" />}
            value={stats?.weeklyNoteCount ?? 0}
            label="本周新增"
            loading={loading}
          />
        </div>
        {empty && (
          <p className="mt-3 rounded-card border border-dashed border-zinc-200 px-4 py-3 text-center text-xs leading-relaxed text-zinc-400 dark:border-zinc-800">
            记下第一条后，小M 会自动整理出概念，这里就有内容了。
          </p>
        )}
      </div>
    </section>
  );
}

/** 连续记录天数：醒目品牌渐变卡 + 火苗。空状态给一句引导。 */
function StreakCard({
  streak,
  loading,
  empty,
}: {
  streak: number;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-card border border-brand/15 bg-gradient-to-br from-brand/[0.07] to-brand/[0.02] px-4 py-3.5 shadow-card dark:border-brand/20 dark:from-brand/[0.12] dark:to-transparent">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <StreakIcon aria-hidden className="h-3.5 w-3.5 text-amber-500" />
        连续记录
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            'text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50',
            loading && 'animate-pulse text-zinc-300 dark:text-zinc-700'
          )}
        >
          {loading ? '—' : streak}
        </span>
        {!loading && <span className="text-xs text-zinc-400">天</span>}
      </div>
      {!loading && (
        <p className="mt-0.5 truncate text-[11px] text-zinc-400">
          {empty
            ? '今天记一条，开启连续记录'
            : streak > 0
              ? '保持住，别断签'
              : '今天还没记，记一条续上'}
        </p>
      )}
    </div>
  );
}

/** 今日待复习：点击进 /review。无到期时显示「已清空」状态。 */
function DueCard({ due, loading }: { due: number; loading: boolean }) {
  const has = due > 0;
  return (
    <Link
      href="/review"
      className={cn(
        'group relative flex flex-col rounded-card border px-4 py-3.5 shadow-card transition duration-200 ease-smooth hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0 focus-visible:outline-none',
        has
          ? 'border-brand/20 bg-brand/[0.06] dark:border-brand/25 dark:bg-brand/[0.1]'
          : 'border-zinc-200/80 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <ReviewIcon aria-hidden className="h-3.5 w-3.5 text-brand" />
        今日待复习
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            'text-2xl font-bold tabular-nums',
            loading && 'animate-pulse text-zinc-300 dark:text-zinc-700',
            !loading && has ? 'text-brand' : 'text-zinc-900 dark:text-zinc-50'
          )}
        >
          {loading ? '—' : due}
        </span>
        {!loading && <span className="text-xs text-zinc-400">{has ? '张待复习' : '已清空'}</span>}
      </div>
      {!loading && (
        <span className="mt-0.5 inline-flex items-center text-[11px] text-brand/80 transition group-hover:text-brand">
          {has ? '去复习' : '去看看'}
          <ChevronRight aria-hidden className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </Link>
  );
}

/** 概览小计数卡（可选链接）。 */
function StatCard({
  icon,
  value,
  label,
  loading,
  href,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  loading: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
      <span
        className={cn(
          'mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50',
          loading && 'animate-pulse text-zinc-300 dark:text-zinc-700'
        )}
      >
        {loading ? '—' : value}
      </span>
      <span className="text-[11px] text-zinc-400">{label}</span>
    </>
  );

  const base =
    'flex flex-col items-center rounded-card border border-zinc-200/80 bg-white px-2 py-3 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900';

  if (href && !loading) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          'transition duration-200 ease-smooth hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-card-hover active:translate-y-0 focus-visible:outline-none dark:hover:border-zinc-700'
        )}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
