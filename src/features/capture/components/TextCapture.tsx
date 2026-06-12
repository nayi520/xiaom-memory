'use client';

import { useRef, useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { Button, Textarea, Input } from '@/components/ui';

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
          className="inline-flex items-center gap-1 rounded-md text-sm text-zinc-400 underline-offset-4 transition hover:text-brand hover:underline"
        >
          <span aria-hidden>＋</span> 为什么重要（可选）
        </button>
      )}

      <Button type="submit" size="lg" fullWidth disabled={!content.trim()}>
        记下 <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-xs font-normal">⌘↵</kbd>
      </Button>
    </form>
  );
}
