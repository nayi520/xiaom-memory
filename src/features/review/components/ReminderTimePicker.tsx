'use client';

/**
 * 复习提醒时间选择器（F3.2）：设置 profiles.settings.reminderHour（0–23 北京整点）。
 * cron/remind 每整点运行，仅给「reminderHour == 当前北京小时」的用户推送。
 * 进入时拉取当前值；改动即 PATCH /api/settings 保存。未登录/网络异常优雅提示。
 */

import { useEffect, useState } from 'react';
import { cn } from '@/components/ui';

/** 缺省提醒小时（北京时间 8 点），与后端保持一致。 */
const DEFAULT_REMINDER_HOUR = 8;

/** 把整点格式化为「HH:00」展示（北京时间）。 */
function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export default function ReminderTimePicker() {
  const [hour, setHour] = useState<number>(DEFAULT_REMINDER_HOUR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { settings?: { reminderHour?: number } };
        if (cancelled) return;
        const h = data.settings?.reminderHour;
        if (typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23) {
          setHour(h);
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
    const prev = hour;
    setHour(next);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reminderHour: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `保存失败（${res.status}）`);
      }
      setMessage('已保存');
    } catch (err) {
      setHour(prev); // 回滚到改动前的值
      setMessage(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <p className="font-medium text-zinc-800 dark:text-zinc-100">提醒时间</p>
        <p className="mt-0.5 text-xs text-zinc-400">
          每天 {formatHour(hour)}（北京时间）有到期卡片时推送。
        </p>
        {message && (
          <p
            className={cn(
              'mt-1 text-xs',
              message === '已保存' ? 'text-emerald-500' : 'text-red-500'
            )}
          >
            {message === '已保存' ? '✓ 已保存' : message}
          </p>
        )}
      </div>
      <label className="relative shrink-0">
        <span className="sr-only">复习提醒时间</span>
        <select
          value={hour}
          disabled={loading || saving}
          onChange={(e) => onChange(Number(e.target.value))}
          className="appearance-none rounded-field border border-zinc-300 bg-white py-2 pl-3.5 pr-9 text-base font-medium tabular-nums shadow-sm outline-none transition hover:border-zinc-400 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {formatHour(h)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-400" aria-hidden>
          ▾
        </span>
      </label>
    </div>
  );
}
