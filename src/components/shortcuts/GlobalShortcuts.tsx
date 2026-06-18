'use client';

/**
 * 全局键盘快捷键监听器（V20）——在根布局挂载一次，翻译按键为导航/事件。
 *
 * 支持：
 *  - n：去主页并聚焦文本捕获输入框（派发 FOCUS_CAPTURE_EVENT）。
 *  - /：打开命令面板搜索（⌘K 仍由 CommandPalette 自管，这里补一个 `/`）。
 *  - r：去复习。
 *  - g 前缀：g h/r/l/t/i/s 跳转对应页面（1 秒内按第二键）。
 *  - ?：打开快捷键帮助浮层（ShortcutHelp 监听）。
 *  - Esc：交由各弹层自身处理（这里不拦截，避免与面板/Sheet 的 Esc 冲突）。
 *
 * 约束：
 *  - 输入框 / 文本域 / 可编辑区聚焦时不触发（让位打字）。
 *  - 含 Ctrl/Meta/Alt 修饰键时不处理（留给浏览器与 ⌘K）。
 *  - /login、/auth 不启用。
 *  - 复习页（/review）内不响应单键导航（n/r/g…），避免打断复习；? 帮助与 / 搜索仍可用。
 *    复习页的 1-4 / 空格由 ReviewSession 自管，与本监听器无交集。
 */

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { openCommandPalette } from '@/components/CommandPalette';
import { requestFocusCapture, openShortcutHelp } from './events';
import { GO_TO_ROUTES, isTypingTarget } from './shortcuts';

/** g 前缀的有效时间窗（ms）：按 g 后多久内按第二键才算组合键。 */
const G_PREFIX_WINDOW_MS = 1000;

export default function GlobalShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  // 用 ref 持有最新 pathname，避免频繁重绑监听。
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  // g 前缀计时：非 null 表示刚按下 g、在等待第二键。
  const gPending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearG() {
      if (gPending.current) {
        clearTimeout(gPending.current);
        gPending.current = null;
      }
    }

    function onKey(e: KeyboardEvent) {
      const path = pathRef.current;
      if (path.startsWith('/login') || path.startsWith('/auth')) return;
      // 让位浏览器/系统组合键与 ⌘K。
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // 正在输入：不拦截（含搜索框、编辑器、就地编辑等）。
      if (isTypingTarget(e.target)) {
        clearG();
        return;
      }

      // ? 帮助（Shift+/ 产生 ?）：任何页面可用。
      if (e.key === '?') {
        e.preventDefault();
        openShortcutHelp();
        clearG();
        return;
      }

      // / 搜索：任何页面可用（命令面板）。
      if (e.key === '/') {
        e.preventDefault();
        openCommandPalette();
        clearG();
        return;
      }

      // g 前缀的第二键：跳转。
      if (gPending.current) {
        const route = GO_TO_ROUTES[e.key.toLowerCase()];
        clearG();
        if (route) {
          e.preventDefault();
          router.push(route);
        }
        return;
      }

      // 复习页内：不响应单键导航（避免打断复习）；上面的 ? 与 / 已先处理。
      const inReview = path.startsWith('/review');

      if (e.key === 'g' && !inReview) {
        // 进入 g 前缀等待态。
        e.preventDefault();
        gPending.current = setTimeout(clearG, G_PREFIX_WINDOW_MS);
        return;
      }

      if (inReview) return;

      if (e.key === 'n') {
        e.preventDefault();
        // 不在主页则先去主页，聚焦事件由 TextCapture 挂载后监听处理（延迟派发一次兜底）。
        if (path !== '/') {
          router.push('/');
          // 给页面切换一点时间，再请求聚焦（TextCapture 挂载后能接住）。
          window.setTimeout(() => requestFocusCapture(), 250);
        } else {
          requestFocusCapture();
        }
        return;
      }

      if (e.key === 'r') {
        e.preventDefault();
        router.push('/review');
        return;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearG();
    };
  }, [router]);

  return null;
}
