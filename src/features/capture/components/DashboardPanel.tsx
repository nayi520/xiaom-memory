'use client';

/**
 * 首页概览面板（V6 Dashboard · V31 今日概览升级）——把首页从「纯捕获」升级为「一屏掌握今天」。
 *
 * 内容（从上到下）：
 *   0) 快捷记录（仅首页传入 onQuickCapture 时显示）：文本 / 语音 / 会议三枚醒目入口，点了切到对应录入并滚动到捕获区；
 *   1) 连续记录天数 streak（醒目卡，火苗图标，副文案带「今天已记 N 条」）+ 今日待复习（点击进 /review，带数字角标）；
 *   2) 今日复习目标进度（来自 /api/review/stats + /api/settings，可选）；
 *   3) 行动项（V28）：未完成待办数 + 最近几条（来自 /api/todos 的 open）+ 进 /todos；仅有未完成项时显示；
 *   4) 最近会议（V30）：最近 1–3 条会议记录（来自 /api/notes/timeline?type=meeting，isMeeting 由后端 SQL 判定）+ 进库筛选 ?type=meeting；仅有会议时显示；
 *   5) 知识概览：概念数 / 笔记数 / 本周新增（来自 /api/stats）；
 *   6) 智能推荐（V16）：来自 /api/recommend——该复习的概念 + 值得回看的相关概念；两组都空则整块不渲染。
 *
 * 数据复用既有端点（均已鉴权 + 按 userId 过滤，不新增重型查询）：
 *   /api/stats（含 V31 新增 todayNoteCount）、/api/review/stats、/api/settings、/api/recommend、
 *   /api/todos（V28）、/api/notes/timeline?type=meeting&limit=3（V30）。
 * 主面板（stats）失败时整块静默隐藏，不打扰捕获主流程；各次要信息独立拉取、失败/为空就不显示该块。
 * 加载中骨架；深浅色与既有设计系统一致。
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
  GoalIcon,
  ListTodoIcon,
  MeetingIcon,
  MeetingBadge,
  TextIcon,
  VoiceIcon,
  ChevronRight,
  cn,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';
import type { CaptureTab } from '../types';

interface Stats {
  noteCount: number;
  conceptCount: number;
  cardCount: number;
  dueCount: number;
  /** V31：今天（UTC 日历日）新增记录数。 */
  todayNoteCount: number;
  weeklyNoteCount: number;
  streak: number;
}

/** 今日复习目标进度（来自 /api/review/stats + /api/settings，可选，失败则不显示）。 */
interface GoalInfo {
  todayCount: number;
  goal: number;
}

/** 智能推荐（/api/recommend）：该复习的概念 + 值得回看的相关概念。 */
interface RecommendConcept {
  conceptId: string;
  name: string;
}
interface Recommend {
  review: RecommendConcept[];
  related: RecommendConcept[];
}

/** 行动项（/api/todos 的 open）：仅取展示所需字段。 */
interface TodoLite {
  noteId: string;
  text: string;
  itemKey: string;
}

/** 最近会议（/api/notes/timeline?type=meeting）：仅取展示所需字段。 */
interface MeetingLite {
  id: string;
  title: string;
  createdAt: string;
}

/**
 * @param onQuickCapture 首页传入：点快捷记录时切换捕获 tab（meeting → 切到语音并预选会议模式）。
 *   不传则不渲染「快捷记录」一行（如其他页面复用本面板时）。
 */
