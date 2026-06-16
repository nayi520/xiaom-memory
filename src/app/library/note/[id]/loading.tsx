/**
 * 记录详情加载骨架（路由段 Suspense fallback）。
 * /library/note/[id] 是 force-dynamic 服务端组件（查记录 + 概念 + 标签），先以骨架占位。
 */
import { PageShell, Skeleton, SkeletonText, SkeletonCard } from '@/components/ui';

export default function NoteDetailLoading() {
  return (
    <PageShell width="reading">
      <div role="status" aria-busy aria-label="正在加载记录" className="animate-fade-in">
        <Skeleton className="mb-4 h-4 w-32" />
        {/* 正文卡 */}
        <div className="rounded-card border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-3 w-40" />
          <div className="mt-4">
            <SkeletonText lines={4} />
          </div>
        </div>
        {/* AI 摘要卡 */}
        <SkeletonCard className="mt-4 h-24" />
        {/* 标签 / 概念 */}
        <Skeleton className="mt-6 h-3 w-16" />
        <div className="mt-2 flex gap-2">
          <Skeleton className="h-7 w-16 rounded-pill" />
          <Skeleton className="h-7 w-20 rounded-pill" />
        </div>
      </div>
    </PageShell>
  );
}
