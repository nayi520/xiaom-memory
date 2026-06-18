/**
 * 全局快捷键相关的自定义事件名（V20）。
 *
 * 跨组件/跨页解耦：快捷键监听器（GlobalShortcuts）只负责「翻译按键 → 派发事件 / 导航」，
 * 具体响应（聚焦捕获输入、打开帮助）由对应组件监听这些事件实现，互不直接依赖。
 */

/** 聚焦「文本捕获」输入框（按 n）。TextCapture 监听后聚焦其 textarea。 */
export const FOCUS_CAPTURE_EVENT = 'xiaom:focus-capture';

/** 打开「快捷键帮助」浮层（按 ?）。ShortcutHelp 监听后打开。 */
export const OPEN_SHORTCUT_HELP_EVENT = 'xiaom:open-shortcut-help';

/** 触发聚焦捕获输入。 */
export function requestFocusCapture() {
  window.dispatchEvent(new Event(FOCUS_CAPTURE_EVENT));
}

/** 触发打开快捷键帮助。 */
export function openShortcutHelp() {
  window.dispatchEvent(new Event(OPEN_SHORTCUT_HELP_EVENT));
}
