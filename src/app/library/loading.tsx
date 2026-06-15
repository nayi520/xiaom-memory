/**
 * 知识库加载骨架（路由段 Suspense fallback）。
 * /library 是 force-dynamic 服务端组件（查库 + 可能跑检索），导航/搜索时先以骨架占位。
 * 结构贴合 library/page.tsx：标题行 + 视图切换 + 搜索框 + 卡片网格。
 */
import { PageShell, SkeletonCard } from '@/components/ui';

export default function LibraryLoading() {
  return (
    <PageShell width="full">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 lg:mb-6">
        <div className="min-w-0">
          <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/70" />
          <div className="mt-2 h-4 w-64 max-w-full animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800/60" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-9 w-20 animate-pulse rounded-field bg-zinc-200/60 dark:bg-zinc-800/60" />
          <div className="h-9 w-24 animate-pulse rounded-field bg-zinc-200/60 dark:bg-zinc-800/60" />
        </div>
      </header>

      {/* 视图切换占位 */}
      <div className="mb-4 h-9 w-44 animate-pulse rounded-field bg-zinc-200/60 dark:bg-zinc-800/60" />
      {/* 搜索框占位 */}
      <div className="mb-5 h-12 w-full max-w-xl animate-pulse rounded-field bg-zinc-200/60 dark:bg-zinc-800/60" />

      <ul
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
        role="status"
        aria-busy
        aria-label="正在加载知识库"
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <li key={i}>
            <SkeletonCard className="h-[4.5rem]" />
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
