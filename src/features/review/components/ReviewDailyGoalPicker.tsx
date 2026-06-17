'use client';

/**
 * 每日复习目标选择器（V7）：设置 profiles.settings.reviewDailyGoal（每日复习目标张数，1–100）。
 * 复习页 / 首页据此显示「今日已复习 / 目标」进度。
 * 进入时拉取当前值；改动即 PATCH /api/settings 保存（与 reminderHour 共用端点、互不覆盖）。
 * 未登录 / 网络异常优雅提示并回滚。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, GoalIcon, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';

/** 缺省每日目标（张），与后端 DEFAULT_REVIEW_DAILY_GOAL 一致。 */
const DEFAULT_GOAL = 10;
/** 下拉可选目标档位（张）。 */
const GOAL_OPTIONS = [5, 10, 15, 20, 30, 50];

export default function ReviewDailyGoalPicker() {
  const { success, error: toastError } = useToast();
  const [goal, setGoal] = useState<number>(DEFAULT_GOAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch('/api/settings');
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { settings?: { reviewDailyGoal?: number } };
        if (cancelled) return;
        const g = data.settings?.reviewDailyGoal;
        if (typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= 100) {
          setGoal(g);
        }
      } catch {
        // 拉取失败：保留缺省值，不阻塞用户改设置。
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onChange(next: number) {
    const prev = goal;
    setGoal(next);
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewDailyGoal: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      success(`每日目标已设为 ${next} 张`);
    } catch (err) {
      setGoal(prev); // 回滚到改动前的值
      toastError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  // 当前值若不在预设档位中（如旧数据），临时并入下拉，避免选中项丢失。
  const options = GOAL_OPTIONS.includes(goal)
    ? GOAL_OPTIONS
    : [...GOAL_OPTIONS, goal].sort((a, b) => a - b);

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-100">
          <GoalIcon aria-hidden className="h-4 w-4 text-emerald-500" />
          每日复习目标
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          复习页与首页会显示「今日已复习 / 目标」进度。
        </p>
      </div>
      <label className="relative shrink-0">
        <span className="sr-only">每日复习目标张数</span>
        <select
          value={goal}
          disabled={loading || saving}
          onChange={(e) => onChange(Number(e.target.value))}
          className="appearance-none rounded-field border border-zinc-300 bg-white py-2 pl-3.5 pr-9 text-base font-medium tabular-nums shadow-sm outline-none transition hover:border-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          {options.map((g) => (
            <option key={g} value={g}>
              {g} 张
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-zinc-400"
        />
      </label>
    </div>
  );
}
