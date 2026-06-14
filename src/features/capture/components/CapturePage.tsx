'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Note } from '@/lib/types';
import type { CaptureTab, RecentItem } from '../types';
import TextCapture from './TextCapture';
import VoiceCapture from './VoiceCapture';
import LinkCapture from './LinkCapture';
import RecentNotes from './RecentNotes';
import { PageShell, TextIcon, VoiceIcon, LinkIcon, useToast, cn } from '@/components/ui';
import type { LucideIcon } from '@/components/ui';

const TABS: { key: CaptureTab; label: string; Icon: LucideIcon }[] = [
  { key: 'text', label: '文本', Icon: TextIcon },
  { key: 'voice', label: '语音', Icon: VoiceIcon },
  { key: 'link', label: '链接', Icon: LinkIcon },
];

export default function CapturePage() {
  const [tab, setTab] = useState<CaptureTab>('text');
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const { error: toastError } = useToast();

  // 加载最近 3 条
  useEffect(() => {
    let cancelled = false;
    fetch('/api/notes?limit=3')
      .then((res) => (res.ok ? res.json() : { notes: [] }))
      .then((data: { notes?: Note[] }) => {
        if (!cancelled && data.notes) setRecent(data.notes as RecentItem[]);
      })
      .catch(() => {
        /* 网络错误：最近列表留空 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 乐观插入一条（提交瞬间调用） */
  const addOptimistic = useCallback((item: RecentItem) => {
    setRecent((prev) => [item, ...prev].slice(0, 3));
  }, []);

  /** 服务端确认后用真实数据替换 */
  const confirmNote = useCallback((tempId: string, note: Note, hint?: string) => {
    setRecent((prev) =>
      prev.map((n) =>
        n.id === tempId ? ({ ...note, pending: false, hint } as RecentItem) : n
      )
    );
  }, []);

  /** 更新某条（如转写完成） */
  const updateNote = useCallback((id: string, patch: Partial<RecentItem>) => {
    setRecent((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  /** 提交失败标记：列表内保留红色「失败」徽标作持久态，同时弹 toast 即时告知。 */
  const failNote = useCallback(
    (tempId: string, message?: string) => {
      setRecent((prev) =>
        prev.map((n) =>
          n.id === tempId ? { ...n, pending: false, failed: true, hint: message } : n
        )
      );
      toastError(message || '保存失败，请重试');
    },
    [toastError]
  );

  /** 软删后从最近列表乐观移除（F5） */
  const removeNote = useCallback((id: string) => {
    setRecent((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handlers = { addOptimistic, confirmNote, updateNote, failNote };

  return (
    <PageShell>
      <header className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-sm font-bold text-white shadow-card">
            小M
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              记录此刻
            </h1>
            <p className="text-xs text-zinc-400">想留住的，先记下来</p>
          </div>
        </div>
      </header>

      {/* 记录类型分段切换（底部 tab 栏让位给全局导航） */}
      <div
        role="tablist"
        aria-label="记录类型"
        className="mb-5 flex gap-1 rounded-field bg-zinc-100/80 p-1 dark:bg-zinc-800/80"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] py-2.5 text-sm transition duration-200 ease-smooth focus-visible:outline-none',
              tab === t.key
                ? 'bg-white font-semibold text-brand shadow-card dark:bg-zinc-900'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            )}
          >
            <t.Icon aria-hidden className="h-[18px] w-[18px]" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1">
        <div key={tab} className="animate-fade-in">
          {tab === 'text' && <TextCapture {...handlers} />}
          {tab === 'voice' && <VoiceCapture {...handlers} />}
          {tab === 'link' && <LinkCapture {...handlers} />}
        </div>

        <RecentNotes items={recent} onTrash={removeNote} />
      </div>
    </PageShell>
  );
}
