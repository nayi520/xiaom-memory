'use client';

import { useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';

export default function TextCapture({
  addOptimistic,
  confirmNote,
  failNote,
}: CaptureHandlers) {
  const [content, setContent] = useState('');
  const [why, setWhy] = useState('');
  const [showWhy, setShowWhy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = content.trim();
    if (!text) return;

    // 乐观 UI：立即上屏、立即清空，可连续记录
    const temp = makeTempNote({
      type: 'text',
      raw_content: text,
      why_important: why.trim() || null,
    });
    addOptimistic(temp);
    setContent('');
    setWhy('');
    textareaRef.current?.focus();

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          raw_content: text,
          why_important: temp.why_important,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.note) {
        confirmNote(temp.id, data.note as Note);
      } else {
        failNote(temp.id, data.error || '保存失败，请重试');
      }
    } catch {
      failNote(temp.id, '网络错误，保存失败');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Cmd/Ctrl + Enter 快速提交
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        ref={textareaRef}
        autoFocus
        rows={4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="记下此刻想留住的内容…（支持 Markdown）"
        className="w-full resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-base leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900"
      />

      {showWhy ? (
        <input
          autoFocus
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="为什么觉得重要？（一句话，可不填）"
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowWhy(true)}
          className="text-sm text-zinc-400 underline-offset-2 hover:underline"
        >
          + 为什么重要（可选）
        </button>
      )}

      <button
        type="submit"
        disabled={!content.trim()}
        className="w-full rounded-2xl bg-brand py-3.5 text-base font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
      >
        记下（⌘↵）
      </button>
    </form>
  );
}
