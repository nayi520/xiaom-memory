'use client';

/**
 * 长按手势（V20 移动端进入选择模式）。
 *
 * 触摸屏上按住某行约 500ms（期间手指基本不移动）触发回调——用于「长按进入多选」。
 * 桌面（精确指针）不绑定，返回空 props，行为不变。手指移动超过阈值即取消（让位给滚动/滑动）。
 *
 * 返回可直接展开到目标元素的 touch 事件处理器；不阻止默认滚动，仅在判定为长按时触发回调。
 */

import { useCallback, useRef } from 'react';
import { useCoarsePointer } from '@/components/useCoarsePointer';

const LONG_PRESS_MS = 500;
/** 手指移动超过此距离（px）即取消长按（视为滚动/滑动意图）。 */
const MOVE_CANCEL_PX = 10;

export interface LongPressHandlers {
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onTouchCancel?: (e: React.TouchEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function useLongPress(
  onLongPress: () => void,
  enabled = true
): LongPressHandlers {
  const coarse = useCoarsePointer();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  if (!coarse || !enabled) return {};

  return {
    onTouchStart: (e) => {
      fired.current = false;
      start.current = { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 };
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
        // 长按成功后给一点触感反馈（支持的设备）。
        try {
          navigator.vibrate?.(15);
        } catch {
          /* 不支持震动：忽略 */
        }
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e) => {
      if (!start.current) return;
      const dx = (e.touches[0]?.clientX ?? 0) - start.current.x;
      const dy = (e.touches[0]?.clientY ?? 0) - start.current.y;
      if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    // 长按在部分浏览器会弹系统菜单：触摸屏下抑制，避免与选择手势冲突。
    onContextMenu: (e) => {
      if (fired.current) e.preventDefault();
    },
  };
}
