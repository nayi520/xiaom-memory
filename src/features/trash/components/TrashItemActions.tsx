'use client';

/**
 * 回收站单条记录的操作（PRD F5）：恢复 / 永久删除。
 *  - 恢复：PATCH /api/notes/[id] { action:'restore' } → deleted_at = null
 *  - 永久删除：DELETE /api/notes/[id]（二次确认，硬删 note 行；派生概念/卡片保留）
 * 操作成功后 router.refresh() 重新渲染服务端列表。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

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
    <div className="mt-2.5 flex flex-col items-end gap-1.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
      {!confirming ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={restore}
            loading={busy === 'restore'}
            disabled={busy !== null}
          >
            {busy === 'restore' ? '恢复中…' : '↩️ 恢复'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={busy !== null}
          >
            永久删除
          </Button>
        </div>
      ) : (
        <div className="animate-scale-in flex flex-col items-end gap-2">
          <p className="text-xs text-zinc-400">永久删除后无法恢复，确定？</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="dangerSolid"
              onClick={purge}
              loading={busy === 'purge'}
              disabled={busy !== null}
            >
              {busy === 'purge' ? '删除中…' : '确认永久删除'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              取消
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
