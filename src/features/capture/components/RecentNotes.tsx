'use client';

import { useState } from 'react';
import type { RecentItem } from '../types';
import NoteDeleteButton from './NoteDeleteButton';
import RecentNoteEditor from './RecentNoteEditor';
import NoteImage from '@/features/library/components/NoteImage';
import {
  SectionTitle,
  Badge,
  Markdown,
  NoteTypeIcon,
  WhyIcon,
  EditIcon,
  SuccessIcon,
  FailIcon,
  RestoreIcon,
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
  className,
  /** 列表为空时是否仍渲染区块（桌面右栏常驻用），并显示占位提示。 */
  keepWhenEmpty = false,
}: {
  items: RecentItem[];
  onTrash?: (id: string) => void;
  /** 就地编辑保存成功后把最新字段写回该条（V13）。 */
  onEdited?: (id: string, patch: Partial<RecentItem>) => void;
  className?: string;
  keepWhenEmpty?: boolean;
}) {
  // 当前处于就地编辑态的记录 id（同一时刻只编辑一条）。
  const [editingId, setEditingId] = useState<string | null>(null);

  if (items.length === 0 && !keepWhenEmpty) return null;

  return (
    <section className={cn('mt-10 lg:mt-0', className)}>
      <SectionTitle>最近记录</SectionTitle>
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
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'group animate-fade-in rounded-card border bg-white px-4 py-3.5 text-sm shadow-card transition duration-200 dark:bg-zinc-900',
              item.failed
                ? 'border-red-300 dark:border-red-900'
                : item.queued
                  ? 'border-sky-300/70 dark:border-sky-900/70'
                  : 'border-zinc-200/80 dark:border-zinc-800',
              item.pending && 'opacity-70'
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
              {/* 已落库的记录：就地编辑 + 删除（乐观占位 / 保存中不显示） */}
              {isPersisted(item) && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {onEdited && (
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      aria-label="编辑"
                      title="编辑"
                      className="rounded-md p-1.5 text-zinc-400 opacity-0 transition hover:bg-zinc-100 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
                    >
                      <EditIcon aria-hidden className="h-4 w-4" />
                    </button>
                  )}
                  <NoteDeleteButton
                    noteId={item.id}
                    onTrashed={() => onTrash?.(item.id)}
                  />
                </div>
              )}
            </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
