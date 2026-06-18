'use client';

/**
 * 搜索无结果态（V22）—— 在统一空状态基础上补：重置筛选/类型入口 + 最近搜索快捷重试。
 *
 * 客户端组件：最近搜索来自 localStorage（readRecentSearches），点一下即跳回该查询。
 * 当前查询会从最近列表中排除（避免「再搜一次自己」）。空列表时不渲染该区块。
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui';
import { readRecentSearches } from '../recent-searches';

export default function SearchNoResults({
  q,
  art,
  title,
  description,
  resetTypeHref,
  resetFilterHref,
}: {
  q: string;
  art?: React.ReactNode;
  title: string;
  description: string;
  /** 「类型」筛选下无结果：给一个切回全部类型的链接。 */
  resetTypeHref?: string;
  /** 领域/标签筛选下无结果：给一个清空领域+标签的链接。 */
  resetFilterHref?: string;
}) {
  const [recent, setRecent] = useState<string[]>([]);

  // 挂载后读最近搜索（排除当前查询），避免 SSR/CSR 文本不一致。
  useEffect(() => {
    setRecent(readRecentSearches().filter((x) => x !== q.trim()));
  }, [q]);

  const action =
    resetTypeHref || resetFilterHref ? (
      <Link
        href={(resetTypeHref ?? resetFilterHref)!}
        className="inline-flex items-center justify-center rounded-field border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-brand hover:text-brand focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {resetTypeHref ? '查看全部类型' : '清除筛选条件'}
      </Link>
    ) : undefined;

  return (
    <div>
      <EmptyState art={art} title={title} description={description} action={action} />

      {recent.length > 0 && (
        <div className="mx-auto mt-2 max-w-md">
          <p className="mb-2 text-center text-xs font-medium text-zinc-400">最近搜过</p>
          <ul className="flex flex-wrap justify-center gap-1.5">
            {recent.map((r) => (
              <li key={r}>
                <Link
                  href={`/library?q=${encodeURIComponent(r)}`}
                  className="inline-flex max-w-[14rem] items-center rounded-pill border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 shadow-sm transition hover:border-brand hover:text-brand focus-visible:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <span className="truncate">{r}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
