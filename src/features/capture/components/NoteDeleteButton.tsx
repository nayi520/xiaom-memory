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
import { Button } from '@/components/ui';

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
          'shrink-0 rounded-md p-1.5 text-zinc-300 opacity-60 transition hover:bg-red-50 hover:text-red-500 hover:opacity-100 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-red-950'
        }
        aria-label="删除这条记录"
        title={label}
      >
        <TrashGlyph />
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
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
