'use client';

/**
 * 时间线列表（/timeline 页主体）。
 *   - 挂载时 GET /api/notes/timeline?limit=30 拉首页，按 createdAt 倒序展示全部未删记录。
 *   - 「加载更多」用上一页 nextCursor 作 before 续拉，直到 nextCursor 为 null。
 *   - 正文用设计系统 Markdown 渲染（与最近记录 / 记录详情一致）；点卡片进记录详情。
 *
 * 性能（V10）：
 *   - 加载态用统一 Skeleton（替代裸 pulse），错误态用统一 ErrorState。
 *   - 长列表窗口化：累计超过 VIRTUALIZE_THRESHOLD 条后切换为单列虚拟滚动
 *     （useVirtualList，仅渲染视口附近行），短列表保持双列网格不变。
 *
 * 纯前端组件，数据来自端点（端点已做 getCurrentUser 鉴权 + userId 过滤）。
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useVirtualList } from '@/components/useVirtualList';
import {
  Button,
  Markdown,
  Badge,
  EmptyState,
  EmptyTimeline,
  ErrorState,
  SkeletonCard,
  NoteTypeIcon,
  ChevronRight,
  cn,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';

/** 累计条数超过此阈值后启用窗口化（单列虚拟滚动）；以下保持双列网格。 */
const VIRTUALIZE_THRESHOLD = 40;
/** 虚拟滚动单行估高（px，含间距）；实际高度挂载后由 ResizeObserver 回填。 */
const ESTIMATED_ROW_HEIGHT = 116;

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
    const res = await apiFetch(`/api/notes/timeline?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error ?? `加载失败（${res.status}）`);
    }
    return data as { notes: TimelineNote[]; nextCursor: string | null };
  }, []);

  const loadFirst = useCallback(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
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

  useEffect(() => loadFirst(), [loadFirst]);

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
      <ul
        className="grid grid-cols-1 gap-2.5 xl:grid-cols-2"
        role="status"
        aria-busy
        aria-label="正在加载时间线"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i}>
            <SkeletonCard className="h-20" />
          </li>
        ))}
      </ul>
    );
  }

  if (phase === 'error' && notes.length === 0) {
    return <ErrorState description={error ?? '请稍后重试。'} onRetry={loadFirst} />;
  }

  if (notes.length === 0) {
    return (
      <EmptyState
        art={<EmptyTimeline />}
        title="还没有记录"
        description="记下想法、剪藏链接或说一段话，它们会按时间出现在这里。"
        action={
          <Link href="/">
            <Button variant="secondary" size="sm">
              去记录
            </Button>
          </Link>
        }
      />
    );
  }

  const virtualize = notes.length > VIRTUALIZE_THRESHOLD;

  return (
    <>
      {virtualize ? (
        <VirtualizedList notes={notes} />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          {notes.map((note) => (
            <li key={note.id}>
              <TimelineCard note={note} />
            </li>
          ))}
        </ul>
      )}

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

/** 单列窗口化列表：长列表只渲染视口附近的卡片，避免一次性挂载上千 DOM 节点。 */
function VirtualizedList({ notes }: { notes: TimelineNote[] }) {
  const { containerRef, virtualItems, topPad, bottomPad } = useVirtualList({
    count: notes.length,
    estimateHeight: () => ESTIMATED_ROW_HEIGHT,
    overscan: 6,
  });

  return (
    <div ref={containerRef}>
      {/* 上占位：撑出区间以上行的总高，保证滚动条与定位正确。 */}
      <div style={{ height: topPad }} aria-hidden />
      <ul className="space-y-2.5">
        {virtualItems.map(({ index, measureRef }) => {
          const note = notes[index];
          if (!note) return null;
          return (
            <li key={note.id} ref={measureRef}>
              <TimelineCard note={note} />
            </li>
          );
        })}
      </ul>
      <div style={{ height: bottomPad }} aria-hidden />
    </div>
  );
}

/** 单条时间线卡片（网格 / 虚拟列表共用）。 */
function TimelineCard({ note }: { note: TimelineNote }) {
  const badge = STATUS_BADGE[note.status];
  return (
    <Link
      href={`/library/note/${note.id}`}
      className="group block animate-fade-in rounded-card border border-zinc-200/80 bg-white px-4 py-3.5 text-sm shadow-card transition duration-200 hover:border-brand/40 hover:shadow-card-hover dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500">
          <NoteTypeIcon type={note.type} className="h-[18px] w-[18px]" />
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
        <ChevronRight
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand dark:text-zinc-600"
        />
      </div>
    </Link>
  );
}
