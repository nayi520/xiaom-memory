'use client';

/**
 * 全局底部导航（移动优先，单手可达）：记录 / 复习 / 知识库 / 设置
 * 复习 tab 带今日到期 badge（原 header 复习入口整合至此）。
 * /login、/auth 不显示。
 *
 * 视觉升级：玻璃拟态底栏 + 顶部细分隔；选中项有品牌色指示条 + 图标抬升；
 * 桌面端 hover 反馈；图标用内联 SVG（线性风格，比 emoji 更精致统一）。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';

type IconProps = { active: boolean };

function PencilIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <path
        d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.8}
        strokeLinejoin="round"
      />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinejoin="round" />
    </svg>
  );
}

function LibraryIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <path
        d="M5 4h3v16H5zM10 4h3v16h-3zM16.2 4.4l2.9.8-3.2 14.6-2.9-.8 3.2-14.6Z"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

const TABS = [
  { href: '/', label: '记录', Icon: PencilIcon },
  { href: '/review', label: '复习', Icon: BookIcon },
  { href: '/library', label: '知识库', Icon: LibraryIcon },
  { href: '/settings', label: '设置', Icon: SettingsIcon },
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
                <Icon active={active} />
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
