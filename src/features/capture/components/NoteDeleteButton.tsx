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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trash() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'trash' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `删除失败（${res.status}）`);
        setBusy(false);
        return;
      }
      onTrashed?.();
      if (redirectTo) {
        router.replace(redirectTo);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className={
          className ??
          'shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-400 transition active:text-red-500'
        }
        aria-label="删除这条记录"
      >
        🗑️ {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="text-xs text-zinc-400">移到回收站？可在回收站恢复。</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={trash}
          disabled={busy}
          className="rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-50"
        >
          {busy ? '处理中…' : '移到回收站'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition active:bg-zinc-50 dark:border-zinc-700"
        >
          取消
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
