/**
 * 全站导航项的单一事实源（桌面侧栏 SidebarNav 与移动底栏 BottomNav 共用）。
 *
 * - PRIMARY_NAV：底栏 + 侧栏都展示的主入口（记录 / 复习 / 知识库 / 设置）。
 * - SECONDARY_NAV：仅桌面侧栏展示的次级入口（问小M / 时间线）——移动端这些
 *   入口本就藏在知识库页右上，底栏保持四项不拥挤。
 * 复习项标记 badge: 'due'，由消费方决定如何渲染到期角标。
 */
import { Pencil, BookOpenCheck, Library, Settings, MessageCircleQuestion, Clock } from 'lucide-react';
import type { LucideIcon } from '@/components/ui';

export interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** 'due' 表示该项需展示「今日到期」角标。 */
  badge?: 'due';
}

export const PRIMARY_NAV: NavItem[] = [
  { href: '/', label: '记录', Icon: Pencil },
  { href: '/review', label: '复习', Icon: BookOpenCheck, badge: 'due' },
  { href: '/library', label: '知识库', Icon: Library },
  { href: '/settings', label: '设置', Icon: Settings },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: '/ask', label: '问小M', Icon: MessageCircleQuestion },
  { href: '/timeline', label: '时间线', Icon: Clock },
];

/** 当前路由是否命中某导航项（首页精确匹配，其余前缀匹配）。 */
export function isNavActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}
