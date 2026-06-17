'use client';

/**
 * 会话过期引导（V18 网络韧性）——全局挂一次，监听 {@link SESSION_EXPIRED_EVENT}。
 *
 * 任一 API 返回 401（会话过期/未登录）时，apiFetch 会广播该事件；本组件据此弹一层轻量浮层：
 * 「登录已过期 · 重新登录」，引导用户回登录页，而不是让请求静默失败、页面卡在半截。
 *
 * 设计：
 *  - 只在「裸页」之外生效（/login、/auth 不打扰——这些页本就处理登录）。
 *  - 浮层非模态遮断，但置顶可点：用户点「重新登录」走 next-auth signOut→/login（清掉过期 cookie，
 *    与侧栏「退出登录」一致的落地）；或点「稍后」先关掉浮层（再次 401 会再弹）。
 *  - 同一时刻只展示一层；事件去抖已在 api.ts 做（5s 内只播一次）。
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import { signOutAndClear } from '@/lib/sign-out';
import { Button, WarningIcon } from '@/components/ui';

export default function SessionExpiredGate() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 登录/鉴权裸页不打扰（它们自己处理登录态）。
  const bare = pathname.startsWith('/login') || pathname.startsWith('/auth');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onExpired = () => setOpen(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // 切到裸页时自动收起（如已被重定向到 /login）。
  useEffect(() => {
    if (bare) setOpen(false);
  }, [bare]);

  if (!open || bare) return null;

  function relogin() {
    // 清掉过期会话 cookie + 本地离线队列，并落地登录页（与侧栏「退出登录」同口径）。
    void signOutAndClear();
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="session-expired-title"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="glass motion-safe:animate-fade-in-up pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border border-amber-300/70 px-4 py-3 shadow-pop ring-1 ring-black/[0.02] dark:border-amber-900/70">
        <WarningIcon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p
            id="session-expired-title"
            className="text-sm font-semibold text-zinc-800 dark:text-zinc-100"
          >
            登录已过期
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            为了保护你的数据，需要重新登录后继续。未提交的内容请先复制保存。
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button size="sm" onClick={relogin}>
              重新登录
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              稍后
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
