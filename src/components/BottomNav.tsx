'use client';

/**
 * 全局底部导航（移动优先，单手可达）：记录 / 复习 / 知识库 / 设置
 * 复习 tab 带今日到期 badge（原 header 复习入口整合至此）。
 * /login、/auth 不显示。
 *
 * 视觉升级：玻璃拟态底栏 + 顶部细分隔；选中项有品牌色指示条 + 图标抬升；
 * 桌面端 hover 反馈；图标统一用 lucide（线性风格，与全站一致），选中时加粗描边。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pencil, BookOpenCheck, Library, Settings } from 'lucide-react';
import type { LucideIcon } from '@/components/ui';
import { cn } from '@/components/ui/cn';

const TABS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/', label: '记录', Icon: Pencil },
  { href: '/review', label: '复习', Icon: BookOpenCheck },
  { href: '/library', label: '知识库', Icon: Library },
  { href: '/settings', label: '设置', Icon: Settings },
];

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
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/70 dark:border-zinc-800/70"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex flex-1 flex-col items-center gap-1 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-[11px] font-medium transition-colors duration-150',
                active
                  ? 'text-brand'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              {/* 选中指示条 */}
              <span
                className={cn(
                  'absolute top-0 h-0.5 w-8 rounded-full bg-brand transition-all duration-200 ease-smooth',
                  active ? 'opacity-100' : 'opacity-0'
                )}
              />
              <span
                className={cn(
                  'relative transition-transform duration-200 ease-smooth',
                  active ? '-translate-y-0.5' : 'group-active:scale-90'
                )}
              >
                <Icon
                  aria-hidden
                  className="h-[22px] w-[22px]"
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {href === '/review' && due > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-brand px-1 py-px text-[9px] font-bold leading-none text-white shadow-sm ring-2 ring-white dark:ring-zinc-900">
                    {due > 99 ? '99+' : due}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
