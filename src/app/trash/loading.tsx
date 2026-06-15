/**
 * 回收站加载骨架（路由段 Suspense fallback）。
 * /trash 是 force-dynamic 服务端组件（查软删记录），导航时先以骨架占位。
 */
import { PageShell, SkeletonCard } from '@/components/ui';

export default function TrashLoading() {
  return (
    <PageShell width="wide">
      <div className="mb-4 h-4 w-28 animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800/60" />
      <header className="mb-5 lg:mb-7">
        <div className="h-8 w-24 animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800/60" />
      </header>
      <ul
        className="grid grid-cols-1 gap-2.5 xl:grid-cols-2"
        role="status"
        aria-busy
        aria-label="正在加载回收站"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i}>
            <SkeletonCard className="h-[5.5rem]" />
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
