'use client';

/**
 * 选择态勾选框（V20）——列表项左侧的圆形勾选，进入选择模式后显示。
 * 复用方形勾选图标与 token，深浅色一致；命中区满足触控（44px）。
 */

import { CheckSquareIcon, SquareIcon, cn } from '@/components/ui';

export default function SelectCheckbox({
  checked,
  onChange,
  className,
  label = '选择这条',
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none',
        checked
          ? 'text-brand'
          : 'text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400',
        className
      )}
    >
      {checked ? (
        <CheckSquareIcon aria-hidden className="h-[22px] w-[22px]" />
      ) : (
        <SquareIcon aria-hidden className="h-[22px] w-[22px]" />
      )}
    </button>
  );
}
