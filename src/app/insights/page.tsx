/**
 * 知识成长洞察页（V17 收官）
 *
 * 一处汇总成长全景：总览 + 成长曲线（内联 SVG，30/90 天）+ 领域分布 + 成就徽章
 * + 复习热力（复用 V7/V14）+ 知识体检（/api/checkup）。
 * 取数走 /api/insights、/api/checkup、/api/review/stats（均已鉴权 + userId 过滤）。
 * 入口：桌面侧栏「洞察」、首页概览的「查看成长洞察」、设置页统计区。
 */

import Link from 'next/link';
import { InsightsView } from '@/features/insights';
import { PageShell, ChevronRight } from '@/components/ui';

export const metadata = { title: '洞察 · 小M' };

export default function InsightsPage() {
  return (
    <PageShell width="wide">
      <header className="mb-6 flex items-start justify-between gap-3 lg:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 lg:text-3xl dark:text-zinc-50">
            洞察
          </h1>
          <p className="mt-1 text-sm text-zinc-400">你的知识成长与体检</p>
        </div>
        <Link
          href="/settings"
          className="inline-flex shrink-0 items-center gap-1 rounded-field border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          设置
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </header>

      <InsightsView />
    </PageShell>
  );
}
