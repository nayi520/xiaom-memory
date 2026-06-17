'use client';

/**
 * 输入草稿暂存（V18 输入韧性）——把较长输入暂存到 localStorage，切页/刷新不丢，提交成功后清除。
 *
 * 用法：
 *   const [text, setText, clearDraft] = useDraft('mxiao.draft.capture-text');
 *   <Textarea value={text} onChange={(e) => setText(e.target.value)} />
 *   // 提交成功后：clearDraft();
 *
 * 设计：
 *  - 首次挂载从 localStorage 水合（hydration 后再读，避免 SSR/CSR 文本不一致告警）。
 *  - 写入做轻量防抖（默认 400ms），避免每键一次磁盘写。
 *  - 空串视为「无草稿」并移除键，保持存储干净。
 *  - 隐私模式/配额写失败时整体降级为纯内存态，不抛错、不阻断输入。
 *  - 仅暂存纯文本草稿，绝不暂存密码等敏感字段（调用方自负）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const WRITE_DEBOUNCE_MS = 400;

export function useDraft(
  key: string,
  initial = ''
): [string, (next: string) => void, () => void] {
  const [value, setValue] = useState(initial);
  const [hydrated, setHydrated] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 挂载后水合：读已存草稿（仅非空时覆盖初值）。
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setValue(saved);
    } catch {
      /* 读不到：用初值 */
    }
    setHydrated(true);
    // key 变化视为换了一份草稿，重新水合。
  }, [key]);

  // 防抖写入（水合完成后才写，避免把初值/空值盖掉已存草稿）。
  useEffect(() => {
    if (!hydrated) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        /* 配额/隐私模式：降级为内存态 */
      }
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, hydrated, key]);

  const clearDraft = useCallback(() => {
    setValue('');
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);

  return [value, setValue, clearDraft];
}
