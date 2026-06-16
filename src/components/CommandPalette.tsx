'use client';

/**
 * 全局命令面板（V6 ⌘K）——快速跳转 + 快速搜索概念/记录。
 *
 * 打开方式：
 *   - 桌面：全局快捷键 ⌘K（macOS）/ Ctrl+K（Win/Linux）。
 *   - 移动：右下角悬浮入口按钮（不绑快捷键，但面板本身在任意尺寸都可用）。
 *
 * 内容：
 *   - 顶部输入框；空查询时列出全部导航入口（复用 nav-items：记录/复习/知识库/设置/问小M/时间线）；
 *   - 有查询时：先按关键词过滤导航项，再 GET /api/library/search 拉概念/记录，回车跳对应详情。
 *
 * 交互：↑/↓ 选择、Enter 确认、Esc 关闭；列表项鼠标悬停同步高亮；路由切换自动关闭。
 * /login、/auth 不挂载。纯客户端 + 既有接口，深浅色适配。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  SearchIcon,
  LibraryIcon,
  NoteIcon,
  AskIcon,
  EnterIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  cn,
  type LucideIcon,
} from '@/components/ui';
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav-items';

// 命令面板额外入口：使用帮助（/guide）——不进常驻侧栏/底栏，但可由 ⌘K 快速到达。
const EXTRA_NAV: NavItem[] = [{ href: '/guide', label: '使用帮助', Icon: AskIcon }];

const NAV = [...PRIMARY_NAV, ...SECONDARY_NAV, ...EXTRA_NAV];

/** 自定义事件名：任意入口（如侧栏「搜索」按钮）dispatch 它即可呼出面板。 */
export const COMMAND_PALETTE_OPEN_EVENT = 'xiaom:open-command-palette';

/** 供非快捷键入口（按钮点击）呼出命令面板。 */
export function openCommandPalette() {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT));
}

interface SearchHit {
  kind: 'note' | 'concept';
  id: string;
  title: string;
  snippet: string;
}

type Row =
  | { type: 'nav'; key: string; href: string; label: string; Icon: LucideIcon }
  | { type: 'hit'; key: string; href: string; hit: SearchHit };

