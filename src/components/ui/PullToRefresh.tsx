'use client';

/**
 * 下拉刷新容器（移动端，V19）——包住列表，在顶部渲染刷新指示器。
 *
 * 仅在触摸屏上生效（手势由 usePullToRefresh 内部判定粗指针）；桌面下指示器始终隐藏、
 * 无监听，故桌面无影响。内容整体随下拉量轻微下移，给「把列表拽下来」的物理感。
 */

import { usePullToRefresh } from '@/components/usePullToRefresh';
import { SpinnerIcon, ArrowDownIcon } from './icons';
import { cn } from './cn';

export default function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
}) {
  const { pull, progress, refreshing } = usePullToRefresh(onRefresh);
  const active = pull > 0 || refreshing;

  return (
    <div className={cn('relative', className)}>
      {/* 指示器：随下拉量从顶部探出。 */}
      <div
        aria-hidden={!active}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ transform: `translateY(${Math.max(0, pull - 28)}px)`, opacity: active ? 1 : 0 }}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/80 bg-white shadow-card dark:border-zinc-700 dark:bg-zinc-900">
          {refreshing ? (
            <SpinnerIcon aria-hidden className="h-4 w-4 animate-spin text-brand" />
          ) : (
            <ArrowDownIcon
              aria-hidden
              className="h-4 w-4 text-brand transition-transform"
              style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)` }}
            />
          )}
        </span>
      </div>

      {/* 内容随下拉轻微下移（刷新中保持一点位移，给「正在加载」的留白）。 */}
      <div
        className={cn(pull === 0 && !refreshing && 'transition-transform duration-200 ease-smooth motion-reduce:transition-none')}
        style={{ transform: `translateY(${refreshing ? 24 : pull * 0.4}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
