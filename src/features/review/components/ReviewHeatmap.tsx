'use client';

/**
 * 复习热力图面板（V7 + V14 复习洞察）—— 年度贡献图 + 保留率 + 今日已复习 + 最易忘。
 *
 * 数据：挂载时 GET /api/review/stats（已鉴权 + userId 过滤）。
 *   - daily：近 365 天每天复习张数（已补全零值、升序），渲染成 GitHub 风格的周×日方格，
 *     按张数分 5 档深浅；hover/focus 有 title 提示「日期 · N 张」。
 *   - retentionRate / todayCount / totalReviews：上方三项指标卡。
 *   - mostForgotten（V14）：lapses 最高的概念 top N，列成「最易忘」清单（含概念名 + 忘记次数）。
 * 加载中骨架；失败友好降级（整块隐藏，不打扰）。深浅色与既有设计系统一致。
 */

import { useEffect, useMemo, useState } from 'react';
import { GoalIcon, TrendIcon, ReviewIcon, WarningIcon, cn } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface DailyCell {
  date: string;
  count: number;
}

interface ForgottenItem {
  conceptId?: string;
  name: string;
  lapses: number;
}

interface ReviewStats {
  daily: DailyCell[];
  retentionRate: number;
  todayCount: number;
  totalReviews: number;
  mostForgotten?: ForgottenItem[];
}

/** 张数 → 深浅档（0..4）。0 = 无复习的浅底；越多越深（品牌色阶）。 */
function levelOf(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

/** 各档色块（浅底 + 4 级品牌绿，深浅色各一套）。 */
const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-zinc-100 dark:bg-zinc-800',
  1: 'bg-emerald-200 dark:bg-emerald-900',
  2: 'bg-emerald-300 dark:bg-emerald-700',
  3: 'bg-emerald-400 dark:bg-emerald-600',
  4: 'bg-emerald-500 dark:bg-emerald-500',
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export default function ReviewHeatmap({ className }: { className?: string }) {
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/review/stats')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('stats');
        return data as ReviewStats;
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

  // 把 365 天（升序）切成「按周列」的网格：每列 7 格（周日→周六），首列前置空格对齐到星期。
  const weeks = useMemo(() => {
    if (!stats) return [];
    const cells = stats.daily;
    if (cells.length === 0) return [];
    // 首格是星期几（0=周日…6=周六）→ 前面补几个占位，使每列从周日开始。
    const firstDow = new Date(`${cells[0].date}T00:00:00.000Z`).getUTCDay();
    const padded: (DailyCell | null)[] = [
      ...Array.from({ length: firstDow }, () => null),
      ...cells,
    ];
    const cols: (DailyCell | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      cols.push(padded.slice(i, i + 7));
    }
    return cols;
  }, [stats]);

  // 加载失败：整块隐藏，不打扰（与首页 DashboardPanel 同策略）。
  if (error) return null;

  const loading = stats === null;

  return (
    <div className={cn('space-y-4', className)}>
      {/* 指标卡：今日已复习 / 保留率 / 累计复习 */}
      <div className="grid grid-cols-3 gap-2.5">
        <MetricCard
          icon={<ReviewIcon aria-hidden className="h-3.5 w-3.5 text-brand" />}
          label="今日已复习"
          value={loading ? '—' : String(stats.todayCount)}
          unit={loading ? undefined : '张'}
          loading={loading}
        />
        <MetricCard
          icon={<GoalIcon aria-hidden className="h-3.5 w-3.5 text-emerald-500" />}
          label="保留率"
          value={loading ? '—' : `${Math.round(stats.retentionRate * 100)}`}
          unit={loading ? undefined : '%'}
          hint="记得/轻松占比"
          loading={loading}
        />
        <MetricCard
          icon={<TrendIcon aria-hidden className="h-3.5 w-3.5 text-zinc-400" />}
          label="累计复习"
          value={loading ? '—' : String(stats.totalReviews)}
          unit={loading ? undefined : '张'}
          loading={loading}
        />
      </div>

      {/* 年度贡献图 */}
      <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">近一年复习</p>
          <Legend />
        </div>

        {loading ? (
          <div className="h-[112px] animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-[3px]">
              {/* 周几标签列（仅一/三/五，省空间） */}
              <div className="mr-1 flex shrink-0 flex-col gap-[3px] pt-0">
                {WEEKDAY_LABELS.map((d, i) => (
                  <span
                    key={d}
                    className="flex h-[11px] items-center text-[9px] leading-none text-zinc-400"
                  >
                    {i % 2 === 1 ? d : ''}
                  </span>
                ))}
              </div>
              {weeks.map((col, ci) => (
                <div key={ci} className="flex shrink-0 flex-col gap-[3px]">
                  {Array.from({ length: 7 }, (_, ri) => {
                    const cell = col[ri] ?? null;
                    if (!cell) {
                      return <span key={ri} className="h-[11px] w-[11px]" aria-hidden />;
                    }
                    const lvl = levelOf(cell.count);
                    return (
                      <span
                        key={ri}
                        title={`${cell.date} · ${cell.count} 张`}
                        className={cn('h-[11px] w-[11px] rounded-[2px]', LEVEL_CLASS[lvl])}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 最易忘（V14）：lapses 最高的概念 top N */}
      {!loading && (stats.mostForgotten?.length ?? 0) > 0 && (
        <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-1.5">
            <WarningIcon aria-hidden className="h-3.5 w-3.5 text-amber-500" />
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">最易忘</p>
          </div>
          <ul className="space-y-1.5">
            {stats.mostForgotten!.map((item, i) => (
              <li
                key={item.conceptId ?? `${item.name}-${i}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-zinc-300 dark:text-zinc-600">
                    {i + 1}
                  </span>
                  <span className="truncate text-zinc-700 dark:text-zinc-200">{item.name}</span>
                </span>
                <span className="shrink-0 rounded-pill bg-amber-50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  忘 {item.lapses} 次
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 指标小卡。 */
function MetricCard({
  icon,
  label,
  value,
  unit,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-3 py-3.5 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-center gap-1 text-[11px] text-zinc-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-0.5">
        <span
          className={cn(
            'text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50',
            loading && 'animate-pulse text-zinc-300 dark:text-zinc-700'
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-zinc-400">{unit}</span>}
      </div>
      {hint && (
        <div className="mt-px text-[10px] text-zinc-300 dark:text-zinc-600">{hint}</div>
      )}
    </div>
  );
}

/** 深浅档图例（少 → 多）。 */
function Legend() {
  return (
    <div className="flex items-center gap-1 text-[10px] text-zinc-400">
      <span>少</span>
      {([0, 1, 2, 3, 4] as const).map((lvl) => (
        <span key={lvl} className={cn('h-[10px] w-[10px] rounded-[2px]', LEVEL_CLASS[lvl])} />
      ))}
      <span>多</span>
    </div>
  );
}