export default function DashboardPanel({
  className,
  onQuickCapture,
}: {
  className?: string;
  onQuickCapture?: (tab: CaptureTab, opts?: { meeting?: boolean }) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [goalInfo, setGoalInfo] = useState<GoalInfo | null>(null);
  const [recommend, setRecommend] = useState<Recommend | null>(null);
  const [todos, setTodos] = useState<{ open: TodoLite[]; openCount: number } | null>(null);
  const [meetings, setMeetings] = useState<MeetingLite[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/stats')
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

  // 今日已复习 / 每日目标（次要信息，独立拉取；任一失败就不显示该行，不影响主面板）。
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch('/api/review/stats').then((r) => (r.ok ? r.json() : null)),
      apiFetch('/api/settings').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([rs, settings]) => {
        if (cancelled) return;
        const todayCount = rs?.todayCount;
        const goal = settings?.settings?.reviewDailyGoal;
        if (typeof todayCount === 'number' && typeof goal === 'number' && goal > 0) {
          setGoalInfo({ todayCount, goal });
        }
      })
      .catch(() => {
        /* 次要信息失败：不显示目标进度，静默 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 智能推荐（V16，次要信息独立拉取；失败/为空则不显示该块，不影响主面板）。
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/recommend')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const review = Array.isArray(data.review) ? data.review : [];
        const related = Array.isArray(data.related) ? data.related : [];
        if (review.length > 0 || related.length > 0) setRecommend({ review, related });
      })
      .catch(() => {
        /* 推荐失败：静默不显示 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 行动项（V28，复用 /api/todos）：只取 open 的数量 + 最近 3 条文本。失败/为空不显示该块。
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/todos')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { open?: TodoLite[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.open)) return;
        setTodos({ open: data.open.slice(0, 3), openCount: data.open.length });
      })
      .catch(() => {
        /* 行动项失败：静默不显示 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 最近会议（V30，复用时间线 ?type=meeting）：取最近 3 条，标题用 summary→正文首段兜底。失败/为空不显示。
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/notes/timeline?type=meeting&limit=3')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            notes?: { id: string; summary: string | null; rawContent: string | null; createdAt: string }[];
          } | null
        ) => {
          if (cancelled || !data || !Array.isArray(data.notes)) return;
          setMeetings(
            data.notes.map((n) => ({
              id: n.id,
              title: meetingTitle(n.summary, n.rawContent),
              createdAt: n.createdAt,
            }))
          );
        }
      )
      .catch(() => {
        /* 会议列表失败：静默不显示 */
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
      {/* 快捷记录（仅首页）：文本 / 语音 / 会议三枚醒目入口，点了切到对应录入并滚动到捕获区。 */}
      {onQuickCapture && <QuickCaptureRow onQuickCapture={onQuickCapture} />}

      {/* 连续记录（含今日已记 N 条） + 今日待复习 */}
      <div className="grid grid-cols-2 gap-3">
        <StreakCard
          streak={stats?.streak ?? 0}
          todayCount={stats?.todayNoteCount ?? 0}
          loading={loading}
          empty={empty}
        />
        <DueCard due={stats?.dueCount ?? 0} loading={loading} />
      </div>

      {/* 今日复习目标进度（有目标信息时才显示） */}
      {goalInfo && <DailyGoalRow todayCount={goalInfo.todayCount} goal={goalInfo.goal} />}

      {/* 行动项（V28）：仅有未完成项时显示，给数量 + 最近几条 + 进 /todos。 */}
      {todos && todos.openCount > 0 && (
        <TodosSection open={todos.open} openCount={todos.openCount} />
      )}

      {/* 最近会议（V30）：仅有会议时显示，最近 1–3 条 + 进库筛选。 */}
      {meetings.length > 0 && <MeetingsSection meetings={meetings} />}

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
            label="记录"
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

      {/* 智能推荐（V16）：该复习的概念 + 值得回看的相关概念。 */}
      {recommend && (
        <RecommendSection review={recommend.review} related={recommend.related} />
      )}
    </section>
  );
}

/** 标题：会议纪要 summary 优先，否则取正文首个非空段；折叠空白并截断。 */
function meetingTitle(summary: string | null, rawContent: string | null, max = 32): string {
  const candidate = (summary ?? '').trim() || (rawContent ?? '').trim();
  const cleaned = candidate.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '会议记录';
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** 相对日期：今天「今天」、昨天「昨天」、更早给月日。 */
function relDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dayMs = 24 * 60 * 60 * 1000;
  const startOf = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const diffDays = Math.round((startOf(Date.now()) - startOf(d.getTime())) / dayMs);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/** 快捷记录：醒目三枚入口（文本 / 语音 / 会议），点了切捕获 tab 并滚到捕获区。 */
function QuickCaptureRow({
  onQuickCapture,
}: {
  onQuickCapture: (tab: CaptureTab, opts?: { meeting?: boolean }) => void;
}) {
  const items: {
    key: string;
    label: string;
    Icon: typeof TextIcon;
    onClick: () => void;
  }[] = [
    { key: 'text', label: '文本', Icon: TextIcon, onClick: () => onQuickCapture('text') },
    { key: 'voice', label: '语音', Icon: VoiceIcon, onClick: () => onQuickCapture('voice') },
    {
      key: 'meeting',
      label: '会议',
      Icon: MeetingIcon,
      onClick: () => onQuickCapture('voice', { meeting: true }),
    },
  ];
  return (
    <div>
      <SectionTitle>快捷记录</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={it.onClick}
            className="group flex flex-col items-center gap-1.5 rounded-card border border-brand/15 bg-gradient-to-br from-brand/[0.06] to-brand/[0.02] px-2 py-3 text-center shadow-card transition duration-200 ease-smooth hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover active:translate-y-0 focus-visible:outline-none dark:border-brand/20 dark:from-brand/[0.12] dark:to-transparent"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand transition group-hover:bg-brand/15 dark:bg-brand/15">
              <it.Icon aria-hidden className="h-[18px] w-[18px]" />
            </span>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              记一条 · {it.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 行动项区：标题（含未完成数）+ 最近几条（点击跳来源记录）+ 进 /todos。 */
function TodosSection({ open, openCount }: { open: TodoLite[]; openCount: number }) {
  return (
    <div className="animate-fade-in">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          行动项
        </h2>
        <Link
          href="/todos"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-brand/80 transition hover:text-brand focus-visible:outline-none"
        >
          全部
          <ChevronRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
      <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-3 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <ListTodoIcon aria-hidden className="h-3.5 w-3.5 text-brand" />
          <span>
            <span className="tabular-nums font-semibold text-zinc-700 dark:text-zinc-200">
              {openCount}
            </span>{' '}
            项未完成
          </span>
        </div>
        <ul className="space-y-1.5">
          {open.map((t) => (
            <li key={`${t.noteId}:${t.itemKey}`}>
              <Link
                href={`/library/note/${t.noteId}`}
                className="flex items-start gap-2 rounded-md px-1 py-0.5 text-sm text-zinc-700 transition hover:text-brand focus-visible:outline-none dark:text-zinc-200 dark:hover:text-brand-100"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/40" aria-hidden />
                <span className="min-w-0 flex-1 truncate leading-relaxed">{t.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        {openCount > open.length && (
          <Link
            href="/todos"
            className="mt-2 inline-flex items-center text-xs text-zinc-400 transition hover:text-brand focus-visible:outline-none"
          >
            还有 {openCount - open.length} 项
            <ChevronRight aria-hidden className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** 最近会议区：标题 + 进库筛选 + 最近 1–3 条会议（点击进记录详情）。 */
function MeetingsSection({ meetings }: { meetings: MeetingLite[] }) {
  return (
    <div className="animate-fade-in">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          最近会议
        </h2>
        <Link
          href="/timeline?type=meeting"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-brand/80 transition hover:text-brand focus-visible:outline-none"
        >
          全部
          <ChevronRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
      <ul className="space-y-2">
        {meetings.map((m) => (
          <li key={m.id}>
            <Link
              href={`/library/note/${m.id}`}
              className="group flex items-start gap-2.5 rounded-card border border-zinc-200/80 bg-white px-3.5 py-2.5 shadow-card transition duration-200 ease-smooth hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card-hover active:translate-y-0 focus-visible:outline-none dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="mt-0.5 shrink-0 text-brand dark:text-brand-100">
                <MeetingIcon aria-hidden className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {m.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                  <MeetingBadge iconClassName="h-2.5 w-2.5" className="px-1.5 py-0" />
                  <span className="tabular-nums">{relDay(m.createdAt)}</span>
                </div>
              </div>
              <ChevronRight
                aria-hidden
                className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 智能推荐区：两组概念 chips——待复习（进 /review）/ 相关概念（进概念详情）。 */
function RecommendSection({
  review,
  related,
}: {
  review: RecommendConcept[];
  related: RecommendConcept[];
}) {
  return (
    <div className="animate-fade-in">
      <SectionTitle>为你推荐</SectionTitle>
      <div className="space-y-3">
        {review.length > 0 && (
          <RecommendGroup
            icon={<ReviewIcon aria-hidden className="h-3.5 w-3.5 text-brand" />}
            title="该复习了"
            concepts={review}
            // 待复习概念点击进复习页（卡片在队列里）。
            hrefOf={() => '/review'}
          />
        )}
        {related.length > 0 && (
          <RecommendGroup
            icon={<LibraryIcon aria-hidden className="h-3.5 w-3.5 text-sky-500" />}
            title="值得回看"
            concepts={related}
            hrefOf={(c) => `/library/concept/${c.conceptId}`}
          />
        )}
      </div>
    </div>
  );
}

/** 一组推荐概念：标题 + 概念 chips（点击跳转）。 */
function RecommendGroup({
  icon,
  title,
  concepts,
  hrefOf,
}: {
  icon: React.ReactNode;
  title: string;
  concepts: RecommendConcept[];
  hrefOf: (c: RecommendConcept) => string;
}) {
  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-3 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {concepts.map((c) => (
          <Link
            key={c.conceptId}
            href={hrefOf(c)}
            className="inline-flex max-w-full items-center gap-0.5 rounded-pill bg-brand-light px-2.5 py-1 text-xs font-medium text-brand transition hover:bg-brand/15 active:scale-95 dark:bg-brand/15 dark:text-brand-100 dark:hover:bg-brand/25"
          >
            <span className="truncate">{c.name}</span>
            <ChevronRight aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 连续记录天数：醒目品牌渐变卡 + 火苗。副文案带「今天已记 N 条」；空状态给一句引导。 */
function StreakCard({
  streak,
  todayCount,
  loading,
  empty,
}: {
  streak: number;
  todayCount: number;
  loading: boolean;
  empty: boolean;
}) {
  // 副文案优先反映「今日是否已记」，再退到连续状态引导。
  const subtitle = empty
    ? '今天记一条，开启连续记录'
    : todayCount > 0
      ? `今天已记 ${todayCount} 条`
      : streak > 0
        ? '今天还没记，记一条别断签'
        : '今天还没记，记一条续上';
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
      {!loading && <p className="mt-0.5 truncate text-[11px] text-zinc-400">{subtitle}</p>}
    </div>
  );
}

/** 今日复习目标进度行：今日已复习 / 目标 + 进度条。达成时变绿。 */
function DailyGoalRow({ todayCount, goal }: { todayCount: number; goal: number }) {
  const reached = todayCount >= goal;
  const pct = Math.min(100, Math.round((todayCount / goal) * 100));
  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-3 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-500 dark:text-zinc-400">
          <GoalIcon aria-hidden className="h-3.5 w-3.5 text-emerald-500" />
          今日复习目标
        </span>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
          {todayCount} / {goal}
          {reached && ' · 已达成 🎉'}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800"
        role="progressbar"
        aria-valuenow={Math.min(todayCount, goal)}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label="今日复习目标进度"
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-smooth',
            reached
              ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
              : 'bg-gradient-to-r from-amber-300 to-amber-400'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
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
