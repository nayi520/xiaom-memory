/**
 * 骨架屏占位（.skeleton 在 globals.css 定义流光动画）。
 * 用于列表/卡片加载态，替代「…」纯文字 loading，观感更稳。
 */
import { cn } from './cn';

export default function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/** 列表项骨架：模拟「图标 + 两行文字」的记录卡片。 */
export function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 rounded-card border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
      <div className="flex-1 space-y-2 py-0.5">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}