const SEARCH_DEBOUNCE_MS = 200;

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const bare = pathname.startsWith('/login') || pathname.startsWith('/auth');

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // 打开前的焦点元素，关闭后归还（无障碍：避免焦点丢回 <body>）。
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // —— 全局快捷键：⌘K / Ctrl+K 切换开关；另接受自定义事件（侧栏按钮等入口呼出）——
  useEffect(() => {
    if (bare) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen);
    };
  }, [bare]);

  // 打开时聚焦输入框、重置状态；关闭时把焦点归还给打开前的元素（焦点管理）
  useEffect(() => {
    if (open) {
      setActive(0);
      // 记录打开前的焦点元素，便于关闭后归还。
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // 等待挂载后聚焦
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    // 关闭时清空查询，下次打开干净
    setQuery('');
    setHits([]);
    // 把焦点还给打开面板前的触发元素（若仍在文档内）。
    const prev = restoreFocusRef.current;
    if (prev && document.contains(prev)) prev.focus();
    restoreFocusRef.current = null;
  }, [open]);

  // 路由切换自动关闭（点击结果跳转后面板收起）
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // —— 防抖搜索（调既有 /api/library/search）——
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/library/search?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results?: SearchHit[] }) => {
          if (!cancelled) setHits(data.results ?? []);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  // —— 行集合：导航（按查询过滤）+ 搜索命中 ——
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const navRows: Row[] = NAV.filter((n) => !q || n.label.toLowerCase().includes(q)).map(
      (n) => ({ type: 'nav', key: `nav:${n.href}`, href: n.href, label: n.label, Icon: n.Icon })
    );
    const hitRows: Row[] = hits.map((h) => ({
      type: 'hit',
      key: `hit:${h.kind}:${h.id}`,
      href:
        h.kind === 'concept' ? `/library/concept/${h.id}` : `/library/note/${h.id}`,
      hit: h,
    }));
    return [...navRows, ...hitRows];
  }, [query, hits]);

  // active 越界时回收到合法范围
  useEffect(() => {
    setActive((a) => (rows.length === 0 ? 0 : Math.min(a, rows.length - 1)));
  }, [rows.length]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // 列表内键盘导航 + 焦点陷阱（Tab 在面板内循环，不逃逸到背后页面）
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Tab') {
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (rows.length ? (a - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row.href);
    }
  }

  // 高亮项滚动进可视区
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (bare) return null;

  return (
    <>
      {/* 移动端悬浮入口（桌面用 ⌘K，故 lg 隐藏；避免遮挡底栏，抬到底栏之上） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开命令面板"
        className="glass fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200/70 text-zinc-600 shadow-pop transition active:scale-95 lg:hidden dark:border-zinc-700/70 dark:text-zinc-300"
      >
        <SearchIcon aria-hidden className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh] sm:pt-[18vh]"
          role="dialog"
          aria-modal="true"
          aria-label="命令面板"
        >
          {/* 遮罩：点击关闭 */}
          <div
            className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm dark:bg-black/50"
            onClick={() => setOpen(false)}
          />

          <div
            ref={dialogRef}
            className="glass relative w-full max-w-xl overflow-hidden rounded-card border border-zinc-200/80 shadow-pop motion-safe:animate-scale-in dark:border-zinc-700/80"
            onKeyDown={onKeyDown}
          >
            {/* 输入框 */}
            <div className="flex items-center gap-2.5 border-b border-zinc-200/70 px-4 dark:border-zinc-800/70">
              <SearchIcon aria-hidden className="h-[18px] w-[18px] shrink-0 text-zinc-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="跳转到… 或搜索概念、记录"
                aria-label="命令或搜索"
                className="w-full bg-transparent py-3.5 text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
              />
              <kbd className="hidden shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 sm:block dark:border-zinc-700">
                Esc
              </kbd>
            </div>

            {/* 结果列表 */}
            <ul ref={listRef} className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5">
              {rows.length === 0 ? (
                <li className="px-3 py-8 text-center text-sm text-zinc-400">
                  {searching ? '搜索中…' : query.trim() ? '没有匹配项' : '开始输入以搜索'}
                </li>
              ) : (
                rows.map((row, i) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      data-active={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(row.href)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-left text-sm transition-colors',
                        i === active
                          ? 'bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-100'
                          : 'text-zinc-700 hover:bg-zinc-100/70 dark:text-zinc-200 dark:hover:bg-zinc-800/60'
                      )}
                    >
                      {row.type === 'nav' ? (
                        <>
                          <row.Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
                          <span className="flex-1 truncate font-medium">{row.label}</span>
                          <span className="shrink-0 text-[11px] text-zinc-400">跳转</span>
                        </>
                      ) : (
                        <>
                          {row.hit.kind === 'concept' ? (
                            <LibraryIcon aria-hidden className="h-[18px] w-[18px] shrink-0 text-zinc-400" />
                          ) : (
                            <NoteIcon aria-hidden className="h-[18px] w-[18px] shrink-0 text-zinc-400" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {row.hit.title || '（无标题）'}
                            </span>
                            {row.hit.snippet && (
                              <span className="block truncate text-xs text-zinc-400">
                                {row.hit.snippet}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-400">
                            {row.hit.kind === 'concept' ? '概念' : '记录'}
                          </span>
                        </>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>

            {/* 底部按键提示（桌面） */}
            <div className="hidden items-center gap-4 border-t border-zinc-200/70 px-4 py-2 text-[11px] text-zinc-400 sm:flex dark:border-zinc-800/70">
              <Hint icon={<ArrowUpIcon className="h-3 w-3" />} extra={<ArrowDownIcon className="h-3 w-3" />}>
                选择
              </Hint>
              <Hint icon={<EnterIcon className="h-3 w-3" />}>打开</Hint>
              <span className="ml-auto inline-flex items-center gap-1">
                <kbd className="rounded border border-zinc-200 px-1 py-px font-medium dark:border-zinc-700">
                  ⌘K
                </kbd>
                呼出 / 收起
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Hint({
  icon,
  extra,
  children,
}: {
  icon: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-0.5 rounded border border-zinc-200 px-1 py-px dark:border-zinc-700">
        {icon}
        {extra}
      </span>
      {children}
    </span>
  );
}
