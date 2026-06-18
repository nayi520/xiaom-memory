'use client';

/**
 * 知识库搜索框（V22）—— 即时搜索（as-you-type，防抖）+ 最近搜索 + 无障碍组合框。
 *
 * 行为：
 *  - 输入防抖 350ms 后，用 router.replace 跳到 /library?q=…（复用既有 SSR 搜索路径，不另起接口）。
 *    用 replace 不污染历史（连打字不会塞一堆历史项）；清空则回到 /library。
 *  - 提交（回车）/ 选中最近项：用 push 落一条历史 + 记入「最近搜索」（localStorage）。
 *  - 聚焦且为空时，下拉展示最近搜索（可点选、可一键清除）；失焦/选中/Esc 收起。
 *  - 仅托管「搜索框」这一岛；筛选 chips、结果区仍是服务端渲染，互不影响。
 *
 * a11y：role=combobox + aria-expanded/aria-controls/aria-activedescendant；
 *   下拉为 role=listbox，项为 role=option；键盘 ↑/↓ 选择、Enter 确认、Esc 收起。
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon, CloseIcon, ClockIcon, cn } from '@/components/ui';
import {
  readRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
} from '../recent-searches';

const DEBOUNCE_MS = 350;

export default function LibrarySearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const listboxId = useId();
  const [value, setValue] = useState(initialQuery);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 记住「最近一次已经导航过去的查询」，避免 effect 把当前 URL 又导航一遍（含初始水合）。
  const lastNavigated = useRef(initialQuery);
  // 持有最新输入值，供卸载时兜底记录最近搜索（避免空依赖 effect 的陈旧闭包）。
  const valueRef = useRef(value);
  valueRef.current = value;

  // 挂载后读最近搜索（localStorage 只在客户端可用）。
  useEffect(() => {
    setRecent(readRecentSearches());
  }, []);

  // URL→输入同步：外部导航（最近项 <Link> / 浏览器前进后退 / 清除）改了 ?q= 时，
  // 把输入回填成新 q（仅当与本框「最近一次导航值」不同，避免覆盖用户正在打的字）。
  useEffect(() => {
    if (initialQuery !== lastNavigated.current) {
      lastNavigated.current = initialQuery;
      setValue(initialQuery);
    }
    // 仅在 initialQuery（来自 URL 的 q）变化时同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // 即时搜索：输入防抖后 replace 到 /library?q=…（与当前 URL 不同才动作）。
  useEffect(() => {
    const q = value.trim();
    if (q === lastNavigated.current.trim()) return;
    const t = setTimeout(() => {
      lastNavigated.current = q;
      router.replace(q ? `/library?q=${encodeURIComponent(q)}` : '/library');
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, router]);

  // 点击外部收起下拉。
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointer);
    return () => document.removeEventListener('pointerdown', onDocPointer);
  }, [open]);

  /** 立即跳查询（回车/选最近项）：记历史 + 入最近搜索，收起下拉。 */
  const commit = useCallback(
    (raw: string) => {
      const q = raw.trim();
      setOpen(false);
      setActive(-1);
      if (!q) {
        lastNavigated.current = '';
        router.replace('/library');
        return;
      }
      setValue(q);
      setRecent(pushRecentSearch(q));
      lastNavigated.current = q;
      router.push(`/library?q=${encodeURIComponent(q)}`);
    },
    [router]
  );

  // 卸载时若有有效查询，补记一次最近搜索（兜底：用户没回车、直接点结果就跳走了）。
  // 用 valueRef 取最新值，避免空依赖闭包记成初始值。
  useEffect(() => {
    return () => {
      const q = valueRef.current.trim();
      if (q) pushRecentSearch(q);
    };
  }, []);

  // 下拉仅在「聚焦 + 输入为空 + 有最近搜索」时出现。
  const showRecent = open && value.trim() === '' && recent.length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // 有高亮的最近项则选它，否则提交当前输入。
      if (showRecent && active >= 0 && active < recent.length) {
        e.preventDefault();
        commit(recent[active]);
      } else {
        e.preventDefault();
        commit(value);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
      return;
    }
    if (!showRecent) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % recent.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + recent.length) % recent.length);
    }
  }

  return (
    <div ref={rootRef} className="relative mb-5 lg:max-w-xl">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-zinc-400">
          <SearchIcon aria-hidden className="h-[18px] w-[18px]" />
        </span>
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setActive(-1);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索概念、记录、标签…"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={showRecent}
          aria-controls={showRecent ? listboxId : undefined}
          aria-activedescendant={
            showRecent && active >= 0 ? `${listboxId}-opt-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-label="搜索知识库"
          className="w-full rounded-field border border-zinc-200 bg-white py-3 pl-11 pr-10 text-base shadow-sm outline-none transition duration-150 ease-smooth hover:border-zinc-300 focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setActive(-1);
              inputRef.current?.focus();
            }}
            aria-label="清空搜索"
            className="absolute inset-y-0 right-2 my-auto flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <CloseIcon aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>

      {showRecent && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="最近搜索"
          className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-card border border-zinc-200 bg-white py-1 shadow-pop dark:border-zinc-700 dark:bg-zinc-900"
        >
          <li className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-400">最近搜索</span>
            <button
              type="button"
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="rounded text-xs text-zinc-400 transition hover:text-brand focus-visible:outline-none"
            >
              清除
            </button>
          </li>
          {recent.map((r, i) => (
            <li
              key={r}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              // 用 pointerdown 抢在 input blur 前选中（blur 会先于 click 收起下拉）。
              onPointerDown={(e) => {
                e.preventDefault();
                commit(r);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                i === active
                  ? 'bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-100'
                  : 'text-zinc-700 dark:text-zinc-200'
              )}
            >
              <ClockIcon aria-hidden className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="truncate">{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
