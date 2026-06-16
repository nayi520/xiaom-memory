/**
 * 概念详情加载骨架（路由段 Suspense fallback）。
 * /library/concept/[id] 是 force-dynamic 服务端组件（查概念 + 关联 + 记录），先以骨架占位。
 */
import { PageShell, Skeleton, SkeletonText, SkeletonCard } from '@/components/ui';

export default function ConceptDetailLoading() {
  return (
    <PageShell width="reading">
      <div role="status" aria-busy aria-label="正在加载概念" className="animate-fade-in">
        <Skeleton className="mb-4 h-4 w-32" />
        <Skeleton className="h-7 w-1/2" />
        <div className="mt-4">
          <SkeletonText lines={3} />
        </div>
        <Skeleton className="mt-6 h-3 w-24" />
        <div className="mt-2.5 space-y-2.5">
          <SkeletonCard className="h-16" />
          <SkeletonCard className="h-16" />
        </div>
      </div>
    </PageShell>
  );
}
