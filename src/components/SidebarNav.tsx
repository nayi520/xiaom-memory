'use client';

/**
 * 桌面侧栏导航（lg 及以上常驻；< lg 不渲染，移动端用 BottomNav）。
 *
 * 结构：
 *   顶部  品牌标识（小M 字标 + 名）
 *   中部  主导航（记录/复习/知识库/设置，复习带今日到期角标） + 次级导航（问小M/时间线）
 *   底部  外观切换（浅/深/系统，紧凑图标组） + 账户（邮箱 + 退出登录）
 *
 * 视觉与全站一致：lucide 线性图标、品牌色高亮、卡片化 hover、深浅色协调。
 * 当前路由项高亮：左侧品牌色指示条 + 品牌淡色底 + 文字加深。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import {
  useTheme,
  Avatar,
  SunIcon,
  MoonIcon,
  SystemIcon,
  cn,
} from '@/components/ui';
import type { LucideIcon, Theme } from '@/components/ui';
import { PRIMARY_NAV, SECONDARY_NAV, isNavActive, type NavItem } from './nav-items';
import { useDueCount } from './useDueCount';

export default function SidebarNav() {
  const pathname = usePathname();
  const due = useDueCount();

  return (
    <nav
      aria-label="主导航"
      className="flex h-dvh w-full flex-col border-r border-zinc-200/70 bg-white/70 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/60"
    >
      {/* 品牌 */}
      <div className="px-5 pt-6 pb-5">
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 rounded-field focus-visible:outline-none"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white shadow-card transition-transform duration-200 group-hover:scale-105">
            小M
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              小M Memory
            </span>
            <span className="text-[11px] text-zinc-400">你负责遇见，小M 替你记得</span>
          </span>
        </Link>
      </div>

      {/* 导航 */}
      <div className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink
                item={item}
                active={isNavActive(pathname, item.href)}
                due={item.badge === 'due' ? due : 0}
              />
            </li>
          ))}
        </ul>

        <p className="mb-1.5 mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          探索
        </p>
        <ul className="space-y-1">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={isNavActive(pathname, item.href)} due={0} />
            </li>
          ))}
        </ul>
      </div>

      {/* 底部：外观 + 账户 */}
      <div className="border-t border-zinc-200/70 px-3 py-3 dark:border-zinc-800/70">
        <ThemeSwitch />
        <AccountRow />
      </div>
    </nav>
  );
}

function NavLink({ item, active, due }: { item: NavItem; active: boolean; due: number }) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-field px-3 py-2.5 text-sm font-medium transition duration-150 ease-smooth focus-visible:outline-none',
        active
          ? 'bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-100'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
      )}
    >
      {/* 选中指示条 */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand transition-opacity duration-200',
          active ? 'opacity-100' : 'opacity-0'
        )}
      />
      <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="flex-1 truncate">{item.label}</span>
      {due > 0 && (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 py-px text-[10px] font-bold leading-none text-white">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </Link>
  );
}

/** 紧凑外观切换（浅/深/系统），与设置页 ThemeToggle 同源、同行为，仅尺寸更小、适配侧栏。 */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string; Icon: LucideIcon }[] = [
    { value: 'light', label: '浅色', Icon: SunIcon },
    { value: 'dark', label: '深色', Icon: MoonIcon },
    { value: 'system', label: '跟随系统', Icon: SystemIcon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="外观"
      className="mb-2 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/70"
    >
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex flex-1 items-center justify-center rounded-[0.625rem] py-1.5 transition duration-200 ease-smooth focus-visible:outline-none',
              active
                ? 'bg-white text-brand shadow-card dark:bg-zinc-900'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            <Icon aria-hidden className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

/** 账户行：头像 + 名字（无名回退邮箱）+ 退出登录（client signOut，落地回 /login）。 */
function AccountRow() {
  const [me, setMe] = useState<{
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data:
            | { email?: string | null; name?: string | null; avatarUrl?: string | null }
            | null
        ) => {
          if (!cancelled && data)
            setMe({
              email: data.email ?? null,
              name: data.name ?? null,
              avatarUrl: data.avatarUrl ?? null,
            });
        }
      )
      .catch(() => {
        /* 取不到资料：仅隐藏文本/头像回退占位，退出按钮仍可用 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 主标题优先名字，回退邮箱；都没有时占位「已登录」。
  const display = me?.name?.trim() || me?.email || '已登录';

  return (
    <div className="flex items-center gap-2 rounded-field px-2 py-1.5">
      <Avatar
        src={me?.avatarUrl}
        name={me?.name}
        email={me?.email}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {display}
        </span>
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        退出
      </button>
    </div>
  );
}
