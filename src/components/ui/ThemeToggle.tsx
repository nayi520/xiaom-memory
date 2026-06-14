'use client';

/**
 * 外观三态切换（浅色 / 深色 / 跟随系统），用于设置页。
 * 分段控件风格与「记录类型」切换一致；选中项高亮，整组 role=radiogroup 可键盘操作。
 * 跟随系统时副文案提示当前实际解析到的外观。
 */

import { useTheme, type Theme } from './theme';
import { SunIcon, MoonIcon, SystemIcon } from './icons';
import type { LucideIcon } from './icons';
import { cn } from './cn';

const OPTIONS: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: '浅色', Icon: SunIcon },
  { value: 'dark', label: '深色', Icon: MoonIcon },
  { value: 'system', label: '跟随系统', Icon: SystemIcon },
];

export default function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <div className="rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">外观</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {theme === 'system'
              ? `跟随系统（当前${resolved === 'dark' ? '深色' : '浅色'}）`
              : theme === 'dark'
                ? '始终深色'
                : '始终浅色'}
          </p>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="外观"
        className="mt-3 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/80"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] py-2 text-sm transition duration-200 ease-smooth focus-visible:outline-none',
                active
                  ? 'bg-white font-semibold text-brand shadow-card dark:bg-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
