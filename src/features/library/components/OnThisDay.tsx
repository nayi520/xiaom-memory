'use client';

/**
 * 「历史上的今天」（V15）：拉 /api/notes/on-this-day，展示同月日往期记录。
 * 无数据则整块不渲染（不占位）；加载中静默（首屏不闪空状态）。
 * 客户端组件：避免给知识库服务端页再加一次查询，且天然可在任意页面复用。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClockIcon, NoteTypeIcon, ChevronRight, cardClass, cn } from '@/components/ui';

interface OnThisDayNote {
  id: string;
  type: string;
  rawContent: string | null;
  summary: string | null;
  createdAt: string;
}

function excerpt(text: string | null | undefined, max = 90): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '（无文字内容）';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function yearOf(iso: string): number {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getFullYear();
}

export default function OnThisDay() {
  const [notes, setNotes] = useState<OnThisDayNote[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/notes/on-this-day')
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((data) => {
        if (alive) setNotes(Array.isArray(data.notes) ? data.notes : []);
      })
      .catch(() => {
        if (alive) setNotes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 未加载完 / 无数据：整块不渲染。
  if (!notes || notes.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
        <ClockIcon aria-hidden className="h-[18px] w-[18px] text-brand" />
        历史上的今天
      </div>
      <ul className="space-y-2.5">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              href={`/library/note/${n.id}`}
              className={cn(cardClass({ interactive: true, padded: false }), 'group block px-4 py-3.5')}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
                  <NoteTypeIcon type={n.type} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                    {excerpt(n.summary || n.rawContent)}
                  </p>
                  <p className="mt-1.5 inline-flex items-center text-xs text-zinc-400">
                    {yearOf(n.createdAt)} 年 ·{' '}
                    {new Date(n.createdAt).toLocaleDateString('zh-CN')}
                    <span className="mx-1">·</span>
                    <span className="inline-flex items-center text-brand/70 transition group-hover:text-brand">
                      查看
                      <ChevronRight aria-hidden className="h-3 w-3" />
                    </span>
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
