/**
 * 复习加载骨架（路由段 Suspense fallback）。
 * /review 是 force-dynamic 服务端组件（查队列 + 今日进度），导航时先以骨架占位，
 * 结构贴合复习会话：进度条 + 问题卡 + 四档评分按钮。
 */
import { PageShell, Skeleton, SkeletonText } from '@/components/ui';

export default function ReviewLoading() {
  return (
    <PageShell>
      <div role="status" aria-busy aria-label="正在加载复习" className="animate-fade-in">
        {/* 进度条 + 计数 */}
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>

        {/* 问题卡 */}
        <div className="rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-3 w-16" />
          <div className="mt-4">
            <SkeletonText lines={2} />
          </div>
          <Skeleton className="mt-8 h-9 w-full rounded-field" />
        </div>

        {/* 四档评分占位 */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-field" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
