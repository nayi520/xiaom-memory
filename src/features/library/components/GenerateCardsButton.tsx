'use client';

/**
 * 概念详情「AI 出题」入口（V16 AI 增强）。
 * 点击展开张数选择（1~10，默认 3）→ POST /api/generate-cards { conceptId, count }
 * → AI 据概念解释 + 关联记录批量生成卡片（服务端初始化 FSRS new + status active）。
 * 成功后 toast（含生成数量）+ router.refresh() 刷新卡片列表；429/503 等错误友好提示、不崩溃。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  AiIcon,
  CloseIcon,
  useToast,
  cardClass,
  cn,
} from '@/components/ui';

const COUNT_OPTIONS = [2, 3, 5];

export default function GenerateCardsButton({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const { success, error: toastError, info } = useToast();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [running, setRunning] = useState(false);

  async function generate() {
    setRunning(true);
    try {
      const res = await fetch('/api/generate-cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conceptId, count }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data?.error ?? `生成失败（${res.status}）`);
        return;
      }
      const created = typeof data?.created === 'number' ? data.created : 0;
      if (created === 0) {
        info('这个概念暂时凑不出合适的题，补充些记录后再试试');
        return;
      }
      success(`已生成 ${created} 张卡片`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <AiIcon aria-hidden className="h-4 w-4" />
        AI 出题
      </Button>
    );
  }

  return (
    <div className={cn(cardClass({ padded: false }), 'px-4 py-4')}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          <AiIcon aria-hidden className="h-4 w-4 text-brand" />
          AI 出题
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
          aria-label="取消"
        >
          <CloseIcon aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        小M 会根据这个概念的解释和你的相关记录，自动出几道复习题。
      </p>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">生成数量</span>
        <div className="flex gap-1.5">
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={cn(
                'rounded-pill px-3 py-1 text-xs font-medium transition focus-visible:outline-none',
                count === n
                  ? 'bg-brand text-white shadow-sm'
                  : 'border border-zinc-200 bg-white text-zinc-600 hover:border-brand hover:text-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
              )}
            >
              {n} 张
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button size="sm" onClick={generate} loading={running}>
          {running ? '出题中…' : '开始出题'}
        </Button>
      </div>
    </div>
  );
}
