'use client';

/**
 * 回收站列表（V10 乐观更新）——拥有列表数据，恢复 / 永久删除即时从列表移除，
 * 失败回滚复原。列表清空后展示空态。渲染与原服务端列表一致（图标 + 预览 + 操作）。
 *
 * 数据由 /trash 服务端页传入（已鉴权 + userId 过滤）；本组件只做 UI 与乐观态，不取数。
 */

import { useState } from 'react';
import TrashItemActions from './TrashItemActions';
import {
  EmptyState,
  NoteTypeIcon,
  WhyIcon,
  TrashIcon,
} from '@/components/ui';

export interface TrashedNote {
  id: string;
  type: string;
  raw_content: string | null;
  transcript: string | null;
  url: string | null;
  why_important: string | null;
  summary: string | null;
  deleted_at: string;
}

function preview(note: TrashedNote): string {
  const text = note.summary || note.raw_content || note.transcript || note.url || '';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export default function TrashList({ initialItems }: { initialItems: TrashedNote[] }) {
  const [items, setItems] = useState<TrashedNote[]>(initialItems);
  // 乐观移除的条目暂存，便于失败回滚（id → 原 note 与其在列表中的位置）。
  const [pendingRemoval, setPendingRemoval] = useState<Map<string, { note: TrashedNote; index: number }>>(
    new Map()
  );

  function removeOptimistic(id: string) {
    setItems((prev) => {
      const index = prev.findIndex((n) => n.id === id);
      if (index < 0) return prev;
      const note = prev[index];
      setPendingRemoval((m) => new Map(m).set(id, { note, index }));
      return prev.filter((n) => n.id !== id);
    });
  }

  function rollback(id: string) {
    setPendingRemoval((m) => {
      const entry = m.get(id);
      if (entry) {
        setItems((prev) => {
          if (prev.some((n) => n.id === id)) return prev; // 已在列表则不重复插入
          const next = [...prev];
          next.splice(Math.min(entry.index, next.length), 0, entry.note);
          return next;
        });
      }
      const nm = new Map(m);
      nm.delete(id);
      return nm;
    });
  }

  function settle(id: string) {
    setPendingRemoval((m) => {
      const nm = new Map(m);
      nm.delete(id);
      return nm;
    });
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<TrashIcon aria-hidden className="h-7 w-7" />}
        title="回收站是空的"
        description="删除的记录会出现在这里，随时可以恢复。"
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      {items.map((note) => (
        <li
          key={note.id}
          className="animate-fade-in rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-sm shadow-card dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
              <NoteTypeIcon type={note.type} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words leading-relaxed text-zinc-700 dark:text-zinc-200">
                {preview(note) || '（无文字内容）'}
              </p>
              {note.why_important && (
                <p className="mt-1 flex items-start gap-1 text-xs text-zinc-400">
                  <WhyIcon aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="min-w-0">{note.why_important}</span>
                </p>
              )}
              <p className="mt-1.5 text-xs text-zinc-400">
                删除于 {new Date(note.deleted_at).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
          <TrashItemActions
            noteId={note.id}
            onOptimisticRemove={() => removeOptimistic(note.id)}
            onRollback={() => rollback(note.id)}
            onSettled={() => settle(note.id)}
          />
        </li>
      ))}
    </ul>
  );
}
