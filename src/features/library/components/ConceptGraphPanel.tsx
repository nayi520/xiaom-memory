'use client';

/**
 * 知识图谱面板（V8）—— 客户端取数 + 图例 + 状态处理，内嵌 client-only 画布。
 *
 * 画布组件用 dynamic(() => import('./ConceptGraph'), { ssr:false }) 加载，
 * 确保 canvas / requestAnimationFrame 仅在浏览器执行，规避 SSR 报错（任务硬性要求）。
 *
 * 取数：GET /api/library/graph → { nodes, links, truncated, totalNodes }。
 * 领域 → 颜色由本面板统一分配（稳定调色板 + 哈希兜底），图例与画布共用同一 colorOf。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LibraryGraph } from '../graph';
import {
  EmptyState,
  LibraryIcon,
  SpinnerIcon,
  Skeleton,
  SkeletonCard,
  cn,
} from '@/components/ui';

// 画布 client-only：禁用 SSR，加载期给占位（避免布局跳动）。
const ConceptGraph = dynamic(() => import('./ConceptGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] min-h-[360px] w-full items-center justify-center rounded-card border border-zinc-200/80 bg-zinc-50/60 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40">
      <SpinnerIcon aria-hidden className="mr-2 h-4 w-4 animate-spin" />
      正在加载图谱…
    </div>
  ),
});

const UNCATEGORIZED = '未分类';

/** 领域调色板（与设计系统色相协调；超出走哈希兜底色）。 */
const PALETTE = [
  '#6366f1', // indigo (brand-ish)
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ef4444', // red
  '#84cc16', // lime
  '#f97316', // orange
];
const FALLBACK_COLOR = '#a1a1aa'; // zinc-400

/** 字符串 → 稳定 HSL 颜色（调色板用尽时的兜底）。 */
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 62% 58%)`;
}

export default function ConceptGraphPanel() {
  const [graph, setGraph] = useState<LibraryGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch('/api/library/graph')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `加载失败（${res.status}）`);
        }
        return res.json() as Promise<LibraryGraph>;
      })
      .then((data) => {
        if (alive) setGraph(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : '网络错误');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 领域 → 颜色映射（按出现顺序分配调色板，未分类固定灰）。
  const domainColors = useMemo(() => {
    const map = new Map<string, string>();
    if (!graph) return map;
    const seen: string[] = [];
    for (const n of graph.nodes) {
      const d = n.domain?.trim() || UNCATEGORIZED;
      if (!map.has(d)) {
        seen.push(d);
        if (d === UNCATEGORIZED) {
          map.set(d, FALLBACK_COLOR);
        } else {
          const idx = seen.filter((x) => x !== UNCATEGORIZED).length - 1;
          map.set(d, idx < PALETTE.length ? PALETTE[idx] : hashColor(d));
        }
      }
    }
    return map;
  }, [graph]);

  const colorOf = useCallback(
    (domain: string | null) => domainColors.get(domain?.trim() || UNCATEGORIZED) ?? FALLBACK_COLOR,
    [domainColors]
  );

  // 图例项（按节点数降序，最多展示若干，其余折叠为「其他」）。
  const legend = useMemo(() => {
    if (!graph) return [];
    const counts = new Map<string, number>();
    for (const n of graph.nodes) {
      const d = n.domain?.trim() || UNCATEGORIZED;
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: colorOf(name) }));
  }, [graph, colorOf]);

  if (loading && !graph) {
    // 取数态用骨架占位（统计行 + 图例 + 画布占位），与就绪结构同构、无布局跳动。
    return (
      <section className="space-y-3" role="status" aria-busy aria-label="正在加载图谱">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
        <SkeletonCard className="h-[60vh] min-h-[360px] w-full" />
      </section>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<LibraryIcon aria-hidden className="h-7 w-7" />}
        title="图谱加载失败"
        description={error}
      />
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={<LibraryIcon aria-hidden className="h-7 w-7" />}
        title="还没有概念可成图"
        description="先去记点东西，AI 整理出概念与关联后，这里会展示它们的关系网络。"
      />
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <p>
          <span className="font-medium text-zinc-700 dark:text-zinc-200">{graph.nodes.length}</span> 个概念
          <span className="mx-1">·</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-200">{graph.links.length}</span> 条关联
        </p>
        {graph.truncated && (
          <p className="rounded-pill bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            概念较多，仅展示卡片数最多的 {graph.nodes.length} / {graph.totalNodes} 个
          </p>
        )}
      </div>

      {/* 领域图例 */}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {legend.map((d) => (
            <span
              key={d.name}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"
            >
              <span
                aria-hidden
                className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full')}
                style={{ backgroundColor: d.color }}
              />
              <span className="truncate">{d.name}</span>
              <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{d.count}</span>
            </span>
          ))}
        </div>
      )}

      <ConceptGraph nodes={graph.nodes} links={graph.links} colorOf={colorOf} />
    </section>
  );
}
