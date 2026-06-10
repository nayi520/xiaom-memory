'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Note } from '@/lib/types';
import type { CaptureTab, RecentItem } from '../types';
import TextCapture from './TextCapture';
import VoiceCapture from './VoiceCapture';
import LinkCapture from './LinkCapture';
import RecentNotes from './RecentNotes';

const TABS: { key: CaptureTab; label: string; icon: string }[] = [
  { key: 'text', label: '文本', icon: '✏️' },
  { key: 'voice', label: '语音', icon: '🎙️' },
  { key: 'link', label: '链接', icon: '🔗' },
];

export default function CapturePage() {
  const [tab, setTab] = useState<CaptureTab>('text');
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // 加载最近 3 条
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        if (data) setRecent(data as RecentItem[]);
      });
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

  /** 提交失败标记 */
  const failNote = useCallback((tempId: string, message?: string) => {
    setRecent((prev) =>
      prev.map((n) =>
        n.id === tempId ? { ...n, pending: false, failed: true, hint: message } : n
      )
    );
  }, []);

  const handlers = { addOptimistic, confirmNote, updateNote, failNote };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-24 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand">小M</h1>
      </header>

      {/* 记录类型分段切换（底部 tab 栏让位给全局导航） */}
      <div className="mb-4 flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm transition ${
              tab === t.key
                ? 'bg-white font-semibold text-brand shadow-sm dark:bg-zinc-900'
                : 'text-zinc-400 active:text-zinc-600'
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {tab === 'text' && <TextCapture {...handlers} />}
        {tab === 'voice' && <VoiceCapture {...handlers} />}
        {tab === 'link' && <LinkCapture {...handlers} />}

        <RecentNotes items={recent} />
      </div>
    </main>
  );
}
