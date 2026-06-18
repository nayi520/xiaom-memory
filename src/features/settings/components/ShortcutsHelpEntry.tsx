'use client';

/**
 * 设置页「键盘快捷键」入口（V22）——点一下打开全局快捷键帮助浮层（复用 V20 ShortcutHelp）。
 *
 * 与设置页其它入口卡（回收站 / 使用帮助）同构：大点击区、左图标、右雪佛龙。
 * 不自渲染浮层，只派发 OPEN_SHORTCUT_HELP_EVENT，由根布局挂载的 ShortcutHelp 接住并打开。
 */

import { KeyboardIcon, ChevronRight, cardClass, cn } from '@/components/ui';
import { openShortcutHelp } from '@/components/shortcuts/events';

export default function ShortcutsHelpEntry() {
  return (
    <button
      type="button"
      onClick={openShortcutHelp}
      className={cn(
        cardClass({ interactive: true, padded: false }),
        'group flex w-full items-center justify-between px-4 py-4 text-left'
      )}
    >
      <span className="flex items-center gap-2.5 font-medium text-zinc-800 dark:text-zinc-100">
        <KeyboardIcon aria-hidden className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
        键盘快捷键
        <span className="hidden text-xs font-normal text-zinc-400 sm:inline">
          也可随时按 ? 打开
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="h-4 w-4 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
      />
    </button>
  );
}
