'use client';

import { useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { enqueue, isOfflineQueueSupported } from '@/features/offline/queue';
import { Button, Textarea, Input, PlusIcon } from '@/components/ui';

export default function TextCapture({
  addOptimistic,
  confirmNote,
  failNote,
  queueNote,
}: CaptureHandlers) {
  const [content, setContent] = useState('');
  const [why, setWhy] = useState('');
  const [showWhy, setShowWhy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** 发一次新建请求（首次提交与「重试」共用，重试会再上屏一条新乐观占位）。 */
  async function submit(text: string, whyImportant: string | null) {
    const temp = makeTempNote({ type: 'text', raw_content: text, why_important: whyImportant });
    addOptimistic(temp);

    const body = { type: 'text', raw_content: text, why_important: whyImportant };

    // 离线（且支持本地队列）：直接入队，不发请求，UI 标「待同步」。
    if (isOfflineQueueSupported() && typeof navigator !== 'undefined' && !navigator.onLine) {
      // 复用占位 id 作幂等键，让队列项与该占位一一对应。
      await enqueue('note', body, temp.id).catch(() => {});
      queueNote(temp.id);
      return;
    }

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.note) {
        confirmNote(temp.id, data.note as Note);
      } else {
        failNote(temp.id, data.error || '保存失败，请重试', () => submit(text, whyImportant));
      }
    } catch {
      // 网络错误（提交途中掉线/不稳）：落入本地队列兜底，不丢这条捕获。
      if (isOfflineQueueSupported()) {
        await enqueue('note', body, temp.id).catch(() => {});
        queueNote(temp.id);
      } else {
        failNote(temp.id, '网络错误，保存失败', () => submit(text, whyImportant));
      }
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = content.trim();
    if (!text) return;

    // 乐观 UI：立即清空，可连续记录
    setContent('');
    setWhy('');
    textareaRef.current?.focus();
    void submit(text, why.trim() || null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Cmd/Ctrl + Enter 快速提交
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        ref={textareaRef}
        autoFocus
        rows={4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="记下此刻想留住的内容…（支持 Markdown）"
        className="rounded-card p-4"
      />

      {showWhy ? (
        <Input
          autoFocus
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="为什么觉得重要？（一句话，可不填）"
          className="px-4 py-2.5 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowWhy(true)}
          className="inline-flex items-center gap-1 rounded-md text-sm text-zinc-400 underline-offset-4 transition hover:text-brand hover:underline focus-visible:outline-none"
        >
          <PlusIcon aria-hidden className="h-3.5 w-3.5" /> 为什么重要（可选）
        </button>
      )}

      <Button type="submit" size="lg" fullWidth disabled={!content.trim()}>
        记下 <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-xs font-normal">⌘↵</kbd>
      </Button>
    </form>
  );
}
