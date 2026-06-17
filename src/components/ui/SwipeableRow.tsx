'use client';

/**
 * 移动端「滑动操作」列表项（V19）。
 *
 * 在触摸屏上向左滑动列表项，从右侧滑出一组操作按钮（如恢复 / 删除 / 打标签）；
 * 点击操作或点击别处都会收起。仅对**粗指针（触摸屏）**启用手势——桌面（精确指针）
 * 不绑定任何手势、容器零额外样式，故桌面渲染与交互完全不变（桌面仍用卡片内既有按钮）。
 *
 * 设计取舍：
 *  - 手势是**增强**，不是唯一入口。即便在移动端，调用方传入的 children 里也应保留可点的
 *    操作（或本组件常驻一个更明确的入口），以保证可达性、可被读屏操作。
 *  - 尊重 prefers-reduced-motion：跟手位移本身是必要的直接操作反馈（非装饰动画），保留；
 *    但回弹/收起的过渡在 reduce 下变为瞬时。
 *
 * 不引入第三方手势库：用原生 touch 事件 + transform，零依赖、包体不增。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCoarsePointer } from '@/components/useCoarsePointer';
import { cn } from './cn';

export interface SwipeAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** 危险态（删除/永久删除）用红色。 */
  danger?: boolean;
}

export default function SwipeableRow({
  actions,
  children,
  className,
  /** 单个操作按钮宽度（px）。总滑出宽度 = 按钮数 × 此值。 */
  actionWidth = 80,
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  className?: string;
  actionWidth?: number;
}) {
  const coarse = useCoarsePointer();
  const revealW = actions.length * actionWidth;
  // 当前横向位移（≤0，向左为负）。open 时停在 -revealW。
  const [tx, setTx] = useState(0);
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  // 判定是否进入水平滑动（避免与纵向滚动冲突）。
  const axis = useRef<'undecided' | 'horizontal' | 'vertical'>('undecided');
  const rowRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTx(0);
  }, []);

  // 点击行外区域时收起（仅在已展开时监听，省开销）。
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: Event) => {
      if (rowRef.current && !rowRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => document.removeEventListener('pointerdown', onDocPointer, true);
  }, [open, close]);

  // 非触摸设备：直接渲染原始内容，零包裹样式、零监听（桌面完全不变）。
  if (!coarse || actions.length === 0) {
    return <>{children}</>;
  }

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0]?.clientX ?? null;
    startY.current = e.touches[0]?.clientY ?? null;
    axis.current = 'undecided';
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null || startY.current === null) return;
    const dx = (e.touches[0]?.clientX ?? 0) - startX.current;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;

    if (axis.current === 'undecided') {
      // 需要积累一点位移再判定方向，阈值内不抢滚动。
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (axis.current !== 'horizontal') return;

    // 水平滑动：阻止页面纵向滚动抢占，跟手更新位移。
    const base = open ? -revealW : 0;
    let next = base + dx;
    // 夹紧在 [-revealW, 0]；越界给阻尼，避免硬边。
    if (next > 0) next = next * 0.3;
    if (next < -revealW) next = -revealW + (next + revealW) * 0.3;
    setTx(next);
  }

  function onTouchEnd() {
    if (axis.current === 'horizontal') {
      // 滑出超过半个按钮宽即吸附为展开，否则收起。
      if (tx < -actionWidth / 2) {
        setOpen(true);
        setTx(-revealW);
      } else {
        close();
      }
    }
    startX.current = null;
    startY.current = null;
    axis.current = 'undecided';
  }

  return (
    <div
      ref={rowRef}
      className={cn('relative overflow-hidden rounded-card', className)}
    >
      {/* 右侧操作区（被前景行盖住，滑动时露出） */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: revealW }}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => {
              a.onClick();
              close();
            }}
            style={{ width: actionWidth }}
            className={cn(
              'flex h-full flex-col items-center justify-center gap-1 text-xs font-semibold text-white transition active:brightness-95',
              a.danger ? 'bg-red-500' : 'bg-brand'
            )}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>

      {/* 前景行（跟手平移；松手用过渡吸附，reduce 下瞬时） */}
      <div
        className={cn(
          'relative bg-white dark:bg-zinc-900',
          startX.current === null && 'transition-transform duration-200 ease-smooth motion-reduce:transition-none'
        )}
        style={{ transform: `translateX(${tx}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
