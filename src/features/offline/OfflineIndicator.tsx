'use client';

/**
 * 离线 / 待同步状态指示（V10）——一个低调的浮动小条：
 *  - 离线时：显示「离线 · 已存本地」，让用户知道捕获不会丢。
 *  - 在线但有待同步项：显示「N 条待同步」+「立即同步」，可手动触发。
 *  - 有失败项：提示「N 条同步失败」，点「重试」全部重发。
 *  - 全清空且在线：不显示（不打扰）。
 *
 * 位于底部导航之上、安全区之内，移动端居中、桌面端靠左下，避免遮挡主操作。
 */

import { useEffect, useState } from 'react';
import { useOffline } from './OfflineProvider';
import { listOutbox, retryItem } from './queue';
import { cn } from '@/components/ui';

export default function OfflineIndicator() {
  const { online, snapshot, sync } = useOffline();
  const { pending, failed } = snapshot;
  const [retrying, setRetrying] = useState(false);

  // 失败重试：把所有 failed 项重置并重发。
  async function retryAll() {
    if (retrying) return;
    setRetrying(true);
    try {
      const items = await listOutbox();
      await Promise.all(items.filter((i) => i.status === 'failed').map((i) => retryItem(i.clientId)));
    } finally {
      setRetrying(false);
    }
  }

  const show = !online || pending > 0 || failed > 0;
  // 避免 SSR/CSR 文案闪动：挂载后再渲染（online 初值在 effect 里校正）。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+4.75rem))]',
        'sm:inset-x-auto sm:left-6 sm:justify-start sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]'
      )}
    >
      <div
        className={cn(
          'glass motion-safe:animate-fade-in-up pointer-events-auto flex items-center gap-2 rounded-pill border px-3 py-1.5 text-xs shadow-pop ring-1 ring-black/[0.02]',
          !online
            ? 'border-zinc-300/70 text-zinc-600 dark:border-zinc-600/70 dark:text-zinc-300'
            : failed > 0
              ? 'border-red-300/70 text-red-600 dark:border-red-900/70 dark:text-red-400'
              : 'border-sky-300/70 text-sky-600 dark:border-sky-900/70 dark:text-sky-400'
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            !online
              ? 'bg-zinc-400'
              : failed > 0
                ? 'bg-red-500'
                : 'animate-pulse bg-sky-500'
          )}
        />
        {!online ? (
          <span>{pending > 0 ? `离线 · ${pending} 条已存本地` : '离线 · 已存本地'}</span>
        ) : failed > 0 ? (
          <>
            <span>{failed} 条同步失败</span>
            <button
              type="button"
              onClick={retryAll}
              disabled={retrying}
              className="ml-0.5 rounded-pill px-1.5 py-0.5 font-medium underline-offset-2 hover:underline disabled:opacity-50"
            >
              {retrying ? '重试中…' : '重试'}
            </button>
          </>
        ) : (
          <>
            <span>{pending} 条待同步</span>
            <button
              type="button"
              onClick={sync}
              className="ml-0.5 rounded-pill px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
            >
              立即同步
            </button>
          </>
        )}
      </div>
    </div>
  );
}
