'use client';

/**
 * 路由级错误边界（V18 全局错误韧性）。
 *
 * Next App Router 约定：某路由段在渲染/数据读取中抛出未捕获异常时，自动以本组件替换该段内容，
 * 而不是整页白屏。仍在根 layout（含侧栏/底栏/Provider）之内，故用户能继续导航到其它页面。
 *
 * 提供两条出路：
 *  - 「重试」：调用 Next 注入的 reset()，就地重渲染该段（瞬时故障多半即可恢复）。
 *  - 「返回首页」：彻底换页，规避坏状态。
 *
 * 复用设计系统 PageShell + EmptyState，深浅色一致；开发态附错误摘要便于定位（生产不暴露堆栈）。
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, EmptyState, WarningIcon, HomeIcon } from '@/components/ui';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 留痕便于排查（含 server 端 digest）。不上报第三方，仅控制台。
    console.error('[route-error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-content flex-col items-center justify-center px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pt-12">
      <EmptyState
        icon={<WarningIcon aria-hidden className="h-7 w-7 text-amber-400" />}
        title="这个页面出了点问题"
        description="可能是临时的小故障。重试一下，或者先回首页。"
        action={
          <div className="flex items-center gap-2">
            <Button onClick={() => reset()}>重试</Button>
            <Link href="/">
              <Button variant="secondary">
                <HomeIcon aria-hidden className="h-4 w-4" />
                返回首页
              </Button>
            </Link>
          </div>
        }
      />
      {process.env.NODE_ENV !== 'production' && (
        <pre className="mt-6 max-w-full overflow-auto rounded-card border border-zinc-200/80 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
      )}
    </main>
  );
}
