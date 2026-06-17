'use client';

/**
 * 知识库「新建概念」入口（V15 手动建概念）。
 * 点击展开内联表单：名称（必填）/ 解释 / 领域 / 主题 → POST /api/library/concept/create。
 * 成功后 toast + router.refresh()（刷新下钻树 / 列表），并跳到新概念详情页。
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

export default function NewConceptButton() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', summary: '', domain: '', topic: '' });

  function reset() {
    setForm({ name: '', summary: '', domain: '', topic: '' });
  }

  async function submit() {
    if (!form.name.trim()) {
      toastError('概念名不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/library/concept/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          summary: form.summary.trim() || undefined,
          domain: form.domain.trim() || undefined,
          topic: form.topic.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(data.error ?? `创建失败（${res.status}）`);
        return;
      }
      success('概念已创建');
      setOpen(false);
      reset();
      if (data.concept?.id) {
        router.push(`/library/concept/${data.concept.id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden className="h-[18px] w-[18px]" />
        新建概念
      </Button>
    );
  }

  return (
    <div className={cn(cardClass({ padded: false }), 'mb-4 px-4 py-4')}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">新建概念</h2>
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
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="概念名（必填）"
          autoFocus
          maxLength={120}
        />
        <Textarea
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
          placeholder="解释（可选）"
          rows={3}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Input
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
            placeholder="领域（可选）"
            maxLength={60}
          />
          <Input
            value={form.topic}
            onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
            placeholder="主题（可选）"
            maxLength={60}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          取消
        </Button>
        <Button onClick={submit} loading={saving} disabled={!form.name.trim()}>
          创建
        </Button>
      </div>
    </div>
  );
}
