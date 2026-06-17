'use client';

/**
 * 概念详情「新建卡片」入口（V15 手动建卡）。
 * 点击展开内联表单：问题 + 答案（均必填）→ POST /api/cards { conceptId, question, answer }。
 * 新卡初始化为 FSRS new 状态、status active（服务端处理）；成功后 toast + router.refresh()。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Input,
  Textarea,
  PlusIcon,
  CloseIcon,
  useToast,
  cardClass,
  cn,
} from '@/components/ui';
import { apiFetch } from '@/lib/api';

export default function NewCardButton({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '' });

  function reset() {
    setForm({ question: '', answer: '' });
  }

  async function submit() {
    if (!form.question.trim() || !form.answer.trim()) {
      toastError('问题与答案都不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conceptId,
          question: form.question.trim(),
          answer: form.answer.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? `创建失败（${res.status}）`);
        return;
      }
      success('卡片已创建');
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden className="h-4 w-4" />
        新建卡片
      </Button>
    );
  }

  return (
    <div className={cn(cardClass({ padded: false }), 'px-4 py-4')}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">新建卡片</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="rounded-md p-1 text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
          aria-label="取消"
        >
          <CloseIcon aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2.5">
        <Input
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="问题（正面）"
          autoFocus
        />
        <Textarea
          value={form.answer}
          onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
          placeholder="答案（背面）"
          rows={3}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          取消
        </Button>
        <Button
          size="sm"
          onClick={submit}
          loading={saving}
          disabled={!form.question.trim() || !form.answer.trim()}
        >
          创建
        </Button>
      </div>
    </div>
  );
}
