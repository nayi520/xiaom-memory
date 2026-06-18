'use client';

/**
 * 是否开启系统「减少动态效果」偏好（prefers-reduced-motion: reduce）。
 *
 * 用于需要在 JS 侧分支的动效（如复习达成庆祝的纸屑：开启偏好时整段不渲染，降级为静态提示）。
 * 纯 CSS 动画已由 globals.css 的 @media (prefers-reduced-motion) 统一压制，无需本 hook；
 * 只有「按偏好决定是否挂载某段动画 DOM」时才用它。
 *
 * SSR 安全：首屏返回 false（避免水合不一致），挂载后按实际媒体查询纠正并监听变化。
 */

import { useEffect, useState } from 'react';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}
