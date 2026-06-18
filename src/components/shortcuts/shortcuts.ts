/**
 * 全局快捷键的「单一事实源」（V20）——监听器与帮助浮层共用同一份清单，避免漂移。
 *
 * 分组：
 *  - 通用：n 新建捕获、/ 或 ⌘K 搜索、r 去复习、? 帮助、Esc 关弹层。
 *  - 跳转（g 前缀）：g h 主页、g r 复习、g l 知识库、g t 时间线、g i 洞察、g s 设置。
 *
 * 说明：输入框聚焦时不触发（见 isTypingTarget）；复习页内的 1-4/空格由 ReviewSession 自管，
 * 与此处全局键不冲突（全局键里不含 1-4/空格）。
 */

export interface ShortcutItem {
  /** 展示用的按键（可多个键帽，如 ['g', 'h']）。 */
  keys: string[];
  /** 说明文案。 */
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** g 前缀的跳转目标：第二个键 → 路由。 */
export const GO_TO_ROUTES: Record<string, string> = {
  h: '/',
  r: '/review',
  l: '/library',
  t: '/timeline',
  i: '/insights',
  s: '/settings',
};

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '通用',
    items: [
      { keys: ['n'], label: '新建捕获（聚焦输入框）' },
      { keys: ['/'], label: '搜索（也可 ⌘K）' },
      { keys: ['r'], label: '去复习' },
      { keys: ['?'], label: '打开此帮助' },
      { keys: ['Esc'], label: '关闭弹层 / 退出选择' },
    ],
  },
  {
    title: '跳转（先按 g，再按）',
    items: [
      { keys: ['g', 'h'], label: '主页（记录）' },
      { keys: ['g', 'r'], label: '复习' },
      { keys: ['g', 'l'], label: '知识库' },
      { keys: ['g', 't'], label: '时间线' },
      { keys: ['g', 'i'], label: '洞察' },
      { keys: ['g', 's'], label: '设置' },
    ],
  },
];

/**
 * 当前焦点是否落在「正在输入」的元素上（输入框 / 文本域 / 可编辑区 / 下拉）。
 * 命中则全局单键快捷键应让位，不拦截用户打字。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}
