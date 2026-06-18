'use client';

import { useCallback, useMemo, useState } from 'react';
import type { RecentItem } from '../types';
import { useCoarsePointer } from '@/components/useCoarsePointer';
import NoteDeleteButton from './NoteDeleteButton';
import RecentNoteEditor from './RecentNoteEditor';
import NoteImage from '@/features/library/components/NoteImage';
import {
  useSelection,
  useLongPress,
  useNoteBatch,
  SelectionToolbar,
  SelectCheckbox,
  trashNote,
  restoreNote,
  addTagsToNote,
} from '@/features/selection';
import {
  SectionTitle,
  Badge,
  Markdown,
  NoteTypeIcon,
  WhyIcon,
  EditIcon,
  CheckSquareIcon,
  SuccessIcon,
  FailIcon,
  RestoreIcon,
  useToast,
  cn,
} from '@/components/ui';

/** 最近记录正文（raw_content/transcript，Markdown 渲染）；纯链接类无正文时回退 URL 文本。 */
function bodyOf(item: RecentItem): string {
  return item.raw_content || item.transcript || item.url || '';
}

/** 是否为已落库（可编辑/可删/可显示图片）的真实记录（非乐观占位/保存中/失败）。 */
function isPersisted(item: RecentItem): boolean {
  return !item.pending && !item.failed && !item.queued && !item.id.startsWith('temp-');
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export default function RecentNotes({
  items,
  onTrash,
  onEdited,
  onRestored,
  className,
  /** 列表为空时是否仍渲染区块（桌面右栏常驻用），并显示占位提示。 */
  keepWhenEmpty = false,
}: {
  items: RecentItem[];
  onTrash?: (id: string) => void;
  /** 就地编辑保存成功后把最新字段写回该条（V13）。 */
  onEdited?: (id: string, patch: Partial<RecentItem>) => void;
  /** 撤销删除 / 批量删除后回调：让父级重拉最近列表，恢复的记录重新出现（V20）。 */
  onRestored?: () => void;
  className?: string;
  keepWhenEmpty?: boolean;
}) {
  // 当前处于就地编辑态的记录 id（同一时刻只编辑一条）。
  const [editingId, setEditingId] = useState<string | null>(null);
  // 触摸屏：编辑/删除按钮无 hover 可触发，故常驻显示且加大命中区（桌面保持 hover 浮现）。
  const coarse = useCoarsePointer();
  const { toast, error: toastError } = useToast();

  // 多选批量（V20）：仅对已落库记录可选；批量打标签 / 删除（可撤销，撤销后重拉列表）。
  const selection = useSelection();
  const batch = useNoteBatch();
  const selectableIds = useMemo(
    () => items.filter((n) => isPersisted(n)).map((n) => n.id),
    [items]
  );
  const selectedIds = useMemo(() => Array.from(selection.selected), [selection.selected]);

  const batchTag = useCallback(
    async (tags: string[]) => {
      const ids = selectedIds.slice();
      selection.exit();
      await batch.run({ ids, run: (id) => addTagsToNote(id, tags), verb: '打标签' });
    },
    [selectedIds, selection, batch]
  );

  const batchTrash = useCallback(async () => {
    const ids = selectedIds.slice();
    ids.forEach((id) => onTrash?.(id));
    selection.exit();
    await batch.run({
      ids,
      run: trashNote,
      verb: '删除',
      // 撤销：对成功项 restore 后重拉列表（恢复的记录重新出现）。
      undo: { run: restoreNote, onUndoUI: () => onRestored?.() },
    });
  }, [selectedIds, onTrash, selection, batch, onRestored]);

  /** 单条删除成功 → 给「已删除 · 撤销」（撤销=restore 后重拉列表）。 */
  const onTrashedOne = useCallback(
    (id: string) => {
      onTrash?.(id);
      toast('已移到回收站', {
        variant: 'success',
        action: {
          label: '撤销',
          onClick: async () => {
            try {
              await restoreNote(id);
              onRestored?.();
            } catch (err) {
              toastError(err instanceof Error ? err.message : '撤销失败');
            }
          },
        },
      });
    },
    [onTrash, onRestored, toast, toastError]
  );

  if (items.length === 0 && !keepWhenEmpty) return null;

  const allSelected =
    selectableIds.length > 0 && selection.count >= selectableIds.length;

  return (
    <section className={cn('mt-10 lg:mt-0', className)}>
      <div className="flex items-center justify-between">
        <SectionTitle>最近记录</SectionTitle>
        {/* 「选择」入口：有可选记录且未在选择态时显示。 */}
        {selectableIds.length > 0 && !selection.active && (
          <button
            type="button"
            onClick={selection.enter}
            className="-mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-brand focus-visible:outline-none dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <CheckSquareIcon aria-hidden className="h-3.5 w-3.5" />
            选择
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="rounded-card border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            还没有任何记录
          </p>
          <p className="mx-auto mt-1 max-w-[15rem] text-xs leading-relaxed text-zinc-400">
            在上方记下第一条——一句想法、一段语音或一个链接都行。记完它会出现在这里，当晚小M 自动整理成概念。
          </p>
        </div>
      ) : (
      <ul className="space-y-2.5">
        {items.map((item) => {
          const persisted = isPersisted(item);
          const selectable = persisted && selection.active;
          const selected = selection.isSelected(item.id);
          return (
          <RecentRow
            key={item.id}
            persisted={persisted}
            selectionActive={selection.active}
            onLongPress={() => selection.enterWith(item.id)}
            onToggle={() => selection.toggle(item.id)}
            className={cn(
              'group animate-fade-in rounded-card border bg-white px-4 py-3.5 text-sm shadow-card transition duration-200 dark:bg-zinc-900',
              selected
                ? 'border-brand/50 ring-1 ring-brand/30'
                : item.failed
                  ? 'border-red-300 dark:border-red-900'
                  : item.queued
                    ? 'border-sky-300/70 dark:border-sky-900/70'
                    : 'border-zinc-200/80 dark:border-zinc-800',
              item.pending && 'opacity-70',
              selectable && 'cursor-pointer'
            )}
          >
            {editingId === item.id ? (
              <RecentNoteEditor
                item={item}
                onSaved={(patch) => {
                  onEdited?.(item.id, patch);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
            <div className="flex items-start gap-2.5">
              {selection.active && persisted && (
                <SelectCheckbox
                  checked={selected}
                  onChange={() => selection.toggle(item.id)}
                  className="-ml-1 mt-0.5"
                />
              )}
              <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
                <NoteTypeIcon type={item.type} className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                {/* 图片记录：签名 URL 缩略图（懒加载、占位防抖）。 */}
                {item.type === 'image' && item.media_path && isPersisted(item) && (
                  <NoteImage
                    mediaPath={item.media_path}
                    alt={bodyOf(item) || '图片记录'}
                    className="mb-2 max-h-40"
                  />
                )}
                {/* 正文用 Markdown 渲染；feed 里保持紧凑，超高度淡出截断（max-h + overflow） */}
                <div className="relative max-h-32 overflow-hidden">
                  <Markdown
                    content={bodyOf(item)}
                    className="text-zinc-800 dark:text-zinc-100"
                  />
                </div>
                {item.why_important && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-zinc-400">
                    <WhyIcon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="min-w-0">{item.why_important}</span>
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span>{timeAgo(item.created_at)}</span>
                  {item.pending && (
                    <Badge tone="brand">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      保存中
                    </Badge>
                  )}
                  {item.queued && (
                    <Badge tone="sky">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                      待同步
                    </Badge>
                  )}
                  {!item.pending && !item.queued && !item.failed && !item.hint && (
                    <Badge tone="emerald">
                      <SuccessIcon aria-hidden className="h-3 w-3" />
                      已记下
                    </Badge>
                  )}
                  {item.hint && <Badge tone="amber">{item.hint}</Badge>}
                  {item.failed && (
                    <Badge tone="red">
                      <FailIcon aria-hidden className="h-3 w-3" />
                      失败
                    </Badge>
                  )}
                  {item.failed && item.retry && (
                    <button
                      type="button"
                      onClick={item.retry}
                      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium text-brand transition hover:bg-brand/10 focus-visible:outline-none dark:hover:bg-brand/15"
                    >
                      <RestoreIcon aria-hidden className="h-3 w-3" />
                      重试
                    </button>
                  )}
                </div>
              </div>
              {/* 已落库的记录：就地编辑 + 删除（乐观占位 / 保存中不显示）。
                  触摸屏常驻显示并加大命中区；桌面保持 hover 浮现、紧凑。选择态隐藏，避免误触。 */}
              {persisted && !selection.active && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {onEdited && (
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      aria-label="编辑"
                      title="编辑"
                      className={cn(
                        'flex items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800',
                        coarse ? 'touch-target opacity-100' : 'p-1.5 opacity-0'
                      )}
                    >
                      <EditIcon aria-hidden className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  <NoteDeleteButton
                    noteId={item.id}
                    onTrashed={() => onTrashedOne(item.id)}
                  />
                </div>
              )}
            </div>
            )}
          </RecentRow>
          );
        })}
      </ul>
      )}

      {/* 选择态底部工具栏：打标签 / 删除（可撤销）。 */}
      {selection.active && (
        <SelectionToolbar
          count={selection.count}
          total={selectableIds.length}
          allSelected={allSelected}
          onToggleSelectAll={() =>
            allSelected ? selection.clear() : selection.selectAll(selectableIds)
          }
          onExit={selection.exit}
          onTag={batchTag}
          onTrash={batchTrash}
          busy={batch.busy}
        />
      )}
    </section>
  );
}

/**
 * 最近记录列表项容器（<li>）：
 *  - 非选择态：仅在触摸屏上绑定长按（进入选择模式）；其余行为不变。
 *  - 选择态：整行点击切换选中（已落库记录），勾选框另在行内。
 * 不影响行内既有编辑/删除按钮（它们自行 stopPropagation 或在选择态隐藏）。
 */
function RecentRow({
  persisted,
  selectionActive,
  onLongPress,
  onToggle,
  className,
  children,
}: {
  persisted: boolean;
  selectionActive: boolean;
  onLongPress: () => void;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // 长按仅在触摸屏 + 非选择态 + 已落库记录时启用。
  const longPress = useLongPress(onLongPress, !selectionActive && persisted);
  return (
    <li
      className={className}
      {...(selectionActive ? {} : longPress)}
      onClick={selectionActive && persisted ? onToggle : undefined}
    >
      {children}
    </li>
  );
}
