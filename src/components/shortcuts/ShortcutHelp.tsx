'use client';

/**
 * 快捷键帮助浮层（V20 设计、V22 落地）——按 ? 或从设置页入口打开，列出全部全局快捷键。
 *
 * 数据来自 shortcuts.ts 的 SHORTCUT_GROUPS（单一事实源，与 GlobalShortcuts 监听器同源，不漂移）。
 * 在根布局挂载一次，监听 OPEN_SHORTCUT_HELP_EVENT 打开；也可由 openShortcutHelp() 主动唤起。
 *
 * a11y：role=dialog + aria-modal；打开聚焦面板、Tab 焦点陷阱、Esc 关闭、关闭后焦点归还触发元素。
 * 居中弹层在桌面/移动均可用；遮罩点击关闭；尊重 reduced-motion（动画类带 motion-safe）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyboardIcon, CloseIcon } from '@/components/ui';
import { OPEN_SHORTCUT_HELP_EVENT } from './events';
import { SHORTCUT_GROUPS } from './shortcuts';

export default function ShortcutHelp() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 监听打开事件（? 快捷键 / 设置页入口都派发它）。
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_SHORTCUT_HELP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SHORTCUT_HELP_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // 打开：记录触发焦点、锁滚动、聚焦面板；关闭：恢复滚动并把焦点还给触发元素。
  useEffect(() => {
    if (!open) return;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = overflow;
      window.clearTimeout(t);
      const prev = restoreFocus.current;
      if (prev && document.contains(prev)) prev.focus();
      restoreFocus.current = null;
    };
  }, [open]);

  // Esc 关闭 + Tab 焦点陷阱（在面板内循环）。
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-zinc-900/40 backdrop-blur-sm motion-safe:animate-fade-in dark:bg-black/60"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-card border border-zinc-200/80 bg-white shadow-pop outline-none motion-safe:animate-scale-in dark:border-zinc-700/80 dark:bg-zinc-900"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200/70 px-5 py-3.5 dark:border-zinc-800/70">
          <h2
            id="shortcut-help-title"
            className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-50"
          >
            <KeyboardIcon aria-hidden className="h-[18px] w-[18px] text-brand" />
            键盘快捷键
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <CloseIcon aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-zinc-600 dark:text-zinc-300">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-medium text-zinc-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="border-t border-zinc-200/70 px-5 py-2.5 text-center text-xs text-zinc-400 dark:border-zinc-800/70">
          随时按{' '}
          <kbd className="rounded border border-zinc-200 px-1 py-px font-medium dark:border-zinc-700">
            ?
          </kbd>{' '}
          打开此帮助 · 输入时不触发
        </footer>
      </div>
    </div>,
    document.body
  );
}
