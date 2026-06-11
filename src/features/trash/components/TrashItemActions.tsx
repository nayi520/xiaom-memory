'use client';

/**
 * 回收站单条记录的操作（PRD F5）：恢复 / 永久删除。
 *  - 恢复：PATCH /api/notes/[id] { action:'restore' } → deleted_at = null
 *  - 永久删除：DELETE /api/notes/[id]（二次确认，硬删 note 行；派生概念/卡片保留）
 * 操作成功后 router.refresh() 重新渲染服务端列表。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TrashItemActions({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'restore' | 'purge'>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy('restore');
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `恢复失败（${res.status}）`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setBusy(null);
    }
  }

  async function purge() {
    setBusy('purge');
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `永久删除失败（${res.status}）`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col items-end gap-1.5">
      {!confirming ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={restore}
            disabled={busy !== null}
            className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-50"
          >
            {busy === 'restore' ? '恢复中…' : '↩️ 恢复'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={busy !== null}
            className="rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition active:text-red-500 disabled:opacity-50 dark:border-zinc-700"
          >
            永久删除
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-xs text-zinc-400">永久删除后无法恢复，确定？</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={purge}
              disabled={busy !== null}
              className="rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-50"
            >
              {busy === 'purge' ? '删除中…' : '确认永久删除'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
              className="rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition active:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
