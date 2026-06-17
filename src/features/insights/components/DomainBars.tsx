'use client';

/**
 * 领域分布（V17）—— 轻量横向条形（CSS 宽度按占比，无依赖）。
 * 数据来自 /api/insights 的 domains [{domain,count}]（已按数量降序）。
 * 桌面/移动同形；超出 TOP_N 的领域合并为「其它」一条，避免列表过长。
 */

import { cn } from '@/components/ui';

export interface DomainCount {
  domain: string;
  count: number;
}

/** 最多单列展示的领域数；其余并入「其它」。 */
const TOP_N = 8;

// 与成长曲线/品牌一致的色阶（循环取色）。
const BAR_COLORS = [
  '#10b981',
  '#6366f1',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
];

export default function DomainBars({ domains }: { domains: DomainCount[] }) {
  if (domains.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-zinc-200 px-4 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
        还没有带领域的概念。记录更多内容后，小M 会自动归类出领域分布。
      </p>
    );
  }

  // 取前 TOP_N，其余合并为「其它」。
  const head = domains.slice(0, TOP_N);
  const rest = domains.slice(TOP_N);
  const restTotal = rest.reduce((s, d) => s + d.count, 0);
  const rows: DomainCount[] = restTotal > 0 ? [...head, { domain: '其它', count: restTotal }] : head;

  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="rounded-card border border-zinc-200/80 bg-white p-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <ul className="space-y-2.5">
        {rows.map((row, i) => {
          const pct = Math.max(4, Math.round((row.count / max) * 100));
          const color = row.domain === '其它' ? '#a1a1aa' : BAR_COLORS[i % BAR_COLORS.length];
          return (
            <li key={row.domain} className="flex items-center gap-2.5">
              <span
                className={cn(
                  'w-20 shrink-0 truncate text-right text-xs',
                  row.domain === '其它'
                    ? 'text-zinc-400'
                    : 'text-zinc-600 dark:text-zinc-300'
                )}
                title={row.domain}
              >
                {row.domain}
              </span>
              <span className="relative h-4 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <span
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </span>
              <span className="w-7 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {row.count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
