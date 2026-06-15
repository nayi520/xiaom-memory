'use client';

/**
 * 外观设置卡片（设置页「外观」区块）：深浅色三态 + 主题色 + 字号。
 * 三组均即时生效（CSS 变量 / class 切换）+ localStorage 持久化，与侧栏紧凑外观开关同源。
 * 分段控件风格与全站一致；各组 role=radiogroup 可键盘操作，选中项高亮。
 */

import { useTheme, type Theme, type Accent, type FontScale } from './theme';
import { SunIcon, MoonIcon, SystemIcon, CheckIcon } from './icons';
import type { LucideIcon } from './icons';
import { cn } from './cn';

const THEME_OPTIONS: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: '浅色', Icon: SunIcon },
  { value: 'dark', label: '深色', Icon: MoonIcon },
  { value: 'system', label: '跟随系统', Icon: SystemIcon },
];

/** 主题色预设：name 用于 aria-label/title，swatch 直接用预设 600 档色值（与 globals.css 一致）。 */
const ACCENT_OPTIONS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'indigo', label: '靛蓝', swatch: 'rgb(79 70 229)' },
  { value: 'violet', label: '紫罗兰', swatch: 'rgb(124 58 237)' },
  { value: 'blue', label: '天蓝', swatch: 'rgb(37 99 235)' },
  { value: 'emerald', label: '翡翠', swatch: 'rgb(5 150 105)' },
  { value: 'rose', label: '玫红', swatch: 'rgb(225 29 72)' },
  { value: 'amber', label: '琥珀', swatch: 'rgb(217 119 6)' },
];

const FONT_OPTIONS: { value: FontScale; label: string; preview: string }[] = [
  { value: 'sm', label: '小', preview: 'text-xs' },
  { value: 'base', label: '标准', preview: 'text-sm' },
  { value: 'lg', label: '大', preview: 'text-base' },
];

export default function ThemeToggle() {
  const { theme, resolved, setTheme, accent, setAccent, fontScale, setFontScale } =
    useTheme();

  return (
    <div className="space-y-5 rounded-card border border-zinc-200/80 bg-white px-4 py-4 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
      {/* 深浅色 */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">外观</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
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
          aria-label="外观模式"
          className="mt-3 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/80"
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
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

      {/* 主题色 */}
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">主题色</p>
        <div
          role="radiogroup"
          aria-label="主题色"
          className="mt-2.5 flex flex-wrap gap-2.5"
        >
          {ACCENT_OPTIONS.map(({ value, label, swatch }) => {
            const active = accent === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                title={label}
                onClick={() => setAccent(value)}
                style={{ backgroundColor: swatch }}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-white transition duration-200 ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900',
                  active
                    ? 'ring-2 ring-zinc-900/70 ring-offset-2 ring-offset-white dark:ring-white/80 dark:ring-offset-zinc-900'
                    : 'hover:scale-105 active:scale-95'
                )}
              >
                {active && <CheckIcon aria-hidden className="h-4 w-4" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 字号 */}
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">字号</p>
        <div
          role="radiogroup"
          aria-label="字号"
          className="mt-2.5 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/80"
        >
          {FONT_OPTIONS.map(({ value, label, preview }) => {
            const active = fontScale === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setFontScale(value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] py-2 transition duration-200 ease-smooth focus-visible:outline-none',
                  active
                    ? 'bg-white font-semibold text-brand shadow-card dark:bg-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                )}
              >
                <span aria-hidden className={cn('font-semibold leading-none', preview)}>
                  A
                </span>
                <span className="text-sm">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
