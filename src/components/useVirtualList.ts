'use client';

/**
 * 轻量列表窗口化（虚拟滚动）—— 自实现，零依赖，避免为长列表引入重库。
 *
 * 思路（动态行高 + 估高兜底）：
 *  - 维护每行已测高度 Map；未测到的行用 estimateHeight 估算。
 *  - 监听最近可滚动祖先（默认 window）的 scroll，按容器在视口中的位置算出
 *    当前应渲染的 [start, end) 行区间（前后各留 overscan 行缓冲）。
 *  - 只渲染区间内的行，用上/下两个占位高度撑出总滚动高度，滚动条与定位正确。
 *  - 行挂载后用 ResizeObserver 量真实高度回填，行高变化（图片加载、展开）自适应。
 *
 * 仅适合**单列纵向流**（多列网格不适用——窗口化时调用方应退化为单列）。
 *
 * 返回：
 *  - containerRef：挂到列表外层容器（用于定位测量）。
 *  - virtualItems：当前要渲染的项 [{ index, measureRef }]，measureRef 挂到该行根节点。
 *  - topPad / bottomPad：上下占位高度（px）。
 *
 * SSR 安全：首帧（未测量）渲染前若干行，hydration 一致；挂载后按滚动收敛。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  /** 总行数 */
  count: number;
  /** 行高估算（未测到的行用它，px）。可按 index 变化。 */
  estimateHeight: (index: number) => number;
  /** 视口前后额外渲染的行数缓冲，默认 6。 */
  overscan?: number;
  /** 自定义滚动容器；不传用 window（容器随页面滚动）。 */
  getScrollElement?: () => HTMLElement | Window | null;
}

interface VirtualItem {
  index: number;
  measureRef: (el: HTMLElement | null) => void;
}

interface VirtualResult {
  containerRef: (el: HTMLElement | null) => void;
  virtualItems: VirtualItem[];
  topPad: number;
  bottomPad: number;
  /** 强制重新测量（如外部数据替换）。 */
  remeasure: () => void;
}

const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useVirtualList({
  count,
  estimateHeight,
  overscan = 6,
  getScrollElement,
}: Options): VirtualResult {
  const containerElRef = useRef<HTMLElement | null>(null);
  const heightsRef = useRef<Map<number, number>>(new Map());
  const rowElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const roRef = useRef<ResizeObserver | null>(null);
  // index → 稳定 ref 回调缓存（复用函数标识，避免 ref 抖动）。
  const measureRefCache = useRef<Map<number, (el: HTMLElement | null) => void>>(new Map());
  // 触发重算的计数器（scroll / resize / 测量回填都 bump 它）。
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const heightOf = useCallback(
    (i: number) => heightsRef.current.get(i) ?? estimateHeight(i),
    [estimateHeight]
  );

  // 容器距文档顶的偏移（用于把页面 scrollY 映射到列表内偏移）。
  const containerTop = useCallback(() => {
    const el = containerElRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset || 0;
    return rect.top + scrollY;
  }, []);

  // 计算可见区间 [start, end)。基于 window 滚动 + 容器在文档中的位置。
  const range = useCallback((): { start: number; end: number } => {
    if (count === 0) return { start: 0, end: 0 };
    if (typeof window === 'undefined') {
      // SSR / 首帧：渲染前 overscan*2 行，保证有内容、hydration 稳定。
      return { start: 0, end: Math.min(count, overscan * 2 + 4) };
    }
    const viewportTop = window.scrollY || window.pageYOffset || 0;
    const viewportH = window.innerHeight || 800;
    const top = containerTop();
    // 相对列表顶部的可视窗口。
    const visStart = viewportTop - top;
    const visEnd = visStart + viewportH;

    let acc = 0;
    let start = 0;
    while (start < count && acc + heightOf(start) < visStart) {
      acc += heightOf(start);
      start++;
    }
    let end = start;
    let accEnd = acc;
    while (end < count && accEnd < visEnd) {
      accEnd += heightOf(end);
      end++;
    }
    start = Math.max(0, start - overscan);
    end = Math.min(count, end + overscan);
    return { start, end };
  }, [count, overscan, heightOf, containerTop]);

  // ResizeObserver：行尺寸变化（图片加载/展开）回填真实高度。
  useIsoLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const idxAttr = el.getAttribute('data-vindex');
        if (idxAttr == null) continue;
        const idx = Number(idxAttr);
        const h = el.getBoundingClientRect().height;
        if (h > 0 && heightsRef.current.get(idx) !== h) {
          heightsRef.current.set(idx, h);
          changed = true;
        }
      }
      if (changed) bump();
    });
    roRef.current = ro;
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [bump]);

  // 监听滚动 / 视口变化。
  useEffect(() => {
    const scroller = getScrollElement?.() ?? window;
    const onScroll = () => bump();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [getScrollElement, bump]);

  // 数据量变化时，丢弃越界的旧测量，避免占位虚高。
  useEffect(() => {
    const heights = heightsRef.current;
    for (const key of Array.from(heights.keys())) {
      if (key >= count) heights.delete(key);
    }
    bump();
  }, [count, bump]);

  const remeasure = useCallback(() => {
    heightsRef.current.clear();
    bump();
  }, [bump]);

  const { start, end } = range();

  // 上/下占位高度：区间外行高之和（用估高 + 已测高）。
  let topPad = 0;
  for (let i = 0; i < start; i++) topPad += heightOf(i);
  let bottomPad = 0;
  for (let i = end; i < count; i++) bottomPad += heightOf(i);

  const containerRef = useCallback((el: HTMLElement | null) => {
    containerElRef.current = el;
  }, []);

  // 每个 index 的 measureRef 缓存稳定函数标识，避免每次渲染都生成新 ref 造成
  // observe/unobserve 抖动（React 会以 null→el 重挂变化的 ref）。
  const makeMeasureRef = useCallback((index: number) => {
    const cached = measureRefCache.current.get(index);
    if (cached) return cached;
    const fn = (el: HTMLElement | null) => {
      const prev = rowElsRef.current.get(index);
      if (prev && prev !== el && roRef.current) roRef.current.unobserve(prev);
      if (el) {
        el.setAttribute('data-vindex', String(index));
        rowElsRef.current.set(index, el);
        roRef.current?.observe(el);
        const h = el.getBoundingClientRect().height;
        if (h > 0 && heightsRef.current.get(index) !== h) {
          heightsRef.current.set(index, h);
        }
      } else {
        rowElsRef.current.delete(index);
      }
    };
    measureRefCache.current.set(index, fn);
    return fn;
  }, []);

  const virtualItems: VirtualItem[] = [];
  for (let i = start; i < end; i++) {
    virtualItems.push({ index: i, measureRef: makeMeasureRef(i) });
  }

  return { containerRef, virtualItems, topPad, bottomPad, remeasure };
}
