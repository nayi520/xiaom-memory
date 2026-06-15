/**
 * 时间线加载骨架（路由段 Suspense fallback）。
 * /timeline 是 force-dynamic 服务端组件（查库），导航时先以骨架占位，
 * 避免「白屏 / 卡住」观感，结构与 timeline/page.tsx 一致（标题 + 双列卡片）。
 */
import { PageShell, SkeletonCard } from '@/components/ui';

export default function TimelineLoading() {
  return (
    <PageShell width="wide">
      <header className="mb-5 lg:mb-7">
        <div className="h-8 w-28 animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="mt-2 h-4 w-40 animate-pulse rounded bg-zinc-200/60 dark:bg-zinc-800/60" />
      </header>
      <ul
        className="grid grid-cols-1 gap-2.5 xl:grid-cols-2"
        role="status"
        aria-busy
        aria-label="正在加载时间线"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i}>
            <SkeletonCard className="h-20" />
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
