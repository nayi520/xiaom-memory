'use client';

/**
 * 时间线列表（/timeline 页主体）。
 *   - 挂载时 GET /api/notes/timeline?limit=30 拉首页，按 createdAt 倒序展示全部未删记录。
 *   - 「加载更多」用上一页 nextCursor 作 before 续拉，直到 nextCursor 为 null。
 *   - 正文用设计系统 Markdown 渲染（与最近记录 / 记录详情一致）；点卡片进记录详情。
 *
 * 纯前端组件，数据来自端点（端点已做 getCurrentUser 鉴权 + userId 过滤）。
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Markdown, Badge, EmptyState, cn } from '@/components/ui';

const TYPE_ICON: Record<string, string> = {
  text: '✏️',
  voice: '🎙️',
  link: '🔗',
  image: '🖼️',
};

const STATUS_BADGE: Record<
  string,
  { tone: 'neutral' | 'brand' | 'amber' | 'sky' | 'emerald' | 'red'; label: string }
> = {
  inbox: { tone: 'brand', label: '待整理' },
  processed: { tone: 'emerald', label: '已整理' },
  needs_review: { tone: 'amber', label: '待处理' },
  archived: { tone: 'neutral', label: '已归档' },
};

interface TimelineNote {
  id: string;
  type: string;
  rawContent: string | null;
  summary: string | null;
  createdAt: string;
  status: string;
}

function bodyOf(n: TimelineNote): string {
  return n.rawContent || n.summary || '';
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return d.toLocaleString('zh-CN');
}

type Phase = 'loading' | 'ready' | 'loadingMore' | 'error';

export default function TimelineFeed() {
  const [notes, setNotes] = useState<TimelineNote[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: string | null) => {
    const params = new URLSearchParams({ limit: '30' });
    if (before) params.set('before', before);
    const res = await fetch(`/api/notes/timeline?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error ?? `加载失败（${res.status}）`);
    }
    return data as { notes: TimelineNote[]; nextCursor: string | null };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    load(null)
      .then((data) => {
        if (cancelled) return;
        setNotes(data.notes);
        setCursor(data.nextCursor);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '网络错误');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function loadMore() {
    if (!cursor || phase === 'loadingMore') return;
    setPhase('loadingMore');
    try {
      const data = await load(cursor);
      setNotes((prev) => [...prev, ...data.notes]);
      setCursor(data.nextCursor);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setPhase('error');
    }
  }

  if (phase === 'loading') {
    return (
      <ul className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <li
            key={i}
            className="h-20 animate-pulse rounded-card border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          />
        ))}
      </ul>
    );
  }

  if (phase === 'error' && notes.length === 0) {
    return (
      <EmptyState
        icon="⚠️"
        title="加载失败"
        description={error ?? '请稍后重试。'}
      />
    );
  }

  if (notes.length === 0) {
    return (
      <EmptyState
        icon="🕊️"
        title="还没有记录"
        description="去记点东西，它们会按时间出现在这里。"
      />
    );
  }

  return (
    <>
      <ul className="space-y-2.5">
        {notes.map((note) => {
          const badge = STATUS_BADGE[note.status];
          return (
            <li key={note.id}>
              <Link
                href={`/library/note/${note.id}`}
                className="group block animate-fade-in rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-sm shadow-card transition duration-200 hover:border-brand/40 hover:shadow-card-hover dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-base leading-none">
                    {TYPE_ICON[note.type] ?? '📝'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="relative max-h-32 overflow-hidden">
                      <Markdown
                        content={bodyOf(note) || '（无文字内容）'}
                        className="text-zinc-800 dark:text-zinc-100"
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span>{timeLabel(note.createdAt)}</span>
                      {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="mt-0.5 shrink-0 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
                  >
                    ›
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {error && phase === 'error' && (
        <p className="mt-3 text-center text-sm text-red-500">{error}</p>
      )}

      {cursor && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={loadMore}
            loading={phase === 'loadingMore'}
            className={cn(phase === 'loadingMore' && 'cursor-wait')}
          >
            {phase === 'loadingMore' ? '加载中…' : '加载更多'}
          </Button>
        </div>
      )}
    </>
  );
}
