'use client';

/**
 * 成就徽章墙（V17）—— 据 /api/insights 的 achievements 渲染，纯派生无存储。
 * 每枚徽章一个进度环（内联 SVG circle，无依赖）：已得高亮品牌色，未得灰显 + 进度环显示完成度。
 * 已得徽章排在前面；未得按进度从高到低，引导用户「再努力一点就能解锁」。
 */

import { cn } from '@/components/ui';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  achieved: boolean;
  progress?: number;
}

export default function AchievementGrid({
  achievements,
}: {
  achievements: Achievement[];
}) {
  if (achievements.length === 0) return null;

  const got = achievements.filter((a) => a.achieved).length;
  // 已得在前；未得按进度降序。
  const sorted = [...achievements].sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? -1 : 1;
    return (b.progress ?? 0) - (a.progress ?? 0);
  });

  return (
    <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">成就徽章</p>
        <span className="text-xs tabular-nums text-zinc-400">
          已解锁 {got} / {achievements.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {sorted.map((a) => (
          <BadgeCell key={a.id} achievement={a} />
        ))}
      </div>
    </div>
  );
}

/** 单枚徽章：进度环 + 名称 + 说明。 */
function BadgeCell({ achievement }: { achievement: Achievement }) {
  const progress = achievement.achieved ? 1 : Math.max(0, Math.min(1, achievement.progress ?? 0));
  const pct = Math.round(progress * 100);

  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-card border px-2 py-3 text-center transition',
        achievement.achieved
          ? 'border-brand/20 bg-brand-light/60 dark:border-brand/25 dark:bg-brand/[0.08]'
          : 'border-zinc-200/70 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900'
      )}
      title={achievement.desc}
    >
      <ProgressRing progress={progress} achieved={achievement.achieved} />
      <span
        className={cn(
          'mt-2 truncate text-xs font-semibold',
          achievement.achieved
            ? 'text-brand dark:text-brand-100'
            : 'text-zinc-500 dark:text-zinc-400'
        )}
      >
        {achievement.name}
      </span>
      <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-zinc-400">
        {achievement.desc}
      </span>
      {!achievement.achieved && (
        <span className="mt-1 text-[10px] tabular-nums text-zinc-300 dark:text-zinc-600">
          {pct}%
        </span>
      )}
    </div>
  );
}

/** 进度环（内联 SVG）：已得显示对勾、满环；未得显示进度弧。 */
function ProgressRing({ progress, achieved }: { progress: number; achieved: boolean }) {
  const size = 44;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (achieved ? 1 : progress);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* 底环 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        className="stroke-zinc-200 dark:stroke-zinc-700"
      />
      {/* 进度弧（从 12 点方向起，顺时针） */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        stroke={achieved ? '#10b981' : '#a1a1aa'}
        strokeDasharray={`${dash.toFixed(2)} ${c.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* 中心：已得显示对勾，未得显示百分比省略（外层已显示） */}
      {achieved ? (
        <path
          d={`M ${size / 2 - 6} ${size / 2} l 4 4 l 8 -9`}
          fill="none"
          stroke="#10b981"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <text
          x={size / 2}
          y={size / 2 + 3}
          textAnchor="middle"
          className="fill-zinc-400 text-[10px] font-semibold tabular-nums"
        >
          {Math.round(progress * 100)}
        </text>
      )}
    </svg>
  );
}
