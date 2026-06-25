'use client';

/**
 * 行动项列表（V28 client 交互）——拥有 open/done 两组数据，勾选即乐观移动并持久化。
 *
 * - 未完成区：复选框（未勾）+ 待办文本 + 来源（类型图标 + 标题摘要 + 日期，点击跳来源记录）。
 *   勾上 → 乐观从 open 移到 done，POST /api/todos/toggle {done:true}；失败回滚 + toast。
 * - 已完成区：可折叠（<details>），复选框（已勾）；取消勾选 → 乐观移回 open，POST {done:false}。
 * - 空状态：open + done 皆空时给友好引导文案。
 *
 * 数据由 /todos 服务端页直出（已鉴权 + userId 过滤）；勾选并发用 itemId（noteId:itemKey）去重。
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { TodoItem } from '@/features/todos';
import {
  Button,
  EmptyState,
  NoteTypeIcon,
  NOTE_TYPE_LABELS,
  CheckSquareIcon,
  SquareIcon,
  ChevronDown,
  VoiceIcon,
  useToast,
  cn,
} from '@/components/ui';

/** 行动项唯一标识（同一记录内 itemKey 唯一；跨记录拼 noteId 区分）。 */
function idOf(item: TodoItem): string {
  return `${item.noteId}:${item.itemKey}`;
}

export default function TodoList({
  initialOpen,
  initialDone,
}: {
  initialOpen: TodoItem[];
  initialDone: TodoItem[];
}) {
  const { error: toastError } = useToast();
  const [open, setOpen] = useState<TodoItem[]>(initialOpen);
  const [done, setDone] = useState<TodoItem[]>(initialDone);
  // 正在请求中的项（防重复点击），key = idOf。
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // 「已完成」折叠区展开态：默认仅当一开始没有未完成项时展开（受控，尊重用户手动开合，
  // 避免 controlled <details open> 在后续 re-render 时与用户点击相互打架）。
  const [doneExpanded, setDoneExpanded] = useState(initialOpen.length === 0);

  const markBusy = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** 勾选 / 取消：乐观在两组间移动；失败回滚。done=true 移到已完成，false 移回未完成。 */
  const toggle = useCallback(
    async (item: TodoItem, nextDone: boolean) => {
      const id = idOf(item);
      if (busy.has(id)) return;
      markBusy(id, true);

      // 乐观移动：从源组移除、加入目标组（已完成置顶，便于看到刚勾的）。
      if (nextDone) {
        setOpen((prev) => prev.filter((t) => idOf(t) !== id));
        setDone((prev) => [item, ...prev.filter((t) => idOf(t) !== id)]);
      } else {
        setDone((prev) => prev.filter((t) => idOf(t) !== id));
        setOpen((prev) => [item, ...prev.filter((t) => idOf(t) !== id)]);
      }

      try {
        const res = await apiFetch('/api/todos/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            noteId: item.noteId,
            itemKey: item.itemKey,
            text: item.text,
            done: nextDone,
          }),
        });
        if (!res.ok) {
          // 回滚：把项放回原组。
          rollback(item, nextDone);
          const data = await res.json().catch(() => ({}));
          toastError(data?.error ?? `操作失败（${res.status}）`);
        }
      } catch (err) {
        rollback(item, nextDone);
        toastError(err instanceof Error ? err.message : '网络错误');
      } finally {
        markBusy(id, false);
      }

      function rollback(t: TodoItem, attemptedDone: boolean) {
        const tid = idOf(t);
        if (attemptedDone) {
          // 本想标记完成，失败 → 移回未完成。
          setDone((prev) => prev.filter((x) => idOf(x) !== tid));
          setOpen((prev) => (prev.some((x) => idOf(x) === tid) ? prev : [t, ...prev]));
        } else {
          setOpen((prev) => prev.filter((x) => idOf(x) !== tid));
          setDone((prev) => (prev.some((x) => idOf(x) === tid) ? prev : [t, ...prev]));
        }
      }
    },
    [busy, markBusy, toastError]
  );

  const isEmpty = open.length === 0 && done.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={<CheckSquareIcon aria-hidden className="h-7 w-7" />}
        title="还没有行动项"
        description="录一段语音或会议，小M 整理时会把其中的待办自动汇总到这里，随时勾掉。"
        action={
          <Link href="/">
            <Button variant="secondary" size="sm">
              <VoiceIcon aria-hidden className="h-4 w-4" />
              去录一段
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 未完成 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
          待办
          <span className="rounded-pill bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {open.length}
          </span>
        </h2>
        {open.length === 0 ? (
          <p className="rounded-card border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
            全部完成 🎉
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((item) => (
              <TodoRow
                key={idOf(item)}
                item={item}
                checked={false}
                busy={busy.has(idOf(item))}
                onToggle={() => void toggle(item, true)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* 已完成（可折叠，受控） */}
      {done.length > 0 && (
        <details
          className="group"
          open={doneExpanded}
          onToggle={(e) => setDoneExpanded((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-zinc-600 transition hover:text-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100">
            <ChevronDown
              aria-hidden
              className="h-4 w-4 text-zinc-400 transition-transform duration-200 group-open:rotate-0 -rotate-90"
            />
            已完成
            <span className="rounded-pill bg-zinc-100 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {done.length}
            </span>
          </summary>
          <ul className="mt-3 space-y-2">
            {done.map((item) => (
              <TodoRow
                key={idOf(item)}
                item={item}
                checked
                busy={busy.has(idOf(item))}
                onToggle={() => void toggle(item, false)}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 单条行动项行：复选框 + 文本 + 来源（图标 / 标题 / 日期，点击跳记录）。 */
function TodoRow({
  item,
  checked,
  busy,
  onToggle,
}: {
  item: TodoItem;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const typeLabel = NOTE_TYPE_LABELS[item.noteType] ?? item.noteType;
  const dateLabel = formatDate(item.createdAt);

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-card border bg-white px-4 py-3 shadow-card transition dark:bg-zinc-900',
        checked
          ? 'border-zinc-200/70 dark:border-zinc-800'
          : 'border-zinc-200/80 dark:border-zinc-800'
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? '标记为未完成' : '标记为完成'}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          'mt-0.5 shrink-0 rounded-md transition focus-visible:outline-none disabled:opacity-50',
          checked ? 'text-brand' : 'text-zinc-300 hover:text-brand dark:text-zinc-600'
        )}
      >
        {checked ? (
          <CheckSquareIcon aria-hidden className="h-5 w-5" />
        ) : (
          <SquareIcon aria-hidden className="h-5 w-5" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'break-words text-sm leading-relaxed',
            checked
              ? 'text-zinc-400 line-through dark:text-zinc-500'
              : 'text-zinc-800 dark:text-zinc-100'
          )}
        >
          {item.text}
        </p>
        {/* 来源记录：类型图标 + 标题摘要 + 日期，整行可点击跳详情。 */}
        <Link
          href={`/library/note/${item.noteId}`}
          className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs text-zinc-400 transition hover:text-brand focus-visible:outline-none dark:hover:text-brand-100"
        >
          <NoteTypeIcon type={item.noteType} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{item.noteTitle}</span>
          <span className="shrink-0 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="shrink-0 tabular-nums">{dateLabel}</span>
          <span className="sr-only">（来源：{typeLabel}记录）</span>
        </Link>
      </div>
    </li>
  );
}

/** 日期格式化：今年省略年份，跨年带年份；非法时间回退原串。 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}
