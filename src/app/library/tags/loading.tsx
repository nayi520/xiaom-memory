/**
 * 标签管理加载骨架（路由段 Suspense fallback）。
 * /library/tags 是 force-dynamic 服务端组件（按 user_id 取标签 + 计数），导航时先以骨架占位。
 */
import { PageShell, Skeleton } from '@/components/ui';

export default function TagsManageLoading() {
  return (
    <PageShell width="wide">
      <div role="status" aria-busy aria-label="正在加载标签管理" className="animate-fade-in">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <Skeleton className="mb-4 h-10 w-full rounded-field" />
        <ul className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Skeleton className="h-5 w-5 rounded-md" />
              <Skeleton className="h-4 flex-1 max-w-[10rem]" />
              <Skeleton className="h-4 w-12" />
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
