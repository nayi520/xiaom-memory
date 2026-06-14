/**
 * 时间线（V4 留存）
 * 按时间倒序浏览全部未删记录，游标分页「加载更多」。
 * 取数走 /api/notes/timeline（已做鉴权 + userId 过滤）；正文用设计系统 Markdown 渲染。
 * 入口：知识库页右上「时间线」。
 */

import Link from 'next/link';
import TimelineFeed from '@/features/timeline/components/TimelineFeed';
import { PageShell } from '@/components/ui';

export const metadata = { title: '时间线 · 小M' };

export default function TimelinePage() {
  return (
    <PageShell width="wide">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            时间线
          </h1>
          <p className="mt-1 text-sm text-zinc-400">所有记录，按时间倒序</p>
        </div>
        <Link
          href="/library"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-field border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        >
          知识库
        </Link>
      </header>

      <TimelineFeed />
    </PageShell>
  );
}
