'use client';

/**
 * 全局底部导航（移动优先，单手可达）：记录 / 复习 / 知识库 / 设置
 * 复习 tab 带今日到期 badge（原 header 复习入口整合至此）。
 * /login、/auth 不显示。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const TABS = [
  { href: '/', label: '记录', icon: '✏️' },
  { href: '/review', label: '复习', icon: '📖' },
  { href: '/library', label: '知识库', icon: '📚' },
  { href: '/settings', label: '设置', icon: '⚙️' },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const hidden = pathname.startsWith('/login') || pathname.startsWith('/auth');
  const [due, setDue] = useState(0);

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    fetch('/api/review/due')
      .then((res) => (res.ok ? res.json() : { due: 0 }))
      .then((data: { due?: number }) => {
        if (!cancelled && typeof data.due === 'number') setDue(data.due);
      })
      .catch(() => {
        /* 网络错误：badge 维持 0，不打扰 */
      });
    return () => {
      cancelled = true;
    };
  }, [hidden, pathname]);

  if (hidden) return null;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90"
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive(t.href) ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-xs transition ${
              isActive(t.href)
                ? 'font-semibold text-brand'
                : 'text-zinc-400 active:text-zinc-600'
            }`}
          >
            <span className="relative text-lg leading-none">
              {t.icon}
              {t.href === '/review' && due > 0 && (
                <span className="absolute -right-3.5 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-brand px-1 py-0.5 text-[9px] font-semibold leading-none text-white">
                  {due > 99 ? '99+' : due}
                </span>
              )}
            </span>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
