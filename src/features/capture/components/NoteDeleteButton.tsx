'use client';

/**
 * 记录"删除"按钮（PRD F5 软删除回收站）。
 * 点击 → 二次确认（无罪化文案：移到回收站，可恢复）→ PATCH /api/notes/[id] { action:'trash' }。
 * 成功后：
 *  - 提供 onTrashed 时交给父组件做乐观移除（如最近记录列表）；
 *  - 否则跳转回知识库（如记录详情页删除后该页已不可访问）。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TrashIcon, useToast } from '@/components/ui';

export default function NoteDeleteButton({
  noteId,
  onTrashed,
  redirectTo,
  className,
  label = '删除',
}: {
  noteId: string;
  onTrashed?: () => void;
  redirectTo?: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function trash() {
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'trash' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data.error ?? `删除失败（${res.status}）`);
        setBusy(false);
        return;
      }
      success('已移到回收站');
      onTrashed?.();
      if (redirectTo) {
        router.replace(redirectTo);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '网络错误');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={
          className ??
          'shrink-0 rounded-md p-1.5 text-zinc-300 opacity-60 transition hover:bg-red-50 hover:text-red-500 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950'
        }
        aria-label="删除这条记录"
        title={label}
      >
        <TrashIcon aria-hidden className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="animate-scale-in flex flex-col items-end gap-2">
      <p className="text-xs text-zinc-400">移到回收站？可在回收站恢复。</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="dangerSolid" onClick={trash} loading={busy}>
          {busy ? '处理中…' : '移到回收站'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          取消
        </Button>
      </div>
    </div>
  );
}
