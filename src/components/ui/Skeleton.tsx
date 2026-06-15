/**
 * 骨架屏占位（.skeleton 在 globals.css 定义流光动画）。
 * 用于列表/卡片加载态，替代「…」纯文字 loading / 裸 spinner，观感更稳、无布局跳动。
 *
 * 提供一组与设计系统对齐的常用骨架：
 *  - <Skeleton/>        原子占位块（任意尺寸，自带流光）。
 *  - <SkeletonRow/>     「图标 + 两行文字」的记录卡片骨架。
 *  - <SkeletonCard/>    带边框/圆角的卡片容器骨架（高度可定）。
 *  - <SkeletonText/>    多行文本骨架（末行自动短一截，更像真实段落）。
 *  - <SkeletonStat/>    小计数卡骨架（DashboardPanel 概览用）。
 *  - <SkeletonList/>    用 SkeletonRow 铺 n 条的列表骨架（grid 可定列数）。
 *
 * a11y：骨架仅作视觉占位，统一 aria-hidden；语义「加载中」由外层容器
 *       （StatusView / 区块 aria-busy）承载，避免读屏逐块播报。
 */
import { cn } from './cn';

export default function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/** 卡片外壳骨架：与 cardClass 同样的边框/圆角/深浅色，内部留白由 className 控高。 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-card border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900',
        className
      )}
    />
  );
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

/** 多行文本骨架：默认 3 行，末行短一截更像真实段落。 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3.5', i === lines - 1 ? 'w-2/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

/** 小计数卡骨架（概览三宫格 / 双宫格用）。 */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex flex-col items-center rounded-card border border-zinc-200/80 bg-white px-2 py-3.5 dark:border-zinc-800 dark:bg-zinc-900',
        className
      )}
    >
      <Skeleton className="h-4 w-4 rounded-md" />
      <Skeleton className="mt-2 h-5 w-8" />
      <Skeleton className="mt-1.5 h-2.5 w-10" />
    </div>
  );
}

/** 用 SkeletonRow 铺 count 条的列表骨架（grid 列数可定，默认单列）。 */
export function SkeletonList({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ul aria-hidden className={cn('grid grid-cols-1 gap-2.5', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <SkeletonRow />
        </li>
      ))}
    </ul>
  );
}
