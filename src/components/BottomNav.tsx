'use client';

/**
 * 全局底部导航（移动优先，单手可达）：记录 / 复习 / 知识库 / 设置
 * 复习 tab 带今日到期 badge（原 header 复习入口整合至此）。
 * /login、/auth 不显示。
 *
 * 仅移动 / 平板（< lg）显示：桌面端用常驻侧栏 SidebarNav 导航，底栏以 lg:hidden 隐去。
 * 导航项与角标数据与侧栏共用同一事实源（nav-items / useDueCount），两端始终一致。
 *
 * 视觉：玻璃拟态底栏 + 顶部细分隔；选中项有品牌色指示条 + 图标抬升；图标统一用 lucide。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui/cn';
import { PRIMARY_NAV, isNavActive } from './nav-items';
import { useDueCount } from './useDueCount';

export default function BottomNav() {
  const pathname = usePathname();
  const hidden =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy');
  const due = useDueCount();

  if (hidden) return null;

  return (
    <nav
      aria-label="主导航"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/70 lg:hidden dark:border-zinc-800/70"
    >
      <div className="mx-auto flex max-w-md">
        {PRIMARY_NAV.map(({ href, label, Icon, badge }) => {
          const active = isNavActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              // data-tour：供 V12 产品导览定位高亮（移动端底栏入口），仅作锚点。
              data-tour={`nav-${href === '/' ? 'home' : href.replace(/^\//, '')}`}
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
                {badge === 'due' && due > 0 && (
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
