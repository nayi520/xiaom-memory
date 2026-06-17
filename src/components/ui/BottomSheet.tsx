'use client';

/**
 * 移动端底部操作面板（Bottom Sheet，V19）。
 *
 * 触控友好地替代桌面下拉菜单：从屏幕底部滑入，承载一组操作项；点击遮罩 / 关闭按钮 /
 * 下滑手势 / Esc 均可关闭。内置 safe-area 垫底（避开 home 条）、滚动隔离、reduced-motion 适配。
 *
 * 定位：**仅移动端使用**——调用方在 `<lg` 分支里挂载本组件、在 `lg:` 分支保留原桌面下拉/内联 UI，
 * 故桌面渲染完全不受影响（本组件在桌面分支根本不出现）。
 *
 * a11y：role=dialog + aria-modal；打开时锁 body 滚动、聚焦面板；关闭后恢复焦点到触发元素。
 * 用 createPortal 渲染到 body，避免被父级 overflow/transform 截断或层级压制。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { CloseIcon } from './icons';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** 顶部标题（可选）。 */
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // 下滑手势：记录起点与当前位移；松手超过阈值则关闭，否则回弹。
  const dragStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  // 记住打开前的焦点元素，关闭后归还（键盘/读屏用户回到触发按钮）。
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 打开时：记录焦点、锁滚动、聚焦面板；关闭/卸载时恢复。
  useEffect(() => {
    if (!open) return;
    prevFocus.current = (document.activeElement as HTMLElement) ?? null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    // 等首帧挂载后聚焦，避免打断滑入动画。
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = overflow;
      window.clearTimeout(t);
      prevFocus.current?.focus?.();
    };
  }, [open]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const endDrag = useCallback(() => {
    if (dragStartY.current === null) return;
    const dy = dragY;
    dragStartY.current = null;
    setDragY(0);
    // 下滑超过 96px 视为关闭意图。
    if (dy > 96) onClose();
  }, [dragY, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] lg:hidden"
      role="dialog"
      aria-modal="true"
    >
      {/* 遮罩 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[2px] motion-safe:animate-fade-in"
      />
      {/* 面板 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-card border-t border-zinc-200/70 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-pop outline-none dark:border-zinc-800/70 dark:bg-zinc-900',
          'motion-safe:animate-sheet-up',
          className
        )}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        onTouchStart={(e) => {
          dragStartY.current = e.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(e) => {
          if (dragStartY.current === null) return;
          const dy = (e.touches[0]?.clientY ?? 0) - dragStartY.current;
          // 仅响应向下拖拽。
          if (dy > 0) setDragY(dy);
        }}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
      >
        {/* 抓手 + 标题 */}
        <div className="shrink-0 px-4 pt-2.5">
          <div
            aria-hidden
            className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"
          />
          {title && (
            <div className="flex items-center justify-between gap-3 pb-1">
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {title}
              </p>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="touch-target -mr-2 flex items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <CloseIcon aria-hidden className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
        {/* 内容（可滚动） */}
        <div className="scroll-touch min-h-0 flex-1 overflow-y-auto px-4 pt-1">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Sheet 内的标准操作项（大命中区、图标 + 文案，可选危险态 / 副标题）。
 * 满足 ≥44px 触控目标；按下有轻微反馈。
 */
export function SheetAction({
  icon,
  label,
  description,
  onClick,
  danger,
  disabled,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-3 rounded-field px-3 py-3 text-left text-[15px] font-medium transition active:scale-[0.99] focus-visible:outline-none disabled:opacity-50',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/60'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800/70'
      )}
    >
      {icon && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            danger
              ? 'bg-red-50 text-red-500 dark:bg-red-950/60'
              : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-xs font-normal text-zinc-400">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
