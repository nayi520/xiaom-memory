/**
 * 行动项加载骨架（路由段 Suspense fallback）。
 * /todos 是 force-dynamic 服务端组件（跨记录解析待办 + 完成态），导航时先以骨架占位。
 */
import { PageShell, Skeleton } from '@/components/ui';

export default function TodosLoading() {
  return (
    <PageShell width="wide">
      <div role="status" aria-busy aria-label="正在加载行动项" className="animate-fade-in">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="mb-3 h-4 w-16" />
        <ul className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-card border border-zinc-200/80 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Skeleton className="mt-0.5 h-5 w-5 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
