'use client';

/**
 * 设置页「数据统计」面板（V4）。
 * 挂载时 GET /api/stats（已鉴权 + userId 过滤）展示：记录 / 概念 / 卡片 / 今日到期 四项计数。
 * 加载中显示骨架；失败友好降级、不崩溃。纯展示，无写操作。
 */

import { useEffect, useState } from 'react';
import { cn } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface Stats {
  noteCount: number;
  conceptCount: number;
  cardCount: number;
  dueCount: number;
}

const ITEMS: { key: keyof Stats; label: string }[] = [
  { key: 'noteCount', label: '记录' },
  { key: 'conceptCount', label: '概念' },
  { key: 'cardCount', label: '卡片' },
  { key: 'dueCount', label: '今日到期' },
];

export default function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/stats')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `加载失败（${res.status}）`);
        return data as Stats;
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '网络错误');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-zinc-400">统计加载失败：{error}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {ITEMS.map((item) => (
        <div
          key={item.key}
          className="rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-center shadow-card dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div
            className={cn(
              'text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50',
              stats === null && 'animate-pulse text-zinc-300 dark:text-zinc-700'
            )}
          >
            {stats === null ? '—' : stats[item.key]}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
