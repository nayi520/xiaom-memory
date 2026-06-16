'use client';

/**
 * 设置页「使用帮助 & 引导」区（V12）：
 *  - 「使用帮助」→ 跳 /guide 图文说明。
 *  - 「重看新手引导」→ 清完成态 + 服务端 onboarded 置回 false，并跳首页重新触发欢迎流 + 导览。
 *
 * 复用全站卡片 / 图标 token，与设置页其它「记录管理」入口同构（大点击区、右侧雪佛龙）。
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AskIcon,
  CelebrateIcon,
  ChevronRight,
  cardClass,
  useToast,
  cn,
} from '@/components/ui';
import { requestRestartOnboarding } from '../store';

export default function OnboardingSettings() {
  const router = useRouter();
  const { info } = useToast();

  function restart() {
    requestRestartOnboarding();
    info('已为你重新打开新手引导');
    // 引导锚点（侧栏/底栏）在各页都在；跳首页让欢迎流/导览在熟悉的起点出现。
    router.push('/');
  }

  return (
    <div className="space-y-2.5">
      <Link
        href="/guide"
        className={cn(
          cardClass({ interactive: true, padded: false }),
          'group flex items-center justify-between px-4 py-4'
        )}
      >
        <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
          <AskIcon aria-hidden className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
          使用帮助
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
        />
      </Link>

      <button
        type="button"
        onClick={restart}
        className={cn(
          cardClass({ interactive: true, padded: false }),
          'group flex w-full items-center justify-between px-4 py-4 text-left'
        )}
      >
        <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
          <CelebrateIcon aria-hidden className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
          重看新手引导
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
        />
      </button>

      <p className="text-sm leading-relaxed text-zinc-400">
        重看会带你回到首页，重新走一遍欢迎介绍与四大入口导览。
      </p>
    </div>
  );
}
