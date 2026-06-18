'use client';

/**
 * 下拉刷新（移动端，V19）。
 *
 * 在触摸屏上，当页面已滚到顶部时继续下拉，露出一个刷新指示器；超过阈值松手则调用 onRefresh。
 * 仅对**粗指针（触摸屏）**启用——桌面不绑定任何监听、不返回位移，故桌面无任何影响。
 *
 * 用法：把返回的 { pull, refreshing, bind } 用于在列表顶部渲染指示器，并把 bind 展开到
 * 滚动容器（这里默认监听 window，容器传 null 即可；也可传具体可滚动元素的 ref）。
 *
 * 细节：
 *  - 距离做阻尼（√式衰减观感），不会越拉越夸张。
 *  - 仅在容器 scrollTop<=0 且向下拉时介入，避免与正常滚动 / SwipeableRow 横滑冲突。
 *  - 尊重 prefers-reduced-motion：指示器位移是直接操作反馈，保留；调用方动画自行降级。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const THRESHOLD = 64; // 触发刷新的下拉距离（px）
const MAX_PULL = 96; // 指示器最大下移（px）

export function usePullToRefresh(
  onRefresh: () => void | Promise<void>,
  /** 临时禁用（如进入多选态，避免与长按/勾选手势冲突）。 */
  disabled = false
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (disabled) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const atTop = () =>
      (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      startY.current = atTop() ? e.touches[0]?.clientY ?? null : null;
      active.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshing || startY.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy <= 0) {
        if (active.current) setPull(0);
        active.current = false;
        return;
      }
      // 仍在顶部且向下拉：介入。
      if (!atTop()) {
        startY.current = null;
        return;
      }
      active.current = true;
      // 阻尼：实际位移随距离衰减。
      const damped = Math.min(MAX_PULL, Math.sqrt(dy) * 7);
      setPull(damped);
      // 阻止橡皮筋 / 原生下拉，避免双重反馈。
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (refreshing) return;
      const shouldRefresh = active.current && pull >= THRESHOLD * 0.6;
      active.current = false;
      startY.current = null;
      if (shouldRefresh) {
        setPull(THRESHOLD * 0.5);
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current())
          .catch(() => {})
          .finally(() => {
            setRefreshing(false);
            setPull(0);
          });
      } else {
        setPull(0);
      }
    };

    // passive:false 仅 move 需要（要 preventDefault）。
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [pull, refreshing, disabled]);

  /** 进度（0~1），用于指示器旋转 / 透明度。 */
  const progress = Math.min(1, pull / THRESHOLD);

  // 触发距离阈值（供调用方文案 / 判断）。
  const reached = useCallback(() => pull >= THRESHOLD * 0.6, [pull]);

  return { pull, progress, refreshing, reached };
}
