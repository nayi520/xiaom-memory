'use client';

import type { RecentItem } from '../types';
import NoteDeleteButton from './NoteDeleteButton';

const TYPE_ICON: Record<string, string> = {
  text: '✏️',
  voice: '🎙️',
  link: '🔗',
  image: '🖼️',
};

function preview(item: RecentItem): string {
  const text = item.transcript || item.raw_content || item.url || '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
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
}: {
  items: RecentItem[];
  onTrash?: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        最近记录
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-xl border bg-white px-4 py-3 text-sm transition dark:bg-zinc-900 ${
              item.failed
                ? 'border-red-300 dark:border-red-900'
                : 'border-zinc-200 dark:border-zinc-800'
            } ${item.pending ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">{TYPE_ICON[item.type] ?? '📝'}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words leading-relaxed">{preview(item)}</p>
                {item.why_important && (
                  <p className="mt-1 text-xs text-zinc-400">
                    💡 {item.why_important}
                  </p>
                )}
                <p className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                  <span>{timeAgo(item.created_at)}</span>
                  {item.pending && <span className="text-brand">保存中…</span>}
                  {!item.pending && !item.failed && !item.hint && (
                    <span className="text-emerald-500">✓ 已记下</span>
                  )}
                  {item.hint && <span className="text-amber-500">{item.hint}</span>}
                  {item.failed && <span className="text-red-500">✕ 失败</span>}
                </p>
              </div>
              {/* 已落库的记录才可删除（乐观占位 / 保存中不显示） */}
              {!item.pending && !item.failed && !item.id.startsWith('temp-') && (
                <NoteDeleteButton
                  noteId={item.id}
                  onTrashed={() => onTrash?.(item.id)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
