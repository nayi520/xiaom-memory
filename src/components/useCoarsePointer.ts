'use client';

/**
 * 是否为粗指针（触摸优先）设备（V19）。
 *
 * 用于「仅在触摸屏增强」的移动端交互分支（滑动操作 / 常驻显示图标按钮 / 滑动评分等）：
 * 命中 `(pointer: coarse)` 才启用，桌面（精确指针）返回 false → 走原桌面分支，渲染不变。
 *
 * SSR 安全：首屏返回 false（避免水合不一致），挂载后按实际媒体查询纠正。
 */

import { useEffect, useState } from 'react';

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}
