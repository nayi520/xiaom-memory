'use client';

import { useState } from 'react';
import type { Note } from '@/lib/types';
import { makeTempNote, type CaptureHandlers } from '../types';
import { Button, Input } from '@/components/ui';

export default function LinkCapture({
  addOptimistic,
  confirmNote,
  failNote,
}: CaptureHandlers) {
  const [url, setUrl] = useState('');
  const [why, setWhy] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

    // 乐观上屏，立即清空可记下一条
    const temp = makeTempNote({
      type: 'link',
      url: target,
      raw_content: target,
      why_important: why.trim() || null,
      hint: '抓取中…',
    });
    addOptimistic(temp);
    setUrl('');
    setWhy('');

    try {
      const res = await fetch('/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, why_important: temp.why_important }),
      });
      const result = await res.json();
      if (res.ok && result.note) {
        confirmNote(temp.id, result.note as Note, result.warning);
      } else {
        failNote(temp.id, result.error || '剪藏失败');
      }
    } catch {
      failNote(temp.id, '网络错误，剪藏失败');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        autoFocus
        type="text"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="粘贴链接，自动抓取标题和正文…"
        className="rounded-card px-4 py-3.5"
      />
      <Input
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="为什么觉得重要？（一句话，可不填）"
        className="px-4 py-2.5 text-sm"
      />
      <Button type="submit" size="lg" fullWidth disabled={!url.trim()}>
        剪藏链接
      </Button>
    </form>
  );
}
